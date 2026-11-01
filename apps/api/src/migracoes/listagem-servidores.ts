import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_LISTAGEM_SERVIDORES = '020-listagem-servidores';

export async function aplicarListagemServidores(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_LISTAGEM_SERVIDORES, async () => {
    await cliente.query(`
      CREATE FUNCTION nucleo.chave_matricula_natural(valor text) RETURNS text[]
        LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
        SET search_path = pg_catalog
        AS $$
          SELECT array_agg(
            CASE WHEN parte[1] ~ '^[0-9]+$' THEN
              '1' || lpad(length(coalesce(nullif(ltrim(parte[1], '0'), ''), '0'))::text, 10, '0')
                || coalesce(nullif(ltrim(parte[1], '0'), ''), '0')
            ELSE '2' || lower(parte[1] COLLATE "C") END ORDER BY ordem)
          FROM regexp_matches(valor, '([0-9]+|[^0-9]+)', 'g') WITH ORDINALITY AS partes(parte, ordem)
        $$;
      CREATE INDEX vinculo_matricula_natural ON nucleo.vinculo
        ((nucleo.chave_matricula_natural(matricula) COLLATE "C"), sistema_origem COLLATE "C", id);
      CREATE INDEX vinculo_pessoa_matricula_natural ON nucleo.vinculo
        (pessoa_id, (nucleo.chave_matricula_natural(matricula) COLLATE "C"), sistema_origem COLLATE "C", id);
    `);
  });
}
