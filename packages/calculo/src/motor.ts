import {
  acumuladoAnteriorSchema,
  anoCalculoSchema,
  dataFuncionalSchema,
  tipoDocumentoSchema,
} from '@sisdoc/contratos';
import { z } from 'zod';
import { diasEntre, dividirIntervaloPorAno } from './calendario';
import { regrasVersaoSchema, type RegrasVersao } from './regras';

const periodoEntradaSchema = z.strictObject({
  inicio: dataFuncionalSchema,
  fim: dataFuncionalSchema,
  anos: z.array(anoCalculoSchema).min(1).max(9999),
  acumuladoAnterior: acumuladoAnteriorSchema.optional(),
});
export const entradaCalculoSchema = z.strictObject({
  tipo: tipoDocumentoSchema,
  posse: dataFuncionalSchema,
  dataReferencia: dataFuncionalSchema,
  periodos: z.array(periodoEntradaSchema).min(1).max(4),
  regras: regrasVersaoSchema,
});

export type EntradaCalculo = z.input<typeof entradaCalculoSchema>;

export type AvisoCalculo = {
  codigo: string;
  mensagem: string;
  periodo?: number;
  ano?: number;
};

export type ErroCalculo = {
  codigo: string;
  mensagem: string;
  caminho?: string;
  periodo?: number;
  ano?: number;
};

export type LinhaAnual = {
  ano: number;
  inicio: string;
  fim: string;
  diasBrutos: number;
  faltas: number;
  ts: number;
  pf: number;
  ip: number;
  outros: number;
  excessoTs: number;
  excessoPf: number;
  deducaoContribuicao: number;
  deducaoExercicio: number;
  contribuicao: number;
  efetivoExercicio: number;
  pb: number;
  pv: number;
  licencaPremio: number;
};

export type TotaisCalculo = {
  diasBrutos: number;
  contribuicaoMunicipio: number;
  efetivoExercicio: number;
  totalContribuicao: number;
  pb: number;
  pv: number;
  licencaPremio: number;
};

export type PeriodoCalculado = {
  ordem: number;
  inicioInformado: string;
  inicioEfetivo: string;
  fim: string;
  linhas: LinhaAnual[];
  excessoTs: number;
  excessoPf: number;
  aplicacaoExcessos: 'anual' | 'total_periodo';
  totais: TotaisCalculo;
};

export type ResultadoCalculo =
  | { sucesso: true; regras: RegrasVersao; avisos: AvisoCalculo[]; periodos: PeriodoCalculado[]; totais: TotaisCalculo }
  | { sucesso: false; avisos: AvisoCalculo[]; erros: ErroCalculo[] };

/** Soma valores de domínio e recusa totais fora da precisão inteira do JavaScript. */
function somaSegura(...valores: number[]): number {
  const total = valores.reduce((soma, valor) => soma + valor, 0);
  if (!Number.isSafeInteger(total)) throw new RangeError('O total excede a precisão inteira permitida.');
  return total;
}

/** Produz falha discriminada com avisos já obtidos e localização do problema. */
function erro(avisos: AvisoCalculo[], codigo: string, mensagem: string, periodo?: number, ano?: number): ResultadoCalculo {
  return { sucesso: false, avisos, erros: [{ codigo, mensagem, periodo, ano }] };
}

/** Cria acumulador independente para impedir compartilhamento entre períodos. */
function totaisVazios(): TotaisCalculo {
  return { diasBrutos: 0, contribuicaoMunicipio: 0, efetivoExercicio: 0, totalContribuicao: 0, pb: 0, pv: 0, licencaPremio: 0 };
}

/** Acumula todos os totais no destino com checagem de precisão em cada campo. */
function somarTotais(destino: TotaisCalculo, origem: TotaisCalculo): void {
  for (const chave of Object.keys(destino) as Array<keyof TotaisCalculo>) {
    destino[chave] = somaSegura(destino[chave], origem[chave]);
  }
}

