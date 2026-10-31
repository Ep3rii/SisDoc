import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_CONFERENCIA_DOF = '012-conferencia-dof';

export async function aplicarConferenciaDof(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_CONFERENCIA_DOF, async (papel) => {
    await cliente.query(`
      CREATE TABLE documentos.conferencia_dof (
        id uuid PRIMARY KEY,
        documento_id uuid NOT NULL REFERENCES documentos.documento(id),
        revisao_documento integer NOT NULL CHECK (revisao_documento > 1),
        revisao_pessoa bigint NOT NULL CHECK (revisao_pessoa > 0),
        revisao_vinculo bigint NOT NULL CHECK (revisao_vinculo > 0),
        conferido_por uuid NOT NULL REFERENCES seguranca.usuario(id),
        conferido_em timestamptz NOT NULL DEFAULT clock_timestamp(),
        avisos text[] NOT NULL CHECK (cardinality(avisos) <= 20 AND array_position(avisos, NULL) IS NULL),
        UNIQUE (documento_id, revisao_documento),
        UNIQUE (id, documento_id)
      );
      CREATE TABLE documentos.devolucao_conferido_dof (
        id uuid PRIMARY KEY,
        documento_id uuid NOT NULL,
        conferencia_id uuid NOT NULL UNIQUE,
        devolvido_por uuid NOT NULL REFERENCES seguranca.usuario(id),
        devolvido_em timestamptz NOT NULL DEFAULT clock_timestamp(),
        motivo_cifrado bytea NOT NULL CHECK (octet_length(motivo_cifrado) > 0),
        FOREIGN KEY (conferencia_id, documento_id) REFERENCES documentos.conferencia_dof(id, documento_id)
      );

      CREATE FUNCTION documentos.validar_conferencia_dof() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE documento record;
      BEGIN
        SELECT d.tipo, d.status, d.revisao, d.criado_por,
          p.revisao_fonte AS revisao_pessoa, v.revisao_fonte AS revisao_vinculo
        INTO documento
        FROM documentos.documento d
        JOIN nucleo.pessoa p ON p.id = d.pessoa_id
        JOIN nucleo.vinculo v ON v.id = d.vinculo_id AND v.pessoa_id = d.pessoa_id
        WHERE d.id = NEW.documento_id FOR UPDATE OF d;
        IF documento.tipo IS DISTINCT FROM 'DOF' OR documento.status IS DISTINCT FROM 'rascunho'
           OR NEW.revisao_documento IS DISTINCT FROM documento.revisao + 1
           OR NEW.revisao_pessoa IS DISTINCT FROM documento.revisao_pessoa
           OR NEW.revisao_vinculo IS DISTINCT FROM documento.revisao_vinculo
           OR NOT EXISTS (
             SELECT 1 FROM seguranca.usuario u WHERE u.id = NEW.conferido_por
               AND u.ativo AND u.papel IN ('analista', 'coordenador')
           )
           OR (documento.criado_por IS DISTINCT FROM NEW.conferido_por AND NOT EXISTS (
             SELECT 1 FROM documentos.encaminhamento_dof e
             JOIN seguranca.usuario u ON u.id = e.destinatario_id
             WHERE e.documento_id = NEW.documento_id AND e.destinatario_id = NEW.conferido_por
               AND e.recolhido_em IS NULL AND u.ativo AND u.papel = 'coordenador'
           )) THEN
          RAISE EXCEPTION 'Conferência incompatível com o documento, a fonte ou o usuário.'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER conferencia_dof_valida BEFORE INSERT ON documentos.conferencia_dof
        FOR EACH ROW EXECUTE FUNCTION documentos.validar_conferencia_dof();

      CREATE FUNCTION documentos.validar_devolucao_conferido_dof() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE documento record;
      BEGIN
        SELECT d.tipo, d.status, d.revisao, d.criado_por, c.revisao_documento
        INTO documento
        FROM documentos.documento d
        JOIN documentos.conferencia_dof c ON c.documento_id = d.id AND c.id = NEW.conferencia_id
        WHERE d.id = NEW.documento_id FOR UPDATE OF d;
        IF documento.tipo IS DISTINCT FROM 'DOF' OR documento.status IS DISTINCT FROM 'conferido'
           OR documento.revisao IS DISTINCT FROM documento.revisao_documento
           OR NOT EXISTS (
             SELECT 1 FROM seguranca.usuario u
             WHERE u.id = NEW.devolvido_por AND u.ativo AND u.papel = 'coordenador'
           )
           OR (documento.criado_por IS DISTINCT FROM NEW.devolvido_por AND NOT EXISTS (
             SELECT 1 FROM documentos.encaminhamento_dof e
             WHERE e.documento_id = NEW.documento_id AND e.destinatario_id = NEW.devolvido_por
               AND e.recolhido_em IS NULL
           )) THEN
          RAISE EXCEPTION 'Devolução incompatível com o documento ou o coordenador.'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER devolucao_conferido_dof_valida BEFORE INSERT ON documentos.devolucao_conferido_dof
        FOR EACH ROW EXECUTE FUNCTION documentos.validar_devolucao_conferido_dof();

      CREATE FUNCTION documentos.exigir_evento_conferencia_dof() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.tipo <> 'DOF' THEN RETURN NEW; END IF;
        IF OLD.status = 'rascunho' AND NEW.status = 'conferido' THEN
          IF NEW.revisao <> OLD.revisao + 1 OR NOT EXISTS (
            SELECT 1 FROM documentos.conferencia_dof c
            WHERE c.documento_id = OLD.id AND c.revisao_documento = NEW.revisao
              AND c.conferido_por = NEW.conferido_por AND c.conferido_em = NEW.conferido_em
          ) THEN
            RAISE EXCEPTION 'Conferência exige evento correspondente.' USING ERRCODE = '23514';
          END IF;
        ELSIF OLD.status = 'conferido' AND NEW.status = 'rascunho' THEN
          IF NEW.revisao <> OLD.revisao + 1 OR NOT EXISTS (
            SELECT 1 FROM documentos.devolucao_conferido_dof v
            JOIN documentos.conferencia_dof c ON c.id = v.conferencia_id
            WHERE v.documento_id = OLD.id AND c.revisao_documento = OLD.revisao
              AND v.devolvido_por = NEW.atualizado_por
          ) THEN
            RAISE EXCEPTION 'Devolução exige evento correspondente.' USING ERRCODE = '23514';
          END IF;
        ELSIF OLD.status = 'conferido' AND NEW.status = 'conferido' AND NEW.revisao <> OLD.revisao THEN
          RAISE EXCEPTION 'A revisão de documento conferido não pode ser alterada.' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER documento_conferencia_dof BEFORE UPDATE ON documentos.documento
        FOR EACH ROW EXECUTE FUNCTION documentos.exigir_evento_conferencia_dof();

      CREATE TRIGGER conferencia_dof_sem_mutacao BEFORE UPDATE OR DELETE ON documentos.conferencia_dof
        FOR EACH ROW EXECUTE FUNCTION seguranca.bloquear_mutacao();
      CREATE TRIGGER conferencia_dof_sem_truncar BEFORE TRUNCATE ON documentos.conferencia_dof
        FOR EACH STATEMENT EXECUTE FUNCTION seguranca.bloquear_mutacao();
      CREATE TRIGGER devolucao_conferido_dof_sem_mutacao BEFORE UPDATE OR DELETE ON documentos.devolucao_conferido_dof
        FOR EACH ROW EXECUTE FUNCTION seguranca.bloquear_mutacao();
      CREATE TRIGGER devolucao_conferido_dof_sem_truncar BEFORE TRUNCATE ON documentos.devolucao_conferido_dof
        FOR EACH STATEMENT EXECUTE FUNCTION seguranca.bloquear_mutacao();

      GRANT SELECT ON documentos.conferencia_dof, documentos.devolucao_conferido_dof TO ${papel};
      GRANT INSERT (id, documento_id, revisao_documento, revisao_pessoa, revisao_vinculo, conferido_por, avisos)
        ON documentos.conferencia_dof TO ${papel};
      GRANT INSERT (id, documento_id, conferencia_id, devolvido_por, motivo_cifrado)
        ON documentos.devolucao_conferido_dof TO ${papel};
      GRANT UPDATE (status, conferido_por, conferido_em) ON documentos.documento TO ${papel};
    `);
  });
}
