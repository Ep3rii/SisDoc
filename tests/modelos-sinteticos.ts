import {
  OBSERVACAO_PADRAO_INSS, snapshotEmissaoDofSchema, snapshotEmissaoDtcSchema,
  type ConteudoDtc, type SnapshotEmissaoDof, type SnapshotEmissaoDtc, type TipoDtc,
} from '@sisdoc/contratos';
import { TEMPLATES_OFICIAIS } from '@sisdoc/templates';
import { randomUUID } from 'node:crypto';
import { calcularDtc } from '../apps/api/dist/calculos/calculo-dtc.js';
import { cpfSintetico } from './dados-sinteticos';
import { previaDofSintetica } from './dof-sintetica';

/** Gera metadados de emissão inteiramente fictícios sem registrar aprovação no banco. */
function metadados() {
  const assinatura = { id: randomUUID(), nome: 'Assinante fictício' };
  return {
    emissaoId: randomUUID(), numero: 1, ano: 2026, numeroFormatado: 'N° 1P/2026',
    emitidoEm: '2026-11-01T12:00:00.000Z', dataEmissao: '2026-11-01',
    regra: { id: randomUUID(), codigo: 'FICTICIA', versao: '1' },
    aprovacao: { id: randomUUID(), aprovadoPor: 'Aprovador fictício', referenciaDecisao: 'SOMENTE TESTE', aprovadoEm: '2026-11-01T12:00:00.000Z' },
    assinaturas: { autor: assinatura, conferente: assinatura, emitente: assinatura },
  };
}

/** Monta snapshot DOF validado com 45 anos e texto HTML fictício para testar formulário e escape. */
export function snapshotDofModelo(): SnapshotEmissaoDof {
  const previa = previaDofSintetica();
  const { documentoId: _id, revisao: _revisao, provaFonte: _prova, ...fonte } = previa.fonte;
  return snapshotEmissaoDofSchema.parse({
    ...metadados(), classificacao: 'emissao', tipo: 'DOF', documentoId: previa.documentoId,
    revisao: previa.revisao, nome: previa.nome, matricula: previa.matricula, fonte,
    entrada: {
      pessoaId: randomUUID(), vinculoId: randomUUID(),
      inicio: previa.resultado.periodo.inicioInformado, fim: previa.resultado.periodo.fim,
      anos: previa.resultado.periodo.linhas.map(l => ({
        ano: l.ano, abrangencia: 'intervalo_declarado',
        faltas: 0, ts: 0, pf: 0, ip: 0, outros: 0, pb: 0, pv: 0, licencaPremio: 0,
      })), confirmacaoDados: true,
    },
    resultado: previa.resultado, blocos: previa.blocos, processo: '1234/2026',
    template: { id: randomUUID(), versao: TEMPLATES_OFICIAIS.DOF },
  });
}

/** Monta snapshot DTC validado para cada formulário sem dados pessoais de modelos ou produção. */
export function snapshotDtcModelo(tipo: TipoDtc): SnapshotEmissaoDtc {
  const conteudo: ConteudoDtc = {
    periodos: [{
      inicio: '2020-01-01', fim: '2021-12-31',
      anos: [2020, 2021].map(ano => ({
        ano, abrangencia: 'ano_civil', faltas: 0, ts: 0, pf: 0, ip: 0, outros: 0, pb: 0, pv: 0, licencaPremio: 0,
      })),
      cargo: tipo === 'DTC_INSS' ? 'Cargo fictício <img src=x>' : null,
      categoria: tipo === 'DTC_INSS' ? 'servico_prestado' : null,
    }],
    cargos: tipo === 'DTC_COMISSIONADO' ? [{
      cargo: 'Cargo fictício', decretoNomeacao: 'Ato fictício', publicacaoNomeacao: 'Publicação fictícia',
      dataEntradaExercicio: '2020-01-01', decretoExoneracao: null, publicacaoExoneracao: null, dataEncerramento: null,
    }] : [],
    inss: tipo === 'DTC_INSS' ? {
      licencas: { possui: false, descricao: null },
      documentacao: { nomeacao: true, ctps: false, folha: true, frequencia: false, outros: null },
      observacao: OBSERVACAO_PADRAO_INSS,
    } : null,
    processo: '1234/2026', confirmarInicioAjustado: false,
  };
  const calculo = calcularDtc(tipo, conteudo, '2020-01-01', '2026-11-01');
  if ('erro' in calculo) throw new Error(calculo.erro);
  const nome = 'Pessoa fictícia <script>fictício</script>';
  return snapshotEmissaoDtcSchema.parse({
    ...metadados(), classificacao: 'emissao', tipo, documentoId: randomUUID(), revisao: 2,
    nome, matricula: 'FICTICIA', conteudo, resultado: calculo.resultado, processo: conteudo.processo,
    fonte: {
      consultadoEm: '2026-11-01T12:00:00.000Z', nome, matricula: 'FICTICIA', cpf: cpfSintetico(),
      nascimento: '1980-01-01', nomeMae: 'Mãe fictícia', nomePai: 'Pai fictício', rg: 'RG FICTICIO',
      rgOrgao: 'Órgão fictício', rgExpedicao: '2000-01-01', pisPasep: null, tituloEleitor: null, endereco: 'Endereço fictício',
      regimeJuridico: 'ESTATUTARIO', cargo: 'Cargo fictício', referencia: 'A', orgao: 'Órgão fictício',
      admissao: '2020-01-01', periodosIpam: [{ inicio: '2020-01-01', fim: '2021-12-31' }], removidoNaFonte: false,
    },
    template: { id: randomUUID(), versao: TEMPLATES_OFICIAIS[tipo] },
  });
}
