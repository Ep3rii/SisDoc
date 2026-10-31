import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { REGRAS_PLANILHA } from '@sisdoc/calculo';
import {
  rascunhoDofSchema,
  resultadoCalculoDofSchema,
  solicitarCalculoDofSchema,
  type AtualizarRascunhoDof,
  type Configuracao,
  type CriarRascunhoDof,
  type PaginaRascunhosDof,
  type RascunhoDof,
  type SolicitarCalculoDof,
} from '@sisdoc/contratos';
import type { Pool, PoolClient } from 'pg';
import { transacao } from '../banco';
import { calcularDofNaTransacao } from '../calculos/calculos';
import { TEMPLATE_DOF_PROVISORIO } from '../migracoes/rascunho-dof';
import { auditarConsultaFuncional } from '../seguranca/auditoria-funcional';
import type { SessaoAutenticada } from '../seguranca/autenticacao';
import { papeisPermitidos } from '../seguranca/permissoes';
import { ProtetorDados } from '../seguranca/protecao-dados';
import { confirmarSessao } from '../seguranca/sessao-transacao';

type LinhaRascunho = {
  id: string;
  pessoa_id: string;
  vinculo_id: string;
  nome: string;
  matricula: string;
  admissao: string | null;
  revisao: number;
  criado_em: Date;
  atualizado_em: Date;
  entrada_cifrada: Buffer;
  resultado_calculo_cifrado: Buffer | null;
  regra_codigo: string;
  regra_versao: string;
  regra_atual: boolean;
};

type Falha = { tipo: 'invalido' | 'conflito' | 'nao_encontrado'; mensagem: string };
type Tentativa<T> = { valor: T } | { falha: Falha };
type Mudanca = { campo: string; anterior: unknown; novo: unknown };

function concluir<T>(tentativa: Tentativa<T>): T {
  if ('valor' in tentativa) return tentativa.valor;
  if (tentativa.falha.tipo === 'conflito') throw new ConflictException(tentativa.falha.mensagem);
  if (tentativa.falha.tipo === 'nao_encontrado') throw new NotFoundException(tentativa.falha.mensagem);
  throw new BadRequestException(tentativa.falha.mensagem);
}

function entradaOrdenada(entrada: SolicitarCalculoDof): SolicitarCalculoDof {
  return { ...entrada, anos: [...entrada.anos].sort((a, b) => a.ano - b.ano) };
}

function mudancas(anterior: SolicitarCalculoDof | null, novo: SolicitarCalculoDof): Mudanca[] {
  const resultado: Mudanca[] = [];
  const adicionar = (campo: string, valorAnterior: unknown, valorNovo: unknown) => {
    if (JSON.stringify(valorAnterior) !== JSON.stringify(valorNovo)) {
      resultado.push({ campo, anterior: valorAnterior, novo: valorNovo });
    }
  };
  adicionar('periodo.inicio', anterior?.inicio ?? null, novo.inicio);
  adicionar('periodo.fim', anterior?.fim ?? null, novo.fim);
  adicionar('acumulado_anterior', anterior?.acumuladoAnterior ?? null, novo.acumuladoAnterior ?? null);
  const anteriores = new Map((anterior?.anos ?? []).map((ano) => [ano.ano, ano]));
  const novos = new Map(novo.anos.map((ano) => [ano.ano, ano]));
  const anos = new Set([...anteriores.keys(), ...novos.keys()]);
  for (const ano of [...anos].sort((a, b) => a - b)) {
    adicionar(`anos.${ano}`, anteriores.get(ano) ?? null, novos.get(ano) ?? null);
  }
  return resultado;
}

export class RascunhosService {
  private readonly protetor: ProtetorDados;

  constructor(private readonly banco: Pool, configuracao: Configuracao) {
    this.protetor = new ProtetorDados(configuracao.chaves);
  }

  private cifrar(tabela: string, id: string, campo: string, valor: unknown): Buffer {
    return this.protetor.cifrar(Buffer.from(JSON.stringify(valor), 'utf8'), {
      schema: 'documentos', tabela, registroId: id, campo,
    });
  }

  private ler(tabela: string, id: string, campo: string, valor: Buffer): unknown {
    return JSON.parse(this.protetor.decifrar(valor, {
      schema: 'documentos', tabela, registroId: id, campo,
    }).toString('utf8'));
  }

