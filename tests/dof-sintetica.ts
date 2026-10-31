import { randomUUID } from 'node:crypto';
import { calcular, linhasDeclaracaoDof, REGRAS_PLANILHA } from '@sisdoc/calculo';
import {
  previaConferidaDofSchema, resultadoCalculoDofSchema, type PreviaConferidaDof, type ResultadoCalculoDof,
} from '@sisdoc/contratos';
import { cpfSintetico } from './dados-sinteticos.js';

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

export function previaDofSintetica(): PreviaConferidaDof {
  const documentoId = randomUUID();
  return previaConferidaDofSchema.parse({
    documentoId, revisao: 2, status: 'conferido',
    nome: 'Pessoa fictícia <img src=x>', matricula: 'FICTICIA-1',
    resultado: resultadoDofSintetico(),
    blocos: [
      { id: randomUUID(), codigo: 'contratacao', ativo: true, texto: 'Linha fictícia para {{nome}}.\nOutra linha.' },
      { id: randomUUID(), codigo: 'complementares', ativo: false, texto: 'BLOCO-INATIVO-FICTICIO' },
    ],
    processo: 'FICTICIO-1',
    fonte: {
      documentoId, revisao: 2, provaFonte: 'a'.repeat(64), consultadoEm: '2026-01-01T12:00:00.000Z',
      nome: 'Pessoa fictícia <img src=x>', matricula: 'FICTICIA-1', cpf: cpfSintetico(),
      nascimento: '1950-05-04', nomeMae: 'Mãe fictícia <script>fictício</script>',
      regimeJuridico: 'ESTATUTARIO', cargo: 'Cargo fictício', nivel: 'A',
      avisoNivel: null, referencia: 'A-1', orgao: 'Órgão fictício',
      admissao: '1980-01-01', removidoNaFonte: false,
    },
    fonteSelecionadaAlterada: false,
  });
}
