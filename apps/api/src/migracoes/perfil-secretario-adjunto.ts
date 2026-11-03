import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_PERFIL_SECRETARIO_ADJUNTO = '024-perfil-secretario-adjunto';

export async function aplicarRetiradaPerfilSecretarioAdjunto(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_PERFIL_SECRETARIO_ADJUNTO, async () => {
    await cliente.query(`
      ALTER TABLE seguranca.usuario DROP CONSTRAINT usuario_papel_check;
      WITH desativados AS (
        UPDATE seguranca.usuario
        SET papel = 'analista', ativo = false
        WHERE papel = 'secretario_adjunto'
        RETURNING id
      ), sessoes_revogadas AS (
        DELETE FROM seguranca.sessao s USING desativados d
        WHERE s.usuario_id = d.id
        RETURNING s.usuario_id
      )
      INSERT INTO seguranca.auditoria (acao, entidade, entidade_id, detalhes)
      SELECT 'perfil_descontinuado', 'usuario', id,
        jsonb_build_object('papelAnterior', 'secretario_adjunto', 'papelNovo', 'analista', 'usuarioInativado', true)
      FROM desativados;
      ALTER TABLE seguranca.usuario ADD CONSTRAINT usuario_papel_check
        CHECK (papel IN ('analista', 'coordenador', 'admin'));
    `);
  });
}
