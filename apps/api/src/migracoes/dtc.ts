import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_DTC = '014-dtc';
export const TEMPLATES_DTC = Object.freeze({
  DTC_IPAM: 'emissao-dtc-ipam-1',
  DTC_COMISSIONADO: 'emissao-dtc-comissionado-1',
  DTC_INSS: 'emissao-dtc-inss-provisorio-1',
} as const);

export async function aplicarDtc(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_DTC, async (papel) => {
    await cliente.query(`
      INSERT INTO documentos.template_versao (tipo, versao, html, css, vigente_de) VALUES
        ('DTC_IPAM', '${TEMPLATES_DTC.DTC_IPAM}',
          '<!-- Layout: @sisdoc/templates renderizarDocumentoDtc (Anexo III) v1; emissão exige aprovação formal. -->', '', CURRENT_DATE),
        ('DTC_COMISSIONADO', '${TEMPLATES_DTC.DTC_COMISSIONADO}',
          '<!-- Layout: @sisdoc/templates renderizarDocumentoDtc (Anexo VIII) v1; totais inferidos; emissão exige aprovação formal. -->', '', CURRENT_DATE),
        ('DTC_INSS', '${TEMPLATES_DTC.DTC_INSS}',
          '<!-- Layout PROVISÓRIO: textos oficiais do INSS não extraídos; emissão exige aprovação formal. -->', '', CURRENT_DATE);

      CREATE TABLE documentos.conferencia_dtc (
        id uuid PRIMARY KEY,
        documento_id uuid NOT NULL REFERENCES documentos.documento(id),
        revisao_documento integer NOT NULL CHECK (revisao_documento > 1),
        revisao_pessoa bigint NOT NULL CHECK (revisao_pessoa > 0),
        revisao_vinculo bigint NOT NULL CHECK (revisao_vinculo > 0),
        conferido_por uuid NOT NULL REFERENCES seguranca.usuario(id),
        conferido_em timestamptz NOT NULL DEFAULT clock_timestamp(),
        avisos text[] NOT NULL CHECK (cardinality(avisos) <= 40 AND array_position(avisos, NULL) IS NULL),
        UNIQUE (documento_id, revisao_documento),
        UNIQUE (id, documento_id)
      );
      CREATE TABLE documentos.devolucao_conferido_dtc (
        id uuid PRIMARY KEY,
        documento_id uuid NOT NULL,
        conferencia_id uuid NOT NULL UNIQUE,
        devolvido_por uuid NOT NULL REFERENCES seguranca.usuario(id),
        devolvido_em timestamptz NOT NULL DEFAULT clock_timestamp(),
        motivo_cifrado bytea NOT NULL CHECK (octet_length(motivo_cifrado) > 0),
        FOREIGN KEY (conferencia_id, documento_id) REFERENCES documentos.conferencia_dtc(id, documento_id)
      );

      CREATE FUNCTION documentos.validar_conferencia_dtc() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE documento record;
      BEGIN
        SELECT d.tipo, d.status, d.revisao, d.criado_por,
          p.revisao_fonte AS revisao_pessoa, v.revisao_fonte AS revisao_vinculo
        INTO documento
        FROM documentos.documento d
        JOIN nucleo.pessoa p ON p.id = d.pessoa_id
        JOIN nucleo.vinculo v ON v.id = d.vinculo_id AND v.pessoa_id = d.pessoa_id
        WHERE d.id = NEW.documento_id FOR UPDATE OF d;
        IF documento.tipo IS NULL OR documento.tipo = 'DOF'
           OR documento.status IS DISTINCT FROM 'rascunho'
           OR NEW.revisao_documento IS DISTINCT FROM documento.revisao + 1
           OR NEW.revisao_pessoa IS DISTINCT FROM documento.revisao_pessoa
           OR NEW.revisao_vinculo IS DISTINCT FROM documento.revisao_vinculo
           OR NOT EXISTS (
             SELECT 1 FROM seguranca.usuario u WHERE u.id = NEW.conferido_por AND u.ativo
               AND (u.papel = 'coordenador' OR (u.papel = 'analista' AND u.id = documento.criado_por))
           ) THEN
          RAISE EXCEPTION 'Conferência incompatível com o documento, a fonte ou o usuário.'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER conferencia_dtc_valida BEFORE INSERT ON documentos.conferencia_dtc
        FOR EACH ROW EXECUTE FUNCTION documentos.validar_conferencia_dtc();

      CREATE FUNCTION documentos.validar_devolucao_conferido_dtc() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE documento record;
      BEGIN
        SELECT d.tipo, d.status, d.revisao, c.revisao_documento
        INTO documento
        FROM documentos.documento d
        JOIN documentos.conferencia_dtc c ON c.documento_id = d.id AND c.id = NEW.conferencia_id
        WHERE d.id = NEW.documento_id FOR UPDATE OF d;
        IF documento.tipo IS NULL OR documento.tipo = 'DOF'
           OR documento.status IS DISTINCT FROM 'conferido'
           OR documento.revisao IS DISTINCT FROM documento.revisao_documento
           OR NOT EXISTS (
             SELECT 1 FROM seguranca.usuario u
             WHERE u.id = NEW.devolvido_por AND u.ativo AND u.papel = 'coordenador'
           ) THEN
          RAISE EXCEPTION 'Devolução incompatível com o documento ou o coordenador.'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER devolucao_conferido_dtc_valida BEFORE INSERT ON documentos.devolucao_conferido_dtc
        FOR EACH ROW EXECUTE FUNCTION documentos.validar_devolucao_conferido_dtc();

      CREATE FUNCTION documentos.exigir_evento_conferencia_dtc() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.tipo = 'DOF' THEN RETURN NEW; END IF;
        IF OLD.status = 'rascunho' AND NEW.status = 'conferido' THEN
          IF NEW.revisao <> OLD.revisao + 1 OR NOT EXISTS (
            SELECT 1 FROM documentos.conferencia_dtc c
            WHERE c.documento_id = OLD.id AND c.revisao_documento = NEW.revisao
              AND c.conferido_por = NEW.conferido_por AND c.conferido_em = NEW.conferido_em
          ) THEN
            RAISE EXCEPTION 'Conferência exige evento correspondente.' USING ERRCODE = '23514';
          END IF;
        ELSIF OLD.status = 'conferido' AND NEW.status = 'rascunho' THEN
          IF NEW.revisao <> OLD.revisao + 1 OR NOT EXISTS (
            SELECT 1 FROM documentos.devolucao_conferido_dtc v
            JOIN documentos.conferencia_dtc c ON c.id = v.conferencia_id
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
      CREATE TRIGGER documento_conferencia_dtc BEFORE UPDATE ON documentos.documento
        FOR EACH ROW EXECUTE FUNCTION documentos.exigir_evento_conferencia_dtc();

      CREATE TRIGGER conferencia_dtc_sem_mutacao BEFORE UPDATE OR DELETE ON documentos.conferencia_dtc
        FOR EACH ROW EXECUTE FUNCTION seguranca.bloquear_mutacao();
      CREATE TRIGGER conferencia_dtc_sem_truncar BEFORE TRUNCATE ON documentos.conferencia_dtc
        FOR EACH STATEMENT EXECUTE FUNCTION seguranca.bloquear_mutacao();
      CREATE TRIGGER devolucao_conferido_dtc_sem_mutacao BEFORE UPDATE OR DELETE ON documentos.devolucao_conferido_dtc
        FOR EACH ROW EXECUTE FUNCTION seguranca.bloquear_mutacao();
      CREATE TRIGGER devolucao_conferido_dtc_sem_truncar BEFORE TRUNCATE ON documentos.devolucao_conferido_dtc
        FOR EACH STATEMENT EXECUTE FUNCTION seguranca.bloquear_mutacao();

      CREATE FUNCTION documentos.restringir_remocao_periodo_dof() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM documentos.documento WHERE id = OLD.documento_id AND tipo = 'DOF') THEN
          RAISE EXCEPTION 'O período da DOF não pode ser removido.' USING ERRCODE = '55000';
        END IF;
        RETURN OLD;
      END;
      $$;
      CREATE TRIGGER periodo_dof_sem_remocao BEFORE DELETE ON documentos.documento_periodo
        FOR EACH ROW EXECUTE FUNCTION documentos.restringir_remocao_periodo_dof();

      CREATE INDEX documento_tipo_status_autor ON documentos.documento (tipo, status, criado_por, atualizado_em DESC);
    `);
    await cliente.query('REVOKE ALL ON documentos.conferencia_dtc, documentos.devolucao_conferido_dtc FROM PUBLIC');
    await cliente.query(`GRANT SELECT ON documentos.conferencia_dtc, documentos.devolucao_conferido_dtc TO ${papel}`);
    await cliente.query(`
      GRANT INSERT (id, documento_id, revisao_documento, revisao_pessoa, revisao_vinculo, conferido_por, avisos)
      ON documentos.conferencia_dtc TO ${papel}
    `);
    await cliente.query(`
      GRANT INSERT (id, documento_id, conferencia_id, devolvido_por, motivo_cifrado)
      ON documentos.devolucao_conferido_dtc TO ${papel}
    `);
    // Períodos e cargos da DTC são regravados por inteiro a cada edição do rascunho (o gatilho validar_filho só aceita rascunho).
    await cliente.query(`GRANT INSERT (categoria, cargo) ON documentos.documento_periodo TO ${papel}`);
    await cliente.query(`GRANT DELETE ON documentos.documento_periodo TO ${papel}`);
    await cliente.query(`
      GRANT INSERT (id, documento_id, ordem, cargo, decreto_nomeacao, publicacao_nomeacao, data_entrada_exercicio,
        decreto_exoneracao, publicacao_exoneracao, data_encerramento)
      ON documentos.documento_cargo_comissionado TO ${papel}
    `);
    await cliente.query(`GRANT DELETE ON documentos.documento_cargo_comissionado TO ${papel}`);
  });
}
