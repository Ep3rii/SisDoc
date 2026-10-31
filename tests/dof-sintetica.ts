import { calcular, linhasDeclaracaoDof, REGRAS_PLANILHA } from '@sisdoc/calculo';
import { resultadoCalculoDofSchema, type ResultadoCalculoDof } from '@sisdoc/contratos';

export function resultadoDofSintetico(): ResultadoCalculoDof {
  const calculo = calcular({
    tipo: 'DOF', posse: '1980-01-01', dataReferencia: '2026-01-01', regras: REGRAS_PLANILHA,
    periodos: [{
      inicio: '1980-01-01', fim: '2024-12-31',
      anos: Array.from({ length: 45 }, (_, indice) => ({
        ano: 1980 + indice, abrangencia: 'intervalo_declarado' as const,
        faltas: 0, ts: 0, pf: 0, ip: 0, outros: 0, pb: 0, pv: 0, licencaPremio: 0,
      })),
    }],
  });
  if (!calculo.sucesso) throw new Error('Cálculo sintético inválido.');
  const periodo = calculo.periodos[0];
  return resultadoCalculoDofSchema.parse({
    admissaoConsiderada: '1980-01-01',
    regra: { codigo: calculo.regras.codigo, versao: calculo.regras.versao, classificacao: calculo.regras.classificacao },
    periodo: {
      inicioInformado: periodo.inicioInformado, inicioEfetivo: periodo.inicioEfetivo,
      fim: periodo.fim, linhas: periodo.linhas,
    },
    totais: calculo.totais,
    declaracao: linhasDeclaracaoDof(calculo.totais, calculo.regras),
    avisos: calculo.avisos,
  });
}
