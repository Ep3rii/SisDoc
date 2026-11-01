import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { nivelDof, REGRAS_PLANILHA } from '@sisdoc/calculo';
import {
  blocoRascunhoDofSchema,
  dadosFontePreviaDofSchema,
  dataFuncionalSchema,
  numeroProcessoSchema,
  processoCorrespondeMascara,
  rascunhoDofSchema,
  resultadoCalculoDofSchema,
  resultadoConferenciaDofSchema,
  resultadoCopiaEmitidoSchema,
  resultadoDevolucaoConferidoDofSchema,
  resultadoDevolucaoDofSchema,
  snapshotEmissaoDofSchema,
  solicitarCalculoDofSchema,
  ultimaDevolucaoDofSchema,
  type AtualizarBlocosDof,
  type AtualizarProcessoDof,
  type AtualizarRascunhoDof,
  type BlocoRascunhoDof,
  type CodigoBlocoDof,
  type ConferirDof,
  type Configuracao,
  type ConfirmarInicioDof,
  type CriarRascunhoDof,
  type DadosFontePreviaDof,
  type DevolverConferidoDof,
  type DevolverRascunhoDof,
  type EmitirDof,
  type EncaminharRascunhoDof,
  type PaginaConferidosDof,
  type PaginaCoordenadoresDof,
  type PaginaEncaminhamentosDof,
  type PaginaRascunhosDof,
  type PreconferenciaDof,
  type RascunhoDof,
  type RecolherRascunhoDof,
  type ResultadoConferenciaDof,
  type ResultadoCopiaEmitido,
  type ResultadoDevolucaoConferidoDof,
  type ResultadoDevolucaoDof,
  type SituacaoEmissao,
  type SolicitarCalculoDof,
  type UltimaDevolucaoDof,
} from '@sisdoc/contratos';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { DatabaseError, type Pool, type PoolClient } from 'pg';
import { z } from 'zod';
import { transacao } from '../banco';
import { calcularDofNaTransacao } from '../calculos/calculos';
import { dataEmSaoPaulo } from '../data';
import { VERSAO_BLOCO_VAZIO } from '../migracoes/blocos-dof';
import { TEMPLATE_EMISSAO_DOF } from '../migracoes/emissao';
import { CHAVE_BLOQUEIO_FONTE_DOF } from '../migracoes/preconferencia-dof';
import { TEMPLATE_DOF_PROVISORIO } from '../migracoes/rascunho-dof';
import { auditarConsultaFuncional } from '../seguranca/auditoria-funcional';
import type { SessaoAutenticada } from '../seguranca/autenticacao';
import { papeisPermitidos } from '../seguranca/permissoes';
import { ProtetorDados } from '../seguranca/protecao-dados';
import { confirmarSessao } from '../seguranca/sessao-transacao';
import { consultarSituacaoEmissao, MENSAGEM_SEM_APROVACAO } from './emissoes';
import { lerCpfDof, lerNomeMaeDof } from './identidade-fonte-dof';
import { verificarPreconferenciaDof } from './preconferencia';
import { concluir, type Tentativa } from './resultado-transacao';

type LinhaRascunho = {
  id: string;
  pessoa_id: string;
  vinculo_id: string;
  criado_por: string;
  nome: string;
  matricula: string;
  admissao: string | null;
  revisao: number;
  criado_em: Date;
  atualizado_em: Date;
  entrada_cifrada: Buffer;
  resultado_calculo_cifrado: Buffer | null;
  processo_cifrado: Buffer | null;
  confirmacao_inicio_cifrada: Buffer | null;
  regra_codigo: string;
  regra_versao: string;
  regra_atual: boolean;
};
type Mudanca = { campo: string; anterior: unknown; novo: unknown };
type LinhaEncaminhamento = {
  id: string;
  destinatario_id: string;
  destinatario_nome: string;
  destinatario_disponivel: boolean;
  encaminhado_em: Date;
};
type RevisoesFonte = { pessoa_revisao: string; vinculo_revisao: string };
type DadosPrevia = {
  conteudo: Omit<RascunhoDof, 'status'>;
  fonte: DadosFontePreviaDof;
  fonteSelecionadaAlterada: boolean | null;
};
const confirmacaoInicioProtegidaSchema = z.strictObject({
  inicio: dataFuncionalSchema,
  admissao: dataFuncionalSchema,
  confirmadoPor: z.uuid(),
  confirmadoEm: z.iso.datetime(),
  perfilConfirmante: z.literal('admin').optional(),
});



function entradaOrdenada(entrada: SolicitarCalculoDof): SolicitarCalculoDof {
  return { ...entrada, anos: [...entrada.anos].sort((a, b) => a.ano - b.ano) };
}

