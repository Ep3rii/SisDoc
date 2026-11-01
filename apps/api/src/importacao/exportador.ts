import { UnprocessableEntityException } from '@nestjs/common';
import type { ExportarDados } from '@sisdoc/contratos';
import type { PoolClient } from 'pg';
import { decifrarTexto, type ProtetorDados } from '../seguranca/protecao-dados';
import { COLUNAS, COLUNAS_AFASTAMENTO_INTERVALO } from './formatos';
import { escreverCsv, escreverXlsx, LIMITE_ARQUIVO_BYTES } from './planilhas';

const MAXIMO_LINHAS = 100_000;
type Valor = string | Buffer | null;
type Registro = Record<string, Valor>;

export const CAMPOS_PESSOA_EXPORTACAO = {
  CPF: 'cpf_cifrado', MAE: 'nome_mae_cifrado', PISPASEP: 'pis_pasep_cifrado',
  NUMRG: 'rg_numero_cifrado', NUMTITEL: 'titulo_eleitor_cifrado', ENDERECO: 'endereco_cifrado',
} as const;

/** Exporta origem validada, recusando ambiguidades, excesso de tamanho e fórmulas CSV sem alterar células. */
export async function gerarExportacao(cliente: PoolClient, protetor: ProtetorDados, dados: ExportarDados): Promise<Buffer> {
  const { tipo, origem } = dados;
  let sql: string;
  let colunas: readonly string[] = COLUNAS[tipo];
  if (tipo === 'dados_funcionais') {
    sql = `SELECT p.id::text AS pessoa_id, p.nome AS "NOME", p.cpf_cifrado AS "CPF",
      to_char(p.nascimento, 'YYYY-MM-DD') AS "NASCIMENTO", p.nome_mae_cifrado AS "MAE",
      p.pis_pasep_cifrado AS "PISPASEP", p.rg_numero_cifrado AS "NUMRG", p.titulo_eleitor_cifrado AS "NUMTITEL",
      p.rg_orgao AS "ORGAORG", p.endereco_cifrado AS "ENDERECO", to_char(p.rg_expedicao, 'YYYY-MM-DD') AS "EXPEDICAO",
      v.matricula AS "MATRICULA", to_char(v.admissao, 'YYYY-MM-DD') AS "ADMISSAO",
      v.regime_juridico AS "REGIMEJUR", v.cargo AS "CARGO", v.referencia AS "REFERENCIA",
      v.setor AS "SETOR", v.orgao_nome AS "ORGAO", to_char(v.desligamento, 'YYYY-MM-DD') AS "DESLIGAMENTO"
      FROM nucleo.vinculo v JOIN nucleo.pessoa p ON p.id = v.pessoa_id
      WHERE v.sistema_origem = $1 AND v.removido_na_fonte_em IS NULL ORDER BY v.id`;
  } else if (tipo === 'afastamentos' && dados.afastamentos === 'anual') {
    sql = `SELECT v.matricula AS "MATRICULA", a.ano_ref::text AS "ANO",
      max(a.dias_ano) FILTER (WHERE a.tipo = 'falta')::text AS "FALTAS",
      max(a.dias_ano) FILTER (WHERE a.tipo = 'licenca_ts')::text AS "TS",
      max(a.dias_ano) FILTER (WHERE a.tipo = 'licenca_pf')::text AS "PF",
      max(a.dias_ano) FILTER (WHERE a.tipo = 'licenca_ip')::text AS "IP",
      max(a.dias_ano) FILTER (WHERE a.tipo = 'outro')::text AS "OUTROS"
      FROM nucleo.afastamento a JOIN nucleo.vinculo v ON v.id = a.vinculo_id
      WHERE a.sistema_origem = $1 AND a.removido_na_fonte_em IS NULL AND v.removido_na_fonte_em IS NULL
        AND a.ano_ref IS NOT NULL GROUP BY v.id, v.matricula, a.ano_ref ORDER BY v.id, a.ano_ref`;
    const ambiguos = await cliente.query(`SELECT 1 FROM nucleo.afastamento
      WHERE sistema_origem = $1 AND removido_na_fonte_em IS NULL AND ano_ref IS NOT NULL
      GROUP BY vinculo_id, ano_ref, tipo HAVING count(*) > 1 LIMIT 1`, [origem]);
    if (ambiguos.rowCount) throw new UnprocessableEntityException('Há afastamentos anuais duplicados; revise a fonte antes de exportar.');
  } else if (tipo === 'afastamentos') {
    colunas = COLUNAS_AFASTAMENTO_INTERVALO;
    sql = `SELECT v.matricula AS "MATRICULA",
      CASE a.tipo WHEN 'falta' THEN 'FALTA' WHEN 'licenca_ts' THEN 'TS' WHEN 'licenca_pf' THEN 'PF'
        WHEN 'licenca_ip' THEN 'IP' ELSE 'OUTRO' END AS "TIPO",
      to_char(a.data_inicio, 'YYYY-MM-DD') AS "DT_INICIO", to_char(a.data_fim, 'YYYY-MM-DD') AS "DT_FIM"
      FROM nucleo.afastamento a JOIN nucleo.vinculo v ON v.id = a.vinculo_id
      WHERE a.sistema_origem = $1 AND a.removido_na_fonte_em IS NULL AND v.removido_na_fonte_em IS NULL
        AND a.data_inicio IS NOT NULL ORDER BY a.id`;
  } else if (tipo === 'incorporacoes') {
    const anuais = await cliente.query(`SELECT 1 FROM nucleo.incorporacao
      WHERE sistema_origem = $1 AND removido_na_fonte_em IS NULL
        AND (ano_ref IS NOT NULL OR convencao <> 'inclusivo') LIMIT 1`, [origem]);
    if (anuais.rowCount) throw new UnprocessableEntityException('Há incorporações anuais ou exclusivas que não cabem no formato de intervalos inclusivos. Revise a fonte antes de exportar.');
    sql = `SELECT v.matricula AS "MATRICULA", a.tipo AS "TIPO",
      to_char(a.data_inicio, 'YYYY-MM-DD') AS "DT_INICIO", to_char(a.data_fim, 'YYYY-MM-DD') AS "DT_FIM"
      FROM nucleo.incorporacao a JOIN nucleo.vinculo v ON v.id = a.vinculo_id
      WHERE a.sistema_origem = $1 AND a.removido_na_fonte_em IS NULL AND v.removido_na_fonte_em IS NULL ORDER BY a.id`;
  } else if (tipo === 'periodos_ipam') {
    sql = `SELECT p.id::text AS pessoa_id, p.cpf_cifrado AS "CPF",
      to_char(a.mes_inicio, 'YYYY-MM') AS "MES_INICIO", to_char(a.mes_fim, 'YYYY-MM') AS "MES_FIM"
      FROM nucleo.periodo_ipam a JOIN nucleo.pessoa p ON p.id = a.pessoa_id
      WHERE a.sistema_origem = $1 AND a.removido_na_fonte_em IS NULL ORDER BY a.id`;
  } else {
    sql = `SELECT a.id::text AS registro_id, v.matricula AS "MATRICULA", a.tipo AS "TIPO",
      to_char(a.data_evento, 'YYYY-MM-DD') AS "DATA", a.ato_numero AS "ATO_NUMERO",
      to_char(a.data_publicacao, 'YYYY-MM-DD') AS "DATA_PUBLICACAO", a.descricao_origem_cifrada AS "DESCRICAO"
      FROM nucleo.evento_funcional a JOIN nucleo.vinculo v ON v.id = a.vinculo_id
      WHERE a.sistema_origem = $1 AND a.removido_na_fonte_em IS NULL AND v.removido_na_fonte_em IS NULL ORDER BY a.id`;
  }
  const registros = await cliente.query<Registro>(`${sql} LIMIT ${MAXIMO_LINHAS + 1}`, [origem]);
  if (registros.rows.length > MAXIMO_LINHAS) throw new UnprocessableEntityException('A exportação excede 100 mil linhas. Separe os dados por origem.');
  const linhas = [[...colunas], ...registros.rows.map((registro) => colunas.map((coluna) => {
    const valor = registro[coluna];
    if (Buffer.isBuffer(valor)) {
      const pessoa = registro.pessoa_id;
      if (typeof pessoa === 'string' && coluna in CAMPOS_PESSOA_EXPORTACAO) {
        const campo = CAMPOS_PESSOA_EXPORTACAO[coluna as keyof typeof CAMPOS_PESSOA_EXPORTACAO];
        return decifrarTexto(protetor, pessoa, 'pessoa', campo, valor) ?? '';
      }
      if (coluna === 'DESCRICAO' && typeof registro.registro_id === 'string') {
        return decifrarTexto(protetor, registro.registro_id, 'evento_funcional', 'descricao_origem_cifrada', valor) ?? '';
      }
      throw new Error('Campo cifrado inesperado na exportação.');
    }
    return valor ?? '';
  }))];
  // CSV não identifica tipos de célula; recusar fórmulas preserva os dados sem executar conteúdo ao abrir no Excel.
  if (dados.formato === 'csv' && linhas.some((linha) => linha.some((valor) => /^[\s]*[=+@\-\t\r]/.test(valor)))) {
    throw new UnprocessableEntityException('Há células interpretáveis como fórmula no CSV. Exporte em XLSX, que preserva os valores como texto.');
  }
  const arquivo = dados.formato === 'csv' ? escreverCsv(linhas) : escreverXlsx(linhas, tipo);
  if (arquivo.length > LIMITE_ARQUIVO_BYTES) throw new UnprocessableEntityException('A exportação excede 64 MB. Separe os dados por origem.');
  return arquivo;
}
