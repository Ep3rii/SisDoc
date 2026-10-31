import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_AUTENTICACAO = '002-autenticacao';

export async function aplicarAutenticacao(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_AUTENTICACAO, async (papel) => {
    await cliente.query(`
      ALTER TABLE seguranca.usuario ADD CONSTRAINT usuario_matricula_nao_vazia CHECK (btrim(matricula) <> '');
      CREATE UNIQUE INDEX usuario_matricula_normalizada ON seguranca.usuario (upper(btrim(matricula)));
      CREATE TABLE seguranca.limite_login (
        escopo text NOT NULL CHECK (escopo IN ('ip', 'matricula')),
        identificador_hash bytea NOT NULL CHECK (octet_length(identificador_hash) = 32),
        falhas integer NOT NULL DEFAULT 0 CHECK (falhas >= 0),
        janela_inicio timestamptz NOT NULL DEFAULT now(),
        bloqueado_ate timestamptz,
        PRIMARY KEY (escopo, identificador_hash)
      );
      CREATE INDEX limite_login_janela ON seguranca.limite_login (janela_inicio);
      REVOKE ALL ON seguranca.limite_login FROM PUBLIC;
    `);
    await cliente.query(`GRANT SELECT, INSERT, UPDATE ON seguranca.limite_login TO ${papel}`);
    await cliente.query(`GRANT INSERT (id, matricula, nome, email, senha_hash, papel, ativo, troca_senha_obrigatoria) ON seguranca.usuario TO ${papel}`);
    await cliente.query(`GRANT UPDATE (nome, email, senha_hash, papel, ativo, tentativas_falhas, bloqueado_ate, troca_senha_obrigatoria, ultimo_login) ON seguranca.usuario TO ${papel}`);
    await cliente.query(`GRANT INSERT, UPDATE, DELETE ON seguranca.sessao TO ${papel}`);
  });
}
