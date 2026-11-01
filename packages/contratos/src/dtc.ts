import { z } from 'zod';
import { anoCalculoSchema, linhaAnualSchema, totaisCalculoSchema } from './calculo';
import { cpfSchema, dataFuncionalSchema } from './dominio';
import { numeroProcessoSchema } from './processo';

const revisaoSchema = z.number().int().min(1).max(2147483647);
export const provaFonteDtcSchema = z.string().regex(/^[0-9a-f]{64}$/);
const motivoSchema = z.string().trim().min(1, 'Informe o motivo da alteração.').max(2000);
const semControle = /^[^\x00-\x1f\x7f]*$/;
const textoCurto = z.string().trim().min(1).max(200).regex(semControle, 'Remova caracteres de controle.');
const textoLongo = z.string().trim().min(1).max(2000).regex(/^[^\x00-\x09\x0b-\x1f\x7f]*$/, 'Remova caracteres de controle.');

export const tipoDtcSchema = z.enum(['DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS']);
export type TipoDtc = z.infer<typeof tipoDtcSchema>;

export const ROTULOS_DTC: Readonly<Record<TipoDtc, string>> = Object.freeze({
  DTC_IPAM: 'DTC IPAM',
  DTC_COMISSIONADO: 'DTC Comissionado',
  DTC_INSS: 'DTC INSS',
});

export const MAXIMO_PERIODOS_DTC = 4;
export const MAXIMO_CARGOS_COMISSIONADOS = 3;
/** Observação descrita no guia (§ DTC INSS); demais textos do INSS seguem provisórios (decisão 023). */
export const OBSERVACAO_PADRAO_INSS = 'Contribuiu para o Instituto Nacional do Seguro Social — INSS, durante todo período contido nesta declaração.';

export const categoriaFuncionalInssSchema = z.enum(['efetivo', 'comissionado', 'contratado', 'servico_prestado']);
export type CategoriaFuncionalInss = z.infer<typeof categoriaFuncionalInssSchema>;
export const ROTULOS_CATEGORIA_INSS: Readonly<Record<CategoriaFuncionalInss, string>> = Object.freeze({
  efetivo: 'Efetivo/Estável',
  comissionado: 'Comissionado/Mandato Eletivo',
  contratado: 'Contratado',
  servico_prestado: 'Serviço Prestado',
});

export const periodoDtcSchema = z.strictObject({
  inicio: dataFuncionalSchema,
  fim: dataFuncionalSchema,
  anos: z.array(anoCalculoSchema).min(1).max(200),
  categoria: categoriaFuncionalInssSchema.nullable(),
  cargo: textoCurto.nullable(),
});

export const cargoComissionadoSchema = z.strictObject({
  cargo: textoCurto,
  decretoNomeacao: textoCurto,
  publicacaoNomeacao: textoCurto,
  dataEntradaExercicio: dataFuncionalSchema,
  decretoExoneracao: textoCurto.nullable(),
  publicacaoExoneracao: textoCurto.nullable(),
  dataEncerramento: dataFuncionalSchema.nullable(),
});

export const dadosInssSchema = z.strictObject({
  licencas: z.strictObject({
    possui: z.boolean(),
    descricao: textoLongo.nullable(),
  }),
  documentacao: z.strictObject({
    nomeacao: z.boolean(),
    ctps: z.boolean(),
    folha: z.boolean(),
    frequencia: z.boolean(),
    outros: textoCurto.nullable(),
  }),
  observacao: textoLongo.nullable(),
});

export const conteudoDtcSchema = z.strictObject({
  periodos: z.array(periodoDtcSchema).min(1).max(MAXIMO_PERIODOS_DTC),
  cargos: z.array(cargoComissionadoSchema).max(MAXIMO_CARGOS_COMISSIONADOS),
  inss: dadosInssSchema.nullable(),
  processo: numeroProcessoSchema.nullable(),
  confirmarInicioAjustado: z.boolean(),
});

export type PeriodoDtc = z.infer<typeof periodoDtcSchema>;
export type CargoComissionado = z.infer<typeof cargoComissionadoSchema>;
export type DadosInss = z.infer<typeof dadosInssSchema>;
export type ConteudoDtc = z.infer<typeof conteudoDtcSchema>;

