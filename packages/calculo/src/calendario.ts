import { afastamentoSchema, dataFuncionalSchema, incorporacaoSchema } from '@sisdoc/contratos';
import { regrasVersaoSchema, type RegrasVersao } from './regras';

/** Converte data gregoriana validada em ordinal sem Date, fuso horário ou limites de timestamp. */
function ordinal(data: string): number {
  const valida = dataFuncionalSchema.parse(data);
  const ano = Number(valida.slice(0, 4));
  const mes = Number(valida.slice(5, 7));
  const dia = Number(valida.slice(8, 10));
  const anoAnterior = ano - 1;
  const diasAntesAno = 365 * anoAnterior + Math.floor(anoAnterior / 4)
    - Math.floor(anoAnterior / 100) + Math.floor(anoAnterior / 400);
  const inicioMes = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][mes - 1];
  const bissexto = ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0);
  return diasAntesAno + inicioMes + dia + (mes > 2 && bissexto ? 1 : 0);
}

/** Conta diferença civil exclusiva e rejeita intervalos invertidos. */
export function diasEntre(inicio: string, fim: string): number {
  const diferenca = ordinal(fim) - ordinal(inicio);
  if (diferenca < 0) throw new RangeError('A data final não pode ser anterior à inicial.');
  return diferenca;
}

/** Conta ambos os extremos do intervalo, incluindo um dia quando início e fim coincidem. */
export function diasInclusivos(inicio: string, fim: string): number {
  return diasEntre(inicio, fim) + 1;
}

/** Divide intervalo inclusivo por anos civis sem ratear afastamentos ou incorporações. */
export function dividirIntervaloPorAno(inicio: string, fim: string): Array<{
  ano: number; inicio: string; fim: string; dias: number;
}> {
  diasEntre(inicio, fim);
  const primeiro = Number(inicio.slice(0, 4));
  const ultimo = Number(fim.slice(0, 4));
  const partes: Array<{ ano: number; inicio: string; fim: string; dias: number }> = [];
  for (let ano = primeiro; ano <= ultimo; ano += 1) {
    const textoAno = String(ano).padStart(4, '0');
    const primeiroDia = `${textoAno}-01-01`;
    const ultimoDia = `${textoAno}-12-31`;
    const inicioAno = inicio > primeiroDia ? inicio : primeiroDia;
    const fimAno = fim < ultimoDia ? fim : ultimoDia;
    partes.push({ ano, inicio: inicioAno, fim: fimAno, dias: diasInclusivos(inicioAno, fimAno) });
  }
  return partes;
}

/** Valida afastamento e distingue lançamento anual de dias pertencentes ao intervalo declarado. */
export function distribuirAfastamento(entrada: unknown): Array<{
  ano: number;
  tipo: 'falta' | 'licenca_ts' | 'licenca_pf' | 'licenca_ip' | 'outro';
  dias: number;
  abrangencia: 'ano_civil' | 'intervalo_declarado';
  inicio?: string;
  fim?: string;
}> {
  const afastamento = afastamentoSchema.parse(entrada);
  if (afastamento.forma === 'anual') {
    return [{ ano: afastamento.ano, tipo: afastamento.tipo, dias: afastamento.dias, abrangencia: 'ano_civil' }];
  }
  return dividirIntervaloPorAno(afastamento.intervalo.inicio, afastamento.intervalo.fim)
    .map((parte) => ({ ...parte, tipo: afastamento.tipo, abrangencia: 'intervalo_declarado' as const }));
}

/** Converte dias inteiros pelas durações convencionais da regra, não por meses civis. */
export function converterDias(dias: number, regras: RegrasVersao): { anos: number; meses: number; dias: number } {
  if (!Number.isSafeInteger(dias) || dias < 0) throw new RangeError('Informe uma quantidade inteira não negativa de dias.');
  const valida = regrasVersaoSchema.parse(regras);
  const anos = Math.floor(dias / valida.diasAno);
  const restante = dias - anos * valida.diasAno;
  const meses = Math.floor(restante / valida.diasMes);
  return { anos, meses, dias: restante - meses * valida.diasMes };
}

/** Valida incorporação e respeita sua convenção anual, inclusiva ou exclusiva. */
export function calcularIncorporacao(entrada: unknown): {
  dias: number; origem: string; convencao: 'anual' | 'inclusivo' | 'exclusivo';
} {
  const incorporacao = incorporacaoSchema.parse(entrada);
  if (incorporacao.forma === 'anual') {
    return { dias: incorporacao.dias, origem: incorporacao.origem, convencao: 'anual' };
  }
  const dias = diasEntre(incorporacao.intervalo.inicio, incorporacao.intervalo.fim);
  return {
    dias: dias + (incorporacao.convencao === 'inclusivo' ? 1 : 0),
    origem: incorporacao.origem,
    convencao: incorporacao.convencao,
  };
}
