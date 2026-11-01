import { origemImportacaoSchema, tipoImportacaoSchema, type TipoImportacao } from '@sisdoc/contratos';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { z } from 'zod';
import { caminhoReal, estaDentro, raizRepositorio } from '../configuracao';
import { ErroImportacao } from './estado-importacao';
import { COLUNAS, COLUNAS_AFASTAMENTO_INTERVALO } from './formatos';

const identificador = z.string().regex(/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/, 'Identificador SQL inválido no mapeamento.');

const consultaSchema = z.strictObject({
  tabela: z.string().regex(/^[A-Za-z_][A-Za-z0-9_$]{0,62}\.[A-Za-z_][A-Za-z0-9_$]{0,62}$/, 'Informe a tabela como esquema.tabela.'),
  colunas: z.record(z.string(), identificador),
});

export const mapeamentoLegadoSchema = z.strictObject({
  origem: origemImportacaoSchema,
  conexao: z.strictObject({
    host: z.string().min(1),
    porta: z.number().int().min(1).max(65535).default(5432),
    banco: identificador,
    usuario: identificador,
    senhaVariavel: z.string().regex(/^[A-Z_][A-Z0-9_]{0,62}$/).optional(),
    senhaArquivo: z.string().min(1).optional(),
  }).refine((conexao) => Boolean(conexao.senhaVariavel) !== Boolean(conexao.senhaArquivo), {
    message: 'Informe exatamente um entre senhaVariavel e senhaArquivo.',
  }),
  consultas: z.partialRecord(tipoImportacaoSchema, consultaSchema),
});
export type MapeamentoLegado = z.infer<typeof mapeamentoLegadoSchema>;

export const ORDEM_TIPOS: readonly TipoImportacao[] = ['dados_funcionais', 'eventos_funcionais', 'afastamentos', 'incorporacoes', 'periodos_ipam'];

export type ConjuntoLegado = { tipo: TipoImportacao; linhas: string[][]; hash: Buffer };

export async function lerMapeamento(arquivo: string): Promise<MapeamentoLegado> {
  let dados: unknown;
  try {
    dados = JSON.parse((await readFile(arquivo, 'utf8')).replace(/^\uFEFF/, ''));
  } catch {
    throw new ErroImportacao('Não foi possível ler o arquivo de mapeamento do legado (JSON).');
  }
  const resultado = mapeamentoLegadoSchema.safeParse(dados);
  if (!resultado.success) {
    const problema = resultado.error.issues[0];
    throw new ErroImportacao(`Mapeamento do legado inválido em ${problema.path.join('.') || 'raiz'}: ${problema.message}`);
  }
  for (const [tipo, consulta] of Object.entries(resultado.data.consultas) as Array<[TipoImportacao, z.infer<typeof consultaSchema>]>) {
    const permitidas = new Set<string>([...COLUNAS[tipo], ...(tipo === 'afastamentos' ? COLUNAS_AFASTAMENTO_INTERVALO : [])]);
    const desconhecidas = Object.keys(consulta.colunas).filter((coluna) => !permitidas.has(coluna));
    if (desconhecidas.length > 0) {
      throw new ErroImportacao(`Mapeamento de ${tipo} usa campos canônicos desconhecidos: ${desconhecidas.join(', ')}.`);
    }
  }
  return resultado.data;
}

async function senhaLegado(mapeamento: MapeamentoLegado): Promise<string> {
  if (mapeamento.conexao.senhaVariavel) {
    const senha = process.env[mapeamento.conexao.senhaVariavel];
    if (!senha) throw new ErroImportacao(`Defina a variável de ambiente ${mapeamento.conexao.senhaVariavel} com a senha do legado.`);
    return senha;
  }
  const arquivo = mapeamento.conexao.senhaArquivo as string;
  if (!path.isAbsolute(arquivo)) throw new ErroImportacao('O arquivo de senha do legado deve usar caminho absoluto fora do repositório.');
  let real: string;
  try {
    real = await caminhoReal(arquivo);
  } catch {
    throw new ErroImportacao('Não foi possível localizar o arquivo de senha do legado.');
  }
  if (estaDentro(real, await raizRepositorio())) throw new ErroImportacao('O arquivo de senha do legado deve ficar fora do repositório.');
  const senha = (await readFile(real, 'utf8')).trim();
  if (!senha) throw new ErroImportacao('O arquivo de senha do legado está vazio.');
  return senha;
}

function aspas(nome: string): string {
  return `"${nome.replace(/"/g, '""')}"`;
}

export async function lerLegado(mapeamento: MapeamentoLegado): Promise<ConjuntoLegado[]> {
  const cliente = new Client({
    host: mapeamento.conexao.host,
    port: mapeamento.conexao.porta,
    database: mapeamento.conexao.banco,
    user: mapeamento.conexao.usuario,
    password: await senhaLegado(mapeamento),
    connectionTimeoutMillis: 10_000,
  });
  try {
    await cliente.connect();
  } catch {
    await cliente.end().catch(() => undefined);
    throw new ErroImportacao('Não foi possível conectar à base legada; confira host, porta, banco, usuário e senha do mapeamento.');
  }
  const conjuntos: ConjuntoLegado[] = [];
  try {
    await cliente.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await cliente.query("SET LOCAL datestyle = 'ISO, YMD'");
    for (const tipo of ORDEM_TIPOS) {
      const consulta = mapeamento.consultas[tipo];
      if (!consulta) continue;
      const [esquema, tabela] = consulta.tabela.split('.');
      const existentes = await cliente.query<{ column_name: string }>(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2', [esquema, tabela],
      );
      if (existentes.rowCount === 0) throw new ErroImportacao(`Mapeamento de ${tipo}: a tabela ${consulta.tabela} não existe ou não é visível ao usuário do legado.`);
      const disponiveis = new Set(existentes.rows.map((linha) => linha.column_name));
      const faltantes = Object.values(consulta.colunas).filter((coluna) => !disponiveis.has(coluna));
      if (faltantes.length > 0) {
        throw new ErroImportacao(`Mapeamento de ${tipo}: coluna(s) ausente(s) em ${consulta.tabela}: ${faltantes.join(', ')}.`);
      }
      const canonicas = Object.keys(consulta.colunas);
      const resultado = await cliente.query<Record<string, string | null>>({
        text: `SELECT ${canonicas.map((canonica) => `${aspas(consulta.colunas[canonica])}::text AS ${aspas(canonica)}`).join(', ')}
          FROM ${aspas(esquema)}.${aspas(tabela)}`,
      });
      const linhas = [canonicas, ...resultado.rows.map((linha) => canonicas.map((canonica) => linha[canonica] ?? ''))];
      conjuntos.push({ tipo, linhas, hash: createHash('sha256').update(JSON.stringify(linhas)).digest() });
    }
    await cliente.query('COMMIT');
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    if (erro instanceof ErroImportacao) throw erro;
    throw new ErroImportacao('Falha ao ler a base legada; confira o mapeamento e as permissões de leitura.');
  } finally {
    await cliente.end();
  }
  return conjuntos;
}
