import {
  type ContagensImportacao, type OcorrenciaImportacao, type RelatorioImportacao
} from '@sisdoc/contratos';
import type { Estado, OpcoesImportacao } from './estado-importacao';
import {
  sugerirMapeamento,
  type ResultadoAnalise
} from './formatos';

const LIMITE_OCORRENCIAS = 1000;

/** Conta unidades a persistir; dados funcionais incluem pessoas e vínculos separadamente. */
export function totalRegistros(resultado: ResultadoAnalise): number {
  const analise = resultado.analise;
  return analise.tipo === 'dados_funcionais' ? analise.pessoas.length + analise.vinculos.length : analise.registros.length;
}

/** Combina análise de arquivo e rejeições no banco sem confundir divergência com atualização aplicada. */
function montarContagens(resultado: ResultadoAnalise, ocorrencias: OcorrenciaImportacao[], banco: Estado['contagens'] | null): ContagensImportacao {
  /** Conta todas as ocorrências antes de truncar a amostra apresentada no relatório. */
  const contar = (tipo: OcorrenciaImportacao['tipo']) => ocorrencias.filter((item) => item.tipo === tipo).length;
  return {
    lidos: resultado.lidos,
    validos: Math.max(0, resultado.validos - (banco?.rejeitadosBanco ?? 0)),
    rejeitados: contar('rejeitada'),
    duplicados: contar('duplicada'),
    quarentena: contar('quarentena'),
    anomalias: contar('anomalia') + contar('divergencia'),
    inseridos: banco?.inseridos ?? 0,
    atualizados: banco?.atualizados ?? 0,
    inalterados: banco?.inalterados ?? 0,
  };
}

/** Ordena e limita ocorrências, mostrando referências completas somente quando autorizado nas opções. */
export function relatorio(
  resultado: ResultadoAnalise, opcoes: OpcoesImportacao, loteId: string | null, loteExistente: string | null,
  ocorrencias: OcorrenciaImportacao[], banco: Estado['contagens'] | null, inicio: number, linhas: string[][],
): RelatorioImportacao {
  const cabecalho = linhas.find((linha) => linha.some((valor) => valor.trim()));
  const mapeamento = cabecalho ? sugerirMapeamento(opcoes.tipo, cabecalho) : {};
  const ordenadas = [...ocorrencias].sort((a, b) => a.linha - b.linha).map((item) => {
    if (!opcoes.referenciasCompletas) return item;
    const linha = linhas[item.linha - 1];
    const campos = ['MATRICULA', 'NOME', 'CPF'].flatMap((campo) => {
      const indice = mapeamento[campo];
      return indice !== null && indice !== undefined && linha?.[indice] ? [`${campo}: ${linha[indice]}`] : [];
    });
    return campos.length ? { ...item, referencia: campos.join(' / ') } : item;
  });
  const limite = opcoes.limiteOcorrencias ?? LIMITE_OCORRENCIAS;
  return {
    loteId,
    tipo: opcoes.tipo,
    origem: opcoes.origem,
    modo: opcoes.gravar ? 'gravacao' : 'validacao',
    loteExistente,
    contagens: montarContagens(resultado, ocorrencias, banco),
    ocorrencias: ordenadas.slice(0, limite),
    ocorrenciasOmitidas: Math.max(0, ordenadas.length - limite),
    avisos: resultado.avisos,
    duracaoMs: Math.round(performance.now() - inicio),
  };
}
