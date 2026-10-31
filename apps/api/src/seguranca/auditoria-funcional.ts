import type { PoolClient } from 'pg';
import type { SessaoAutenticada } from './autenticacao';

export async function auditarConsultaFuncional(
  cliente: PoolClient,
  sessao: SessaoAutenticada,
  acao: string,
  entidade: string,
  entidadeId: string | null,
  pessoaId: string | null,
  ip: string,
): Promise<void> {
  await cliente.query(`
    INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, entidade_id, pessoa_id, ip)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [sessao.usuario.id, acao, entidade, entidadeId, pessoaId, ip]);
}
