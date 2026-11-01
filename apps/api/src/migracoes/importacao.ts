import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_IMPORTACAO = '015-importacao';

const TABELAS_IMPORTADAS = ['pessoa', 'pessoa_origem', 'vinculo', 'afastamento', 'incorporacao', 'periodo_ipam', 'evento_funcional'] as const;

export async function aplicarImportacao(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_IMPORTACAO, async (papel) => {
    await cliente.query(`
      ALTER TABLE nucleo.importacao_lote
        ADD COLUMN tipo text NOT NULL DEFAULT 'dados_funcionais' CHECK (tipo IN (
          'dados_funcionais', 'afastamentos', 'incorporacoes', 'periodos_ipam', 'eventos_funcionais'
        )),
        ADD COLUMN sistema_origem text NOT NULL DEFAULT 'planilha' CHECK (sistema_origem ~ '^[a-z0-9][a-z0-9_.-]{0,62}$'),
        ADD COLUMN canal text NOT NULL DEFAULT 'cli' CHECK (canal IN ('cli', 'tela', 'legado')),
        ADD COLUMN desfeito_em timestamptz,
        ADD CONSTRAINT importacao_lote_status CHECK (status IN ('processando', 'concluido', 'falhou', 'desfeito'));
      ALTER TABLE nucleo.importacao_lote
        ALTER COLUMN tipo DROP DEFAULT, ALTER COLUMN sistema_origem DROP DEFAULT, ALTER COLUMN canal DROP DEFAULT;
      CREATE INDEX importacao_lote_hash ON nucleo.importacao_lote (tipo, sistema_origem, hash_arquivo, status);

      CREATE TABLE nucleo.importacao_registro (
        id bigserial PRIMARY KEY,
        lote_id uuid NOT NULL REFERENCES nucleo.importacao_lote(id),
        tabela text NOT NULL CHECK (tabela IN (
          'pessoa', 'pessoa_origem', 'vinculo', 'afastamento', 'incorporacao', 'periodo_ipam', 'evento_funcional'
        )),
        chave jsonb NOT NULL,
        acao text NOT NULL CHECK (acao IN ('inserido', 'atualizado')),
        anterior jsonb,
        CHECK ((acao = 'inserido') = (anterior IS NULL))
      );
      CREATE INDEX importacao_registro_lote ON nucleo.importacao_registro (lote_id, id);
      CREATE TRIGGER importacao_registro_sem_mutacao BEFORE UPDATE ON nucleo.importacao_registro
        FOR EACH ROW EXECUTE FUNCTION seguranca.bloquear_mutacao();

      CREATE TABLE nucleo.sincronizacao_estado (
        origem text PRIMARY KEY CHECK (origem ~ '^[a-z0-9][a-z0-9_.-]{0,62}$'),
        falhas_consecutivas integer NOT NULL DEFAULT 0 CHECK (falhas_consecutivas >= 0),
        disjuntor_aberto_em timestamptz,
        ultima_sincronizacao_em timestamptz,
        cursor_incremental text,
        atualizado_em timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX sincronizacao_lote_origem ON nucleo.sincronizacao_lote (origem, iniciado_em DESC);
      CREATE INDEX staging_api_lote ON nucleo.staging_api (lote_id, id_origem);
    `);
    for (const tabela of TABELAS_IMPORTADAS) {
      await cliente.query(`
        ALTER TABLE nucleo.${tabela}
          ADD COLUMN lote_importacao_id uuid REFERENCES nucleo.importacao_lote(id),
          ADD COLUMN importado_em timestamptz
      `);
    }
    await cliente.query('REVOKE ALL ON nucleo.importacao_registro, nucleo.sincronizacao_estado FROM PUBLIC');
    await cliente.query('REVOKE ALL ON SEQUENCE nucleo.importacao_registro_id_seq FROM PUBLIC');

    // A aplicação grava importações pela tela e a sincronização; nunca apaga dados pessoais (rollback só pela CLI de migração).
    await cliente.query(`GRANT INSERT ON nucleo.importacao_registro TO ${papel}`);
    await cliente.query(`GRANT USAGE ON SEQUENCE nucleo.importacao_registro_id_seq TO ${papel}`);
    await cliente.query(`GRANT INSERT ON nucleo.importacao_lote TO ${papel}`);
    await cliente.query(`GRANT UPDATE (status, contagens, concluido_em) ON nucleo.importacao_lote TO ${papel}`);
    await cliente.query(`GRANT SELECT, INSERT ON nucleo.sincronizacao_estado TO ${papel}`);
    await cliente.query(`
      GRANT UPDATE (falhas_consecutivas, disjuntor_aberto_em, ultima_sincronizacao_em, cursor_incremental, atualizado_em)
      ON nucleo.sincronizacao_estado TO ${papel}
    `);
    await cliente.query(`GRANT INSERT ON nucleo.sincronizacao_lote TO ${papel}`);
    await cliente.query(`
      GRANT UPDATE (concluido_em, status, lidos, inseridos, atualizados, removidos, erros_sanitizados, cursor)
      ON nucleo.sincronizacao_lote TO ${papel}
    `);
    await cliente.query(`GRANT INSERT, DELETE ON nucleo.staging_api TO ${papel}`);
    await cliente.query(`GRANT UPDATE (processado_em) ON nucleo.staging_api TO ${papel}`);

    await cliente.query(`GRANT INSERT ON nucleo.pessoa TO ${papel}`);
    await cliente.query(`
      GRANT UPDATE (nome, nome_busca, nascimento, nome_mae_cifrado, nome_pai_cifrado, pis_pasep_cifrado, rg_numero_cifrado,
        rg_orgao, rg_expedicao, titulo_eleitor_cifrado, endereco_cifrado, atualizado_em, lote_importacao_id, importado_em)
      ON nucleo.pessoa TO ${papel}
    `);
    await cliente.query(`GRANT INSERT ON nucleo.pessoa_origem TO ${papel}`);
    await cliente.query(`
      GRANT UPDATE (hash_conteudo, sincronizado_em, removido_na_fonte_em, lote_importacao_id, importado_em)
      ON nucleo.pessoa_origem TO ${papel}
    `);
    await cliente.query(`GRANT INSERT ON nucleo.vinculo TO ${papel}`);
    await cliente.query(`
      GRANT UPDATE (matricula, regime_juridico, cargo, classe, nivel, referencia, setor, orgao_codigo, orgao_nome,
        admissao, desligamento, hash_conteudo, sincronizado_em, removido_na_fonte_em, lote_importacao_id, importado_em)
      ON nucleo.vinculo TO ${papel}
    `);
    await cliente.query(`GRANT INSERT ON nucleo.afastamento TO ${papel}`);
    await cliente.query(`
      GRANT UPDATE (dias_ano, observacao_cifrada, hash_conteudo, sincronizado_em, removido_na_fonte_em, lote_importacao_id, importado_em)
      ON nucleo.afastamento TO ${papel}
    `);
    await cliente.query(`GRANT INSERT ON nucleo.incorporacao TO ${papel}`);
    await cliente.query(`
      GRANT UPDATE (data_fim, hash_conteudo, sincronizado_em, removido_na_fonte_em, lote_importacao_id, importado_em)
      ON nucleo.incorporacao TO ${papel}
    `);
    await cliente.query(`GRANT INSERT ON nucleo.periodo_ipam TO ${papel}`);
    await cliente.query(`
      GRANT UPDATE (mes_fim, hash_conteudo, sincronizado_em, removido_na_fonte_em, lote_importacao_id, importado_em)
      ON nucleo.periodo_ipam TO ${papel}
    `);
    await cliente.query(`GRANT INSERT ON nucleo.evento_funcional TO ${papel}`);
    await cliente.query(`
      GRANT UPDATE (tipo, data_evento, data_publicacao, ato_tipo, ato_numero, descricao_origem_cifrada, dados_cifrados,
        hash_conteudo, sincronizado_em, removido_na_fonte_em, lote_importacao_id, importado_em)
      ON nucleo.evento_funcional TO ${papel}
    `);
  });
}
