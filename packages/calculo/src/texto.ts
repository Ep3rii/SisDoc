import { converterDias, diasEntre } from './calendario';
import type { PeriodoCalculado, TotaisCalculo } from './motor';
import type { RegrasVersao } from './regras';

/** Agrupa milhares para apresentação, sem alterar o total numérico calculado. */
function numero(dias: number): string {
  return String(dias).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Aplica singular/plural e largura mínima às unidades convencionais do tempo. */
function unidade(valor: number, singular: string, plural: string): string {
  return `${String(valor).padStart(2, '0')} ${valor === 1 ? singular : plural}`;
}

/** Redige total com conversão da regra; zero é omitido deliberadamente nos modelos. */
export function textoTempo(dias: number, regras: RegrasVersao): string {
  const convertido = converterDias(dias, regras);
  if (dias === 0) return '';
  const partes: string[] = [];
  if (convertido.anos > 0) partes.push(unidade(convertido.anos, 'ano', 'anos'));
  if (convertido.meses > 0) partes.push(unidade(convertido.meses, 'mês', 'meses'));
  if (convertido.dias > 0) partes.push(unidade(convertido.dias, 'dia', 'dias'));
  const texto = partes.length === 3 ? `${partes[0]}, ${partes[1]} e ${partes[2]}`
    : partes.length === 2 ? `${partes[0]} e ${partes[1]}` : partes[0];
  return `${numero(dias)} dias, que correspondem a ${texto}${convertido.dias > 0 ? '.' : ''}`;
}

/** Monta somente linhas DOF com totais positivos, sem confundir efetivo exercício e contribuição. */
export function linhasDeclaracaoDof(totais: TotaisCalculo, regras: RegrasVersao): string[] {
  const linhas: string[] = [];
  if (totais.efetivoExercicio > 0) linhas.push(`- Tempo de efetivo exercício: ${textoTempo(totais.efetivoExercicio, regras)}`);
  if (totais.contribuicaoMunicipio > 0) linhas.push(`- Tempo de contribuição ao município: ${textoTempo(totais.contribuicaoMunicipio, regras)}`);
  const pbPv = totais.pb + totais.pv;
  if (!Number.isSafeInteger(pbPv)) throw new RangeError('O total de incorporações excede a precisão permitida.');
  if (pbPv > 0) linhas.push(`- Incorporação de PV-PB: ${textoTempo(pbPv, regras)}`);
  if (totais.licencaPremio > 0) linhas.push(`- Incorporação de LICENÇA-PRÊMIO: ${textoTempo(totais.licencaPremio, regras)}`);
  if (totais.contribuicaoMunicipio > 0) linhas.push(`- Tempo total de contribuição: ${textoTempo(totais.totalContribuicao, regras)}`);
  return linhas;
}

/** Valida intervalos e redige datas efetivas, preservando a ordem recebida do cálculo. */
export function textoPeriodos(periodos: ReadonlyArray<Pick<PeriodoCalculado, 'inicioEfetivo' | 'fim'>>): string {
  const partes = periodos.map((periodo) => {
    diasEntre(periodo.inicioEfetivo, periodo.fim);
    /** Apresenta data ISO cujo intervalo já foi validado por diasEntre. */
    const formatar = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)}`;
    return `${formatar(periodo.inicioEfetivo)} A ${formatar(periodo.fim)}`;
  });
  return partes.length > 0 ? `${partes.join('; ')}.` : '';
}

/** Extrai nível anterior ao hífen, omitindo referência DA e sinalizando formato não reconhecido. */
export function nivelDof(referencia: string): { nivel: string; avisos: string[] } {
  const valor = referencia.trim();
  if (!valor || valor.toUpperCase().startsWith('DA')) return { nivel: '', avisos: [] };
  const separador = valor.indexOf('-');
  if (separador <= 0) return { nivel: '', avisos: ['Referência sem hífen; confira o nível.'] };
  return { nivel: valor.slice(0, separador), avisos: [] };
}