/** Regras de forma por tipo, compartilhadas entre tela e servidor. */
export function validarConteudoDtc(tipo: TipoDtc, conteudo: ConteudoDtc): Array<{ caminho: string; mensagem: string }> {
  const problemas: Array<{ caminho: string; mensagem: string }> = [];
  const ordenados = conteudo.periodos.map((periodo, indice) => ({ ...periodo, indice }))
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
  for (const [posicao, periodo] of ordenados.entries()) {
    if (periodo.fim < periodo.inicio) {
      problemas.push({ caminho: `periodos.${periodo.indice}.fim`, mensagem: `O fim do ${periodo.indice + 1}º período é anterior ao início.` });
    }
    const anterior = ordenados[posicao - 1];
    if (anterior && periodo.inicio <= anterior.fim) {
      problemas.push({ caminho: `periodos.${periodo.indice}.inicio`, mensagem: 'Os períodos não podem se sobrepor.' });
    }
    if (tipo === 'DTC_INSS' && periodo.categoria === null) {
      problemas.push({ caminho: `periodos.${periodo.indice}.categoria`, mensagem: `Informe a categoria funcional do ${periodo.indice + 1}º período.` });
    }
    if (tipo !== 'DTC_INSS' && periodo.categoria !== null) {
      problemas.push({ caminho: `periodos.${periodo.indice}.categoria`, mensagem: 'A categoria funcional só se aplica à DTC INSS.' });
    }
    if (tipo === 'DTC_INSS' && periodo.cargo === null) {
      problemas.push({ caminho: `periodos.${periodo.indice}.cargo`, mensagem: `Informe o cargo/função do ${periodo.indice + 1}º período.` });
    }
    if (tipo !== 'DTC_INSS' && periodo.cargo !== null) {
      problemas.push({ caminho: `periodos.${periodo.indice}.cargo`, mensagem: 'O cargo/função por período só se aplica à DTC INSS.' });
    }
  }
  if (tipo === 'DTC_COMISSIONADO' && conteudo.cargos.length < 1) {
    problemas.push({ caminho: 'cargos', mensagem: 'Informe ao menos um cargo em comissão (até três).' });
  }
  if (tipo !== 'DTC_COMISSIONADO' && conteudo.cargos.length > 0) {
    problemas.push({ caminho: 'cargos', mensagem: 'Cargos em comissão só se aplicam à DTC Comissionado.' });
  }
  for (const [indice, cargo] of conteudo.cargos.entries()) {
    const saida = [cargo.decretoExoneracao, cargo.publicacaoExoneracao, cargo.dataEncerramento];
    if (saida.some((valor) => valor !== null) && saida.some((valor) => valor === null)) {
      problemas.push({
        caminho: `cargos.${indice}.decretoExoneracao`,
        mensagem: `No ${indice + 1}º cargo, informe decreto, publicação e data de encerramento juntos, ou nenhum deles.`,
      });
    }
    if (cargo.dataEncerramento !== null && cargo.dataEncerramento < cargo.dataEntradaExercicio) {
      problemas.push({ caminho: `cargos.${indice}.dataEncerramento`, mensagem: `No ${indice + 1}º cargo, o encerramento é anterior à entrada em exercício.` });
    }
  }
  if (tipo === 'DTC_INSS') {
    if (!conteudo.inss) {
      problemas.push({ caminho: 'inss', mensagem: 'Informe licenças, documentação-base e observações da DTC INSS.' });
    } else {
      if (conteudo.inss.licencas.possui && !conteudo.inss.licencas.descricao) {
        problemas.push({ caminho: 'inss.licencas.descricao', mensagem: 'Descreva as licenças/afastamentos (períodos e tipo).' });
      }
      if (!conteudo.inss.licencas.possui && conteudo.inss.licencas.descricao) {
        problemas.push({ caminho: 'inss.licencas.descricao', mensagem: 'Remova a descrição ou marque que há licenças.' });
      }
      const documentacao = conteudo.inss.documentacao;
      if (!documentacao.nomeacao && !documentacao.ctps && !documentacao.folha && !documentacao.frequencia && !documentacao.outros) {
        problemas.push({ caminho: 'inss.documentacao', mensagem: 'Indique ao menos uma documentação-base.' });
      }
    }
  } else if (conteudo.inss) {
    problemas.push({ caminho: 'inss', mensagem: 'Os dados de INSS só se aplicam à DTC INSS.' });
  }
  return problemas;
}

/** Converte problemas de forma por tipo em erros Zod localizados no campo original. */
function refinarPorTipo(tipo: TipoDtc, conteudo: ConteudoDtc, contexto: z.RefinementCtx): void {
  for (const problema of validarConteudoDtc(tipo, conteudo)) {
    contexto.addIssue({ code: 'custom', path: problema.caminho.split('.'), message: problema.mensagem });
  }
}