async function tentarBloqueioFonte(cliente: PoolClient): Promise<boolean> {
  const bloqueio = await cliente.query<{ obtido: boolean }>(
    'SELECT pg_try_advisory_xact_lock_shared($1, $2) AS obtido', [...CHAVE_BLOQUEIO_FONTE_DOF],
  );
  return bloqueio.rows[0].obtido;
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

  private assinarFonte(linha: LinhaRascunho, revisoes: RevisoesFonte): Buffer {
    return this.protetor.assinarRevisaoFonteDof({
      documentoId: linha.id,
      documentoRevisao: linha.revisao,
      pessoaId: linha.pessoa_id,
      pessoaRevisao: revisoes.pessoa_revisao,
      vinculoId: linha.vinculo_id,
      vinculoRevisao: revisoes.vinculo_revisao,
    });
  }

  private async consultarRevisoesFonte(cliente: PoolClient, linha: LinhaRascunho): Promise<RevisoesFonte> {
    const consulta = await cliente.query<RevisoesFonte>(`
      SELECT p.revisao_fonte::text AS pessoa_revisao, v.revisao_fonte::text AS vinculo_revisao
      FROM nucleo.pessoa p JOIN nucleo.vinculo v ON v.pessoa_id = p.id
      WHERE p.id = $1 AND v.id = $2
    `, [linha.pessoa_id, linha.vinculo_id]);
    if (!consulta.rows[0]) throw new Error('Pessoa ou vínculo da verificação deixou de existir.');
    return consulta.rows[0];
  }

  private fonteCorresponde(linha: LinhaRascunho, revisoes: RevisoesFonte, prova: string): boolean {
    const recebida = Buffer.from(prova, 'hex');
    const esperada = this.assinarFonte(linha, revisoes);
    return recebida.length === esperada.length && timingSafeEqual(recebida, esperada);
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

  private async encaminhamento(cliente: PoolClient, documentoId: string): Promise<LinhaEncaminhamento | undefined> {
    const consulta = await cliente.query<LinhaEncaminhamento>(`
      SELECT e.id, e.destinatario_id, u.nome AS destinatario_nome,
        (u.ativo AND u.papel = 'coordenador') AS destinatario_disponivel, e.encaminhado_em
      FROM documentos.encaminhamento_dof e
      JOIN seguranca.usuario u ON u.id = e.destinatario_id
      WHERE e.documento_id = $1 AND e.recolhido_em IS NULL
    `, [documentoId]);
    return consulta.rows[0];
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
    const confirmacaoInicio = linha.confirmacao_inicio_cifrada
      ? confirmacaoInicioProtegidaSchema.parse(
        this.ler('documento', linha.id, 'confirmacao_inicio_cifrada', linha.confirmacao_inicio_cifrada),
      ) : null;
    if (confirmacaoInicio && confirmacaoInicio.confirmadoPor !== linha.criado_por
        && confirmacaoInicio.perfilConfirmante !== 'admin') {
      throw new Error('Autor da confirmação do início é inconsistente.');
    }
    const encaminhamento = await this.encaminhamento(cliente, linha.id);
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
      inicioAjustadoConfirmado: Boolean(confirmacaoInicio
        && entrada.inicio < resultado.admissaoConsiderada
        && confirmacaoInicio.inicio === entrada.inicio
        && confirmacaoInicio.admissao === resultado.admissaoConsiderada
        && linha.admissao === confirmacaoInicio.admissao),
      blocos: await this.blocos(cliente, linha.id),
      processo: linha.processo_cifrado
        ? numeroProcessoSchema.parse(this.ler('documento', linha.id, 'processo_cifrado', linha.processo_cifrado)) : null,
      mascarasProcesso: this.mascarasProcesso,
      encaminhamento: encaminhamento ? {
        destinatarioId: encaminhamento.destinatario_id,
        destinatarioNome: encaminhamento.destinatario_nome,
        destinatarioDisponivel: encaminhamento.destinatario_disponivel,
        encaminhadoEm: encaminhamento.encaminhado_em.toISOString(),
      } : null,
    });
  }

  private async linha(
    cliente: PoolClient,
    id: string,
    autorId: string,
    bloquear?: 'leitura' | 'alteracao',
    permitirEncaminhado = false,
    estado: 'rascunho' | 'conferido' = 'rascunho',
  ): Promise<LinhaRascunho | undefined> {
    if (permitirEncaminhado && !bloquear) {
      throw new Error('Acesso a encaminhamento requer bloqueio do rascunho.');
    }
    const consulta = await cliente.query<LinhaRascunho>(`
      SELECT d.id, d.pessoa_id, d.vinculo_id, d.criado_por, p.nome, v.matricula,
        to_char(v.admissao, 'YYYY-MM-DD') AS admissao, d.revisao, d.criado_em, d.atualizado_em,
        d.entrada_cifrada, d.resultado_calculo_cifrado, d.processo_cifrado, d.confirmacao_inicio_cifrada,
        r.codigo AS regra_codigo, r.versao AS regra_versao,
        (r.codigo = $3 AND r.versao = $4 AND r.configuracao = $5::jsonb) AS regra_atual
      FROM documentos.documento d
      JOIN nucleo.pessoa p ON p.id = d.pessoa_id
      JOIN nucleo.vinculo v ON v.id = d.vinculo_id AND v.pessoa_id = d.pessoa_id
      JOIN documentos.regra_versao r ON r.id = d.regra_versao_id
      WHERE d.id = $1 AND (d.criado_por = $2 OR $6::boolean OR EXISTS (
        SELECT 1 FROM seguranca.usuario u WHERE u.id = $2 AND u.ativo AND u.papel = 'admin'
      )) AND d.tipo = 'DOF' AND d.status = $7
      ${bloquear === 'alteracao' ? 'FOR UPDATE OF d' : bloquear === 'leitura' ? 'FOR SHARE OF d' : ''}
    `, [id, autorId, REGRAS_PLANILHA.codigo, REGRAS_PLANILHA.versao, JSON.stringify(REGRAS_PLANILHA), permitirEncaminhado, estado]);
    const linha = consulta.rows[0];
    if (!linha || linha.criado_por === autorId) return linha;
    // Revalida após bloquear o documento, para não aceitar um encaminhamento recolhido durante a espera.
    const acesso = await cliente.query(`
      SELECT 1 FROM seguranca.usuario u WHERE u.id = $2 AND u.ativo AND u.papel = 'admin'
      UNION ALL
      SELECT 1 FROM documentos.encaminhamento_dof e
      JOIN seguranca.usuario u ON u.id = e.destinatario_id
      WHERE e.documento_id = $1 AND e.destinatario_id = $2 AND e.recolhido_em IS NULL
        AND u.ativo AND u.papel IN ('coordenador', 'admin')
    `, [id, autorId]);
    return (acesso.rowCount ?? 0) > 0 ? linha : undefined;
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
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_documentos'));
      const consulta = await cliente.query<Pick<LinhaRascunho, 'id' | 'pessoa_id' | 'vinculo_id' | 'nome' | 'matricula' | 'revisao' | 'atualizado_em'>>(`
        SELECT d.id, d.pessoa_id, d.vinculo_id, p.nome, v.matricula, d.revisao, d.atualizado_em
        FROM documentos.documento d
        JOIN nucleo.pessoa p ON p.id = d.pessoa_id
        JOIN nucleo.vinculo v ON v.id = d.vinculo_id AND v.pessoa_id = d.pessoa_id
        WHERE (d.criado_por = $1 OR $4::boolean) AND d.tipo = 'DOF' AND d.status = 'rascunho'
          AND NOT EXISTS (SELECT 1 FROM documentos.exclusao_documento x
            WHERE x.documento_id = d.id AND x.status = 'pendente')
          AND ($2::uuid IS NULL OR d.id > $2::uuid)
        ORDER BY d.id LIMIT $3
      `, [sessao.usuario.id, cursor ?? null, limite + 1, sessao.usuario.papel === 'admin']);
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

  async listarCoordenadores(
    sessao: SessaoAutenticada, ip: string, limite: number, cursor?: string,
  ): Promise<PaginaCoordenadoresDof> {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('editar_rascunho'));
      const consulta = await cliente.query<{ id: string; nome: string; matricula: string }>(`
        SELECT id, nome, matricula FROM seguranca.usuario
        WHERE ativo AND papel = 'coordenador' AND id <> $1
          AND ($2::uuid IS NULL OR id > $2::uuid)
        ORDER BY id LIMIT $3
      `, [sessao.usuario.id, cursor ?? null, limite + 1]);
      await auditarConsultaFuncional(cliente, sessao, 'coordenadores_listados', 'usuario', null, null, ip);
      return {
        itens: consulta.rows.slice(0, limite),
        proximoCursor: consulta.rows.length > limite ? consulta.rows[limite - 1].id : null,
      };
    });
  }

  async listarEncaminhados(
    sessao: SessaoAutenticada, ip: string, limite: number, cursor?: string,
  ): Promise<PaginaEncaminhamentosDof> {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('receber_encaminhamento'));
      const consulta = await cliente.query<Pick<LinhaRascunho, 'id' | 'pessoa_id' | 'vinculo_id' | 'nome' | 'matricula' | 'revisao' | 'atualizado_em'> & {
        autor_nome: string; encaminhado_em: Date;
      }>(`
        SELECT d.id, d.pessoa_id, d.vinculo_id, p.nome, v.matricula, d.revisao, d.atualizado_em,
          u.nome AS autor_nome, e.encaminhado_em
        FROM documentos.encaminhamento_dof e
        JOIN documentos.documento d ON d.id = e.documento_id
        JOIN nucleo.pessoa p ON p.id = d.pessoa_id
        JOIN nucleo.vinculo v ON v.id = d.vinculo_id AND v.pessoa_id = d.pessoa_id
        JOIN seguranca.usuario u ON u.id = d.criado_por
        WHERE (e.destinatario_id = $1 OR $4::boolean) AND e.recolhido_em IS NULL
          AND d.tipo = 'DOF' AND d.status = 'rascunho'
          AND NOT EXISTS (SELECT 1 FROM documentos.exclusao_documento x
            WHERE x.documento_id = d.id AND x.status = 'pendente')
          AND ($2::uuid IS NULL OR d.id > $2::uuid)
        ORDER BY d.id LIMIT $3
      `, [sessao.usuario.id, cursor ?? null, limite + 1, sessao.usuario.papel === 'admin']);
      await auditarConsultaFuncional(cliente, sessao, 'encaminhamentos_listados', 'documento', null, null, ip);
      return {
        itens: consulta.rows.slice(0, limite).map((linha) => ({
          id: linha.id, pessoaId: linha.pessoa_id, vinculoId: linha.vinculo_id, nome: linha.nome,
          matricula: linha.matricula, revisao: linha.revisao, atualizadoEm: linha.atualizado_em.toISOString(),
          autorNome: linha.autor_nome, encaminhadoEm: linha.encaminhado_em.toISOString(),
        })),
        proximoCursor: consulta.rows.length > limite ? consulta.rows[limite - 1].id : null,
      };
    });
  }

  async listarConferidos(
    sessao: SessaoAutenticada, ip: string, limite: number, cursor?: string,
  ): Promise<PaginaConferidosDof> {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('conferir'));
      const consulta = await cliente.query<Pick<LinhaRascunho,
        'id' | 'pessoa_id' | 'vinculo_id' | 'nome' | 'matricula' | 'revisao' | 'atualizado_em'> & {
        autor_nome: string; conferido_por_nome: string; conferido_em: Date; fonte_selecionada_alterada: boolean;
      }>(`
        SELECT d.id, d.pessoa_id, d.vinculo_id, p.nome, v.matricula, d.revisao, d.atualizado_em,
          autor.nome AS autor_nome, conferente.nome AS conferido_por_nome, c.conferido_em,
          (c.revisao_pessoa <> p.revisao_fonte OR c.revisao_vinculo <> v.revisao_fonte) AS fonte_selecionada_alterada
        FROM documentos.documento d
        JOIN nucleo.pessoa p ON p.id = d.pessoa_id
        JOIN nucleo.vinculo v ON v.id = d.vinculo_id AND v.pessoa_id = d.pessoa_id
        JOIN documentos.conferencia_dof c ON c.documento_id = d.id AND c.revisao_documento = d.revisao
        JOIN seguranca.usuario autor ON autor.id = d.criado_por
        JOIN seguranca.usuario conferente ON conferente.id = c.conferido_por
        WHERE d.tipo = 'DOF' AND d.status = 'conferido'
          AND NOT EXISTS (SELECT 1 FROM documentos.exclusao_documento x
            WHERE x.documento_id = d.id AND x.status = 'pendente')
          AND (d.criado_por = $1 OR $4::boolean OR EXISTS (
            SELECT 1 FROM documentos.encaminhamento_dof e
            JOIN seguranca.usuario u ON u.id = e.destinatario_id
            WHERE e.documento_id = d.id AND e.destinatario_id = $1 AND e.recolhido_em IS NULL
              AND u.ativo AND u.papel IN ('coordenador', 'admin')
          ))
          AND ($2::uuid IS NULL OR d.id > $2::uuid)
        ORDER BY d.id LIMIT $3
      `, [sessao.usuario.id, cursor ?? null, limite + 1, sessao.usuario.papel === 'admin']);
      await auditarConsultaFuncional(cliente, sessao, 'conferidos_dof_listados', 'documento', null, null, ip);
      return {
        itens: consulta.rows.slice(0, limite).map((linha) => ({
          id: linha.id, pessoaId: linha.pessoa_id, vinculoId: linha.vinculo_id, nome: linha.nome,
          matricula: linha.matricula, revisao: linha.revisao, atualizadoEm: linha.atualizado_em.toISOString(),
          autorNome: linha.autor_nome, conferidoPorNome: linha.conferido_por_nome,
          conferidoEm: linha.conferido_em.toISOString(), fonteSelecionadaAlterada: linha.fonte_selecionada_alterada,
        })),
        proximoCursor: consulta.rows.length > limite ? consulta.rows[limite - 1].id : null,
      };
    });
  }

  private async obterAuditado(
    sessao: SessaoAutenticada, ip: string, id: string,
  ): Promise<RascunhoDof> {
    const tentativa = await transacao<Tentativa<RascunhoDof>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_documentos'));
      const linha = await this.linha(cliente, id, sessao.usuario.id, 'leitura', true);
      await auditarConsultaFuncional(cliente, sessao, linha ? 'rascunho_aberto' : 'rascunho_nao_encontrado',
        'documento', id, linha?.pessoa_id ?? null, ip);
      if (!linha) return { falha: { tipo: 'nao_encontrado', mensagem: 'Rascunho não encontrado.' } };
      return { valor: await this.apresentar(cliente, linha) };
    });
    return concluir(tentativa);
  }

  async obter(sessao: SessaoAutenticada, ip: string, id: string): Promise<RascunhoDof> {
    return this.obterAuditado(sessao, ip, id);
  }

  async ultimaDevolucao(sessao: SessaoAutenticada, ip: string, id: string): Promise<UltimaDevolucaoDof> {
    const tentativa = await transacao<Tentativa<UltimaDevolucaoDof>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_documentos'));
      const linha = await this.linha(cliente, id, sessao.usuario.id, 'leitura');
      if (!linha) {
        await auditarConsultaFuncional(cliente, sessao, 'rascunho_nao_encontrado', 'documento', id, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'Rascunho não encontrado.' } };
      }
      const consulta = await cliente.query<{
        id: string; tipo: 'conferido' | 'encaminhamento'; coordenador_nome: string; recolhido_em: Date; motivo_cifrado: Buffer;
      }>(`
        SELECT id, tipo, coordenador_nome, recolhido_em, motivo_cifrado FROM (
          SELECT v.id, 'conferido' AS tipo, u.nome AS coordenador_nome,
            v.devolvido_em AS recolhido_em, v.motivo_cifrado, 1 AS prioridade
          FROM documentos.devolucao_conferido_dof v
          JOIN seguranca.usuario u ON u.id = v.devolvido_por WHERE v.documento_id = $1
          UNION ALL
          SELECT e.id, 'encaminhamento' AS tipo, u.nome AS coordenador_nome,
            e.recolhido_em, e.motivo_cifrado, 0 AS prioridade
          FROM documentos.encaminhamento_dof e
          JOIN seguranca.usuario u ON u.id = e.destinatario_id
          WHERE e.documento_id = $1 AND e.recolhido_por = e.destinatario_id AND e.recolhido_em IS NOT NULL
        ) devolucoes ORDER BY recolhido_em DESC, prioridade DESC, id DESC LIMIT 1
      `, [id]);
      const devolucao = consulta.rows[0];
      let motivo: unknown = null;
      if (devolucao) {
        try {
          motivo = this.ler(
            devolucao.tipo === 'conferido' ? 'devolucao_conferido_dof' : 'encaminhamento_dof',
            devolucao.id, 'motivo_cifrado', devolucao.motivo_cifrado,
          );
        } catch (erro) {
          if (!(erro instanceof SyntaxError)
              && (!(erro instanceof Error) || erro.message !== 'Dado protegido inválido ou corrompido.')) throw erro;
          await auditarConsultaFuncional(cliente, sessao, 'devolucao_motivo_invalido', 'documento', id, linha.pessoa_id, ip);
          return { falha: { tipo: 'conflito', mensagem: 'O motivo da devolução não pôde ser validado. Solicite a verificação de integridade e das chaves.' } };
        }
      }
      const resultado = ultimaDevolucaoDofSchema.safeParse({
        documentoId: id,
        revisao: linha.revisao,
        devolucao: devolucao ? {
          coordenadorNome: devolucao.coordenador_nome,
          devolvidoEm: devolucao.recolhido_em.toISOString(),
          motivo,
        } : null,
      });
      if (!resultado.success) {
        await auditarConsultaFuncional(cliente, sessao, 'devolucao_motivo_invalido', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'O motivo da devolução não pôde ser validado. Solicite a verificação de integridade e das chaves.' } };
      }
      await auditarConsultaFuncional(cliente, sessao, 'devolucao_dof_consultada', 'documento', id, linha.pessoa_id, ip);
      return { valor: resultado.data };
    });
    return concluir(tentativa);
  }

  async obterParaPrevia(
    sessao: SessaoAutenticada, ip: string, id: string, estado: 'rascunho' | 'conferido' = 'rascunho',
  ): Promise<DadosPrevia> {
    const tentativa = await transacao<Tentativa<DadosPrevia>>(
      this.banco, async (cliente) => {
        await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_documentos'));
        const linha = await this.linha(cliente, id, sessao.usuario.id, 'leitura', true, estado);
        if (!linha) {
          await auditarConsultaFuncional(cliente, sessao, 'rascunho_nao_encontrado', 'documento', id, null, ip);
          return { falha: { tipo: 'nao_encontrado', mensagem: 'Rascunho não encontrado.' } };
        }
        if (!await tentarBloqueioFonte(cliente)) {
          await auditarConsultaFuncional(cliente, sessao, 'previa_fonte_ocupada', 'documento', id, linha.pessoa_id, ip);
          return { falha: { tipo: 'conflito', mensagem: 'A fonte está sendo atualizada. Aguarde e abra a prévia novamente.' } };
        }
        const atual = await this.linha(cliente, id, sessao.usuario.id, 'leitura', true, estado);
        if (!atual) throw new Error('Rascunho não pôde ser recuperado durante a abertura da prévia.');
        const leitura = await this.lerFonte(cliente, atual, estado);
        if ('erro' in leitura) {
          if (leitura.erro === 'identidade') {
            await auditarConsultaFuncional(cliente, sessao, 'previa_identidade_invalida', 'documento', id, atual.pessoa_id, ip);
            return {
              falha: {
                tipo: 'conflito',
                mensagem: 'A identidade protegida não pôde ser validada. Verifique as pendências e solicite a correção da fonte.',
              },
            };
          }
          await auditarConsultaFuncional(cliente, sessao, 'previa_fonte_invalida', 'documento', id, atual.pessoa_id, ip);
          return { falha: { tipo: 'conflito', mensagem: 'Os dados da fonte são inválidos. Solicite sua verificação antes de abrir a prévia.' } };
        }
        const { status: _status, ...conteudo } = await this.apresentar(cliente, atual);
        await auditarConsultaFuncional(
          cliente, sessao, estado === 'conferido' ? 'previa_conferido_dof_aberta' : 'previa_dof_aberta',
          'documento', id, atual.pessoa_id, ip,
        );
        return { valor: { conteudo, fonte: leitura.fonte, fonteSelecionadaAlterada: leitura.fonteSelecionadaAlterada } };
      },
    );
    return concluir(tentativa);
  }

  private async lerFonte(
    cliente: PoolClient, atual: LinhaRascunho, estado: 'rascunho' | 'conferido',
  ): Promise<{ fonte: DadosFontePreviaDof; fonteSelecionadaAlterada: boolean | null } | { erro: 'identidade' | 'fonte' }> {
    const id = atual.id;
    const consulta = await cliente.query<RevisoesFonte & {
      cpf_cifrado: Buffer; cpf_hash: Buffer; nascimento: string | null; nome_mae_cifrado: Buffer | null;
      regime_juridico: string | null; cargo: string | null; referencia: string | null; orgao_nome: string | null;
      removido: boolean; consultado_em: Date; fonte_selecionada_alterada: boolean | null;
    }>(`
      SELECT p.cpf_cifrado, p.cpf_hash, to_char(p.nascimento, 'YYYY-MM-DD') AS nascimento,
        p.nome_mae_cifrado, v.regime_juridico, v.cargo, v.referencia, v.orgao_nome,
        p.revisao_fonte::text AS pessoa_revisao, v.revisao_fonte::text AS vinculo_revisao,
        v.removido_na_fonte_em IS NOT NULL AS removido, clock_timestamp() AS consultado_em,
        (c.revisao_pessoa <> p.revisao_fonte OR c.revisao_vinculo <> v.revisao_fonte) AS fonte_selecionada_alterada
      FROM nucleo.pessoa p JOIN nucleo.vinculo v ON v.pessoa_id = p.id
      LEFT JOIN documentos.conferencia_dof c ON c.documento_id = $3 AND c.revisao_documento = $4
      WHERE p.id = $1 AND v.id = $2
    `, [atual.pessoa_id, atual.vinculo_id, atual.id, atual.revisao]);
    const origem = consulta.rows[0];
    if (!origem) throw new Error('Pessoa ou vínculo da prévia deixou de existir.');
    if (estado === 'conferido' && origem.fonte_selecionada_alterada === null) {
      throw new Error('DOF conferida sem registro correspondente.');
    }
    const cpf = lerCpfDof(this.protetor, atual.pessoa_id, origem.cpf_cifrado, origem.cpf_hash);
    const nomeMae = lerNomeMaeDof(this.protetor, atual.pessoa_id, origem.nome_mae_cifrado);
    if ('erro' in cpf || 'erro' in nomeMae) return { erro: 'identidade' };
    const nivel = nivelDof(origem.referencia ?? '');
    const fonte = dadosFontePreviaDofSchema.safeParse({
      documentoId: id,
      revisao: atual.revisao,
      provaFonte: this.assinarFonte(atual, origem).toString('hex'),
      consultadoEm: origem.consultado_em.toISOString(),
      nome: atual.nome,
      matricula: atual.matricula,
      cpf: cpf.valor,
      nascimento: origem.nascimento,
      nomeMae: nomeMae.valor,
      regimeJuridico: origem.regime_juridico,
      cargo: origem.cargo,
      nivel: nivel.nivel || null,
      avisoNivel: nivel.avisos.join(' ') || null,
      referencia: origem.referencia,
      orgao: origem.orgao_nome,
      admissao: atual.admissao,
      removidoNaFonte: origem.removido,
    });
    if (!fonte.success) return { erro: 'fonte' };
    return { fonte: fonte.data, fonteSelecionadaAlterada: origem.fonte_selecionada_alterada };
  }

  async verificarPreconferencia(
    sessao: SessaoAutenticada, ip: string, id: string, provaFonte?: string,
  ): Promise<PreconferenciaDof> {
    const tentativa = await transacao<Tentativa<PreconferenciaDof>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('conferir'));
      const linha = await this.linha(cliente, id, sessao.usuario.id, 'leitura', true);
      if (!linha) {
        await auditarConsultaFuncional(cliente, sessao, 'rascunho_nao_encontrado', 'documento', id, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'Rascunho não encontrado.' } };
      }
      if (!await tentarBloqueioFonte(cliente)) {
        await auditarConsultaFuncional(cliente, sessao, 'preconferencia_fonte_ocupada', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A fonte está sendo atualizada. Aguarde e verifique novamente.' } };
      }
      const atual = await this.linha(cliente, id, sessao.usuario.id, 'leitura', true);
      if (!atual) throw new Error('Rascunho não pôde ser recuperado durante a pré-conferência.');
      if (provaFonte !== undefined) {
        const revisoes = await this.consultarRevisoesFonte(cliente, atual);
        if (!this.fonteCorresponde(atual, revisoes, provaFonte)) {
          await auditarConsultaFuncional(cliente, sessao, 'preconferencia_fonte_alterada', 'documento', id, atual.pessoa_id, ip);
          return {
            falha: {
              tipo: 'conflito',
              mensagem: 'A fonte ou a revisão do rascunho mudou desde a prévia. Feche e reabra a prévia antes de verificar.',
            },
          };
        }
      }
      const rascunho = await this.apresentar(cliente, atual);
      const resultado = await verificarPreconferenciaDof(
        cliente, sessao, ip, rascunho, atual.regra_atual, this.protetor, provaFonte,
      );
      await auditarConsultaFuncional(cliente, sessao, 'preconferencia_verificada', 'documento', id, atual.pessoa_id, ip);
      return { valor: resultado };
    });
    return concluir(tentativa);
  }

  async conferir(
    sessao: SessaoAutenticada, ip: string, id: string, dados: ConferirDof,
  ): Promise<ResultadoConferenciaDof> {
    const tentativa = await transacao<Tentativa<ResultadoConferenciaDof>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('conferir'));
      const linha = await this.linha(cliente, id, sessao.usuario.id, 'alteracao', true);
      if (!linha) {
        await auditarConsultaFuncional(cliente, sessao, 'conferencia_dof_nao_encontrada', 'documento', id, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'Rascunho não encontrado para conferência.' } };
      }
      if (linha.revisao !== dados.revisao || linha.revisao === 2147483647) {
        await auditarConsultaFuncional(cliente, sessao, 'conferencia_dof_revisao_invalida', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A revisão do rascunho mudou ou atingiu o limite. Reabra-o e verifique novamente.' } };
      }
      if (!await tentarBloqueioFonte(cliente)) {
        await auditarConsultaFuncional(cliente, sessao, 'conferencia_dof_fonte_ocupada', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A fonte está sendo atualizada. Aguarde e verifique novamente.' } };
      }
      const atual = await this.linha(cliente, id, sessao.usuario.id, 'alteracao', true);
      if (!atual) throw new Error('Rascunho não pôde ser recuperado durante a conferência.');
      const revisoes = await this.consultarRevisoesFonte(cliente, atual);
      if (!this.fonteCorresponde(atual, revisoes, dados.provaFonte)) {
        await auditarConsultaFuncional(cliente, sessao, 'conferencia_dof_fonte_alterada', 'documento', id, atual.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A fonte mudou desde a prévia. Feche e reabra a prévia antes de conferir.' } };
      }
      const rascunho = await this.apresentar(cliente, atual);
      const relatorio = await verificarPreconferenciaDof(
        cliente, sessao, ip, rascunho, atual.regra_atual, this.protetor, dados.provaFonte,
      );
      if (!relatorio.provaRelatorio) throw new Error('Relatório vinculado à prévia não possui prova.');
      const recebida = Buffer.from(dados.provaRelatorio, 'hex');
      const esperada = Buffer.from(relatorio.provaRelatorio, 'hex');
      if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) {
        await auditarConsultaFuncional(cliente, sessao, 'conferencia_dof_relatorio_alterado', 'documento', id, atual.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'As pendências ou os avisos mudaram. Verifique-os novamente antes de conferir.' } };
      }
      if (relatorio.bloqueios.length > 0) {
        await auditarConsultaFuncional(cliente, sessao, 'conferencia_dof_com_pendencias', 'documento', id, atual.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'Há pendências que impedem a conferência. Consulte o relatório e corrija-as.' } };
      }
      const conferenciaId = randomUUID();
      await cliente.query(`
        INSERT INTO documentos.conferencia_dof
          (id, documento_id, revisao_documento, revisao_pessoa, revisao_vinculo, conferido_por, avisos)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        conferenciaId, id, atual.revisao + 1, revisoes.pessoa_revisao, revisoes.vinculo_revisao,
        sessao.usuario.id, relatorio.avisos.map((aviso) => aviso.codigo),
      ]);
      const atualizado = await cliente.query<{ revisao: number; conferido_em: Date }>(`
        UPDATE documentos.documento SET status = 'conferido', conferido_por = $2,
          conferido_em = (SELECT conferido_em FROM documentos.conferencia_dof WHERE id = $3),
          atualizado_por = $2, atualizado_em = now(), revisao = revisao + 1
        WHERE id = $1 AND status = 'rascunho' AND revisao = $4
        RETURNING revisao, conferido_em
      `, [id, sessao.usuario.id, conferenciaId, atual.revisao]);
      if (!atualizado.rows[0]) throw new Error('A transição para conferido não pôde ser registrada.');
      await auditarConsultaFuncional(cliente, sessao, 'dof_conferida', 'documento', id, atual.pessoa_id, ip);
      return {
        valor: resultadoConferenciaDofSchema.parse({
          documentoId: id, revisao: atualizado.rows[0].revisao, status: 'conferido',
          conferidoEm: atualizado.rows[0].conferido_em.toISOString(),
        }),
      };
    });
    return concluir(tentativa);
  }

  async devolverConferido(
    sessao: SessaoAutenticada, ip: string, id: string, dados: DevolverConferidoDof,
  ): Promise<ResultadoDevolucaoConferidoDof> {
    const tentativa = await transacao<Tentativa<ResultadoDevolucaoConferidoDof>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('receber_encaminhamento'));
      const linha = await this.linha(cliente, id, sessao.usuario.id, 'alteracao', true, 'conferido');
      if (!linha) {
        await auditarConsultaFuncional(cliente, sessao, 'conferido_dof_nao_encontrado', 'documento', id, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'DOF conferida não encontrada.' } };
      }
      if (linha.revisao !== dados.revisao || linha.revisao === 2147483647) {
        await auditarConsultaFuncional(cliente, sessao, 'devolucao_conferido_dof_revisao_invalida', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A revisão da DOF mudou ou atingiu o limite. Reabra a lista antes de devolver.' } };
      }
      const conferencia = await cliente.query<{ id: string }>(`
        SELECT id FROM documentos.conferencia_dof WHERE documento_id = $1 AND revisao_documento = $2
      `, [id, linha.revisao]);
      if (!conferencia.rows[0]) throw new Error('DOF conferida sem registro correspondente.');
      const devolucaoId = randomUUID();
      await cliente.query(`
        INSERT INTO documentos.devolucao_conferido_dof
          (id, documento_id, conferencia_id, devolvido_por, motivo_cifrado)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        devolucaoId, id, conferencia.rows[0].id, sessao.usuario.id,
        this.cifrar('devolucao_conferido_dof', devolucaoId, 'motivo_cifrado', dados.motivo),
      ]);
      const atualizado = await cliente.query<{ revisao: number; devolvido_em: Date }>(`
        UPDATE documentos.documento SET status = 'rascunho', conferido_por = NULL, conferido_em = NULL,
          atualizado_por = $2, atualizado_em = now(), revisao = revisao + 1
        WHERE id = $1 AND status = 'conferido' AND revisao = $3
        RETURNING revisao, (SELECT devolvido_em FROM documentos.devolucao_conferido_dof WHERE id = $4) AS devolvido_em
      `, [id, sessao.usuario.id, linha.revisao, devolucaoId]);
      if (!atualizado.rows[0]) throw new Error('A devolução da DOF conferida não pôde ser registrada.');
      const encaminhamento = await this.encaminhamento(cliente, id);
      if (encaminhamento) {
        await cliente.query(`
          UPDATE documentos.encaminhamento_dof SET recolhido_por = $2,
            recolhido_em = (SELECT devolvido_em FROM documentos.devolucao_conferido_dof WHERE id = $3),
            motivo_cifrado = $4 WHERE id = $1 AND recolhido_em IS NULL
        `, [
          encaminhamento.id, sessao.usuario.id, devolucaoId,
          this.cifrar('encaminhamento_dof', encaminhamento.id, 'motivo_cifrado', dados.motivo),
        ]);
      }
      await auditarConsultaFuncional(cliente, sessao, 'dof_conferida_devolvida', 'documento', id, linha.pessoa_id, ip);
      return {
        valor: resultadoDevolucaoConferidoDofSchema.parse({
          documentoId: id, revisao: atualizado.rows[0].revisao, status: 'rascunho',
          devolvidoEm: atualizado.rows[0].devolvido_em.toISOString(),
        }),
      };
    });
    return concluir(tentativa);
  }

  async criar(sessao: SessaoAutenticada, ip: string, dados: CriarRascunhoDof): Promise<RascunhoDof> {
    const tentativa = await transacao<Tentativa<RascunhoDof>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('criar_rascunho'));
      const entrada = entradaOrdenada(dados.calculo);
      if (!await tentarBloqueioFonte(cliente)) {
        await auditarConsultaFuncional(cliente, sessao, 'rascunho_fonte_ocupada', 'vinculo', entrada.vinculoId, null, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A fonte está sendo atualizada. Aguarde e tente salvar novamente.' } };
      }
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
      let linha = await this.linha(cliente, id, sessao.usuario.id, 'alteracao');
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
      if (!await tentarBloqueioFonte(cliente)) {
        await auditarConsultaFuncional(cliente, sessao, 'rascunho_fonte_ocupada', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A fonte está sendo atualizada. Aguarde e tente salvar novamente.' } };
      }
      const atual = await this.linha(cliente, id, sessao.usuario.id, 'alteracao');
      if (!atual) throw new Error('Rascunho não pôde ser recuperado ao proteger a leitura da fonte.');
      linha = atual;
      const anterior = await this.apresentar(cliente, linha);
      if (anterior.encaminhamento) {
        return { falha: { tipo: 'conflito', mensagem: 'Recolha o encaminhamento antes de editar o rascunho.' } };
      }
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
        UPDATE documentos.documento SET entrada_cifrada = $1, resultado_calculo_cifrado = $2, confirmacao_inicio_cifrada = NULL,
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
      if (anterior.encaminhamento) {
        return { falha: { tipo: 'conflito', mensagem: 'Recolha o encaminhamento antes de editar os blocos.' } };
      }
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
      const anterior = await this.apresentar(cliente, linha);
      if (anterior.encaminhamento) {
        return { falha: { tipo: 'conflito', mensagem: 'Recolha o encaminhamento antes de editar o processo.' } };
      }
      const processoNovo = dados.processo;
      if (processoNovo !== null && this.mascarasProcesso.length === 0) {
        throw new ServiceUnavailableException('Nenhuma máscara de processo foi configurada. Solicite a configuração ao administrador.');
      }
      if (processoNovo !== null
          && !this.mascarasProcesso.some((mascara) => processoCorrespondeMascara(processoNovo, mascara))) {
        return { falha: { tipo: 'invalido', mensagem: 'O número do processo não corresponde às máscaras configuradas.' } };
      }
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

  async confirmarInicio(
    sessao: SessaoAutenticada, ip: string, id: string, dados: ConfirmarInicioDof,
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
      if (!await tentarBloqueioFonte(cliente)) {
        await auditarConsultaFuncional(cliente, sessao, 'confirmacao_inicio_fonte_ocupada', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A fonte está sendo atualizada. Aguarde e tente confirmar novamente.' } };
      }
      const atual = await this.linha(cliente, id, sessao.usuario.id, 'alteracao');
      if (!atual) throw new Error('Rascunho não pôde ser recuperado durante a confirmação do início.');
      const rascunho = await this.apresentar(cliente, atual);
      if (rascunho.encaminhamento) {
        return { falha: { tipo: 'conflito', mensagem: 'Recolha o encaminhamento antes de confirmar o ajuste do início.' } };
      }
      if (!atual.regra_atual || !rascunho.admissao || rascunho.admissao !== rascunho.resultado.admissaoConsiderada) {
        return { falha: { tipo: 'conflito', mensagem: 'A admissão ou a regra do rascunho mudou. Reabra e confira o cálculo antes de confirmar.' } };
      }
      if (rascunho.entrada.inicio >= rascunho.admissao) {
        return { falha: { tipo: 'invalido', mensagem: 'Este rascunho não possui início ajustado à admissão.' } };
      }
      if (rascunho.inicioAjustadoConfirmado) {
        return { falha: { tipo: 'conflito', mensagem: 'O ajuste do início já foi confirmado nesta versão do cálculo.' } };
      }
      const tempo = await cliente.query<{ confirmado_em: Date }>('SELECT now() AS confirmado_em');
      const confirmacao = confirmacaoInicioProtegidaSchema.parse({
        inicio: rascunho.entrada.inicio,
        admissao: rascunho.admissao,
        confirmadoPor: sessao.usuario.id,
        confirmadoEm: tempo.rows[0].confirmado_em.toISOString(),
        ...(sessao.usuario.papel === 'admin' ? { perfilConfirmante: 'admin' } : {}),
      });
      await cliente.query(`
        UPDATE documentos.documento SET confirmacao_inicio_cifrada = $1, atualizado_por = $2,
          atualizado_em = now(), revisao = revisao + 1 WHERE id = $3
      `, [this.cifrar('documento', id, 'confirmacao_inicio_cifrada', confirmacao), sessao.usuario.id, id]);
      await auditarConsultaFuncional(cliente, sessao, 'inicio_ajustado_confirmado', 'documento', id, atual.pessoa_id, ip);
      const confirmado = await this.linha(cliente, id, sessao.usuario.id);
      if (!confirmado) throw new Error('Rascunho com início confirmado não pôde ser recuperado.');
      return { valor: await this.apresentar(cliente, confirmado) };
    });
    return concluir(tentativa);
  }

  async encaminhar(
    sessao: SessaoAutenticada, ip: string, id: string, dados: EncaminharRascunhoDof,
  ): Promise<RascunhoDof> {
    const tentativa = await transacao<Tentativa<RascunhoDof>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('editar_rascunho'));
      const proprio = await cliente.query(`
        SELECT 1 FROM documentos.documento
        WHERE id = $1 AND (criado_por = $2 OR $3::boolean) AND tipo = 'DOF' AND status = 'rascunho'
      `, [id, sessao.usuario.id, sessao.usuario.papel === 'admin']);
      if (proprio.rowCount !== 1) {
        await auditarConsultaFuncional(cliente, sessao, 'rascunho_nao_encontrado', 'documento', id, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'Rascunho não encontrado.' } };
      }
      if (dados.destinatarioId === sessao.usuario.id) {
        return { falha: { tipo: 'invalido', mensagem: 'Selecione outro coordenador como destinatário.' } };
      }
      await cliente.query('SAVEPOINT destinatario_encaminhamento');
      let destinatario: { id: string } | undefined;
      try {
        const consulta = await cliente.query<{ id: string }>(`
          SELECT id FROM seguranca.usuario WHERE id = $1 AND ativo AND papel = 'coordenador' FOR UPDATE NOWAIT
        `, [dados.destinatarioId]);
        destinatario = consulta.rows[0];
        await cliente.query('RELEASE SAVEPOINT destinatario_encaminhamento');
      } catch (erro) {
        await cliente.query('ROLLBACK TO SAVEPOINT destinatario_encaminhamento');
        await cliente.query('RELEASE SAVEPOINT destinatario_encaminhamento');
        if (erro instanceof DatabaseError && erro.code === '55P03') {
          return { falha: { tipo: 'conflito', mensagem: 'O destinatário está em outra operação. Tente encaminhar novamente.' } };
        }
        throw erro;
      }
      if (!destinatario) {
        return { falha: { tipo: 'invalido', mensagem: 'Selecione um coordenador ativo para receber o rascunho.' } };
      }
      const linha = await this.linha(cliente, id, sessao.usuario.id, 'alteracao');
      if (!linha) {
        await auditarConsultaFuncional(cliente, sessao, 'rascunho_nao_encontrado', 'documento', id, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'Rascunho não encontrado.' } };
      }
      if (linha.revisao !== dados.revisao || linha.revisao === 2147483647) {
        await auditarConsultaFuncional(cliente, sessao, 'rascunho_conflito', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'O rascunho foi alterado ou atingiu o limite de revisões; reabra-o antes de continuar.' } };
      }
      if (await this.encaminhamento(cliente, id)) {
        return { falha: { tipo: 'conflito', mensagem: 'O rascunho já está encaminhado; recolha-o antes de encaminhar novamente.' } };
      }
      await cliente.query(`
        UPDATE documentos.documento SET atualizado_por = $1, atualizado_em = now(), revisao = revisao + 1 WHERE id = $2
      `, [sessao.usuario.id, id]);
      await cliente.query(`
        INSERT INTO documentos.encaminhamento_dof (id, documento_id, encaminhado_por, destinatario_id)
        VALUES ($1, $2, $3, $4)
      `, [randomUUID(), id, sessao.usuario.id, dados.destinatarioId]);
      await auditarConsultaFuncional(cliente, sessao, 'rascunho_encaminhado', 'documento', id, linha.pessoa_id, ip,
        { destinatarioId: dados.destinatarioId });
      const atualizado = await this.linha(cliente, id, sessao.usuario.id);
      if (!atualizado) throw new Error('Rascunho encaminhado não pôde ser recuperado.');
      return { valor: await this.apresentar(cliente, atualizado) };
    });
    return concluir(tentativa);
  }

  async recolher(
    sessao: SessaoAutenticada, ip: string, id: string, dados: RecolherRascunhoDof,
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
      const encaminhamento = await this.encaminhamento(cliente, id);
      if (!encaminhamento) {
        return { falha: { tipo: 'conflito', mensagem: 'O rascunho não possui encaminhamento ativo.' } };
      }
      await cliente.query(`
        UPDATE documentos.encaminhamento_dof
        SET recolhido_por = $1, recolhido_em = now(), motivo_cifrado = $2 WHERE id = $3
      `, [sessao.usuario.id, this.cifrar('encaminhamento_dof', encaminhamento.id, 'motivo_cifrado', dados.motivo),
        encaminhamento.id]);
      await cliente.query(`
        UPDATE documentos.documento SET atualizado_por = $1, atualizado_em = now(), revisao = revisao + 1 WHERE id = $2
      `, [sessao.usuario.id, id]);
      await auditarConsultaFuncional(cliente, sessao, 'rascunho_recolhido', 'documento', id, linha.pessoa_id, ip,
        { destinatarioId: encaminhamento.destinatario_id });
      const atualizado = await this.linha(cliente, id, sessao.usuario.id);
      if (!atualizado) throw new Error('Rascunho recolhido não pôde ser recuperado.');
      return { valor: await this.apresentar(cliente, atualizado) };
    });
    return concluir(tentativa);
  }

  async devolver(
    sessao: SessaoAutenticada, ip: string, id: string, dados: DevolverRascunhoDof,
  ): Promise<ResultadoDevolucaoDof> {
    const tentativa = await transacao<Tentativa<ResultadoDevolucaoDof>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('receber_encaminhamento'));
      const linha = await this.linha(cliente, id, sessao.usuario.id, 'alteracao', true);
      const encaminhamento = linha ? await this.encaminhamento(cliente, id) : undefined;
      if (!linha || !encaminhamento || (sessao.usuario.papel !== 'admin'
          && (linha.criado_por === sessao.usuario.id || encaminhamento.destinatario_id !== sessao.usuario.id))) {
        await auditarConsultaFuncional(cliente, sessao, 'rascunho_nao_encontrado', 'documento', id, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'Rascunho não encontrado.' } };
      }
      if (linha.revisao !== dados.revisao || linha.revisao === 2147483647) {
        await auditarConsultaFuncional(cliente, sessao, 'rascunho_conflito', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'O rascunho foi alterado ou atingiu o limite de revisões; reabra-o antes de continuar.' } };
      }
      const encerrado = await cliente.query<{ recolhido_em: Date }>(`
        UPDATE documentos.encaminhamento_dof
        SET recolhido_por = $1, recolhido_em = now(), motivo_cifrado = $2
        WHERE id = $3 RETURNING recolhido_em
      `, [sessao.usuario.id, this.cifrar('encaminhamento_dof', encaminhamento.id, 'motivo_cifrado', dados.motivo),
        encaminhamento.id]);
      if (encerrado.rowCount !== 1) throw new Error('O encaminhamento não pôde ser devolvido.');
      await cliente.query(`
        UPDATE documentos.documento SET atualizado_por = $1, atualizado_em = now(), revisao = revisao + 1 WHERE id = $2
      `, [sessao.usuario.id, id]);
      await auditarConsultaFuncional(cliente, sessao, 'rascunho_devolvido', 'documento', id, linha.pessoa_id, ip,
        { destinatarioId: sessao.usuario.id });
      return {
        valor: resultadoDevolucaoDofSchema.parse({
          documentoId: id, revisao: linha.revisao + 1, devolvidoEm: encerrado.rows[0].recolhido_em.toISOString(),
        }),
      };
    });
    return concluir(tentativa);
  }

  private async emissaoPorChave(
    cliente: PoolClient, sessao: SessaoAutenticada, ip: string, id: string, chave: string,
  ): Promise<Tentativa<SituacaoEmissao> | undefined> {
    const consulta = await cliente.query<{ id: string; documento_id: string; emitido_por: string; oficial: boolean }>(`
      SELECT e.id, e.documento_id, e.emitido_por,
        EXISTS (SELECT 1 FROM documentos.emissao_aprovacao a WHERE a.emissao_id = e.id) AS oficial
      FROM documentos.emissao e WHERE e.chave_idempotencia = $1
    `, [chave]);
    const existente = consulta.rows[0];
    if (!existente) return undefined;
    if (existente.documento_id !== id || existente.emitido_por !== sessao.usuario.id || !existente.oficial) {
      await auditarConsultaFuncional(cliente, sessao, 'emissao_dof_chave_reutilizada', 'documento', id, null, ip);
      return { falha: { tipo: 'conflito', mensagem: 'A chave de idempotência já foi usada em outra emissão. Reabra a DOF e tente novamente.' } };
    }
    await auditarConsultaFuncional(cliente, sessao, 'emissao_dof_repetida', 'emissao', existente.id, null, ip);
    return { valor: await consultarSituacaoEmissao(cliente, existente.id) };
  }

  async emitir(
    sessao: SessaoAutenticada, ip: string, id: string, chave: string, dados: EmitirDof,
  ): Promise<SituacaoEmissao> {
    const executar = () => transacao<Tentativa<SituacaoEmissao>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('emitir'));
      const repetida = await this.emissaoPorChave(cliente, sessao, ip, id, chave);
      if (repetida) return repetida;
      const linha = await this.linha(cliente, id, sessao.usuario.id, 'alteracao', true, 'conferido');
      if (!linha) {
        // Uma requisição concorrente com a mesma chave pode ter concluído enquanto aguardávamos o bloqueio.
        const concorrente = await this.emissaoPorChave(cliente, sessao, ip, id, chave);
        if (concorrente) return concorrente;
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dof_nao_encontrada', 'documento', id, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'DOF conferida não encontrada para emissão.' } };
      }
      if (linha.revisao !== dados.revisao) {
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dof_revisao_invalida', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A revisão da DOF mudou. Reabra a lista de conferidos antes de emitir.' } };
      }
      if (!await tentarBloqueioFonte(cliente)) {
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dof_fonte_ocupada', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A fonte está sendo atualizada. Aguarde e tente emitir novamente.' } };
      }
      const atual = await this.linha(cliente, id, sessao.usuario.id, 'alteracao', true, 'conferido');
      if (!atual) throw new Error('DOF conferida não pôde ser recuperada durante a emissão.');
      const revisoes = await this.consultarRevisoesFonte(cliente, atual);
      if (!this.fonteCorresponde(atual, revisoes, dados.provaFonte)) {
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dof_fonte_alterada', 'documento', id, atual.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A fonte ou a revisão mudou desde a prévia. Reabra a prévia antes de emitir.' } };
      }
      const conferencia = await cliente.query<{
        revisao_pessoa: string; revisao_vinculo: string; conferido_por: string; conferente_nome: string;
      }>(`
        SELECT c.revisao_pessoa::text, c.revisao_vinculo::text, c.conferido_por, u.nome AS conferente_nome
        FROM documentos.conferencia_dof c JOIN seguranca.usuario u ON u.id = c.conferido_por
        WHERE c.documento_id = $1 AND c.revisao_documento = $2
      `, [id, atual.revisao]);
      const conferido = conferencia.rows[0];
      if (!conferido) throw new Error('DOF conferida sem registro correspondente.');
      if (conferido.revisao_pessoa !== revisoes.pessoa_revisao || conferido.revisao_vinculo !== revisoes.vinculo_revisao) {
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dof_fonte_alterada', 'documento', id, atual.pessoa_id, ip);
        return {
          falha: {
            tipo: 'conflito',
            mensagem: 'A pessoa ou o vínculo mudou na fonte após a conferência. Devolva a DOF para nova conferência.',
          },
        };
      }
      const rascunho = await this.apresentar(cliente, atual);
      const relatorio = await verificarPreconferenciaDof(cliente, sessao, ip, rascunho, atual.regra_atual, this.protetor);
      if (relatorio.bloqueios.length > 0 || !rascunho.processo || !atual.regra_atual) {
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dof_com_pendencias', 'documento', id, atual.pessoa_id, ip);
        const pendencias = relatorio.bloqueios.map((bloqueio) => bloqueio.mensagem).join(' ');
        return {
          falha: {
            tipo: 'conflito',
            mensagem: `Há pendências que impedem a emissão. Devolva a DOF para correção. ${pendencias}`.trim(),
          },
        };
      }
      const leitura = await this.lerFonte(cliente, atual, 'conferido');
      if ('erro' in leitura) {
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dof_fonte_invalida', 'documento', id, atual.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'Os dados da fonte não puderam ser validados. Solicite a verificação da fonte antes de emitir.' } };
      }
      const aprovacoes = await cliente.query<{
        id: string; aprovado_por: string; referencia_decisao: string; aprovado_em: Date;
        regra_id: string; regra_codigo: string; regra_versao: string; template_id: string; template_versao: string;
        autor_id: string; autor_nome: string;
      }>(`
        SELECT a.id, a.aprovado_por, a.referencia_decisao, a.aprovado_em,
          r.id AS regra_id, r.codigo AS regra_codigo, r.versao AS regra_versao,
          t.id AS template_id, t.versao AS template_versao, autor.id AS autor_id, autor.nome AS autor_nome
        FROM documentos.documento d
        JOIN documentos.regra_versao r ON r.id = d.regra_versao_id
        JOIN seguranca.usuario autor ON autor.id = d.criado_por
        JOIN documentos.template_versao t ON t.tipo = 'DOF' AND t.versao = $2
        JOIN documentos.aprovacao_modelo a ON a.tipo = 'DOF' AND a.regra_versao_id = r.id AND a.template_versao_id = t.id
        WHERE d.id = $1
      `, [id, TEMPLATE_EMISSAO_DOF]);
      const aprovacao = aprovacoes.rows[0];
      if (!aprovacao) {
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dof_bloqueada_sem_aprovacao', 'documento', id, atual.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: MENSAGEM_SEM_APROVACAO } };
      }
      const tempo = await cliente.query<{ agora: Date }>('SELECT now() AS agora');
      const agora = tempo.rows[0].agora;
      const dataEmissao = dataEmSaoPaulo(agora);
      const ano = Number(dataEmissao.slice(0, 4));
      await cliente.query(`
        INSERT INTO documentos.numeracao (tipo, ano, sufixo) VALUES ('DOF', $1, 'P')
        ON CONFLICT (tipo, ano) DO NOTHING
      `, [ano]);
      const numeracao = await cliente.query<{ ultimo_numero: string; sufixo: string }>(`
        SELECT ultimo_numero::text, sufixo FROM documentos.numeracao WHERE tipo = 'DOF' AND ano = $1 FOR UPDATE
      `, [ano]);
      if (!numeracao.rows[0]) throw new Error('A numeração da DOF não pôde ser reservada.');
      const reservado = await cliente.query<{ ultimo_numero: string }>(`
        UPDATE documentos.numeracao SET ultimo_numero = ultimo_numero + 1
        WHERE tipo = 'DOF' AND ano = $1 RETURNING ultimo_numero::text
      `, [ano]);
      const numero = Number(reservado.rows[0].ultimo_numero);
      if (!Number.isSafeInteger(numero) || numero < 1) throw new Error('O número reservado para a DOF é inválido.');
      const numeroFormatado = `N° ${numero}${numeracao.rows[0].sufixo}/${ano}`;
      const emissaoId = randomUUID();
      const { documentoId: _documentoId, revisao: _revisao, provaFonte: _prova, ...fonte } = leitura.fonte;
      const snapshot = snapshotEmissaoDofSchema.parse({
        classificacao: 'emissao',
        tipo: 'DOF',
        documentoId: id,
        emissaoId,
        revisao: atual.revisao,
        numero,
        ano,
        numeroFormatado,
        emitidoEm: agora.toISOString(),
        dataEmissao,
        nome: rascunho.nome,
        matricula: rascunho.matricula,
        fonte,
        entrada: rascunho.entrada,
        resultado: rascunho.resultado,
        blocos: rascunho.blocos,
        processo: rascunho.processo,
        regra: { id: aprovacao.regra_id, codigo: aprovacao.regra_codigo, versao: aprovacao.regra_versao },
        template: { id: aprovacao.template_id, versao: aprovacao.template_versao },
        aprovacao: {
          id: aprovacao.id,
          aprovadoPor: aprovacao.aprovado_por,
          referenciaDecisao: aprovacao.referencia_decisao,
          aprovadoEm: aprovacao.aprovado_em.toISOString(),
        },
        assinaturas: {
          autor: { id: aprovacao.autor_id, nome: aprovacao.autor_nome },
          conferente: { id: conferido.conferido_por, nome: conferido.conferente_nome },
          emitente: { id: sessao.usuario.id, nome: sessao.usuario.nome },
        },
      });
      await cliente.query(`
        INSERT INTO documentos.emissao
          (id, documento_id, tipo, ano, numero, numero_formatado, chave_idempotencia, snapshot_cifrado, emitido_por)
        VALUES ($1, $2, 'DOF', $3, $4, $5, $6, $7, $8)
      `, [emissaoId, id, ano, numero, numeroFormatado, chave,
        this.protetor.cifrar(Buffer.from(JSON.stringify(snapshot), 'utf8'), {
          schema: 'documentos', tabela: 'emissao', registroId: emissaoId, campo: 'snapshot_cifrado',
        }), sessao.usuario.id]);
      await cliente.query(`
        INSERT INTO documentos.emissao_aprovacao (emissao_id, aprovacao_id, tipo) VALUES ($1, $2, 'DOF')
      `, [emissaoId, aprovacao.id]);
      await cliente.query(`
        INSERT INTO documentos.job_pdf (id, emissao_id, status) VALUES ($1, $2, 'pendente')
      `, [randomUUID(), emissaoId]);
      const atualizado = await cliente.query(`
        UPDATE documentos.documento SET status = 'emitido', atualizado_por = $2, atualizado_em = now()
        WHERE id = $1 AND status = 'conferido' AND revisao = $3
      `, [id, sessao.usuario.id, atual.revisao]);
      if (atualizado.rowCount !== 1) throw new Error('A transição para emitido não pôde ser registrada.');
      await auditarConsultaFuncional(cliente, sessao, 'dof_emitida', 'documento', id, atual.pessoa_id, ip);
      return { valor: await consultarSituacaoEmissao(cliente, emissaoId) };
    });
    try {
      return concluir(await executar());
    } catch (erro) {
      if (erro instanceof DatabaseError && erro.code === '23505' && erro.constraint === 'emissao_chave_idempotencia_key') {
        return concluir(await executar());
      }
      throw erro;
    }
  }

  async copiar(sessao: SessaoAutenticada, ip: string, documentoId: string): Promise<ResultadoCopiaEmitido> {
    const tentativa = await transacao<Tentativa<ResultadoCopiaEmitido>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('criar_rascunho'));
      const origem = await cliente.query<{
        emissao_id: string; snapshot_cifrado: Buffer; criado_por: string; emitido_por: string; pessoa_id: string;
        admissao: string | null;
      }>(`
        SELECT e.id AS emissao_id, e.snapshot_cifrado, d.criado_por, e.emitido_por, d.pessoa_id,
          to_char(v.admissao, 'YYYY-MM-DD') AS admissao
        FROM documentos.documento d
        JOIN documentos.emissao e ON e.documento_id = d.id
        JOIN documentos.emissao_aprovacao a ON a.emissao_id = e.id
        JOIN nucleo.vinculo v ON v.id = d.vinculo_id AND v.pessoa_id = d.pessoa_id
        WHERE d.id = $1 AND d.tipo = 'DOF' AND d.status IN ('emitido', 'cancelado')
      `, [documentoId]);
      const linha = origem.rows[0];
      if (!linha || !(linha.criado_por === sessao.usuario.id || linha.emitido_por === sessao.usuario.id
          || sessao.usuario.papel === 'coordenador' || sessao.usuario.papel === 'admin')) {
        await auditarConsultaFuncional(cliente, sessao, 'copia_emissao_nao_encontrada', 'documento', documentoId, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'DOF emitida não encontrada para cópia.' } };
      }
      const snapshot = snapshotEmissaoDofSchema.parse(JSON.parse(this.protetor.decifrar(linha.snapshot_cifrado, {
        schema: 'documentos', tabela: 'emissao', registroId: linha.emissao_id, campo: 'snapshot_cifrado',
      }).toString('utf8')));
      if (snapshot.documentoId !== documentoId || snapshot.emissaoId !== linha.emissao_id) {
        throw new Error('O snapshot não pertence à emissão consultada.');
      }
      if (!await tentarBloqueioFonte(cliente)) {
        await auditarConsultaFuncional(cliente, sessao, 'copia_emissao_fonte_ocupada', 'documento', documentoId, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A fonte está sendo atualizada. Aguarde e tente copiar novamente.' } };
      }
      if (!linha.admissao) {
        return { falha: { tipo: 'conflito', mensagem: 'A admissão do vínculo não está informada na fonte. Solicite a correção antes de copiar.' } };
      }
      const entrada = entradaOrdenada(snapshot.entrada);
      const calculo = await calcularDofNaTransacao(cliente, sessao, ip, entrada, linha.admissao);
      if ('erro' in calculo) return { falha: { tipo: 'invalido', mensagem: calculo.erro } };
      if ('conflito' in calculo) return { falha: { tipo: 'conflito', mensagem: calculo.conflito } };
      const versoes = await cliente.query<{ template_id: string; regra_id: string }>(`
        SELECT t.id AS template_id, r.id AS regra_id
        FROM documentos.template_versao t CROSS JOIN documentos.regra_versao r
        WHERE t.tipo = 'DOF' AND t.versao = $1 AND r.codigo = $2 AND r.versao = $3
          AND r.configuracao = $4::jsonb
      `, [TEMPLATE_DOF_PROVISORIO, REGRAS_PLANILHA.codigo, REGRAS_PLANILHA.versao, JSON.stringify(REGRAS_PLANILHA)]);
      const versao = versoes.rows[0];
      if (!versao) throw new ServiceUnavailableException('As versões de cálculo e modelo não estão disponíveis.');
      const id = randomUUID();
      await cliente.query(`
        INSERT INTO documentos.documento (
          id, tipo, pessoa_id, vinculo_id, entrada_cifrada, resultado_calculo_cifrado,
          template_versao_id, regra_versao_id, substitui_id, criado_por, atualizado_por
        ) VALUES ($1, 'DOF', $2, $3, $4, $5, $6, $7, $8, $9, $9)
      `, [
        id, entrada.pessoaId, entrada.vinculoId, this.cifrar('documento', id, 'entrada_cifrada', entrada),
        this.cifrar('documento', id, 'resultado_calculo_cifrado', calculo.resultado),
        versao.template_id, versao.regra_id, documentoId, sessao.usuario.id,
      ]);
      await cliente.query(`
        INSERT INTO documentos.documento_periodo (id, documento_id, ordem, inicio, fim)
        VALUES ($1, $2, 1, $3, $4)
      `, [randomUUID(), id, entrada.inicio, entrada.fim]);
      const codigos = [...new Set(snapshot.blocos.map((bloco) => bloco.codigo))];
      const catalogo = await cliente.query<{ id: string; codigo: CodigoBlocoDof }>(`
        SELECT v.id, t.codigo FROM documentos.bloco_texto t
        JOIN documentos.bloco_versao v ON v.bloco_id = t.id
        WHERE t.ativo AND t.codigo = ANY($1::text[]) AND v.versao = $2
          AND t.tipos_documento @> ARRAY['DOF']::text[]
      `, [codigos, VERSAO_BLOCO_VAZIO]);
      if (catalogo.rows.length !== codigos.length) {
        throw new ServiceUnavailableException('As versões dos blocos não estão disponíveis para a cópia.');
      }
      const versoesBloco = new Map(catalogo.rows.map((item) => [item.codigo, item.id]));
      for (const [indice, bloco] of snapshot.blocos.entries()) {
        const blocoId = randomUUID();
        await cliente.query(`
          INSERT INTO documentos.documento_bloco (id, documento_id, bloco_versao_id, ordem, ativo, texto_final_cifrado)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [blocoId, id, versoesBloco.get(bloco.codigo), indice + 1, bloco.ativo,
          this.cifrar('documento_bloco', blocoId, 'texto_final_cifrado', bloco.texto)]);
      }
      await cliente.query(`
        UPDATE documentos.documento SET processo_cifrado = $1, atualizado_por = $2, atualizado_em = now(),
          revisao = revisao + 1 WHERE id = $3
      `, [this.cifrar('documento', id, 'processo_cifrado', snapshot.processo), sessao.usuario.id, id]);
      const motivo = `Cópia da emissão ${snapshot.numeroFormatado}.`;
      await this.registrarAjustes(cliente, id, sessao.usuario.id, motivo, [
        ...mudancas(null, entrada),
        { campo: 'processo', anterior: null, novo: snapshot.processo },
      ]);
      await auditarConsultaFuncional(cliente, sessao, 'rascunho_copiado_de_emissao', 'documento', id, entrada.pessoaId, ip);
      const criado = await this.linha(cliente, id, sessao.usuario.id);
      if (!criado) throw new Error('Rascunho copiado não pôde ser recuperado.');
      return {
        valor: resultadoCopiaEmitidoSchema.parse({ documentoId: id, revisao: criado.revisao, origemEmissaoId: linha.emissao_id }),
      };
    });
    return concluir(tentativa);
  }
}
