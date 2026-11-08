import { BadRequestException, Controller, Get, NotFoundException, Param, Query, Req } from '@nestjs/common';
import { conteudoDtcSchema, solicitarCalculoDofSchema, paginaUuidQuerySchema, sugestoesCadastroSchema,
  notificacoesDeclaracoesSchema, retornosDeclaracoesSchema } from '@sisdoc/contratos';
import type { Configuracao } from '@sisdoc/contratos';
import type { Pool } from 'pg';
import { z } from 'zod';
import { transacao } from '../banco';
import { ProtetorDados } from '../seguranca/protecao-dados';
import { confirmarSessao } from '../seguranca/sessao-transacao';
import { papeisPermitidos } from '../seguranca/permissoes';
import { ExigirAcao, exigirSessao, ipRequisicao, type RequisicaoAutenticada } from '../seguranca/guarda';
import { auditarConsultaFuncional } from '../seguranca/auditoria-funcional';
import type { SessaoAutenticada } from '../seguranca/autenticacao';

export const consultaRetornosDocumentos = `SELECT documento_id, max(em) AS em FROM (
  SELECT documento_id, recolhido_em AS em FROM documentos.encaminhamento_dof
    WHERE recolhido_em IS NOT NULL AND recolhido_por <> encaminhado_por
  UNION ALL SELECT documento_id, devolvido_em AS em FROM documentos.devolucao_conferido_dof
  UNION ALL SELECT documento_id, devolvido_em AS em FROM documentos.devolucao_conferido_dtc
) r GROUP BY documento_id`;
const retornos = consultaRetornosDocumentos;
const acessiveis = `d.status = 'rascunho' AND (d.criado_por = $1 OR $2::boolean)
  AND NOT EXISTS (SELECT 1 FROM documentos.exclusao_documento x WHERE x.documento_id = d.id AND x.status = 'pendente')`;

export class InteracoesService {
  private readonly protetor: ProtetorDados;
  constructor(private readonly banco: Pool, config: Configuracao) { this.protetor = new ProtetorDados(config.chaves); }

