import {
  mascararCpf, mascararMatricula,
  origemImportacaoSchema,
  type ConferenciaImportacao,
  type TipoImportacao
} from '@sisdoc/contratos';
import { type ClientBase } from 'pg';
import type { ProtetorDados } from '../seguranca/protecao-dados';
import {
  analisarLinhas
} from './formatos';
import { CAMPOS_VINCULO, selecionarColuna } from './gravacao-importacao';

/** Consulta totais por origem sem devolver dados pessoais ou modificar os lotes. */
export async function conferenciaGeral(cliente: ClientBase): Promise<ConferenciaImportacao> {
  const resultado = await cliente.query<{
    origem: string; pessoas: number; vinculos: number; afastamentos: number; incorporacoes: number;
    periodos_ipam: number; eventos: number; removidos: number;
  }>(`
    WITH origens AS (
      SELECT sistema_origem FROM nucleo.vinculo UNION SELECT sistema_origem FROM nucleo.pessoa_origem
      UNION SELECT sistema_origem FROM nucleo.afastamento WHERE sistema_origem IS NOT NULL
      UNION SELECT sistema_origem FROM nucleo.incorporacao WHERE sistema_origem IS NOT NULL
      UNION SELECT sistema_origem FROM nucleo.periodo_ipam WHERE sistema_origem IS NOT NULL
      UNION SELECT sistema_origem FROM nucleo.evento_funcional WHERE sistema_origem IS NOT NULL
    )
    SELECT o.sistema_origem AS origem,
      (SELECT count(*)::int FROM nucleo.pessoa_origem x WHERE x.sistema_origem = o.sistema_origem) AS pessoas,
      (SELECT count(*)::int FROM nucleo.vinculo x WHERE x.sistema_origem = o.sistema_origem) AS vinculos,
      (SELECT count(*)::int FROM nucleo.afastamento x WHERE x.sistema_origem = o.sistema_origem) AS afastamentos,
      (SELECT count(*)::int FROM nucleo.incorporacao x WHERE x.sistema_origem = o.sistema_origem) AS incorporacoes,
      (SELECT count(*)::int FROM nucleo.periodo_ipam x WHERE x.sistema_origem = o.sistema_origem) AS periodos_ipam,
      (SELECT count(*)::int FROM nucleo.evento_funcional x WHERE x.sistema_origem = o.sistema_origem) AS eventos,
      (SELECT count(*)::int FROM nucleo.vinculo x WHERE x.sistema_origem = o.sistema_origem AND x.removido_na_fonte_em IS NOT NULL) AS removidos
    FROM origens o ORDER BY o.sistema_origem
  `);
  const totais = await cliente.query<{ pessoas: number; vinculos: number }>(
    'SELECT (SELECT count(*)::int FROM nucleo.pessoa) AS pessoas, (SELECT count(*)::int FROM nucleo.vinculo) AS vinculos',
  );
  return {
    origens: resultado.rows.map((linha) => ({
      origem: linha.origem,
      pessoas: linha.pessoas,
      vinculos: linha.vinculos,
      afastamentos: linha.afastamentos,
      incorporacoes: linha.incorporacoes,
      periodosIpam: linha.periodos_ipam,
      eventos: linha.eventos,
      removidosNaFonte: linha.removidos,
    })),
    totais: totais.rows[0],
  };
}

export type ResultadoConferenciaArquivo = {
  tipo: TipoImportacao;
  origem: string;
  noArquivo: number;
  noBanco: number;
  ausentes: number;
  amostra: Array<{ referencia: string; campos: Record<string, 'confere' | 'difere' | 'vazio no arquivo'> }>;
};

/** Compara referências válidas e amostra de campos por origem, sem alterar o banco. */
export async function conferirArquivo(
  cliente: ClientBase, protetor: ProtetorDados, tipo: TipoImportacao, origemInformada: string, linhas: string[][], tamanhoAmostra: number,
): Promise<ResultadoConferenciaArquivo> {
  const origem = origemImportacaoSchema.parse(origemInformada);
  const { analise } = analisarLinhas(tipo, linhas);
  if (analise.tipo !== 'dados_funcionais') {
    const tabela = { afastamentos: 'afastamento', incorporacoes: 'incorporacao', periodos_ipam: 'periodo_ipam', eventos_funcionais: 'evento_funcional' }[analise.tipo];
    const ids = analise.tipo === 'periodos_ipam'
      ? analise.registros.map((registro) => `${protetor.hashCpf(registro.cpf).toString('hex')}|${registro.inicio}`)
      : analise.registros.map((registro) => registro.idOrigem);
    const presentes = await cliente.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM nucleo.${tabela} WHERE sistema_origem = $1 AND id_origem = ANY($2::text[])`, [origem, ids],
    );
    return { tipo, origem, noArquivo: ids.length, noBanco: presentes.rows[0].total, ausentes: ids.length - presentes.rows[0].total, amostra: [] };
  }
  const matriculas = analise.vinculos.map((vinculo) => vinculo.campos.matriculaNorm);
  const banco = await cliente.query<Record<string, string | null> & { matricula_norm: string; nome: string; cpf_hash: Buffer }>(`
    SELECT v.matricula_norm, p.nome, p.cpf_hash, ${CAMPOS_VINCULO.map(({ coluna, data }) => selecionarColuna(`v.${coluna}`, data).replace(/AS v\./, 'AS ')).join(', ')}
    FROM nucleo.vinculo v JOIN nucleo.pessoa p ON p.id = v.pessoa_id
    WHERE v.sistema_origem = $1 AND v.matricula_norm = ANY($2::text[])
  `, [origem, matriculas]);
  const porMatricula = new Map(banco.rows.map((linha) => [linha.matricula_norm, linha]));
  const pessoasPorCpf = new Map(analise.pessoas.map((pessoa) => [pessoa.cpf, pessoa]));
  const sorteados = [...analise.vinculos].sort(() => Math.random() - 0.5).slice(0, Math.max(0, tamanhoAmostra));
  const amostra = sorteados.map((vinculo) => {
    const linha = porMatricula.get(vinculo.campos.matriculaNorm);
    const referencia = `matrícula ${mascararMatricula(vinculo.campos.matricula)} / CPF ${mascararCpf(vinculo.cpf)}`;
    const campos: Record<string, 'confere' | 'difere' | 'vazio no arquivo'> = {};
    /** Distingue campo ausente no arquivo de divergência; não preenche ou corrige nenhum valor. */
    const comparar = (rotulo: string, arquivo: string | null, valorBanco: string | null | undefined) => {
      campos[rotulo] = arquivo === null ? 'vazio no arquivo' : arquivo === valorBanco ? 'confere' : 'difere';
    };
    comparar('CPF', vinculo.cpf, linha && linha.cpf_hash.equals(protetor.hashCpf(vinculo.cpf)) ? vinculo.cpf : null);
    comparar('NOME', pessoasPorCpf.get(vinculo.cpf)?.campos.nome ?? null, linha?.nome);
    for (const descritor of CAMPOS_VINCULO) comparar(descritor.coluna.toUpperCase(), vinculo.campos[descritor.campo], linha?.[descritor.coluna]);
    return { referencia, campos };
  });
  return { tipo, origem, noArquivo: matriculas.length, noBanco: porMatricula.size, ausentes: matriculas.length - porMatricula.size, amostra };
}
