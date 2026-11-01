import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_PLANILHAS_LEGADO = '019-planilhas-legado';

export async function aplicarPlanilhasLegado(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_PLANILHAS_LEGADO, async (papel) => {
    await cliente.query(`
      CREATE TABLE legado.planilha_lote (
        id uuid PRIMARY KEY,
        origem text NOT NULL,
        hash_arquivo bytea NOT NULL CHECK (octet_length(hash_arquivo) = 32),
        cabecalhos jsonb NOT NULL CHECK (jsonb_typeof(cabecalhos) = 'array'),
        linhas integer NOT NULL CHECK (linhas >= 0),
        usuario_id uuid NOT NULL REFERENCES seguranca.usuario(id),
        importado_em timestamptz NOT NULL DEFAULT now(),
        UNIQUE (origem, hash_arquivo)
      );
      CREATE TABLE legado.planilha_linha (
        id uuid PRIMARY KEY,
        lote_id uuid NOT NULL REFERENCES legado.planilha_lote(id),
        numero integer NOT NULL CHECK (numero > 0),
        conteudo_cifrado bytea NOT NULL,
        UNIQUE (lote_id, numero)
      );
      REVOKE ALL ON legado.planilha_lote, legado.planilha_linha FROM PUBLIC;
      GRANT USAGE ON SCHEMA legado TO ${papel};
      GRANT SELECT, INSERT ON legado.planilha_lote, legado.planilha_linha TO ${papel};
    `);
  });
}
