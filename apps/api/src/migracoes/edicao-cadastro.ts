import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_EDICAO_CADASTRO = '018-edicao-cadastro';

export async function aplicarEdicaoCadastro(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_EDICAO_CADASTRO, async (papel) => {
    await cliente.query(`
      CREATE TABLE nucleo.edicao_servidor_auditoria (
        id uuid PRIMARY KEY,
        usuario_id uuid NOT NULL REFERENCES seguranca.usuario(id),
        pessoa_id uuid NOT NULL REFERENCES nucleo.pessoa(id),
        vinculo_id uuid NOT NULL REFERENCES nucleo.vinculo(id),
        campos text[] NOT NULL CHECK (cardinality(campos) > 0),
        motivo_cifrado bytea NOT NULL CHECK (octet_length(motivo_cifrado) > 0),
        criado_em timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX edicao_servidor_auditoria_pessoa
        ON nucleo.edicao_servidor_auditoria (pessoa_id, criado_em DESC);
      CREATE TRIGGER edicao_servidor_auditoria_sem_mutacao
        BEFORE UPDATE OR DELETE ON nucleo.edicao_servidor_auditoria
        FOR EACH ROW EXECUTE FUNCTION seguranca.bloquear_mutacao();
      REVOKE ALL ON nucleo.edicao_servidor_auditoria FROM PUBLIC;
    `);
    await cliente.query(`
      GRANT UPDATE (cpf_cifrado, cpf_hash) ON nucleo.pessoa TO ${papel};
      GRANT UPDATE (matricula_norm) ON nucleo.vinculo TO ${papel};
      GRANT INSERT ON nucleo.edicao_servidor_auditoria TO ${papel};
    `);
  });
}
