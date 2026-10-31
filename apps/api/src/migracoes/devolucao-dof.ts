import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_DEVOLUCAO_DOF = '010-devolucao-dof';

export async function aplicarDevolucaoDof(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_DEVOLUCAO_DOF, async () => {
    await cliente.query(`
      CREATE OR REPLACE FUNCTION documentos.validar_encaminhamento_dof() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE autor uuid; tipo_documento text; estado text;
      BEGIN
        SELECT criado_por, tipo, status INTO autor, tipo_documento, estado
          FROM documentos.documento WHERE id = NEW.documento_id FOR UPDATE;
        IF estado IS DISTINCT FROM 'rascunho' OR tipo_documento IS DISTINCT FROM 'DOF'
           OR autor IS DISTINCT FROM NEW.encaminhado_por THEN
          RAISE EXCEPTION 'Encaminhamento requer rascunho DOF do autor.' USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'INSERT' THEN
          IF NEW.recolhido_em IS NOT NULL OR NOT EXISTS (
            SELECT 1 FROM seguranca.usuario
            WHERE id = NEW.destinatario_id AND ativo AND papel = 'coordenador'
          ) THEN
            RAISE EXCEPTION 'Destinatário deve ser coordenador ativo.' USING ERRCODE = '23514';
          END IF;
        ELSE
          IF ROW(NEW.id, NEW.documento_id, NEW.encaminhado_por, NEW.destinatario_id, NEW.encaminhado_em)
               IS DISTINCT FROM ROW(OLD.id, OLD.documento_id, OLD.encaminhado_por, OLD.destinatario_id, OLD.encaminhado_em)
             OR OLD.recolhido_em IS NOT NULL OR NEW.recolhido_em IS NULL OR NEW.motivo_cifrado IS NULL
             OR (NEW.recolhido_por IS DISTINCT FROM OLD.encaminhado_por
                 AND NEW.recolhido_por IS DISTINCT FROM OLD.destinatario_id) THEN
            RAISE EXCEPTION 'Encaminhamento só pode ser encerrado uma vez pelo autor ou destinatário.' USING ERRCODE = '55000';
          END IF;
          IF NEW.recolhido_por = OLD.destinatario_id AND NOT EXISTS (
            SELECT 1 FROM seguranca.usuario
            WHERE id = OLD.destinatario_id AND ativo AND papel = 'coordenador'
          ) THEN
            RAISE EXCEPTION 'Devolução exige coordenador destinatário ativo.' USING ERRCODE = '23514';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
  });
}
