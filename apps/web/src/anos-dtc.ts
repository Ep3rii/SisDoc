import type { AnoCalculo } from '@sisdoc/contratos';

/** Gera anos cobertos sem ratear os lançamentos já informados nos anos parciais. */
export function anosDoPeriodo(inicio: string, fim: string, existentes: AnoCalculo[]): AnoCalculo[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim) || fim < inicio) return existentes;
  const primeiro = Number(inicio.slice(0, 4));
  const ultimo = Number(fim.slice(0, 4));
  if (ultimo - primeiro > 199) return existentes;
  const linhas: AnoCalculo[] = [];
  for (let ano = primeiro; ano <= ultimo; ano += 1) {
    const anterior = existentes.find((linha) => linha.ano === ano);
    const completo = (ano > primeiro || inicio.endsWith('-01-01')) && (ano < ultimo || fim.endsWith('-12-31'));
    linhas.push({
      ano,
      abrangencia: completo ? 'ano_civil' : 'intervalo_declarado',
      faltas: anterior?.faltas ?? 0,
      ts: anterior?.ts ?? 0,
      pf: anterior?.pf ?? 0,
      ip: anterior?.ip ?? 0,
      outros: anterior?.outros ?? 0,
      pb: anterior?.pb ?? 0,
      pv: anterior?.pv ?? 0,
      licencaPremio: anterior?.licencaPremio ?? 0,
    });
  }
  return linhas;
}
