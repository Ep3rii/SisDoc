import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_CONSULTA = '003-consulta';

export async function aplicarConsulta(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_CONSULTA, async () => {
    await cliente.query(`
      CREATE INDEX vinculo_pessoa_id ON nucleo.vinculo (pessoa_id, id);
      CREATE INDEX evento_vinculo_id ON nucleo.evento_funcional (vinculo_id, id);
    `);
  });
}
