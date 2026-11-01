import type { Configuracao } from '@sisdoc/contratos';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const carregar = createRequire(import.meta.url);
const arquivos = carregar('node:fs/promises') as typeof import('node:fs/promises');
const { Client } = carregar('pg') as typeof import('pg');
const configuracao = carregar('../apps/api/dist/configuracao.js') as typeof import('../apps/api/dist/configuracao.js');
const { lerArgumentos, texto } = carregar('../apps/api/dist/importacao/argumentos-cli.js') as typeof import('../apps/api/dist/importacao/argumentos-cli.js');
const { conectarAplicacao, lerArquivo } = carregar('../apps/api/dist/importacao/recursos-cli.js') as typeof import('../apps/api/dist/importacao/recursos-cli.js');
const { LIMITE_ARQUIVO_BYTES } = carregar('../apps/api/dist/importacao/planilhas.js') as typeof import('../apps/api/dist/importacao/planilhas.js');

let temporario: string;
let arquivo: string;
beforeAll(async () => {
  temporario = await mkdtemp(path.join(process.env.SISDOC_TEST_TEMP ?? os.tmpdir(), 'sisdoc-cli-'));
  arquivo = path.join(temporario, 'ficticio.csv');
  await writeFile(arquivo, 'COLUNA\nFICTICIO\n', 'utf8');
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await rm(temporario, { recursive: true, force: true });
});

/** Fornece configuração fictícia ao módulo CommonJS e impede leitura da instalação externa durante o teste. */
function simularConfiguracao(chaves: Configuracao['chaves'] = {
  cifra: Buffer.alloc(32, 1).toString('base64'), hmac: Buffer.alloc(32, 2).toString('base64'),
}): void {
  const dados: Configuracao = {
    porta: 3443,
    banco: { host: '127.0.0.1', porta: 5432, nome: 'ficticio', usuario: 'ficticio', senha: 'somente-teste' },
    tls: { certificado: 'ficticio.crt', chave: 'ficticio.key', ca: 'ficticio-ca.crt', nome: 'ficticio.local' },
    chaves,
  };
  vi.spyOn(configuracao, 'carregarConfiguracao').mockResolvedValue(dados);
}

describe('argumentos CLI compartilhados', () => {
  it('mantém flags, valores separados, igualdade embutida e última opção repetida', () => {
    expect(lerArgumentos(['--commit', '--arquivo', 'ficticio.csv', '--origem=a=b', '--origem', 'ultima']))
      .toEqual({ commit: true, arquivo: 'ficticio.csv', origem: 'ultima' });
  });

  it('preserva valor vazio embutido e lista sem argumentos', () => {
    expect(lerArgumentos(['--origem='])).toEqual({ origem: '' });
    expect(lerArgumentos([])).toEqual({});
  });

  it('recusa argumentos posicionais e flag sem texto obrigatório', () => {
    expect(() => lerArgumentos(['ficticio.csv'])).toThrow('Argumento inesperado');
    expect(() => texto({ arquivo: true }, 'arquivo')).toThrow('Informe um valor para --arquivo');
    expect(texto({}, 'arquivo')).toBeUndefined();
  });
});

describe('recursos CLI sem conexão real', () => {
  it('recusa chaves inválidas antes de abrir conexão', async () => {
    simularConfiguracao({ cifra: 'ficticia-invalida', hmac: 'ficticia-invalida' });
    const conectar = vi.spyOn(Client.prototype, 'connect').mockImplementation(async () => undefined);
    await expect(conectarAplicacao()).rejects.toThrow('A chave de proteção deve conter 32 bytes');
    expect(conectar).not.toHaveBeenCalled();
  });

  it('lê o arquivo fictício e explicita arquivo ausente', async () => {
    await expect(lerArquivo(arquivo)).resolves.toEqual(Buffer.from('COLUNA\nFICTICIO\n'));
    await expect(lerArquivo(path.join(temporario, 'ausente.csv'))).rejects.toThrow('Não foi possível localizar');
  });

  it('aceita exatamente 64 MB e recusa o primeiro byte acima antes de ler', async () => {
    expect(LIMITE_ARQUIVO_BYTES).toBe(64 * 1024 * 1024);
    const metadados = await stat(arquivo);
    metadados.size = LIMITE_ARQUIVO_BYTES;
    vi.spyOn(arquivos, 'stat').mockResolvedValue(metadados);
    const leitura = vi.spyOn(arquivos, 'readFile').mockImplementation(async () => Buffer.from('ficticio'));
    await expect(lerArquivo(arquivo)).resolves.toEqual(Buffer.from('ficticio'));
    metadados.size += 1;
    await expect(lerArquivo(arquivo)).rejects.toThrow('excede o limite de 64 MB');
    expect(leitura).toHaveBeenCalledTimes(1);
  });

  it('devolve cliente conectado e deixa seu encerramento sob responsabilidade do comando', async () => {
    simularConfiguracao();
    const conectar = vi.spyOn(Client.prototype, 'connect').mockImplementation(async () => undefined);
    const encerrar = vi.spyOn(Client.prototype, 'end').mockImplementation(async () => undefined);
    const resultado = await conectarAplicacao();
    expect(resultado.cliente).toBeInstanceOf(Client);
    expect(resultado.protetor).toBeDefined();
    expect(conectar).toHaveBeenCalledTimes(1);
    expect(encerrar).not.toHaveBeenCalled();
  });

  it('preserva causa de conexão e encerra o cliente antes de falhar', async () => {
    simularConfiguracao();
    const causa = new Error('Falha fictícia de conexão');
    vi.spyOn(Client.prototype, 'connect').mockImplementation(async () => { throw causa; });
    const encerrar = vi.spyOn(Client.prototype, 'end').mockImplementation(async () => undefined);
    await expect(conectarAplicacao()).rejects.toMatchObject({
      message: 'Não foi possível conectar ao banco com a configuração do aplicativo.', cause: causa,
    });
    expect(encerrar).toHaveBeenCalledTimes(1);
  });

  it('preserva as duas causas quando conexão e encerramento falham', async () => {
    simularConfiguracao();
    const causa = new Error('Falha fictícia de conexão');
    const limpeza = new Error('Falha fictícia de encerramento');
    vi.spyOn(Client.prototype, 'connect').mockImplementation(async () => { throw causa; });
    vi.spyOn(Client.prototype, 'end').mockImplementation(async () => { throw limpeza; });
    const tentativa = conectarAplicacao();
    await expect(tentativa).rejects.toBeInstanceOf(AggregateError);
    await expect(tentativa).rejects.toMatchObject({ errors: [causa, limpeza] });
  });
});
