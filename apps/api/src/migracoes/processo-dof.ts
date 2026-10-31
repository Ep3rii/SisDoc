import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_PROCESSO_DOF = '006-processo-dof';

export async function aplicarProcessoDof(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_PROCESSO_DOF, async (papel) => {
    await cliente.query(`
      ALTER TABLE documentos.documento ADD COLUMN processo_cifrado bytea
        CHECK (processo_cifrado IS NULL OR octet_length(processo_cifrado) > 0);
      CREATE FUNCTION documentos.proteger_processo_cifrado() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.status <> 'rascunho' AND NEW.processo_cifrado IS DISTINCT FROM OLD.processo_cifrado THEN
          RAISE EXCEPTION 'Processo de documento conferido não pode ser alterado.' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER processo_conferido BEFORE UPDATE ON documentos.documento
        FOR EACH ROW EXECUTE FUNCTION documentos.proteger_processo_cifrado();
      GRANT UPDATE (processo_cifrado) ON documentos.documento TO ${papel};
    `);
  });
}
