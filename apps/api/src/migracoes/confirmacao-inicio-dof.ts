import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_CONFIRMACAO_INICIO_DOF = '009-confirmacao-inicio-dof';

export async function aplicarConfirmacaoInicioDof(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_CONFIRMACAO_INICIO_DOF, async (papel) => {
    await cliente.query(`
      ALTER TABLE documentos.documento ADD COLUMN confirmacao_inicio_cifrada bytea
        CHECK (confirmacao_inicio_cifrada IS NULL OR octet_length(confirmacao_inicio_cifrada) > 0);
      CREATE FUNCTION documentos.proteger_confirmacao_inicio() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.confirmacao_inicio_cifrada IS DISTINCT FROM OLD.confirmacao_inicio_cifrada
           AND (OLD.status <> 'rascunho' OR EXISTS (
             SELECT 1 FROM documentos.encaminhamento_dof
             WHERE documento_id = OLD.id AND recolhido_em IS NULL
           )) THEN
          RAISE EXCEPTION 'Confirmação só pode ser alterada em rascunho não encaminhado.' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER confirmacao_inicio_protegida BEFORE UPDATE ON documentos.documento
        FOR EACH ROW EXECUTE FUNCTION documentos.proteger_confirmacao_inicio();
      GRANT UPDATE (confirmacao_inicio_cifrada) ON documentos.documento TO ${papel};
    `);
  });
}
