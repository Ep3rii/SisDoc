import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_ACESSO_ADMIN = '016-acesso-admin';

export async function aplicarAcessoAdmin(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_ACESSO_ADMIN, async () => {
    await cliente.query(`
      CREATE OR REPLACE FUNCTION documentos.validar_encaminhamento_dof() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE autor uuid; tipo_documento text; estado text;
      BEGIN
        SELECT criado_por, tipo, status INTO autor, tipo_documento, estado
          FROM documentos.documento WHERE id = NEW.documento_id FOR UPDATE;
        IF estado IS DISTINCT FROM 'rascunho' OR tipo_documento IS DISTINCT FROM 'DOF' THEN
          RAISE EXCEPTION 'Encaminhamento requer rascunho DOF.' USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'INSERT' THEN
          IF autor IS DISTINCT FROM NEW.encaminhado_por AND NOT EXISTS (
            SELECT 1 FROM seguranca.usuario WHERE id = NEW.encaminhado_por AND ativo AND papel = 'admin'
          ) THEN
            RAISE EXCEPTION 'Encaminhamento exige autor ou administrador ativo.' USING ERRCODE = '23514';
          END IF;
          IF NEW.recolhido_em IS NOT NULL OR NOT EXISTS (
            SELECT 1 FROM seguranca.usuario
            WHERE id = NEW.destinatario_id AND ativo AND papel IN ('coordenador', 'admin')
          ) THEN
            RAISE EXCEPTION 'Destinatário deve ser coordenador ou administrador ativo.' USING ERRCODE = '23514';
          END IF;
        ELSE
          IF ROW(NEW.id, NEW.documento_id, NEW.encaminhado_por, NEW.destinatario_id, NEW.encaminhado_em)
               IS DISTINCT FROM ROW(OLD.id, OLD.documento_id, OLD.encaminhado_por, OLD.destinatario_id, OLD.encaminhado_em)
             OR OLD.recolhido_em IS NOT NULL OR NEW.recolhido_em IS NULL OR NEW.motivo_cifrado IS NULL
             OR (NEW.recolhido_por IS DISTINCT FROM autor
                 AND NEW.recolhido_por IS DISTINCT FROM OLD.encaminhado_por
                 AND NEW.recolhido_por IS DISTINCT FROM OLD.destinatario_id
                 AND NOT EXISTS (
                   SELECT 1 FROM seguranca.usuario WHERE id = NEW.recolhido_por AND ativo AND papel = 'admin'
                 )) THEN
            RAISE EXCEPTION 'Encaminhamento só pode ser encerrado uma vez pelo autor, destinatário ou administrador.'
              USING ERRCODE = '55000';
          END IF;
          IF NEW.recolhido_por = OLD.destinatario_id AND NOT EXISTS (
            SELECT 1 FROM seguranca.usuario
            WHERE id = OLD.destinatario_id AND ativo AND papel IN ('coordenador', 'admin')
          ) THEN
            RAISE EXCEPTION 'Devolução exige destinatário ativo.' USING ERRCODE = '23514';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE OR REPLACE FUNCTION documentos.validar_conferencia_dof() RETURNS trigger LANGUAGE plpgsql AS $$
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
             SELECT 1 FROM seguranca.usuario u WHERE u.id = NEW.conferido_por AND u.ativo
               AND (u.papel = 'admin' OR (
                 u.papel IN ('analista', 'coordenador')
                 AND (documento.criado_por = u.id OR (
                   u.papel = 'coordenador' AND EXISTS (
                     SELECT 1 FROM documentos.encaminhamento_dof e
                     WHERE e.documento_id = NEW.documento_id AND e.destinatario_id = u.id AND e.recolhido_em IS NULL
                   )
                 ))
               ))
           ) THEN
          RAISE EXCEPTION 'Conferência incompatível com o documento, a fonte ou o usuário.' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE OR REPLACE FUNCTION documentos.validar_devolucao_conferido_dof() RETURNS trigger LANGUAGE plpgsql AS $$
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
             SELECT 1 FROM seguranca.usuario u WHERE u.id = NEW.devolvido_por AND u.ativo
               AND (u.papel = 'admin' OR (u.papel = 'coordenador'
                 AND (documento.criado_por = u.id OR EXISTS (
                   SELECT 1 FROM documentos.encaminhamento_dof e
                   WHERE e.documento_id = NEW.documento_id AND e.destinatario_id = u.id AND e.recolhido_em IS NULL
                 ))
               ))
           ) THEN
          RAISE EXCEPTION 'Devolução incompatível com o documento ou o usuário.' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE OR REPLACE FUNCTION documentos.validar_conferencia_dtc() RETURNS trigger LANGUAGE plpgsql AS $$
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
               AND (u.papel IN ('coordenador', 'admin') OR (u.papel = 'analista' AND u.id = documento.criado_por))
           ) THEN
          RAISE EXCEPTION 'Conferência incompatível com o documento, a fonte ou o usuário.' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE OR REPLACE FUNCTION documentos.validar_devolucao_conferido_dtc() RETURNS trigger LANGUAGE plpgsql AS $$
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
             WHERE u.id = NEW.devolvido_por AND u.ativo AND u.papel IN ('coordenador', 'admin')
           ) THEN
          RAISE EXCEPTION 'Devolução incompatível com o documento ou o usuário.' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE OR REPLACE FUNCTION documentos.validar_emissao_aprovacao() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE dados record;
      BEGIN
        SELECT e.tipo AS emissao_tipo, e.emitido_por, d.regra_versao_id AS regra_documento,
          a.regra_versao_id AS regra_aprovada, a.tipo AS aprovacao_tipo
        INTO dados
        FROM documentos.emissao e
        JOIN documentos.documento d ON d.id = e.documento_id
        JOIN documentos.aprovacao_modelo a ON a.id = NEW.aprovacao_id
        WHERE e.id = NEW.emissao_id;
        IF dados IS NULL OR dados.emissao_tipo IS DISTINCT FROM NEW.tipo
           OR dados.aprovacao_tipo IS DISTINCT FROM NEW.tipo
           OR dados.regra_documento IS DISTINCT FROM dados.regra_aprovada
           OR NOT EXISTS (
             SELECT 1 FROM seguranca.usuario u
             WHERE u.id = dados.emitido_por AND u.ativo AND u.papel IN ('coordenador', 'admin')
           ) THEN
          RAISE EXCEPTION 'Emissão incompatível com a aprovação formal ou com o emitente.' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
  });
}