  private apresentar(linha: LinhaRascunho): RascunhoDof {
    if (!linha.resultado_calculo_cifrado) throw new Error('Rascunho sem resultado de cálculo protegido.');
    const entrada = solicitarCalculoDofSchema.parse(this.ler('documento', linha.id, 'entrada_cifrada', linha.entrada_cifrada));
    if (entrada.pessoaId !== linha.pessoa_id || entrada.vinculoId !== linha.vinculo_id) {
      throw new Error('Identidade do rascunho é inconsistente.');
    }
    const resultado = resultadoCalculoDofSchema.parse(
      this.ler('documento', linha.id, 'resultado_calculo_cifrado', linha.resultado_calculo_cifrado),
    );
    if (resultado.regra.codigo !== linha.regra_codigo || resultado.regra.versao !== linha.regra_versao) {
      throw new Error('Versão de regra do rascunho é inconsistente.');
    }
    const inicioEfetivo = entrada.inicio < resultado.admissaoConsiderada ? resultado.admissaoConsiderada : entrada.inicio;
    if (resultado.periodo.inicioInformado !== entrada.inicio || resultado.periodo.inicioEfetivo !== inicioEfetivo
        || resultado.periodo.fim !== entrada.fim) {
      throw new Error('Período calculado do rascunho é inconsistente.');
    }
    return rascunhoDofSchema.parse({
      id: linha.id,
      pessoaId: linha.pessoa_id,
      vinculoId: linha.vinculo_id,
      nome: linha.nome,
      matricula: linha.matricula,
      admissao: linha.admissao,
      revisao: linha.revisao,
      criadoEm: linha.criado_em.toISOString(),
      atualizadoEm: linha.atualizado_em.toISOString(),
      status: 'rascunho',
      entrada,
      resultado,
    });
  }

  private async linha(
    cliente: PoolClient,
    id: string,
    autorId: string,
    bloquear = false,
  ): Promise<LinhaRascunho | undefined> {
    const consulta = await cliente.query<LinhaRascunho>(`
      SELECT d.id, d.pessoa_id, d.vinculo_id, p.nome, v.matricula,
        to_char(v.admissao, 'YYYY-MM-DD') AS admissao, d.revisao, d.criado_em, d.atualizado_em,
        d.entrada_cifrada, d.resultado_calculo_cifrado, r.codigo AS regra_codigo, r.versao AS regra_versao,
        (r.codigo = $3 AND r.versao = $4 AND r.configuracao = $5::jsonb) AS regra_atual
      FROM documentos.documento d
      JOIN nucleo.pessoa p ON p.id = d.pessoa_id
      JOIN nucleo.vinculo v ON v.id = d.vinculo_id AND v.pessoa_id = d.pessoa_id
      JOIN documentos.regra_versao r ON r.id = d.regra_versao_id
      WHERE d.id = $1 AND d.criado_por = $2 AND d.tipo = 'DOF' AND d.status = 'rascunho'
      ${bloquear ? 'FOR UPDATE OF d' : ''}
    `, [id, autorId, REGRAS_PLANILHA.codigo, REGRAS_PLANILHA.versao, JSON.stringify(REGRAS_PLANILHA)]);
    return consulta.rows[0];
  }

