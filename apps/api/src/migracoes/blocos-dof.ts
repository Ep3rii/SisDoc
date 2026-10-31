import { TITULOS_BLOCOS_DOF } from '@sisdoc/contratos';
import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_BLOCOS_DOF = '005-blocos-dof';
export const VERSAO_BLOCO_VAZIO = 'referencia-vazia-1';

export async function aplicarBlocosDof(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_BLOCOS_DOF, async (papel) => {
    await cliente.query(`
      ALTER TABLE documentos.documento_bloco
        DROP CONSTRAINT documento_bloco_documento_id_ordem_key,
        ADD CONSTRAINT documento_bloco_documento_id_ordem_key
          UNIQUE (documento_id, ordem) DEFERRABLE INITIALLY DEFERRED
    `);
    for (const [codigo, titulo] of Object.entries(TITULOS_BLOCOS_DOF)) {
      await cliente.query(`
        WITH bloco AS (
          INSERT INTO documentos.bloco_texto (codigo, titulo, tipos_documento)
          VALUES ($1, $2, ARRAY['DOF']::text[]) RETURNING id
        )
        INSERT INTO documentos.bloco_versao (bloco_id, versao, conteudo, esquema_variaveis, vigente_de)
        SELECT id, $3, '', '{}'::jsonb, CURRENT_DATE FROM bloco
      `, [codigo, titulo, VERSAO_BLOCO_VAZIO]);
    }
    await cliente.query(`
      GRANT INSERT (id, documento_id, bloco_versao_id, ordem, ativo, texto_final_cifrado)
        ON documentos.documento_bloco TO ${papel};
      GRANT UPDATE (ordem, ativo, texto_final_cifrado) ON documentos.documento_bloco TO ${papel};
    `);
  });
}
