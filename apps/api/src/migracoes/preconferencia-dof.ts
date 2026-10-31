import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_PRECONFERENCIA_DOF = '008-preconferencia-dof';
export const CHAVE_BLOQUEIO_FONTE_DOF = [1936286821, 1] as const;

export async function aplicarPreconferenciaDof(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_PRECONFERENCIA_DOF, async () => {
    await cliente.query(`
      CREATE FUNCTION nucleo.bloquear_escrita_na_conferencia() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(${CHAVE_BLOQUEIO_FONTE_DOF[0]}, ${CHAVE_BLOQUEIO_FONTE_DOF[1]});
        RETURN NULL;
      END;
      $$;
      CREATE TRIGGER pessoa_conferencia BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON nucleo.pessoa
        FOR EACH STATEMENT EXECUTE FUNCTION nucleo.bloquear_escrita_na_conferencia();
      CREATE TRIGGER vinculo_conferencia BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON nucleo.vinculo
        FOR EACH STATEMENT EXECUTE FUNCTION nucleo.bloquear_escrita_na_conferencia();
    `);
  });
}
