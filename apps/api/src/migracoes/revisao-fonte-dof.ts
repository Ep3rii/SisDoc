import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_REVISAO_FONTE_DOF = '011-revisao-fonte-dof';

export async function aplicarRevisaoFonteDof(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_REVISAO_FONTE_DOF, async () => {
    await cliente.query(`
      ALTER TABLE nucleo.pessoa ADD COLUMN revisao_fonte bigint NOT NULL DEFAULT 1 CHECK (revisao_fonte > 0);
      ALTER TABLE nucleo.vinculo ADD COLUMN revisao_fonte bigint NOT NULL DEFAULT 1 CHECK (revisao_fonte > 0);

      CREATE FUNCTION nucleo.atualizar_revisao_fonte() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          NEW.revisao_fonte := 1;
        ELSE
          IF OLD.revisao_fonte = 9223372036854775807 THEN
            RAISE EXCEPTION 'A revisão da fonte atingiu o limite.' USING ERRCODE = '22003';
          END IF;
          NEW.revisao_fonte := OLD.revisao_fonte + 1;
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER pessoa_revisao_fonte BEFORE INSERT OR UPDATE ON nucleo.pessoa
        FOR EACH ROW EXECUTE FUNCTION nucleo.atualizar_revisao_fonte();
      CREATE TRIGGER vinculo_revisao_fonte BEFORE INSERT OR UPDATE ON nucleo.vinculo
        FOR EACH ROW EXECUTE FUNCTION nucleo.atualizar_revisao_fonte();
    `);
  });
}
