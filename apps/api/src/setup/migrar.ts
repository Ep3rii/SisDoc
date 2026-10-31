import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { z } from 'zod';
import { aplicarMigracoesPendentes } from '../migracoes/sequencia';

export const PROVISIONAMENTO_PADRAO = 'C:\\ProgramData\\SisDoc\\provisionamento\\banco.json';

const credencialSchema = z.object({
  usuario: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/),
  senha: z.string().min(1),
});

export const provisionamentoSchema = z.object({
  host: z.string().min(1).default('127.0.0.1'),
  porta: z.number().int().min(1).max(65535),
  nome: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/),
  migracao: credencialSchema,
  aplicativo: credencialSchema,
});
export type Provisionamento = z.infer<typeof provisionamentoSchema>;

export function arquivoProvisionamento(): string {
  const arquivo = process.env.SISDOC_PROVISIONAMENTO ?? PROVISIONAMENTO_PADRAO;
  if (!path.isAbsolute(arquivo)) throw new Error('SISDOC_PROVISIONAMENTO deve indicar um caminho absoluto.');
  return arquivo;
}

export async function lerProvisionamento(arquivo: string): Promise<Provisionamento> {
  let conteudo: string;
  try {
    conteudo = await readFile(arquivo, 'utf8');
  } catch {
    throw new Error(`Não foi possível ler o arquivo de provisionamento do banco em ${arquivo}.`);
  }
  let dados: unknown;
  try {
    dados = JSON.parse(conteudo.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('O arquivo de provisionamento do banco não contém JSON válido.');
  }
  const resultado = provisionamentoSchema.safeParse(dados);
  if (!resultado.success) {
    throw new Error('O arquivo de provisionamento deve conter host, porta, nome, migracao{usuario,senha} e aplicativo{usuario,senha}.');
  }
  return resultado.data;
}

export async function conectarMigracao(provisionamento: Provisionamento): Promise<Client> {
  const cliente = new Client({
    host: provisionamento.host,
    port: provisionamento.porta,
    database: provisionamento.nome,
    user: provisionamento.migracao.usuario,
    password: provisionamento.migracao.senha,
    connectionTimeoutMillis: 5000,
  });
  try {
    await cliente.connect();
  } catch {
    await cliente.end().catch(() => undefined);
    throw new Error('Não foi possível conectar ao banco com a credencial de migração do provisionamento.');
  }
  return cliente;
}

export type ResultadoMigrar = { aplicadas: string[]; versaoAtual: string };

export async function migrar(provisionamento: Provisionamento): Promise<ResultadoMigrar> {
  const cliente = await conectarMigracao(provisionamento);
  let transacaoAberta = false;
  try {
    await cliente.query('BEGIN');
    transacaoAberta = true;
    const historico = await cliente.query<{ existe: boolean }>(
      "SELECT to_regclass('seguranca.migracao') IS NOT NULL AS existe",
    );
    if (!historico.rows[0].existe) {
      throw new Error('O banco não possui histórico de migrações do SisDoc; use npm run setup para novas instalações.');
    }
    const aplicadas = await aplicarMigracoesPendentes(cliente, provisionamento.aplicativo.usuario);
    const atual = await cliente.query<{ versao: string }>('SELECT max(versao) AS versao FROM seguranca.migracao');
    await cliente.query('COMMIT');
    transacaoAberta = false;
    return { aplicadas, versaoAtual: atual.rows[0].versao };
  } catch (erro) {
    if (transacaoAberta) await cliente.query('ROLLBACK').catch(() => undefined);
    throw erro;
  } finally {
    await cliente.end();
  }
}
