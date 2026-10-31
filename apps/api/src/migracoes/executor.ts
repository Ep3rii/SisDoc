import type { Client } from 'pg';

const versoesConhecidas = ['000-fundacao', '001-modelo', '002-autenticacao'] as const;
export type VersaoMigracao = typeof versoesConhecidas[number];

export async function executarMigracao(
  cliente: Client,
  usuarioAplicacao: string,
  versao: VersaoMigracao,
  aplicar: (papel: string) => Promise<void>,
): Promise<boolean> {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(usuarioAplicacao)) {
    throw new Error('Papel do aplicativo inválido para migração.');
  }
  await cliente.query('SAVEPOINT sisdoc_migracao');
  try {
    const bloqueio = await cliente.query<{ obtido: boolean }>(
      'SELECT pg_try_advisory_xact_lock($1, $2) AS obtido',
      [1936286820, 1],
    );
    if (!bloqueio.rows[0].obtido) throw new Error('Já existe outra migração em andamento neste banco.');
    const resultado = await cliente.query<{ versao: string }>('SELECT versao FROM seguranca.migracao ORDER BY versao');
    const versoes = new Set(resultado.rows.map((linha) => linha.versao));
    const historicoValido = versoes.has('000-fundacao')
      && [...versoes].every((item) => versoesConhecidas.some((conhecida) => conhecida === item))
      && versoesConhecidas.every((item, indice) => !versoes.has(item) || indice === 0 || versoes.has(versoesConhecidas[indice - 1]));
    if (!historicoValido) throw new Error('Histórico de migrações desconhecido ou incompleto.');
    if (versoes.has(versao)) {
      await cliente.query('RELEASE SAVEPOINT sisdoc_migracao');
      return false;
    }
    const indice = versoesConhecidas.indexOf(versao);
    if (indice === 0 || !versoesConhecidas.slice(0, indice).every((item) => versoes.has(item))) {
      throw new Error('Há migrações anteriores pendentes.');
    }
    await aplicar(`"${usuarioAplicacao}"`);
    await cliente.query('INSERT INTO seguranca.migracao (versao) VALUES ($1)', [versao]);
    await cliente.query('RELEASE SAVEPOINT sisdoc_migracao');
    return true;
  } catch (erro) {
    try {
      await cliente.query('ROLLBACK TO SAVEPOINT sisdoc_migracao');
      await cliente.query('RELEASE SAVEPOINT sisdoc_migracao');
    } catch (erroRollback) {
      throw new AggregateError([erro, erroRollback], 'Não foi possível reverter a migração.');
    }
    throw erro;
  }
}
