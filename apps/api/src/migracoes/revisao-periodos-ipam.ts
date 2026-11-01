import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_REVISAO_PERIODOS_IPAM = '021-revisao-periodos-ipam';

export async function aplicarRevisaoPeriodosIpam(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_REVISAO_PERIODOS_IPAM, async (papel) => {
    await cliente.query(`
      CREATE FUNCTION documentos.bloquear_periodos_ipam() RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
        AS $$
        BEGIN
          LOCK TABLE nucleo.periodo_ipam IN SHARE MODE NOWAIT;
        END;
        $$;
      REVOKE ALL ON FUNCTION documentos.bloquear_periodos_ipam() FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION documentos.bloquear_periodos_ipam() TO ${papel};
    `);
  });
}
