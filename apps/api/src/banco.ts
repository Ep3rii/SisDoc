import type { Pool, PoolClient } from 'pg';

export async function transacao<T>(banco: Pool, executar: (cliente: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await banco.connect();
  let aberta = false;
  let commitIniciado = false;
  let erroLiberacao: Error | undefined;
  try {
    await cliente.query('BEGIN');
    aberta = true;
    const resultado = await executar(cliente);
    commitIniciado = true;
    await cliente.query('COMMIT');
    aberta = false;
    return resultado;
  } catch (erro) {
    if (commitIniciado) {
      erroLiberacao = new Error('Conexão descartada após falha ao confirmar a transação.');
      throw new Error('Não foi possível confirmar a transação; verifique o resultado antes de tentar novamente.', { cause: erro });
    }
    if (aberta) {
      try {
        await cliente.query('ROLLBACK');
      } catch (erroRollback) {
        erroLiberacao = new Error('Conexão descartada após falha ao reverter a transação.');
        throw new AggregateError([erro, erroRollback], 'Não foi possível reverter a transação.');
      }
    } else {
      erroLiberacao = new Error('Conexão descartada após falha ao iniciar a transação.');
    }
    throw erro;
  } finally {
    cliente.release(erroLiberacao);
  }
}
