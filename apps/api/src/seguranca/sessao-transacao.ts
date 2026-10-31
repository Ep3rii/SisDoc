import { UnauthorizedException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { SessaoAutenticada } from './autenticacao';
import type { Papel } from './permissoes';

export async function confirmarSessao(
  cliente: PoolClient,
  sessao: SessaoAutenticada,
  papeis: readonly Papel[],
): Promise<void> {
  const resultado = await cliente.query(`
    SELECT 1 FROM seguranca.sessao s JOIN seguranca.usuario u ON u.id = s.usuario_id
    WHERE s.id_hash = $1 AND u.ativo AND NOT u.troca_senha_obrigatoria AND u.papel = ANY($2::text[])
      AND s.expira_em > now() AND s.ultimo_uso > now() - interval '30 minutes'
    FOR UPDATE OF u, s
  `, [sessao.hash, papeis]);
  if (resultado.rowCount !== 1) throw new UnauthorizedException('Sessão inválida ou expirada.');
}