export const criarDtcSchema = conteudoDtcSchema.extend({
  tipo: tipoDtcSchema,
  pessoaId: z.uuid(),
  vinculoId: z.uuid(),
  confirmacaoDados: z.literal(true),
}).superRefine((dados, contexto) => refinarPorTipo(dados.tipo, dados, contexto));

export const atualizarDtcSchema = conteudoDtcSchema.extend({
  revisao: revisaoSchema,
  motivo: motivoSchema,
});

export const consultaDtcSchema = z.strictObject({
  estado: z.enum(['rascunho', 'conferido']).default('rascunho'),
  tipo: tipoDtcSchema.optional(),
});

const avisoSchema = z.strictObject({
  codigo: z.string(),
  mensagem: z.string(),
  periodo: z.number().int().optional(),
  ano: z.number().int().optional(),
});

export const codigoLinhaTotalDtcSchema = z.enum([
  'total_contribuicao', 'efetivo_exercicio', 'incorporacao_pb', 'incorporacao_pv', 'incorporacao_pb_pv', 'licenca_premio',
]);

export const linhaTotalDtcSchema = z.strictObject({
  codigo: codigoLinhaTotalDtcSchema,
  rotulo: z.string().min(1),
  dias: z.number().int().min(0),
  anos: z.number().int().min(0),
  meses: z.number().int().min(0),
  diasRestantes: z.number().int().min(0),
  texto: z.string(),
  provisoria: z.boolean(),
});

export const periodoCalculadoDtcSchema = z.strictObject({
  ordem: z.number().int().min(1).max(MAXIMO_PERIODOS_DTC),
  inicioInformado: dataFuncionalSchema,
  inicioEfetivo: dataFuncionalSchema,
  fim: dataFuncionalSchema,
  linhas: z.array(linhaAnualSchema).min(1),
  excessoTs: z.number().int().min(0),
  excessoPf: z.number().int().min(0),
  totais: totaisCalculoSchema,
});

export const resultadoCalculoDtcSchema = z.strictObject({
  tipo: tipoDtcSchema,
  admissaoConsiderada: dataFuncionalSchema,
  regra: z.strictObject({
    codigo: z.string().min(1),
    versao: z.string().min(1),
    classificacao: z.literal('provisoria'),
  }),
  periodos: z.array(periodoCalculadoDtcSchema).min(1).max(MAXIMO_PERIODOS_DTC),
  totais: totaisCalculoSchema,
  textoPeriodos: z.string(),
  textoTotal: z.string(),
  linhasTotais: z.array(linhaTotalDtcSchema).length(6),
  avisos: z.array(avisoSchema),
});

export const fonteDtcSchema = z.strictObject({
  documentoId: z.uuid(),
  revisao: revisaoSchema,
  provaFonte: provaFonteDtcSchema,
  consultadoEm: z.iso.datetime(),
  nome: z.string(),
  matricula: z.string(),
  cpf: cpfSchema,
  nascimento: dataFuncionalSchema.nullable(),
  nomeMae: z.string().nullable(),
  nomePai: z.string().nullable(),
  rg: z.string().nullable(),
  rgOrgao: z.string().nullable(),
  rgExpedicao: dataFuncionalSchema.nullable(),
  pisPasep: z.string().nullable(),
  tituloEleitor: z.string().nullable(),
  endereco: z.string().nullable(),
  regimeJuridico: z.string().nullable(),
  cargo: z.string().nullable(),
  referencia: z.string().nullable(),
  orgao: z.string().nullable(),
  admissao: dataFuncionalSchema.nullable(),
  periodosIpam: z.array(z.strictObject({ inicio: dataFuncionalSchema, fim: dataFuncionalSchema })).max(50),
  removidoNaFonte: z.boolean(),
});

export const fonteEmissaoDtcSchema = fonteDtcSchema.omit({ documentoId: true, revisao: true, provaFonte: true });

export const documentoDtcSchema = z.strictObject({
  id: z.uuid(),
  tipo: tipoDtcSchema,
  pessoaId: z.uuid(),
  vinculoId: z.uuid(),
  nome: z.string(),
  matricula: z.string(),
  admissao: dataFuncionalSchema.nullable(),
  status: z.enum(['rascunho', 'conferido']),
  revisao: revisaoSchema,
  criadoEm: z.iso.datetime(),
  atualizadoEm: z.iso.datetime(),
  autorNome: z.string(),
  conferidoPorNome: z.string().nullable(),
  conferidoEm: z.iso.datetime().nullable(),
  conteudo: conteudoDtcSchema,
  resultado: resultadoCalculoDtcSchema,
  mascarasProcesso: z.array(z.string()),
  pendencias: z.array(z.string()),
});

