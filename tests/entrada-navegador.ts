import { calcular, converterDias, REGRAS_PLANILHA } from '@sisdoc/calculo';

export function amostra(): { anos: number; meses: number; dias: number; diasBrutos: number } {
  const resultado = calcular({
    tipo: 'DOF',
    posse: '2020-01-01',
    dataReferencia: '2020-12-31',
    periodos: [{
      inicio: '2020-01-01',
      fim: '2020-12-31',
      anos: [{
        ano: 2020, abrangencia: 'ano_civil', faltas: 0, ts: 0, pf: 0, ip: 0, outros: 0,
        pb: 0, pv: 0, licencaPremio: 0,
      }],
    }],
    regras: REGRAS_PLANILHA,
  });
  if (!resultado.sucesso) throw new Error('Falha ao calcular no navegador.');
  return { ...converterDias(1311, REGRAS_PLANILHA), diasBrutos: resultado.totais.diasBrutos };
}
