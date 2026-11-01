import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_DOCUMENTOS_ADMIN = '017-documentos-admin';

export async function aplicarDocumentosAdmin(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_DOCUMENTOS_ADMIN, async (papel) => {
    await cliente.query(`
      CREATE TABLE documentos.exclusao_documento (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        documento_id uuid NOT NULL UNIQUE,
        tipo text NOT NULL CHECK (tipo IN ('DOF', 'DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS')),
        status_anterior text NOT NULL CHECK (status_anterior IN ('rascunho', 'conferido', 'emitido', 'cancelado')),
        revisao integer NOT NULL CHECK (revisao > 0),
        solicitado_por uuid NOT NULL REFERENCES seguranca.usuario(id),
        motivo text NOT NULL CHECK (char_length(btrim(motivo)) BETWEEN 15 AND 2000),
        solicitado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
        numero_formatado text,
        artefato_id uuid,
        sha256_pdf bytea CHECK (sha256_pdf IS NULL OR octet_length(sha256_pdf) = 32),
        status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'concluido')),
        tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
        ultima_tentativa_em timestamptz,
        erro_sanitizado text,
        pdf_removido boolean,
        concluido_em timestamptz,
        CHECK ((artefato_id IS NULL) = (sha256_pdf IS NULL)),
        CHECK ((status = 'concluido') = (concluido_em IS NOT NULL)),
        CHECK (status <> 'concluido' OR erro_sanitizado IS NULL)
      );
      CREATE INDEX exclusao_documento_pendente
        ON documentos.exclusao_documento (ultima_tentativa_em, solicitado_em)
        WHERE status = 'pendente';
      CREATE TABLE documentos.contexto_exclusao_admin (
        transacao_id bigint NOT NULL,
        documento_id uuid NOT NULL,
        PRIMARY KEY (transacao_id, documento_id)
      );
      REVOKE ALL ON documentos.exclusao_documento, documentos.contexto_exclusao_admin FROM PUBLIC;
      REVOKE ALL ON documentos.exclusao_documento, documentos.contexto_exclusao_admin FROM ${papel};
      GRANT INSERT (substitui_id) ON documentos.documento TO ${papel};

      CREATE FUNCTION documentos.exclusao_admin_autorizada(p_documento uuid)
        RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, documentos
      AS $$
        SELECT EXISTS (
          SELECT 1 FROM documentos.contexto_exclusao_admin c
          WHERE c.transacao_id = txid_current() AND c.documento_id = p_documento
        )
      $$;
      REVOKE ALL ON FUNCTION documentos.exclusao_admin_autorizada(uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION documentos.exclusao_admin_autorizada(uuid) TO ${papel};

      CREATE FUNCTION documentos.bloquear_mutacao_documento() RETURNS trigger
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, documentos
      AS $$
      DECLARE alvo uuid;
      BEGIN
        IF TG_TABLE_NAME = 'emissao_aprovacao' THEN
          SELECT e.documento_id INTO alvo FROM documentos.emissao e WHERE e.id = OLD.emissao_id;
        ELSE
          alvo := OLD.documento_id;
        END IF;
        IF TG_OP = 'DELETE' AND documentos.exclusao_admin_autorizada(alvo) THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'Registro imutável não pode ser alterado ou apagado.'
          USING ERRCODE = '55000';
      END;
      $$;
      REVOKE ALL ON FUNCTION documentos.bloquear_mutacao_documento() FROM PUBLIC;

      DROP TRIGGER ajuste_imutavel ON documentos.ajuste_campo;
      CREATE TRIGGER ajuste_imutavel BEFORE UPDATE OR DELETE ON documentos.ajuste_campo
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_mutacao_documento();
      DROP TRIGGER emissao_imutavel ON documentos.emissao;
      CREATE TRIGGER emissao_imutavel BEFORE UPDATE OR DELETE ON documentos.emissao
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_mutacao_documento();
      DROP TRIGGER encaminhamento_sem_apagar ON documentos.encaminhamento_dof;
      CREATE TRIGGER encaminhamento_sem_apagar BEFORE DELETE ON documentos.encaminhamento_dof
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_mutacao_documento();
      DROP TRIGGER conferencia_dof_sem_mutacao ON documentos.conferencia_dof;
      CREATE TRIGGER conferencia_dof_sem_mutacao BEFORE UPDATE OR DELETE ON documentos.conferencia_dof
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_mutacao_documento();
      DROP TRIGGER devolucao_conferido_dof_sem_mutacao ON documentos.devolucao_conferido_dof;
      CREATE TRIGGER devolucao_conferido_dof_sem_mutacao BEFORE UPDATE OR DELETE ON documentos.devolucao_conferido_dof
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_mutacao_documento();
      DROP TRIGGER conferencia_dtc_sem_mutacao ON documentos.conferencia_dtc;
      CREATE TRIGGER conferencia_dtc_sem_mutacao BEFORE UPDATE OR DELETE ON documentos.conferencia_dtc
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_mutacao_documento();
      DROP TRIGGER devolucao_conferido_dtc_sem_mutacao ON documentos.devolucao_conferido_dtc;
      CREATE TRIGGER devolucao_conferido_dtc_sem_mutacao BEFORE UPDATE OR DELETE ON documentos.devolucao_conferido_dtc
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_mutacao_documento();
      DROP TRIGGER emissao_aprovacao_imutavel ON documentos.emissao_aprovacao;
      CREATE TRIGGER emissao_aprovacao_imutavel BEFORE UPDATE OR DELETE ON documentos.emissao_aprovacao
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_mutacao_documento();

      CREATE OR REPLACE FUNCTION documentos.validar_filho() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE alvo uuid; tipo_documento text; estado text;
      BEGIN
        IF TG_OP = 'DELETE' THEN alvo := OLD.documento_id; ELSE alvo := NEW.documento_id; END IF;
        IF TG_OP = 'DELETE' AND documentos.exclusao_admin_autorizada(alvo) THEN RETURN OLD; END IF;
        IF TG_OP = 'UPDATE' AND NEW.documento_id <> OLD.documento_id THEN
          RAISE EXCEPTION 'Não é permitido mover item entre documentos.' USING ERRCODE = '23514';
        END IF;
        IF EXISTS (
          SELECT 1 FROM documentos.exclusao_documento x
          WHERE x.documento_id = alvo AND x.status = 'pendente'
        ) THEN
          RAISE EXCEPTION 'O documento está aguardando exclusão administrativa.' USING ERRCODE = '55000';
        END IF;
        SELECT tipo, status INTO tipo_documento, estado
          FROM documentos.documento WHERE id = alvo FOR UPDATE;
        IF estado IS DISTINCT FROM 'rascunho' THEN
          RAISE EXCEPTION 'Itens só podem ser alterados em rascunho.' USING ERRCODE = '55000';
        END IF;
        IF TG_TABLE_NAME = 'documento_periodo' AND TG_OP <> 'DELETE' THEN
          IF tipo_documento = 'DOF' AND NEW.ordem <> 1 THEN
            RAISE EXCEPTION 'DOF permite apenas um período.' USING ERRCODE = '23514';
          END IF;
          IF EXISTS (
            SELECT 1 FROM documentos.documento_periodo p
            WHERE p.documento_id = alvo AND p.id <> NEW.id
              AND daterange(p.inicio, p.fim, '[]') && daterange(NEW.inicio, NEW.fim, '[]')
          ) THEN
            RAISE EXCEPTION 'Períodos não podem se sobrepor.' USING ERRCODE = '23514';
          END IF;
        END IF;
        IF TG_TABLE_NAME = 'documento_cargo_comissionado' AND tipo_documento <> 'DTC_COMISSIONADO' THEN
          RAISE EXCEPTION 'Cargo comissionado incompatível com o tipo do documento.' USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$;

      CREATE OR REPLACE FUNCTION documentos.proteger_filho_encaminhado() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE alvo uuid;
      BEGIN
        IF TG_OP = 'DELETE' THEN alvo := OLD.documento_id; ELSE alvo := NEW.documento_id; END IF;
        IF TG_OP = 'DELETE' AND documentos.exclusao_admin_autorizada(alvo) THEN RETURN OLD; END IF;
        IF EXISTS (
          SELECT 1 FROM documentos.exclusao_documento x
          WHERE x.documento_id = alvo AND x.status = 'pendente'
        ) THEN
          RAISE EXCEPTION 'O documento está aguardando exclusão administrativa.' USING ERRCODE = '55000';
        END IF;
        PERFORM 1 FROM documentos.documento WHERE id = alvo FOR UPDATE;
        IF EXISTS (SELECT 1 FROM documentos.encaminhamento_dof WHERE documento_id = alvo AND recolhido_em IS NULL) THEN
          RAISE EXCEPTION 'Recolha o encaminhamento antes de alterar o conteúdo.' USING ERRCODE = '55000';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$;

      CREATE OR REPLACE FUNCTION documentos.restringir_remocao_periodo_dof() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF documentos.exclusao_admin_autorizada(OLD.documento_id) THEN RETURN OLD; END IF;
        IF EXISTS (SELECT 1 FROM documentos.documento WHERE id = OLD.documento_id AND tipo = 'DOF') THEN
          RAISE EXCEPTION 'O período da DOF não pode ser removido.' USING ERRCODE = '55000';
        END IF;
        RETURN OLD;
      END;
      $$;

      CREATE FUNCTION documentos.bloquear_documento_em_exclusao() RETURNS trigger
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, documentos
      AS $$
      DECLARE alvo uuid; id_emissao_alvo uuid; origem uuid;
      BEGIN
        IF TG_TABLE_NAME = 'documento' THEN
          IF TG_OP = 'DELETE' THEN alvo := OLD.id; ELSE alvo := NEW.id; END IF;
          IF TG_OP = 'INSERT' AND NEW.substitui_id IS NOT NULL THEN
            origem := NEW.substitui_id;
            PERFORM pg_advisory_xact_lock_shared(hashtextextended(origem::text, 0));
            PERFORM 1 FROM documentos.documento WHERE id = origem;
            IF NOT FOUND OR EXISTS (
              SELECT 1 FROM documentos.exclusao_documento x
              WHERE x.documento_id = origem AND x.status = 'pendente'
            ) THEN
              RAISE EXCEPTION 'A emissão está sendo excluída e não pode gerar cópias.' USING ERRCODE = '55000';
            END IF;
          END IF;
        ELSIF TG_TABLE_NAME = 'emissao' THEN
          IF TG_OP = 'DELETE' THEN alvo := OLD.documento_id; ELSE alvo := NEW.documento_id; END IF;
        ELSIF TG_TABLE_NAME = 'job_pdf' THEN
          IF TG_OP = 'DELETE' THEN id_emissao_alvo := OLD.emissao_id; ELSE id_emissao_alvo := NEW.emissao_id; END IF;
          SELECT e.documento_id INTO alvo FROM documentos.emissao e WHERE e.id = id_emissao_alvo;
        ELSIF TG_TABLE_NAME = 'artefato_pdf' THEN
          IF TG_OP = 'DELETE' THEN id_emissao_alvo := OLD.emissao_id; ELSE id_emissao_alvo := NEW.emissao_id; END IF;
          SELECT e.documento_id INTO alvo FROM documentos.emissao e WHERE e.id = id_emissao_alvo;
        ELSE
          IF TG_OP = 'DELETE' THEN alvo := OLD.documento_id; ELSE alvo := NEW.documento_id; END IF;
        END IF;
        IF TG_OP = 'DELETE' AND documentos.exclusao_admin_autorizada(alvo) THEN RETURN OLD; END IF;
        IF EXISTS (
          SELECT 1 FROM documentos.exclusao_documento x
          WHERE x.documento_id = alvo AND x.status = 'pendente'
        ) THEN
          RAISE EXCEPTION 'O documento está aguardando exclusão administrativa.' USING ERRCODE = '55000';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$;
      REVOKE ALL ON FUNCTION documentos.bloquear_documento_em_exclusao() FROM PUBLIC;

      CREATE TRIGGER documento_exclusao_pendente BEFORE INSERT OR UPDATE OR DELETE ON documentos.documento
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_documento_em_exclusao();
      CREATE TRIGGER periodo_exclusao_pendente BEFORE INSERT OR UPDATE OR DELETE ON documentos.documento_periodo
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_documento_em_exclusao();
      CREATE TRIGGER cargo_exclusao_pendente BEFORE INSERT OR UPDATE OR DELETE ON documentos.documento_cargo_comissionado
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_documento_em_exclusao();
      CREATE TRIGGER bloco_exclusao_pendente BEFORE INSERT OR UPDATE OR DELETE ON documentos.documento_bloco
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_documento_em_exclusao();
      CREATE TRIGGER ajuste_exclusao_pendente BEFORE INSERT OR UPDATE OR DELETE ON documentos.ajuste_campo
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_documento_em_exclusao();
      CREATE TRIGGER encaminhamento_exclusao_pendente BEFORE INSERT OR UPDATE OR DELETE ON documentos.encaminhamento_dof
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_documento_em_exclusao();
      CREATE TRIGGER conferencia_dof_exclusao_pendente BEFORE INSERT OR UPDATE OR DELETE ON documentos.conferencia_dof
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_documento_em_exclusao();
      CREATE TRIGGER devolucao_dof_exclusao_pendente BEFORE INSERT OR UPDATE OR DELETE ON documentos.devolucao_conferido_dof
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_documento_em_exclusao();
      CREATE TRIGGER conferencia_dtc_exclusao_pendente BEFORE INSERT OR UPDATE OR DELETE ON documentos.conferencia_dtc
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_documento_em_exclusao();
      CREATE TRIGGER devolucao_dtc_exclusao_pendente BEFORE INSERT OR UPDATE OR DELETE ON documentos.devolucao_conferido_dtc
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_documento_em_exclusao();
      CREATE TRIGGER emissao_exclusao_pendente BEFORE INSERT OR UPDATE OR DELETE ON documentos.emissao
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_documento_em_exclusao();
      CREATE TRIGGER job_pdf_exclusao_pendente BEFORE INSERT OR UPDATE OR DELETE ON documentos.job_pdf
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_documento_em_exclusao();
      CREATE TRIGGER artefato_pdf_exclusao_pendente BEFORE INSERT OR UPDATE OR DELETE ON documentos.artefato_pdf
        FOR EACH ROW EXECUTE FUNCTION documentos.bloquear_documento_em_exclusao();

      CREATE FUNCTION documentos.solicitar_exclusao_documento_admin(
        p_documento uuid, p_ator uuid, p_revisao integer, p_motivo text, p_confirmacao text
      ) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = pg_catalog, documentos, seguranca
      AS $$
      DECLARE registro_documento record; arquivo record; id_solicitacao uuid;
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM seguranca.usuario u
          WHERE u.id = p_ator AND u.ativo AND NOT u.troca_senha_obrigatoria AND u.papel = 'admin'
        ) THEN
          RAISE EXCEPTION 'Exclusão exige administrador ativo.' USING ERRCODE = '42501';
        END IF;
        IF p_revisao IS NULL OR p_revisao < 1 OR p_motivo IS NULL
           OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 2000
           OR p_confirmacao IS DISTINCT FROM 'EXCLUIR DOCUMENTO ' || p_documento::text THEN
          RAISE EXCEPTION 'Confirmação, revisão ou motivo de exclusão inválido.' USING ERRCODE = '22023';
        END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended(p_documento::text, 0));
        SELECT doc.id, doc.tipo, doc.status, doc.revisao, doc.pessoa_id
          INTO registro_documento FROM documentos.documento doc WHERE doc.id = p_documento FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Documento não encontrado.' USING ERRCODE = 'P0002';
        END IF;
        IF registro_documento.revisao IS DISTINCT FROM p_revisao THEN
          RAISE EXCEPTION 'A revisão do documento mudou. Atualize a lista antes de excluir.' USING ERRCODE = '40001';
        END IF;
        IF EXISTS (SELECT 1 FROM documentos.documento copia WHERE copia.substitui_id = p_documento) THEN
          RAISE EXCEPTION 'Documento possui cópias dependentes; remova essas cópias antes.' USING ERRCODE = '23503';
        END IF;
        SELECT e.numero_formatado, a.id AS artefato_id, a.sha256
          INTO arquivo
          FROM documentos.emissao e
          LEFT JOIN documentos.artefato_pdf a ON a.emissao_id = e.id
          WHERE e.documento_id = p_documento;
        INSERT INTO documentos.exclusao_documento (
          documento_id, tipo, status_anterior, revisao, solicitado_por, motivo, numero_formatado,
          artefato_id, sha256_pdf
        ) VALUES (
          registro_documento.id, registro_documento.tipo, registro_documento.status, registro_documento.revisao,
          p_ator, btrim(p_motivo), arquivo.numero_formatado,
          arquivo.artefato_id, arquivo.sha256
        ) RETURNING id INTO id_solicitacao;
        RETURN id_solicitacao;
      END;
      $$;
      REVOKE ALL ON FUNCTION documentos.solicitar_exclusao_documento_admin(uuid, uuid, integer, text, text) FROM PUBLIC;

      CREATE FUNCTION documentos.finalizar_exclusao_documento_admin(
        p_solicitacao uuid, p_pdf_removido boolean
      ) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = pg_catalog, documentos, seguranca
      AS $$
      DECLARE x record; pessoa uuid;
      BEGIN
        SELECT * INTO x FROM documentos.exclusao_documento
          WHERE id = p_solicitacao AND status = 'pendente' FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação de exclusão pendente não encontrada.' USING ERRCODE = 'P0002'; END IF;
        IF NOT EXISTS (
          SELECT 1 FROM seguranca.usuario u WHERE u.id = x.solicitado_por AND u.papel = 'admin'
        ) THEN
          RAISE EXCEPTION 'Solicitante da exclusão não identificado como administrador.' USING ERRCODE = '42501';
        END IF;
        IF x.artefato_id IS NOT NULL AND p_pdf_removido IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'PDF da emissão não foi removido; exclusão física cancelada.' USING ERRCODE = '55000';
        END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended(x.documento_id::text, 0));
        PERFORM 1 FROM documentos.documento WHERE id = x.documento_id FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Documento não encontrado para exclusão física.' USING ERRCODE = 'P0002';
        END IF;
        IF (SELECT revisao FROM documentos.documento WHERE id = x.documento_id) IS DISTINCT FROM x.revisao THEN
          RAISE EXCEPTION 'A revisão do documento mudou após a solicitação.' USING ERRCODE = '40001';
        END IF;
        IF EXISTS (SELECT 1 FROM documentos.documento copia WHERE copia.substitui_id = x.documento_id) THEN
          RAISE EXCEPTION 'Documento possui cópias dependentes; exclusão física recusada.' USING ERRCODE = '23503';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM documentos.emissao e
          JOIN documentos.emissao_aprovacao a ON a.emissao_id = e.id
          WHERE e.documento_id = x.documento_id
        ) AND EXISTS (SELECT 1 FROM documentos.emissao WHERE documento_id = x.documento_id) THEN
          RAISE EXCEPTION 'A emissão não possui vínculo de aprovação íntegro.' USING ERRCODE = '55000';
        END IF;
        SELECT pessoa_id INTO pessoa FROM documentos.documento WHERE id = x.documento_id;
        INSERT INTO documentos.contexto_exclusao_admin (transacao_id, documento_id)
          VALUES (txid_current(), x.documento_id);

        DELETE FROM documentos.documento_bloco WHERE documento_id = x.documento_id;
        DELETE FROM documentos.documento_periodo WHERE documento_id = x.documento_id;
        DELETE FROM documentos.documento_cargo_comissionado WHERE documento_id = x.documento_id;
        DELETE FROM documentos.ajuste_campo WHERE documento_id = x.documento_id;
        DELETE FROM documentos.encaminhamento_dof WHERE documento_id = x.documento_id;
        DELETE FROM documentos.devolucao_conferido_dof WHERE documento_id = x.documento_id;
        DELETE FROM documentos.conferencia_dof WHERE documento_id = x.documento_id;
        DELETE FROM documentos.devolucao_conferido_dtc WHERE documento_id = x.documento_id;
        DELETE FROM documentos.conferencia_dtc WHERE documento_id = x.documento_id;
        DELETE FROM documentos.artefato_pdf a USING documentos.emissao e
          WHERE a.emissao_id = e.id AND e.documento_id = x.documento_id;
        DELETE FROM documentos.job_pdf j USING documentos.emissao e
          WHERE j.emissao_id = e.id AND e.documento_id = x.documento_id;
        DELETE FROM documentos.emissao_aprovacao a USING documentos.emissao e
          WHERE a.emissao_id = e.id AND e.documento_id = x.documento_id;
        DELETE FROM documentos.emissao WHERE documento_id = x.documento_id;
        DELETE FROM documentos.documento WHERE id = x.documento_id;

        INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, entidade_id, pessoa_id, detalhes)
        VALUES (
          x.solicitado_por, 'documento_excluido_fisicamente', 'documento', x.documento_id, pessoa,
          jsonb_build_object(
            'solicitacaoId', x.id, 'tipo', x.tipo, 'statusAnterior', x.status_anterior,
            'revisao', x.revisao, 'motivo', x.motivo, 'numero', x.numero_formatado,
            'pdfRemovido', p_pdf_removido, 'artefatoId', x.artefato_id
          )
        );
        DELETE FROM documentos.contexto_exclusao_admin
          WHERE transacao_id = txid_current() AND documento_id = x.documento_id;
        UPDATE documentos.exclusao_documento SET status = 'concluido', erro_sanitizado = NULL,
          pdf_removido = p_pdf_removido, concluido_em = clock_timestamp()
          WHERE id = x.id AND status = 'pendente';
      END;
      $$;
      REVOKE ALL ON FUNCTION documentos.finalizar_exclusao_documento_admin(uuid, boolean) FROM PUBLIC;

      CREATE FUNCTION documentos.registrar_falha_exclusao_documento_admin(p_solicitacao uuid) RETURNS void
        LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, documentos
      AS $$
        UPDATE documentos.exclusao_documento SET tentativas = tentativas + 1,
          ultima_tentativa_em = clock_timestamp(),
          erro_sanitizado = 'A exclusão aguarda a remoção segura do PDF ou a resolução de uma dependência. O registro permanece íntegro.'
        WHERE id = p_solicitacao AND status = 'pendente'
      $$;
      REVOKE ALL ON FUNCTION documentos.registrar_falha_exclusao_documento_admin(uuid) FROM PUBLIC;

      CREATE FUNCTION documentos.listar_exclusoes_pendentes_admin(p_limite integer)
        RETURNS TABLE(id uuid) LANGUAGE sql SECURITY DEFINER
        SET search_path = pg_catalog, documentos
      AS $$
        SELECT x.id FROM documentos.exclusao_documento x
        WHERE x.status = 'pendente'
          AND (x.ultima_tentativa_em IS NULL
            OR x.ultima_tentativa_em <= clock_timestamp() - interval '5 seconds')
        ORDER BY x.solicitado_em, x.id
        LIMIT LEAST(GREATEST(COALESCE(p_limite, 1), 1), 5)
      $$;
      REVOKE ALL ON FUNCTION documentos.listar_exclusoes_pendentes_admin(integer) FROM PUBLIC;

      CREATE FUNCTION documentos.reservar_exclusao_pendente_admin(p_solicitacao uuid)
        RETURNS TABLE(
          id uuid, documento_id uuid, solicitado_por uuid, artefato_id uuid, sha256_pdf bytea, status text
        ) LANGUAGE sql SECURITY DEFINER
        SET search_path = pg_catalog, documentos
      AS $$
        SELECT x.id, x.documento_id, x.solicitado_por, x.artefato_id, x.sha256_pdf, x.status
        FROM documentos.exclusao_documento x
        WHERE x.id = p_solicitacao AND x.status = 'pendente'
        FOR UPDATE OF x SKIP LOCKED
      $$;
      REVOKE ALL ON FUNCTION documentos.reservar_exclusao_pendente_admin(uuid) FROM PUBLIC;

      CREATE FUNCTION documentos.consultar_exclusao_admin(p_solicitacao uuid)
        RETURNS TABLE(status text, numero_formatado text) LANGUAGE sql SECURITY DEFINER
        SET search_path = pg_catalog, documentos
      AS $$
        SELECT x.status, x.numero_formatado
        FROM documentos.exclusao_documento x WHERE x.id = p_solicitacao
      $$;
      REVOKE ALL ON FUNCTION documentos.consultar_exclusao_admin(uuid) FROM PUBLIC;

      GRANT EXECUTE ON FUNCTION documentos.listar_exclusoes_pendentes_admin(integer) TO ${papel};
      GRANT EXECUTE ON FUNCTION documentos.reservar_exclusao_pendente_admin(uuid) TO ${papel};
      GRANT EXECUTE ON FUNCTION documentos.consultar_exclusao_admin(uuid) TO ${papel};
      GRANT EXECUTE ON FUNCTION documentos.registrar_falha_exclusao_documento_admin(uuid) TO ${papel};
      GRANT EXECUTE ON FUNCTION documentos.finalizar_exclusao_documento_admin(uuid, boolean) TO ${papel};

      GRANT EXECUTE ON FUNCTION documentos.solicitar_exclusao_documento_admin(uuid, uuid, integer, text, text) TO ${papel};
      GRANT EXECUTE ON FUNCTION documentos.finalizar_exclusao_documento_admin(uuid, boolean) TO ${papel};
      GRANT EXECUTE ON FUNCTION documentos.registrar_falha_exclusao_documento_admin(uuid) TO ${papel};
      GRANT SELECT (id, documento_id, solicitado_por, artefato_id, sha256_pdf, status, numero_formatado,
        solicitado_em, tentativas, ultima_tentativa_em)
        ON documentos.exclusao_documento TO ${papel};
    `);
  });
}