  async notificacoes(sessao: SessaoAutenticada, ip: string) {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_documentos'));
      const resultado = await cliente.query<{ encaminhados: string; retornos: string }>(`
        SELECT
          (SELECT count(DISTINCT d.id) FROM documentos.documento d
            JOIN documentos.encaminhamento_dof e ON e.documento_id = d.id
            WHERE d.status = 'rascunho' AND d.tipo = 'DOF' AND e.recolhido_em IS NULL
              AND (e.destinatario_id = $1 OR $2::boolean) AND $3::boolean
              AND NOT EXISTS (SELECT 1 FROM documentos.exclusao_documento x WHERE x.documento_id = d.id AND x.status = 'pendente')) AS encaminhados,
          (SELECT count(*) FROM documentos.documento d JOIN (${retornos}) r ON r.documento_id = d.id
            WHERE ${acessiveis} AND d.atualizado_em <= r.em
              AND NOT EXISTS (SELECT 1 FROM documentos.encaminhamento_dof e WHERE e.documento_id = d.id AND e.recolhido_em IS NULL)) AS retornos`,
      [sessao.usuario.id, sessao.usuario.papel === 'admin', ['admin', 'coordenador'].includes(sessao.usuario.papel)]);
      await auditarConsultaFuncional(cliente, sessao, 'notificacoes_consultadas', 'documento', null, null, ip);
      return notificacoesDeclaracoesSchema.parse({
        encaminhados: Number(resultado.rows[0].encaminhados), retornos: Number(resultado.rows[0].retornos),
      });
    });
  }

  async retornos(sessao: SessaoAutenticada, ip: string, limite: number, cursor?: string) {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_documentos'));
      const resultado = await cliente.query<{ id: string; tipo: string; nome: string; matricula: string; em: Date }>(`
        SELECT d.id, d.tipo, p.nome, v.matricula, r.em FROM documentos.documento d
          JOIN (${retornos}) r ON r.documento_id = d.id
          JOIN nucleo.pessoa p ON p.id = d.pessoa_id JOIN nucleo.vinculo v ON v.id = d.vinculo_id
        WHERE ${acessiveis} AND d.atualizado_em <= r.em
          AND NOT EXISTS (SELECT 1 FROM documentos.encaminhamento_dof e WHERE e.documento_id = d.id AND e.recolhido_em IS NULL)
          AND ($3::uuid IS NULL OR d.id > $3) ORDER BY d.id LIMIT $4`,
      [sessao.usuario.id, sessao.usuario.papel === 'admin', cursor ?? null, limite + 1]);
      await auditarConsultaFuncional(cliente, sessao, 'retornos_listados', 'documento', null, null, ip);
      return retornosDeclaracoesSchema.parse({
        itens: resultado.rows.slice(0, limite).map(({ em, ...linha }) => ({ ...linha, devolvidoEm: em.toISOString() })),
        proximoCursor: resultado.rows.length > limite ? resultado.rows[limite - 1].id : null,
      });
    });
  }

  async sugestoes(sessao: SessaoAutenticada, ip: string, pessoaId: string, limite: number, cursor?: string) {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_pessoa'));
      const pessoa = await cliente.query('SELECT id FROM nucleo.pessoa WHERE id = $1', [pessoaId]);
      if (!pessoa.rowCount) throw new NotFoundException('Pessoa não encontrada.');
      const consulta = await cliente.query<{ id: string; tipo: string; vinculo_id: string; revisao: number; atualizado_em: Date; entrada_cifrada: Buffer }>(`
        SELECT d.id, d.tipo, d.vinculo_id, d.revisao, d.atualizado_em, d.entrada_cifrada
        FROM documentos.documento d WHERE d.pessoa_id = $1 AND d.status IN ('rascunho','conferido','emitido','cancelado')
          AND ($2::uuid IS NULL OR d.id > $2)
          AND NOT EXISTS (SELECT 1 FROM documentos.exclusao_documento x WHERE x.documento_id = d.id AND x.status = 'pendente')
        ORDER BY d.id LIMIT $3`, [pessoaId, cursor ?? null, limite + 1]);
      const itens = consulta.rows.slice(0, limite).flatMap((linha) => {
        const entrada: unknown = JSON.parse(this.protetor.decifrar(linha.entrada_cifrada, {
          schema: 'documentos', tabela: 'documento', registroId: linha.id, campo: 'entrada_cifrada',
        }).toString('utf8'));
        const ajustes = (linha.tipo === 'DOF' ? solicitarCalculoDofSchema.parse(entrada) : conteudoDtcSchema.parse(entrada)).ajustesCadastro;
        return ajustes && Object.keys(ajustes).length ? [{
          documentoId: linha.id, tipo: linha.tipo, revisao: linha.revisao, vinculoId: linha.vinculo_id,
          atualizadoEm: linha.atualizado_em.toISOString(), ajustes,
        }] : [];
      });
      await auditarConsultaFuncional(cliente, sessao, 'sugestoes_cadastro_consultadas', 'pessoa', pessoaId, pessoaId, ip);
      return sugestoesCadastroSchema.parse({ itens, proximoCursor: consulta.rows.length > limite ? consulta.rows[limite - 1].id : null });
    });
  }
}

@Controller()
export class InteracoesController {
  constructor(private readonly interacoes: InteracoesService) {}
  @ExigirAcao('consultar_documentos')
  @Get('notificacoes/declaracoes')
  notificacoes(@Req() req: RequisicaoAutenticada) { return this.interacoes.notificacoes(exigirSessao(req), ipRequisicao(req)); }
  @ExigirAcao('consultar_documentos')
  @Get('notificacoes/retornos')
  retornos(@Query() consulta: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = paginaUuidQuerySchema.safeParse(consulta);
    if (!dados.success) throw new BadRequestException('Paginação inválida.');
    return this.interacoes.retornos(exigirSessao(req), ipRequisicao(req), dados.data.limite, dados.data.cursor);
  }
  @ExigirAcao('consultar_pessoa')
  @Get('servidores/:id/sugestoes')
  sugestoes(@Param('id') id: string, @Query() consulta: unknown, @Req() req: RequisicaoAutenticada) {
    const pessoa = z.uuid().safeParse(id);
    const dados = paginaUuidQuerySchema.safeParse(consulta);
    if (!pessoa.success || !dados.success) throw new BadRequestException('Pessoa ou paginação inválida.');
    return this.interacoes.sugestoes(exigirSessao(req), ipRequisicao(req), pessoa.data, dados.data.limite, dados.data.cursor);
  }
}
