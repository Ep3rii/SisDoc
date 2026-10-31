import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { REGRAS_PLANILHA } from '@sisdoc/calculo';
import {
  blocoRascunhoDofSchema,
  numeroProcessoSchema,
  processoCorrespondeMascara,
  rascunhoDofSchema,
  resultadoCalculoDofSchema,
  solicitarCalculoDofSchema,
  type AtualizarBlocosDof,
  type AtualizarProcessoDof,
  type AtualizarRascunhoDof,
  type BlocoRascunhoDof,
  type CodigoBlocoDof,
  type Configuracao,
  type CriarRascunhoDof,
  type PaginaRascunhosDof,
  type RascunhoDof,
  type SolicitarCalculoDof,
} from '@sisdoc/contratos';
import { DatabaseError, type Pool, type PoolClient } from 'pg';
import { transacao } from '../banco';
import { calcularDofNaTransacao } from '../calculos/calculos';
import { VERSAO_BLOCO_VAZIO } from '../migracoes/blocos-dof';
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
  processo_cifrado: Buffer | null;
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
  private readonly mascarasProcesso: string[];

  constructor(private readonly banco: Pool, configuracao: Configuracao) {
    this.protetor = new ProtetorDados(configuracao.chaves);
    this.mascarasProcesso = configuracao.processos?.mascaras ?? [];
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

  private async blocos(cliente: PoolClient, documentoId: string): Promise<BlocoRascunhoDof[]> {
    const consulta = await cliente.query<{
      id: string; codigo: string; ordem: number; ativo: boolean; texto_final_cifrado: Buffer | null;
    }>(`
      SELECT b.id, t.codigo, b.ordem, b.ativo, b.texto_final_cifrado
      FROM documentos.documento_bloco b
      JOIN documentos.bloco_versao v ON v.id = b.bloco_versao_id
      JOIN documentos.bloco_texto t ON t.id = v.bloco_id
      WHERE b.documento_id = $1 ORDER BY b.ordem
    `, [documentoId]);
    return consulta.rows.map((linha, indice) => {
      if (linha.ordem !== indice + 1 || !linha.texto_final_cifrado) {
        throw new Error('Conteúdo ou ordem dos blocos do rascunho é inconsistente.');
      }
      return blocoRascunhoDofSchema.parse({
        id: linha.id, codigo: linha.codigo, ativo: linha.ativo,
        texto: this.ler('documento_bloco', linha.id, 'texto_final_cifrado', linha.texto_final_cifrado),
      });
    });
  }

  private async apresentar(cliente: PoolClient, linha: LinhaRascunho): Promise<RascunhoDof> {
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
      blocos: await this.blocos(cliente, linha.id),
      processo: linha.processo_cifrado
        ? numeroProcessoSchema.parse(this.ler('documento', linha.id, 'processo_cifrado', linha.processo_cifrado)) : null,
      mascarasProcesso: this.mascarasProcesso,
    });
  }

  private async linha(
    cliente: PoolClient,
    id: string,
    autorId: string,
    bloquear?: 'leitura' | 'alteracao',
  ): Promise<LinhaRascunho | undefined> {
    const consulta = await cliente.query<LinhaRascunho>(`
      SELECT d.id, d.pessoa_id, d.vinculo_id, p.nome, v.matricula,
        to_char(v.admissao, 'YYYY-MM-DD') AS admissao, d.revisao, d.criado_em, d.atualizado_em,
        d.entrada_cifrada, d.resultado_calculo_cifrado, d.processo_cifrado,
        r.codigo AS regra_codigo, r.versao AS regra_versao,
        (r.codigo = $3 AND r.versao = $4 AND r.configuracao = $5::jsonb) AS regra_atual
      FROM documentos.documento d
      JOIN nucleo.pessoa p ON p.id = d.pessoa_id
      JOIN nucleo.vinculo v ON v.id = d.vinculo_id AND v.pessoa_id = d.pessoa_id
      JOIN documentos.regra_versao r ON r.id = d.regra_versao_id
      WHERE d.id = $1 AND d.criado_por = $2 AND d.tipo = 'DOF' AND d.status = 'rascunho'
      ${bloquear === 'alteracao' ? 'FOR UPDATE OF d' : bloquear === 'leitura' ? 'FOR SHARE OF d' : ''}
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

  private async obterAuditado(
    sessao: SessaoAutenticada, ip: string, id: string, acao: 'rascunho_aberto' | 'previa_dof_aberta',
  ): Promise<RascunhoDof> {
    const tentativa = await transacao<Tentativa<RascunhoDof>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('criar_rascunho'));
      const linha = await this.linha(cliente, id, sessao.usuario.id, 'leitura');
      await auditarConsultaFuncional(cliente, sessao, linha ? acao : 'rascunho_nao_encontrado',
        'documento', id, linha?.pessoa_id ?? null, ip);
      if (!linha) return { falha: { tipo: 'nao_encontrado', mensagem: 'Rascunho não encontrado.' } };
      return { valor: await this.apresentar(cliente, linha) };
    });
    return concluir(tentativa);
  }

  async obter(sessao: SessaoAutenticada, ip: string, id: string): Promise<RascunhoDof> {
    return this.obterAuditado(sessao, ip, id, 'rascunho_aberto');
  }

  async obterParaPrevia(sessao: SessaoAutenticada, ip: string, id: string): Promise<RascunhoDof> {
    return this.obterAuditado(sessao, ip, id, 'previa_dof_aberta');
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
      return { valor: await this.apresentar(cliente, linha) };
    });
    return concluir(tentativa);
  }

  async atualizar(sessao: SessaoAutenticada, ip: string, id: string, dados: AtualizarRascunhoDof): Promise<RascunhoDof> {
    const tentativa = await transacao<Tentativa<RascunhoDof>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('editar_rascunho'));
      const linha = await this.linha(cliente, id, sessao.usuario.id, 'alteracao');
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
      const anterior = await this.apresentar(cliente, linha);
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
      return { valor: await this.apresentar(cliente, atualizado) };
    });
    return concluir(tentativa);
  }

  async atualizarBlocos(
    sessao: SessaoAutenticada,
    ip: string,
    id: string,
    dados: AtualizarBlocosDof,
  ): Promise<RascunhoDof> {
    const tentativa = await transacao<Tentativa<RascunhoDof>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('editar_rascunho'));
      const linha = await this.linha(cliente, id, sessao.usuario.id, 'alteracao');
      if (!linha) {
        await auditarConsultaFuncional(cliente, sessao, 'rascunho_nao_encontrado', 'documento', id, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'Rascunho não encontrado.' } };
      }
      if (linha.revisao !== dados.revisao || linha.revisao === 2147483647) {
        await auditarConsultaFuncional(cliente, sessao, 'rascunho_conflito', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'O rascunho foi alterado ou atingiu o limite de revisões; reabra-o antes de continuar.' } };
      }
      const anterior = await this.apresentar(cliente, linha);
      const antigos = new Map(anterior.blocos.map((bloco, indice) => [bloco.id, { ...bloco, ordem: indice + 1 }]));
      const novos = new Map(dados.blocos.map((bloco) => [bloco.id, bloco]));
      if ([...antigos.keys()].some((blocoId) => !novos.has(blocoId))) {
        return { falha: { tipo: 'invalido', mensagem: 'Blocos existentes não podem ser apagados; desative-os para preservá-los.' } };
      }
      if (dados.blocos.some((bloco) => antigos.has(bloco.id) && antigos.get(bloco.id)?.codigo !== bloco.codigo)) {
        return { falha: { tipo: 'invalido', mensagem: 'O tipo de um bloco existente não pode ser alterado.' } };
      }
      const alteracoes: Mudanca[] = [];
      for (const [indice, bloco] of dados.blocos.entries()) {
        const antigo = antigos.get(bloco.id) ?? null;
        const novo = { ...bloco, ordem: indice + 1 };
        if (JSON.stringify(antigo) !== JSON.stringify(novo)) {
          alteracoes.push({ campo: `blocos.${bloco.id}`, anterior: antigo, novo });
        }
      }
      if (alteracoes.length === 0) return { falha: { tipo: 'conflito', mensagem: 'Nenhuma alteração foi identificada nos blocos.' } };
      const criados = dados.blocos.filter((bloco) => !antigos.has(bloco.id));
      const codigos = [...new Set(criados.map((bloco) => bloco.codigo))];
      const catalogo = await cliente.query<{ id: string; codigo: CodigoBlocoDof }>(`
        SELECT v.id, t.codigo FROM documentos.bloco_texto t
        JOIN documentos.bloco_versao v ON v.bloco_id = t.id
        WHERE t.ativo AND t.codigo = ANY($1::text[]) AND v.versao = $2
          AND t.tipos_documento @> ARRAY['DOF']::text[]
      `, [codigos, VERSAO_BLOCO_VAZIO]);
      if (catalogo.rows.length !== codigos.length) {
        throw new ServiceUnavailableException('As versões provisórias dos blocos não estão disponíveis.');
      }
      const versoes = new Map(catalogo.rows.map((item) => [item.codigo, item.id]));
      const alterados = new Set(alteracoes.map((alteracao) => alteracao.campo));
      for (const [indice, bloco] of dados.blocos.entries()) {
        if (!alterados.has(`blocos.${bloco.id}`)) continue;
        const texto = this.cifrar('documento_bloco', bloco.id, 'texto_final_cifrado', bloco.texto);
        if (antigos.has(bloco.id)) {
          await cliente.query(`
            UPDATE documentos.documento_bloco SET ordem = $1, ativo = $2, texto_final_cifrado = $3
            WHERE id = $4 AND documento_id = $5
          `, [indice + 1, bloco.ativo, texto, bloco.id, id]);
        } else {
          const versao = versoes.get(bloco.codigo);
          if (!versao) throw new Error('Versão de bloco provisório ausente.');
          try {
            await cliente.query(`
              INSERT INTO documentos.documento_bloco
                (id, documento_id, bloco_versao_id, ordem, ativo, texto_final_cifrado)
              VALUES ($1, $2, $3, $4, $5, $6)
            `, [bloco.id, id, versao, indice + 1, bloco.ativo, texto]);
          } catch (erro) {
            if (erro instanceof DatabaseError && erro.code === '23505' && erro.constraint === 'documento_bloco_pkey') {
              throw new ConflictException('Identificador de bloco já utilizado; reabra e adicione o bloco novamente.');
            }
            throw erro;
          }
        }
      }
      await cliente.query(`
        UPDATE documentos.documento SET atualizado_por = $1, atualizado_em = now(), revisao = revisao + 1 WHERE id = $2
      `, [sessao.usuario.id, id]);
      await this.registrarAjustes(cliente, id, sessao.usuario.id, dados.motivo, alteracoes);
      await auditarConsultaFuncional(cliente, sessao, 'rascunho_blocos_editados', 'documento', id, linha.pessoa_id, ip);
      const atualizado = await this.linha(cliente, id, sessao.usuario.id);
      if (!atualizado) throw new Error('Rascunho com blocos atualizados não pôde ser recuperado.');
      return { valor: await this.apresentar(cliente, atualizado) };
    });
    return concluir(tentativa);
  }

  async atualizarProcesso(
    sessao: SessaoAutenticada,
    ip: string,
    id: string,
    dados: AtualizarProcessoDof,
  ): Promise<RascunhoDof> {
    const tentativa = await transacao<Tentativa<RascunhoDof>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('editar_rascunho'));
      const linha = await this.linha(cliente, id, sessao.usuario.id, 'alteracao');
      if (!linha) {
        await auditarConsultaFuncional(cliente, sessao, 'rascunho_nao_encontrado', 'documento', id, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'Rascunho não encontrado.' } };
      }
      if (linha.revisao !== dados.revisao || linha.revisao === 2147483647) {
        await auditarConsultaFuncional(cliente, sessao, 'rascunho_conflito', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'O rascunho foi alterado ou atingiu o limite de revisões; reabra-o antes de continuar.' } };
      }
      const processoNovo = dados.processo;
      if (processoNovo !== null && this.mascarasProcesso.length === 0) {
        throw new ServiceUnavailableException('Nenhuma máscara de processo foi configurada. Solicite a configuração ao administrador.');
      }
      if (processoNovo !== null
          && !this.mascarasProcesso.some((mascara) => processoCorrespondeMascara(processoNovo, mascara))) {
        return { falha: { tipo: 'invalido', mensagem: 'O número do processo não corresponde às máscaras configuradas.' } };
      }
      const anterior = await this.apresentar(cliente, linha);
      if (anterior.processo === dados.processo) {
        return { falha: { tipo: 'conflito', mensagem: 'O número de processo não foi alterado.' } };
      }
      await cliente.query(`
        UPDATE documentos.documento SET processo_cifrado = $1, atualizado_por = $2,
          atualizado_em = now(), revisao = revisao + 1 WHERE id = $3
      `, [dados.processo === null ? null : this.cifrar('documento', id, 'processo_cifrado', dados.processo),
        sessao.usuario.id, id]);
      await this.registrarAjustes(cliente, id, sessao.usuario.id, dados.motivo, [
        { campo: 'processo', anterior: anterior.processo, novo: dados.processo },
      ]);
      await auditarConsultaFuncional(cliente, sessao, 'rascunho_processo_editado', 'documento', id, linha.pessoa_id, ip);
      const atualizado = await this.linha(cliente, id, sessao.usuario.id);
      if (!atualizado) throw new Error('Rascunho com processo atualizado não pôde ser recuperado.');
      return { valor: await this.apresentar(cliente, atualizado) };
    });
    return concluir(tentativa);
  }
}
