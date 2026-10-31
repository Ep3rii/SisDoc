import { DatabaseError, Pool } from 'pg';
import { criarAplicacao } from './aplicacao';
import { carregarConfiguracao } from './configuracao';
import { VERSAO_CONSULTA } from './migracoes/consulta';

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
  let migracaoAtual: boolean;
  try {
    const resultado = await banco.query<{ atual: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM seguranca.migracao WHERE versao = $1) AS atual',
      [VERSAO_CONSULTA],
    );
    migracaoAtual = resultado.rows[0].atual;
  } catch (erro) {
    await banco.end();
    if (erro instanceof DatabaseError && (erro.code === '3F000' || erro.code === '42P01')) {
      throw new Error('O banco não possui o histórico de migrações necessário; atualizações existentes exigem procedimento seguro.');
    }
    if (erro instanceof DatabaseError && erro.code === '42501') {
      throw new Error('O papel do aplicativo não pode consultar o histórico de migrações; confira os privilégios.');
    }
    throw new Error('Não foi possível consultar o histórico de migrações; confira a conexão e o banco configurado.');
  }
  if (!migracaoAtual) {
    await banco.end();
    throw new Error('O banco não possui a migração de consulta; atualizações existentes ainda exigem procedimento seguro.');
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