/**
 * Calcula contribuição e efetivo exercício com a mesma regra na API e no navegador.
 * Exige anos explícitos e confirmação de intervalo parcial, sem rateio automático.
 * Ajuste à posse e regras provisórias geram avisos; não constituem aprovação de emissão.
 */
export function calcular(entrada: unknown): ResultadoCalculo {
  const validacao = entradaCalculoSchema.safeParse(entrada);
  if (!validacao.success) {
    return {
      sucesso: false,
      avisos: [],
      erros: validacao.error.issues.map((item) => ({
        codigo: 'entrada_invalida',
        mensagem: 'Entrada de cálculo inválida; verifique o campo indicado.',
        caminho: item.path.map(String).join('.'),
      })),
    };
  }
  const dados = validacao.data;
  const avisos: AvisoCalculo[] = [{
    codigo: 'regra_provisoria',
    mensagem: 'Regra provisória de referência; a emissão depende de aprovação.',
  }];
  if (dados.tipo === 'DTC_COMISSIONADO' || dados.tipo === 'DTC_INSS') {
    avisos.push({ codigo: 'perfil_inferido', mensagem: 'O perfil de cálculo deste documento é inferido e depende de aprovação.' });
  }
  if (dados.tipo === 'DOF' && dados.periodos.length !== 1) {
    return erro(avisos, 'quantidade_periodos', 'A DOF exige exatamente um período.');
  }
  const periodosOrdenados = dados.periodos.map((periodo, indice) => ({ ...periodo, ordem: indice + 1 }))
    .sort((a, b) => a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0);
  for (let indice = 0; indice < periodosOrdenados.length; indice += 1) {
    const periodo = periodosOrdenados[indice];
    if (periodo.fim < periodo.inicio || periodo.fim > dados.dataReferencia) {
      return erro(avisos, 'datas_invalidas', 'Verifique o início, o fim e a data de referência.', periodo.ordem);
    }
    if (indice > 0 && periodo.inicio <= periodosOrdenados[indice - 1].fim) {
      return erro(avisos, 'periodos_sobrepostos', 'Os períodos não podem se sobrepor.', periodo.ordem);
    }
  }

  const saida: PeriodoCalculado[] = [];
  const totaisGerais = totaisVazios();
  let anteriorTs = 0;
  let anteriorPf = 0;
  try {
    for (const periodo of periodosOrdenados) {
      const inicio = periodo.inicio < dados.posse ? dados.posse : periodo.inicio;
      if (inicio !== periodo.inicio) {
        avisos.push({
          codigo: 'inicio_ajustado_posse',
          mensagem: 'O início foi ajustado à posse; a alteração exige confirmação.',
          periodo: periodo.ordem,
        });
      }
      if (inicio > periodo.fim) {
        return erro(avisos, 'periodo_antes_posse', 'O período termina antes da posse.', periodo.ordem);
      }
      const escopo = dados.regras.escopoPorTipo[dados.tipo];
      if (escopo === 'vinculo' && inicio > dados.posse && !periodo.acumuladoAnterior) {
        return erro(avisos, 'acumulado_anterior_necessario', 'Informe o acumulado anterior ao período e sua origem.', periodo.ordem);
      }
      if (escopo === 'periodo' && periodo.acumuladoAnterior) {
        return erro(avisos, 'acumulado_incompativel', 'O perfil por período não usa acumulado anterior.', periodo.ordem);
      }
      let acumuladoTs = periodo.acumuladoAnterior?.ts ?? 0;
      let acumuladoPf = periodo.acumuladoAnterior?.pf ?? 0;
      if (escopo === 'vinculo' && (
        (inicio === dados.posse && (acumuladoTs !== 0 || acumuladoPf !== 0))
        || acumuladoTs < anteriorTs || acumuladoPf < anteriorPf
        || somaSegura(acumuladoTs, acumuladoPf) > diasEntre(dados.posse, inicio)
      )) {
        return erro(avisos, 'acumulado_inconsistente', 'O acumulado anterior é incompatível com o vínculo ou período anterior.', periodo.ordem);
      }
      const inicioAno = Number(inicio.slice(0, 4));
      const fimAno = Number(periodo.fim.slice(0, 4));
      const porAno = new Map<number, z.infer<typeof anoCalculoSchema>>();
      for (const item of periodo.anos) {
        if (item.ano < inicioAno || item.ano > fimAno || porAno.has(item.ano)) {
          return erro(avisos, 'anos_inconsistentes', 'Cada ano do período deve constar uma única vez.', periodo.ordem, item.ano);
        }
        porAno.set(item.ano, item);
      }
      if (porAno.size !== fimAno - inicioAno + 1) {
        return erro(avisos, 'anos_incompletos', 'Informe explicitamente os valores de todos os anos do período.', periodo.ordem);
      }
      const linhas: LinhaAnual[] = [];
      const totais = totaisVazios();
      let excessoTsPeriodo = 0;
      let excessoPfPeriodo = 0;
      for (const segmento of dividirIntervaloPorAno(inicio, periodo.fim)) {
        const { ano } = segmento;
        const entradaAno = porAno.get(ano);
        if (!entradaAno) return erro(avisos, 'anos_incompletos', 'Faltam valores anuais.', periodo.ordem, ano);
        const anoTexto = String(ano).padStart(4, '0');
        const primeiroDia = `${anoTexto}-01-01`;
        const ultimoDia = `${anoTexto}-12-31`;
        const inicioAnoEfetivo = segmento.inicio;
        const fimAnoEfetivo = segmento.fim;
        const bruto = segmento.dias;
        const informados = somaSegura(
          entradaAno.faltas, entradaAno.ts, entradaAno.pf, entradaAno.ip, entradaAno.outros,
          entradaAno.pb, entradaAno.pv, entradaAno.licencaPremio,
        );
        if ((inicioAnoEfetivo !== primeiroDia || fimAnoEfetivo !== ultimoDia)
          && entradaAno.abrangencia === 'ano_civil' && informados > 0) {
          return erro(avisos, 'ano_parcial_nao_confirmado', 'Confirme os valores referentes ao intervalo parcial, sem rateio automático.', periodo.ordem, ano);
        }
        if (dados.tipo !== 'DOF' && (entradaAno.pb > 0 || entradaAno.pv > 0 || entradaAno.licencaPremio > 0)) {
          avisos.push({
            codigo: 'incorporacao_dtc_provisoria',
            mensagem: 'Incorporações anuais informadas na DTC são provisórias e exigem validação documental e aprovação do modelo.',
            periodo: periodo.ordem, ano,
          });
        }
        const afastamentos = somaSegura(entradaAno.faltas, entradaAno.ts, entradaAno.pf, entradaAno.ip, entradaAno.outros);
        if (afastamentos > bruto) {
          avisos.push({
            codigo: 'deducoes_excedem_dias',
            mensagem: 'Os afastamentos informados excedem os dias disponíveis no ano.',
            periodo: periodo.ordem,
            ano,
          });
          return erro(avisos, 'afastamentos_excedem_dias', 'Revise os afastamentos antes de calcular.', periodo.ordem, ano);
        }
        const anteriorAnoTs = acumuladoTs;
        const anteriorAnoPf = acumuladoPf;
        acumuladoTs = somaSegura(acumuladoTs, entradaAno.ts);
        acumuladoPf = somaSegura(acumuladoPf, entradaAno.pf);
        const excessoTs = escopo === 'vinculo'
          ? Math.max(0, acumuladoTs - dados.regras.limiteTs) - Math.max(0, anteriorAnoTs - dados.regras.limiteTs)
          : 0;
        const excessoPf = escopo === 'vinculo' && dados.regras.pfEntraNaSoma
          ? Math.max(0, acumuladoPf - dados.regras.limitePf) - Math.max(0, anteriorAnoPf - dados.regras.limitePf)
          : 0;
        excessoTsPeriodo = somaSegura(excessoTsPeriodo, excessoTs);
        excessoPfPeriodo = somaSegura(excessoPfPeriodo, excessoPf);
        const deducaoContribuicao = somaSegura(entradaAno.faltas, entradaAno.ip, entradaAno.outros);
        const deducaoExercicio = somaSegura(deducaoContribuicao, excessoTs, excessoPf);
        const contribuicao = bruto - deducaoContribuicao;
        const efetivoExercicio = bruto - deducaoExercicio;
        const linha: LinhaAnual = {
          ano, inicio: inicioAnoEfetivo, fim: fimAnoEfetivo, diasBrutos: bruto,
          faltas: entradaAno.faltas, ts: entradaAno.ts, pf: entradaAno.pf, ip: entradaAno.ip, outros: entradaAno.outros,
          excessoTs, excessoPf, deducaoContribuicao, deducaoExercicio, contribuicao, efetivoExercicio,
          pb: entradaAno.pb, pv: entradaAno.pv, licencaPremio: entradaAno.licencaPremio,
        };
        linhas.push(linha);
        somarTotais(totais, {
          diasBrutos: bruto,
          contribuicaoMunicipio: contribuicao,
          efetivoExercicio,
          totalContribuicao: contribuicao,
          pb: entradaAno.pb,
          pv: entradaAno.pv,
          licencaPremio: entradaAno.licencaPremio,
        });
      }
      if (escopo === 'periodo') {
        excessoTsPeriodo = Math.max(0, acumuladoTs - dados.regras.limiteTs);
        excessoPfPeriodo = dados.regras.pfEntraNaSoma ? Math.max(0, acumuladoPf - dados.regras.limitePf) : 0;
        totais.efetivoExercicio -= somaSegura(excessoTsPeriodo, excessoPfPeriodo);
      }
      if (acumuladoTs > dados.regras.limiteTs) {
        avisos.push({ codigo: 'limite_ts_excedido', mensagem: 'O limite provisório de T/S foi ultrapassado.', periodo: periodo.ordem });
      }
      if (acumuladoPf > dados.regras.limitePf) {
        avisos.push({ codigo: 'limite_pf_excedido', mensagem: 'O limite provisório de P/F foi ultrapassado.', periodo: periodo.ordem });
      }
      if (totais.efetivoExercicio < 0) {
        avisos.push({ codigo: 'deducoes_excedem_dias', mensagem: 'As deduções excedem os dias disponíveis.', periodo: periodo.ordem });
        return erro(avisos, 'deducoes_excedem_periodo', 'Revise as deduções antes de calcular.', periodo.ordem);
      }
      totais.totalContribuicao = somaSegura(totais.contribuicaoMunicipio, totais.pb, totais.pv, totais.licencaPremio);
      anteriorTs = acumuladoTs;
      anteriorPf = acumuladoPf;
      saida.push({
        ordem: periodo.ordem,
        inicioInformado: periodo.inicio,
        inicioEfetivo: inicio,
        fim: periodo.fim,
        linhas,
        excessoTs: excessoTsPeriodo,
        excessoPf: excessoPfPeriodo,
        aplicacaoExcessos: escopo === 'vinculo' ? 'anual' : 'total_periodo',
        totais,
      });
      somarTotais(totaisGerais, totais);
    }
    return { sucesso: true, regras: dados.regras, avisos, periodos: saida, totais: totaisGerais };
  } catch (falha) {
    if (falha instanceof RangeError) {
      return erro(avisos, 'limite_numerico', 'Os valores excedem a precisão numérica permitida.');
    }
    throw falha;
  }
}
