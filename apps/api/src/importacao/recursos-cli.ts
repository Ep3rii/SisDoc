import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { carregarConfiguracao } from '../configuracao';
import { ProtetorDados } from '../seguranca/protecao-dados';
import { LIMITE_ARQUIVO_BYTES } from './planilhas';

/** Resolve e lê arquivo somente após conferir o limite de tamanho permitido pelo importador. */
export async function lerArquivo(arquivo: string): Promise<Buffer> {
  const caminho = path.resolve(arquivo);
  let tamanho: number;
  try {
    tamanho = (await stat(caminho)).size;
  } catch {
    throw new Error('Não foi possível localizar o arquivo informado.');
  }
  if (tamanho > LIMITE_ARQUIVO_BYTES) throw new Error('O arquivo excede o limite de 64 MB.');
  return readFile(caminho);
}

/** Abre cliente sem privilégios com configuração externa; falhas de conexão/encerramento permanecem explícitas. */
export async function conectarAplicacao(): Promise<{ cliente: Client; protetor: ProtetorDados }> {
  const configuracao = await carregarConfiguracao(process.env.SISDOC_CONFIG);
  const protetor = new ProtetorDados(configuracao.chaves);
  const cliente = new Client({
    host: configuracao.banco.host,
    port: configuracao.banco.porta,
    database: configuracao.banco.nome,
    user: configuracao.banco.usuario,
    password: configuracao.banco.senha,
    connectionTimeoutMillis: 5000,
  });
  try {
    await cliente.connect();
  } catch (erroConexao) {
    try {
      await cliente.end();
    } catch (erroEncerramento) {
      throw new AggregateError(
        [erroConexao, erroEncerramento],
        'Não foi possível conectar ao banco nem encerrar o cliente com a configuração do aplicativo.',
      );
    }
    throw new Error('Não foi possível conectar ao banco com a configuração do aplicativo.', { cause: erroConexao });
  }
  return { cliente, protetor };
}
