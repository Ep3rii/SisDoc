import { Pool } from 'pg';
import { criarAplicacao } from './aplicacao';
import { carregarConfiguracao } from './configuracao';

async function iniciar(): Promise<void> {
  const configuracao = await carregarConfiguracao(process.env.SISDOC_CONFIG);
  const banco = new Pool({
    host: configuracao.banco.host,
    port: configuracao.banco.porta,
    database: configuracao.banco.nome,
    user: configuracao.banco.usuario,
    password: configuracao.banco.senha,
    connectionTimeoutMillis: 5000,
  });
  banco.on('error', () => process.stderr.write('Conexão de banco indisponível.\n'));
  try {
    await banco.query('SELECT 1');
  } catch {
    await banco.end();
    throw new Error('Não foi possível conectar ao banco configurado.');
  }
  let app;
  try {
    app = await criarAplicacao(configuracao, banco);
  } catch {
    await banco.end();
    throw new Error('Não foi possível preparar o serviço HTTPS; confira a configuração e os arquivos TLS.');
  }
  try {
    await app.listen(configuracao.porta, '127.0.0.1');
  } catch {
    await app.close();
    throw new Error('Não foi possível iniciar o serviço HTTPS em loopback.');
  }
  process.stdout.write(`SisDoc disponível em HTTPS na porta ${configuracao.porta} em loopback.\n`);
}

iniciar().catch((erro: unknown) => {
  const mensagem = erro instanceof Error ? erro.message : 'Erro inesperado ao iniciar.';
  process.stderr.write(`${mensagem}\n`);
  process.exitCode = 1;
});
