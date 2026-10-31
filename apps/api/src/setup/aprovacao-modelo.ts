import { randomUUID } from 'node:crypto';
import { REGRAS_PLANILHA } from '@sisdoc/calculo';
import type { Client } from 'pg';
import { z } from 'zod';
import { TEMPLATES_DTC } from '../migracoes/dtc';
import { TEMPLATE_EMISSAO_DOF } from '../migracoes/emissao';

const textoAprovacaoSchema = z.string().trim().min(3).max(200);

export const tipoAprovacaoSchema = z.enum(['DOF', 'DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS']);
export type TipoAprovacao = z.infer<typeof tipoAprovacaoSchema>;

export const TEMPLATES_EMISSAO: Readonly<Record<TipoAprovacao, string>> = Object.freeze({
  DOF: TEMPLATE_EMISSAO_DOF,
  ...TEMPLATES_DTC,
});

export const aprovacaoModeloSchema = z.strictObject({
  tipo: tipoAprovacaoSchema,
  aprovadoPor: textoAprovacaoSchema,
  referenciaDecisao: textoAprovacaoSchema,
});
export type AprovacaoModelo = z.infer<typeof aprovacaoModeloSchema>;

export type ModeloVigente = {
  regra: { id: string; codigo: string; versao: string };
  template: { id: string; versao: string };
  aprovacaoExistente: { id: string; aprovadoPor: string; referenciaDecisao: string; aprovadoEm: string } | null;
};

export const CONFIRMACAO_APROVACAO = 'APROVAR DOF';

export function confirmacaoAprovacao(tipo: TipoAprovacao): string {
  return `APROVAR ${tipo}`;
}

export async function consultarModeloVigente(cliente: Client, tipo: TipoAprovacao = 'DOF'): Promise<ModeloVigente> {
  tipoAprovacaoSchema.parse(tipo);
  const consulta = await cliente.query<{
    regra_id: string; regra_codigo: string; regra_versao: string; template_id: string; template_versao: string;
    aprovacao_id: string | null; aprovado_por: string | null; referencia_decisao: string | null; aprovado_em: Date | null;
  }>(`
    SELECT r.id AS regra_id, r.codigo AS regra_codigo, r.versao AS regra_versao,
      t.id AS template_id, t.versao AS template_versao,
      a.id AS aprovacao_id, a.aprovado_por, a.referencia_decisao, a.aprovado_em
    FROM documentos.regra_versao r
    JOIN documentos.template_versao t ON t.tipo = $5 AND t.versao = $4
    LEFT JOIN documentos.aprovacao_modelo a
      ON a.tipo = $5 AND a.regra_versao_id = r.id AND a.template_versao_id = t.id
    WHERE r.codigo = $1 AND r.versao = $2 AND r.configuracao = $3::jsonb
  `, [REGRAS_PLANILHA.codigo, REGRAS_PLANILHA.versao, JSON.stringify(REGRAS_PLANILHA), TEMPLATES_EMISSAO[tipo], tipo]);
  const linha = consulta.rows[0];
  if (!linha) {
    throw new Error('A regra vigente ou o template de emissão não estão registrados; execute npm run migrar antes de aprovar.');
  }
  return {
    regra: { id: linha.regra_id, codigo: linha.regra_codigo, versao: linha.regra_versao },
    template: { id: linha.template_id, versao: linha.template_versao },
    aprovacaoExistente: linha.aprovacao_id && linha.aprovado_por && linha.referencia_decisao && linha.aprovado_em ? {
      id: linha.aprovacao_id,
      aprovadoPor: linha.aprovado_por,
      referenciaDecisao: linha.referencia_decisao,
      aprovadoEm: linha.aprovado_em.toISOString(),
    } : null,
  };
}

// Requer conexão com o papel de migração; o papel do aplicativo não possui INSERT em aprovacao_modelo.
export async function registrarAprovacaoModelo(cliente: Client, entrada: AprovacaoModelo): Promise<{ id: string; modelo: ModeloVigente }> {
  const dados = aprovacaoModeloSchema.parse(entrada);
  await cliente.query('BEGIN');
  try {
    const modelo = await consultarModeloVigente(cliente, dados.tipo);
    if (modelo.aprovacaoExistente) {
      throw new Error(`A regra e o template vigentes de ${dados.tipo} já possuem aprovação registrada.`);
    }
    const id = randomUUID();
    await cliente.query(`
      INSERT INTO documentos.aprovacao_modelo (id, tipo, regra_versao_id, template_versao_id, aprovado_por, referencia_decisao)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [id, dados.tipo, modelo.regra.id, modelo.template.id, dados.aprovadoPor, dados.referenciaDecisao]);
    await cliente.query(`
      INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, entidade_id, detalhes)
      VALUES (NULL, 'modelo_aprovado', 'aprovacao_modelo', $1, $2::jsonb)
    `, [id, JSON.stringify({
      tipo: dados.tipo,
      regra: `${modelo.regra.codigo}@${modelo.regra.versao}`,
      template: modelo.template.versao,
      referenciaDecisao: dados.referenciaDecisao,
      registradoPor: 'cli_aprovar_modelo',
    })]);
    await cliente.query('COMMIT');
    return { id, modelo };
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw erro;
  }
}