  private async registrarAjustes(
    cliente: PoolClient,
    documentoId: string,
    usuarioId: string,
    motivo: string,
    alteracoes: Mudanca[],
  ): Promise<void> {
    for (const alteracao of alteracoes) {
      const id = randomUUID();
      await cliente.query(`
        INSERT INTO documentos.ajuste_campo
          (id, documento_id, campo, valor_original_cifrado, valor_novo_cifrado, motivo_cifrado, usuario_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        id, documentoId, alteracao.campo,
        alteracao.anterior === null ? null : this.cifrar('ajuste_campo', id, 'valor_original_cifrado', alteracao.anterior),
        this.cifrar('ajuste_campo', id, 'valor_novo_cifrado', alteracao.novo),
        this.cifrar('ajuste_campo', id, 'motivo_cifrado', motivo),
        usuarioId,
      ]);
    }
  }

  async listar(sessao: SessaoAutenticada, ip: string, limite: number, cursor?: string): Promise<PaginaRascunhosDof> {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('criar_rascunho'));
      const consulta = await cliente.query<Pick<LinhaRascunho, 'id' | 'pessoa_id' | 'vinculo_id' | 'nome' | 'matricula' | 'revisao' | 'atualizado_em'>>(`
        SELECT d.id, d.pessoa_id, d.vinculo_id, p.nome, v.matricula, d.revisao, d.atualizado_em
        FROM documentos.documento d
        JOIN nucleo.pessoa p ON p.id = d.pessoa_id
        JOIN nucleo.vinculo v ON v.id = d.vinculo_id AND v.pessoa_id = d.pessoa_id
        WHERE d.criado_por = $1 AND d.tipo = 'DOF' AND d.status = 'rascunho'
          AND ($2::uuid IS NULL OR d.id > $2::uuid)
        ORDER BY d.id LIMIT $3
      `, [sessao.usuario.id, cursor ?? null, limite + 1]);
      await auditarConsultaFuncional(cliente, sessao, 'rascunhos_listados', 'documento', null, null, ip);
      return {
        itens: consulta.rows.slice(0, limite).map((linha) => ({
          id: linha.id, pessoaId: linha.pessoa_id, vinculoId: linha.vinculo_id,
          nome: linha.nome, matricula: linha.matricula, revisao: linha.revisao, atualizadoEm: linha.atualizado_em.toISOString(),
        })),
        proximoCursor: consulta.rows.length > limite ? consulta.rows[limite - 1].id : null,
      };
    });
  }

  async obter(sessao: SessaoAutenticada, ip: string, id: string): Promise<RascunhoDof> {
    const tentativa = await transacao<Tentativa<RascunhoDof>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('criar_rascunho'));
      const linha = await this.linha(cliente, id, sessao.usuario.id);
      await auditarConsultaFuncional(cliente, sessao, linha ? 'rascunho_aberto' : 'rascunho_nao_encontrado',
        'documento', id, linha?.pessoa_id ?? null, ip);
      if (!linha) return { falha: { tipo: 'nao_encontrado', mensagem: 'Rascunho não encontrado.' } };
      return { valor: this.apresentar(linha) };
    });
    return concluir(tentativa);
  }

  async criar(sessao: SessaoAutenticada, ip: string, dados: CriarRascunhoDof): Promise<RascunhoDof> {
    const tentativa = await transacao<Tentativa<RascunhoDof>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('criar_rascunho'));
      const entrada = entradaOrdenada(dados.calculo);
      const calculo = await calcularDofNaTransacao(cliente, sessao, ip, entrada, dados.admissaoEsperada);
      if ('erro' in calculo) return { falha: { tipo: 'invalido', mensagem: calculo.erro } };
      if ('conflito' in calculo) {
        await auditarConsultaFuncional(cliente, sessao, 'rascunho_admissao_alterada', 'vinculo', entrada.vinculoId, entrada.pessoaId, ip);
        return { falha: { tipo: 'conflito', mensagem: calculo.conflito } };
      }
      const versoes = await cliente.query<{ template_id: string; regra_id: string }>(`
        SELECT t.id AS template_id, r.id AS regra_id
        FROM documentos.template_versao t CROSS JOIN documentos.regra_versao r
        WHERE t.tipo = 'DOF' AND t.versao = $1 AND r.codigo = $2 AND r.versao = $3
          AND r.configuracao = $4::jsonb
      `, [TEMPLATE_DOF_PROVISORIO, REGRAS_PLANILHA.codigo, REGRAS_PLANILHA.versao, JSON.stringify(REGRAS_PLANILHA)]);
      const versao = versoes.rows[0];
      if (!versao) throw new ServiceUnavailableException('As versões provisórias de cálculo e modelo não estão disponíveis.');
      const id = randomUUID();
      await cliente.query(`
        INSERT INTO documentos.documento (
          id, tipo, pessoa_id, vinculo_id, entrada_cifrada, resultado_calculo_cifrado,
          template_versao_id, regra_versao_id, criado_por, atualizado_por
        ) VALUES ($1, 'DOF', $2, $3, $4, $5, $6, $7, $8, $8)
      `, [
        id, entrada.pessoaId, entrada.vinculoId, this.cifrar('documento', id, 'entrada_cifrada', entrada),
        this.cifrar('documento', id, 'resultado_calculo_cifrado', calculo.resultado),
        versao.template_id, versao.regra_id, sessao.usuario.id,
      ]);
      await cliente.query(`
        INSERT INTO documentos.documento_periodo (id, documento_id, ordem, inicio, fim)
        VALUES ($1, $2, 1, $3, $4)
      `, [randomUUID(), id, entrada.inicio, entrada.fim]);
      await this.registrarAjustes(cliente, id, sessao.usuario.id, dados.motivo, mudancas(null, entrada));
      await auditarConsultaFuncional(cliente, sessao, 'rascunho_criado', 'documento', id, entrada.pessoaId, ip);
      const linha = await this.linha(cliente, id, sessao.usuario.id);
      if (!linha) throw new Error('Rascunho recém-criado não pôde ser recuperado.');
      return { valor: this.apresentar(linha) };
    });
    return concluir(tentativa);
  }

  async atualizar(sessao: SessaoAutenticada, ip: string, id: string, dados: AtualizarRascunhoDof): Promise<RascunhoDof> {
    const tentativa = await transacao<Tentativa<RascunhoDof>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('editar_rascunho'));
      const linha = await this.linha(cliente, id, sessao.usuario.id, true);
      if (!linha) {
        await auditarConsultaFuncional(cliente, sessao, 'rascunho_nao_encontrado', 'documento', id, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'Rascunho não encontrado.' } };
      }
      if (linha.revisao !== dados.revisao || linha.revisao === 2147483647) {
        await auditarConsultaFuncional(cliente, sessao, 'rascunho_conflito', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'O rascunho foi alterado ou atingiu o limite de revisões; reabra-o antes de continuar.' } };
      }
      if (!linha.regra_atual) {
        await auditarConsultaFuncional(cliente, sessao, 'rascunho_regra_incompativel', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A versão de regra deste rascunho não é a versão disponível para cálculo. Contate o administrador.' } };
      }
      const anterior = this.apresentar(linha);
      const entrada = entradaOrdenada(dados.calculo);
      if (entrada.pessoaId !== linha.pessoa_id || entrada.vinculoId !== linha.vinculo_id) {
        return { falha: { tipo: 'invalido', mensagem: 'Pessoa e vínculo do rascunho não podem ser alterados.' } };
      }
      const anosAtuais = new Set(entrada.anos.map((ano) => ano.ano));
      const anosRemovidos = anterior.entrada.anos.map((ano) => ano.ano)
        .filter((ano) => !anosAtuais.has(ano)).sort((a, b) => a - b);
      const anosConfirmados = [...(dados.anosRemovidosConfirmados ?? [])].sort((a, b) => a - b);
      if (anosRemovidos.length !== anosConfirmados.length
          || anosRemovidos.some((ano, indice) => ano !== anosConfirmados[indice])) {
        return { falha: { tipo: 'invalido', mensagem: 'Confirme explicitamente todos os anos removidos do rascunho.' } };
      }
      const alteracoes = mudancas(anterior.entrada, entrada);
      if (anterior.resultado.admissaoConsiderada !== dados.admissaoEsperada) {
        alteracoes.push({
          campo: 'admissao_considerada',
          anterior: anterior.resultado.admissaoConsiderada,
          novo: dados.admissaoEsperada,
        });
      }
      if (alteracoes.length === 0) return { falha: { tipo: 'conflito', mensagem: 'Nenhuma alteração foi identificada no rascunho.' } };
      const calculo = await calcularDofNaTransacao(cliente, sessao, ip, entrada, dados.admissaoEsperada);
      if ('erro' in calculo) return { falha: { tipo: 'invalido', mensagem: calculo.erro } };
      if ('conflito' in calculo) {
        await auditarConsultaFuncional(cliente, sessao, 'rascunho_admissao_alterada', 'documento', id, entrada.pessoaId, ip);
        return { falha: { tipo: 'conflito', mensagem: calculo.conflito } };
      }
      await cliente.query(`
        UPDATE documentos.documento SET entrada_cifrada = $1, resultado_calculo_cifrado = $2,
          atualizado_por = $3, atualizado_em = now(), revisao = revisao + 1 WHERE id = $4
      `, [
        this.cifrar('documento', id, 'entrada_cifrada', entrada),
        this.cifrar('documento', id, 'resultado_calculo_cifrado', calculo.resultado), sessao.usuario.id, id,
      ]);
      await cliente.query('UPDATE documentos.documento_periodo SET inicio = $1, fim = $2 WHERE documento_id = $3 AND ordem = 1',
        [entrada.inicio, entrada.fim, id]);
      await this.registrarAjustes(cliente, id, sessao.usuario.id, dados.motivo, alteracoes);
      await auditarConsultaFuncional(cliente, sessao, 'rascunho_editado', 'documento', id, entrada.pessoaId, ip);
      const atualizado = await this.linha(cliente, id, sessao.usuario.id);
      if (!atualizado) throw new Error('Rascunho atualizado não pôde ser recuperado.');
      return { valor: this.apresentar(atualizado) };
    });
    return concluir(tentativa);
  }
}
