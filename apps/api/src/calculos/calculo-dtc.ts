import { calcular, converterDias, REGRAS_PLANILHA, textoPeriodos, textoTempo } from '@sisdoc/calculo';
import {
  resultadoCalculoDtcSchema,
  type ConteudoDtc,
  type LinhaTotalDtc,
  type ResultadoCalculoDtc,
  type TipoDtc
} from '@sisdoc/contratos';

const ROTULOS_TOTAIS: ReadonlyArray<[LinhaTotalDtc['codigo'], string, boolean]> = [
  ['total_contribuicao', 'Tempo Total de Contribuição', false],
  ['efetivo_exercicio', 'Tempo de Efetivo Exercício na PMSL', false],
  ['incorporacao_pb', 'Tempo de Incorporação de PB', true],
  ['incorporacao_pv', 'Tempo de Incorporação de PV', true],
  ['incorporacao_pb_pv', 'Tempo de Incorporação de PB/PV', true],
  ['licenca_premio', 'Tempo de Incorporação de Licença-prêmio', true],
];

/** Adapta o motor puro às linhas e avisos da DTC, sem consultar banco ou decidir autorização. */
export function calcularDtc(
  tipo: TipoDtc, conteudo: ConteudoDtc, admissao: string, dataReferencia: string,
): { resultado: ResultadoCalculoDtc } | { erro: string } {
  const calculo = calcular({
    tipo,
    posse: admissao,
    dataReferencia,
    periodos: conteudo.periodos.map((periodo) => ({ inicio: periodo.inicio, fim: periodo.fim, anos: periodo.anos })),
    regras: REGRAS_PLANILHA,
  });
  if (!calculo.sucesso) {
    return { erro: [...new Set(calculo.erros.map((erro) => erro.periodo ? `${erro.periodo}º período: ${erro.mensagem}` : erro.mensagem))].join(' ') };
  }
  const { totais } = calculo;
  const dias: Record<LinhaTotalDtc['codigo'], number> = {
    total_contribuicao: totais.totalContribuicao,
    efetivo_exercicio: totais.efetivoExercicio,
    incorporacao_pb: totais.pb,
    incorporacao_pv: totais.pv,
    incorporacao_pb_pv: totais.pb + totais.pv,
    licenca_premio: totais.licencaPremio,
  };
  const linhasTotais = ROTULOS_TOTAIS.map(([codigo, rotulo, incorporacao]) => {
    const convertido = converterDias(dias[codigo], calculo.regras);
    return {
      codigo,
      rotulo,
      dias: dias[codigo],
      anos: convertido.anos,
      meses: convertido.meses,
      diasRestantes: convertido.dias,
      texto: textoTempo(dias[codigo], calculo.regras),
      // Incorporações não têm regra aprovada para DTC; no Comissionado e no INSS todo o bloco é inferido.
      provisoria: incorporacao || tipo !== 'DTC_IPAM',
    };
  });
  return {
    resultado: resultadoCalculoDtcSchema.parse({
      tipo,
      admissaoConsiderada: admissao,
      regra: { codigo: calculo.regras.codigo, versao: calculo.regras.versao, classificacao: calculo.regras.classificacao },
      periodos: calculo.periodos.map((periodo) => ({
        ordem: periodo.ordem,
        inicioInformado: periodo.inicioInformado,
        inicioEfetivo: periodo.inicioEfetivo,
        fim: periodo.fim,
        linhas: periodo.linhas,
        excessoTs: periodo.excessoTs,
        excessoPf: periodo.excessoPf,
        totais: periodo.totais,
      })),
      totais,
      textoPeriodos: textoPeriodos(calculo.periodos),
      textoTotal: textoTempo(totais.totalContribuicao, calculo.regras),
      linhasTotais,
      avisos: calculo.avisos,
    }),
  };
}
