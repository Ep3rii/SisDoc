import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_EMISSAO = '013-emissao';
export const TEMPLATE_EMISSAO_DOF = 'emissao-dof-1';

export async function aplicarEmissao(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_EMISSAO, async (papel) => {
    await cliente.query(`
      INSERT INTO documentos.template_versao (tipo, versao, html, css, vigente_de)
      VALUES ('DOF', '${TEMPLATE_EMISSAO_DOF}',
        '<!-- Layout de emissão: @sisdoc/templates renderizarEmissaoDof v1; uso operacional exige aprovação formal registrada. -->',
        '', CURRENT_DATE);

      CREATE TABLE documentos.aprovacao_modelo (
        id uuid PRIMARY KEY,
        tipo text NOT NULL CHECK (tipo IN ('DOF', 'DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS')),
        regra_versao_id uuid NOT NULL REFERENCES documentos.regra_versao(id),
        template_versao_id uuid NOT NULL,
        aprovado_por text NOT NULL CHECK (
          char_length(aprovado_por) BETWEEN 3 AND 200 AND aprovado_por = btrim(aprovado_por)
        ),
        referencia_decisao text NOT NULL CHECK (
          char_length(referencia_decisao) BETWEEN 3 AND 200 AND referencia_decisao = btrim(referencia_decisao)
        ),
        registrado_por text NOT NULL DEFAULT current_user,
        aprovado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
        UNIQUE (tipo, regra_versao_id, template_versao_id),
        UNIQUE (id, tipo),
        FOREIGN KEY (template_versao_id, tipo) REFERENCES documentos.template_versao(id, tipo)
      );
      CREATE TRIGGER aprovacao_modelo_imutavel BEFORE UPDATE OR DELETE ON documentos.aprovacao_modelo
        FOR EACH ROW EXECUTE FUNCTION seguranca.bloquear_mutacao();
      CREATE TRIGGER aprovacao_modelo_sem_truncar BEFORE TRUNCATE ON documentos.aprovacao_modelo
        FOR EACH STATEMENT EXECUTE FUNCTION seguranca.bloquear_mutacao();

      CREATE TABLE documentos.emissao_aprovacao (
        emissao_id uuid PRIMARY KEY REFERENCES documentos.emissao(id),
        aprovacao_id uuid NOT NULL,
        tipo text NOT NULL,
        FOREIGN KEY (aprovacao_id, tipo) REFERENCES documentos.aprovacao_modelo(id, tipo)
      );
      CREATE TRIGGER emissao_aprovacao_imutavel BEFORE UPDATE OR DELETE ON documentos.emissao_aprovacao
        FOR EACH ROW EXECUTE FUNCTION seguranca.bloquear_mutacao();
      CREATE TRIGGER emissao_aprovacao_sem_truncar BEFORE TRUNCATE ON documentos.emissao_aprovacao
        FOR EACH STATEMENT EXECUTE FUNCTION seguranca.bloquear_mutacao();

      CREATE FUNCTION documentos.validar_emissao_aprovacao() RETURNS trigger LANGUAGE plpgsql AS $$
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
             WHERE u.id = dados.emitido_por AND u.ativo AND u.papel = 'coordenador'
           ) THEN
          RAISE EXCEPTION 'Emissão incompatível com a aprovação formal ou com o emitente.' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER emissao_aprovacao_valida BEFORE INSERT ON documentos.emissao_aprovacao
        FOR EACH ROW EXECUTE FUNCTION documentos.validar_emissao_aprovacao();

      CREATE INDEX emissao_emitente_data ON documentos.emissao (emitido_por, emitido_em DESC);
      CREATE INDEX emissao_tipo_data ON documentos.emissao (tipo, emitido_em DESC);
    `);
    await cliente.query('REVOKE ALL ON documentos.aprovacao_modelo, documentos.emissao_aprovacao FROM PUBLIC');
    await cliente.query(`GRANT SELECT ON documentos.aprovacao_modelo, documentos.emissao_aprovacao TO ${papel}`);
    await cliente.query(`GRANT INSERT (emissao_id, aprovacao_id, tipo) ON documentos.emissao_aprovacao TO ${papel}`);
    await cliente.query(`GRANT INSERT (tipo, ano, sufixo) ON documentos.numeracao TO ${papel}`);
    await cliente.query(`GRANT UPDATE (ultimo_numero) ON documentos.numeracao TO ${papel}`);
    await cliente.query(`
      GRANT INSERT (id, documento_id, tipo, ano, numero, numero_formatado, chave_idempotencia, snapshot_cifrado, emitido_por)
      ON documentos.emissao TO ${papel}
    `);
    await cliente.query(`GRANT INSERT (id, emissao_id, status) ON documentos.job_pdf TO ${papel}`);
    await cliente.query(`
      GRANT UPDATE (status, tentativas, erro_sanitizado, posse, posse_expira_em, atualizado_em)
      ON documentos.job_pdf TO ${papel}
    `);
    await cliente.query(`
      GRANT INSERT (id, emissao_id, job_id, caminho_relativo, sha256) ON documentos.artefato_pdf TO ${papel}
    `);
    await cliente.query(`
      GRANT UPDATE (cancelado_por, cancelado_em, motivo_cancelamento_cifrado) ON documentos.documento TO ${papel}
    `);
  });
}
