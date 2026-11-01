import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ProtetorDados } from '../seguranca/protecao-dados';

export type PeriodoFonteDtc = {
  id: string;
  versao: string;
  inicio: string;
  fim: string;
  removido_em: string | null;
  sincronizado_em: string | null;
  hash_conteudo: string | null;
};

export async function lerPeriodosFonteDtc(cliente: PoolClient, pessoaId: string): Promise<PeriodoFonteDtc[]> {
  const consulta = await cliente.query<PeriodoFonteDtc>(`
    SELECT id::text, xmin::text AS versao, to_char(mes_inicio, 'YYYY-MM-DD') AS inicio,
      to_char(mes_fim, 'YYYY-MM-DD') AS fim, removido_na_fonte_em::text AS removido_em,
      sincronizado_em::text, encode(hash_conteudo, 'hex') AS hash_conteudo
    FROM nucleo.periodo_ipam WHERE pessoa_id = $1 ORDER BY id
  `, [pessoaId]);
  return consulta.rows;
}

export function assinarFonteDtc(
  protetor: ProtetorDados,
  revisoes: Parameters<ProtetorDados['assinarRevisaoFonteDof']>[0],
  periodos: PeriodoFonteDtc[],
): Buffer {
  const chave = protetor.assinarRevisaoFonteDof(revisoes);
  return createHmac('sha256', chave).update('sisdoc/dtc/revisao-fonte/v1\0', 'utf8')
    .update(JSON.stringify(periodos), 'utf8').digest();
}

export function provasDtcIguais(recebida: string, esperada: Buffer): boolean {
  const prova = Buffer.from(recebida, 'hex');
  return prova.length === esperada.length && timingSafeEqual(prova, esperada);
}

// O bloqueio de pessoa/vínculo não cobre INSERT/DELETE/TRUNCATE de períodos IPAM.
export async function tentarBloqueioPeriodosDtc(cliente: PoolClient): Promise<boolean> {
  await cliente.query('SAVEPOINT bloqueio_periodos_dtc');
  try {
    await cliente.query('SELECT documentos.bloquear_periodos_ipam()');
    await cliente.query('RELEASE SAVEPOINT bloqueio_periodos_dtc');
    return true;
  } catch (erro) {
    await cliente.query('ROLLBACK TO SAVEPOINT bloqueio_periodos_dtc');
    await cliente.query('RELEASE SAVEPOINT bloqueio_periodos_dtc');
    if (erro instanceof Error && 'code' in erro && erro.code === '55P03') return false;
    throw erro;
  }
}
