import { resultadoCalculoDofSchema, type SolicitarCalculoDof } from '@sisdoc/contratos';
import { calcular } from './motor';
import { REGRAS_PLANILHA } from './regras';
import { linhasDeclaracaoDof } from './texto';

export function calcularPreviaDof(dados: SolicitarCalculoDof, admissao: string, dataReferencia: string) {
  admissao = dados.ajustesCadastro?.admissao ?? admissao;
  const calculo = calcular({
    tipo: 'DOF', posse: admissao, dataReferencia,
    periodos: [{ inicio: dados.inicio, fim: dados.fim, anos: dados.anos,
      ...(dados.acumuladoAnterior ? { acumuladoAnterior: dados.acumuladoAnterior } : {}) }],
    regras: REGRAS_PLANILHA,
  });
  if (!calculo.sucesso) return { erro: [...new Set(calculo.erros.map((erro) => erro.mensagem))].join(' ') };
  const periodo = calculo.periodos[0];
  return { resultado: resultadoCalculoDofSchema.parse({
    admissaoConsiderada: admissao,
    regra: { codigo: calculo.regras.codigo, versao: calculo.regras.versao, classificacao: calculo.regras.classificacao },
    periodo: { inicioInformado: periodo.inicioInformado, inicioEfetivo: periodo.inicioEfetivo, fim: periodo.fim, linhas: periodo.linhas },
    totais: calculo.totais, declaracao: linhasDeclaracaoDof(calculo.totais, calculo.regras), avisos: calculo.avisos,
  }) };
}
