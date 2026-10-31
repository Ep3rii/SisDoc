import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_ENCAMINHAMENTO_DOF = '007-encaminhamento-dof';

export async function aplicarEncaminhamentoDof(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_ENCAMINHAMENTO_DOF, async (papel) => {
    await cliente.query(`
      CREATE TABLE documentos.encaminhamento_dof (
        id uuid PRIMARY KEY,
        documento_id uuid NOT NULL REFERENCES documentos.documento(id),
        encaminhado_por uuid NOT NULL REFERENCES seguranca.usuario(id),
        destinatario_id uuid NOT NULL REFERENCES seguranca.usuario(id),
        encaminhado_em timestamptz NOT NULL DEFAULT now(),
        recolhido_por uuid REFERENCES seguranca.usuario(id),
        recolhido_em timestamptz,
        motivo_cifrado bytea,
        CHECK (encaminhado_por <> destinatario_id),
        CHECK (
          (recolhido_por IS NULL AND recolhido_em IS NULL AND motivo_cifrado IS NULL)
          OR (recolhido_por IS NOT NULL AND recolhido_em IS NOT NULL
            AND motivo_cifrado IS NOT NULL AND octet_length(motivo_cifrado) > 0)
        )
      );
      CREATE UNIQUE INDEX encaminhamento_dof_ativo ON documentos.encaminhamento_dof (documento_id)
        WHERE recolhido_em IS NULL;
      CREATE INDEX encaminhamento_dof_destinatario ON documentos.encaminhamento_dof (destinatario_id, documento_id)
        WHERE recolhido_em IS NULL;

      CREATE FUNCTION documentos.validar_encaminhamento_dof() RETURNS trigger LANGUAGE plpgsql AS $$
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
        ELSIF ROW(NEW.id, NEW.documento_id, NEW.encaminhado_por, NEW.destinatario_id, NEW.encaminhado_em)
            IS DISTINCT FROM ROW(OLD.id, OLD.documento_id, OLD.encaminhado_por, OLD.destinatario_id, OLD.encaminhado_em)
            OR OLD.recolhido_em IS NOT NULL OR NEW.recolhido_em IS NULL
            OR NEW.recolhido_por IS DISTINCT FROM OLD.encaminhado_por OR NEW.motivo_cifrado IS NULL THEN
          RAISE EXCEPTION 'Encaminhamento só pode ser recolhido uma vez pelo autor.' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER encaminhamento_valido BEFORE INSERT OR UPDATE ON documentos.encaminhamento_dof
        FOR EACH ROW EXECUTE FUNCTION documentos.validar_encaminhamento_dof();
      CREATE TRIGGER encaminhamento_sem_apagar BEFORE DELETE ON documentos.encaminhamento_dof
        FOR EACH ROW EXECUTE FUNCTION seguranca.bloquear_mutacao();
      CREATE TRIGGER encaminhamento_sem_truncar BEFORE TRUNCATE ON documentos.encaminhamento_dof
        FOR EACH STATEMENT EXECUTE FUNCTION seguranca.bloquear_mutacao();

      CREATE FUNCTION documentos.proteger_conteudo_encaminhado() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM documentos.encaminhamento_dof WHERE documento_id = OLD.id AND recolhido_em IS NULL)
           AND ROW(NEW.processo_numero, NEW.processo_cifrado, NEW.entrada_cifrada, NEW.ajustes_cifrados,
                   NEW.resultado_calculo_cifrado, NEW.template_versao_id, NEW.regra_versao_id, NEW.substitui_id)
             IS DISTINCT FROM
               ROW(OLD.processo_numero, OLD.processo_cifrado, OLD.entrada_cifrada, OLD.ajustes_cifrados,
                   OLD.resultado_calculo_cifrado, OLD.template_versao_id, OLD.regra_versao_id, OLD.substitui_id) THEN
          RAISE EXCEPTION 'Recolha o encaminhamento antes de alterar o conteúdo.' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER conteudo_encaminhado BEFORE UPDATE ON documentos.documento
        FOR EACH ROW EXECUTE FUNCTION documentos.proteger_conteudo_encaminhado();

      CREATE FUNCTION documentos.proteger_filho_encaminhado() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE alvo uuid;
      BEGIN
        IF TG_OP = 'DELETE' THEN alvo := OLD.documento_id; ELSE alvo := NEW.documento_id; END IF;
        PERFORM 1 FROM documentos.documento WHERE id = alvo FOR UPDATE;
        IF EXISTS (SELECT 1 FROM documentos.encaminhamento_dof WHERE documento_id = alvo AND recolhido_em IS NULL) THEN
          RAISE EXCEPTION 'Recolha o encaminhamento antes de alterar o conteúdo.' USING ERRCODE = '55000';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER periodo_encaminhado BEFORE INSERT OR UPDATE OR DELETE ON documentos.documento_periodo
        FOR EACH ROW EXECUTE FUNCTION documentos.proteger_filho_encaminhado();
      CREATE TRIGGER bloco_encaminhado BEFORE INSERT OR UPDATE OR DELETE ON documentos.documento_bloco
        FOR EACH ROW EXECUTE FUNCTION documentos.proteger_filho_encaminhado();

      GRANT SELECT ON documentos.encaminhamento_dof TO ${papel};
      GRANT INSERT (id, documento_id, encaminhado_por, destinatario_id) ON documentos.encaminhamento_dof TO ${papel};
      GRANT UPDATE (recolhido_por, recolhido_em, motivo_cifrado) ON documentos.encaminhamento_dof TO ${papel};
    `);
  });
}