export const resumoDtcSchema = documentoDtcSchema.pick({
  id: true, tipo: true, nome: true, matricula: true, status: true, revisao: true, atualizadoEm: true, autorNome: true,
});

export const paginaDtcSchema = z.strictObject({
  itens: z.array(resumoDtcSchema).max(50),
});

export const previaDtcSchema = z.strictObject({
  documento: documentoDtcSchema,
  fonte: fonteDtcSchema,
  fonteSelecionadaAlterada: z.boolean().nullable(),
});

export const conferirDtcSchema = z.strictObject({
  revisao: revisaoSchema,
  provaFonte: provaFonteDtcSchema,
  confirmar: z.literal(true),
});

export const devolverDtcSchema = z.strictObject({
  revisao: revisaoSchema,
  motivo: motivoSchema,
});

export const emitirDtcSchema = z.strictObject({
  revisao: revisaoSchema,
  provaFonte: provaFonteDtcSchema,
});

export const resultadoTransicaoDtcSchema = z.strictObject({
  documentoId: z.uuid(),
  revisao: revisaoSchema,
  status: z.enum(['rascunho', 'conferido']),
});

const assinaturaSchema = z.strictObject({ id: z.uuid(), nome: z.string().min(1) });

export const snapshotEmissaoDtcSchema = z.strictObject({
  classificacao: z.literal('emissao'),
  tipo: tipoDtcSchema,
  documentoId: z.uuid(),
  emissaoId: z.uuid(),
  revisao: revisaoSchema,
  numero: z.number().int().min(1),
  ano: z.number().int().min(1).max(9999),
  numeroFormatado: z.string().min(1),
  emitidoEm: z.iso.datetime(),
  dataEmissao: z.iso.date(),
  nome: z.string().min(1),
  matricula: z.string().min(1),
  fonte: fonteEmissaoDtcSchema,
  conteudo: conteudoDtcSchema,
  resultado: resultadoCalculoDtcSchema,
  processo: numeroProcessoSchema,
  regra: z.strictObject({ id: z.uuid(), codigo: z.string().min(1), versao: z.string().min(1) }),
  template: z.strictObject({ id: z.uuid(), versao: z.string().min(1) }),
  aprovacao: z.strictObject({
    id: z.uuid(),
    aprovadoPor: z.string().min(1),
    referenciaDecisao: z.string().min(1),
    aprovadoEm: z.iso.datetime(),
  }),
  assinaturas: z.strictObject({
    autor: assinaturaSchema,
    conferente: assinaturaSchema,
    emitente: assinaturaSchema,
  }),
}).superRefine((dados, contexto) => {
  if (dados.nome !== dados.fonte.nome || dados.matricula !== dados.fonte.matricula || dados.tipo !== dados.resultado.tipo) {
    contexto.addIssue({ code: 'custom', message: 'A identidade do snapshot é inconsistente.' });
  }
  if (dados.conteudo.periodos.length !== dados.resultado.periodos.length) {
    contexto.addIssue({ code: 'custom', message: 'Os períodos do snapshot são inconsistentes.' });
  }
});

export type CriarDtc = z.infer<typeof criarDtcSchema>;
export type AtualizarDtc = z.infer<typeof atualizarDtcSchema>;
export type ConsultaDtc = z.infer<typeof consultaDtcSchema>;
export type LinhaTotalDtc = z.infer<typeof linhaTotalDtcSchema>;
export type ResultadoCalculoDtc = z.infer<typeof resultadoCalculoDtcSchema>;
export type FonteDtc = z.infer<typeof fonteDtcSchema>;
export type FonteEmissaoDtc = z.infer<typeof fonteEmissaoDtcSchema>;
export type DocumentoDtc = z.infer<typeof documentoDtcSchema>;
export type ResumoDtc = z.infer<typeof resumoDtcSchema>;
export type PaginaDtc = z.infer<typeof paginaDtcSchema>;
export type PreviaDtc = z.infer<typeof previaDtcSchema>;
export type ConferirDtc = z.infer<typeof conferirDtcSchema>;
export type DevolverDtc = z.infer<typeof devolverDtcSchema>;
export type EmitirDtc = z.infer<typeof emitirDtcSchema>;
export type ResultadoTransicaoDtc = z.infer<typeof resultadoTransicaoDtcSchema>;
export type SnapshotEmissaoDtc = z.infer<typeof snapshotEmissaoDtcSchema>;
