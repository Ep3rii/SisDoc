import { z } from 'zod';
import { resultadoCalculoDofSchema, solicitarCalculoDofSchema } from './calculo';
import { cpfSchema, dataFuncionalSchema } from './dominio';
import { mascaraProcessoSchema, numeroProcessoSchema } from './processo';

const motivoSchema = z.string().trim().min(1, 'Informe o motivo dos lançamentos.').max(2000);
const revisaoSchema = z.number().int().min(1).max(2147483647);

export const provaFonteDofSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const codigoBlocoDofSchema = z.enum(['contratacao', 'transposicao', 'progressao', 'complementares']);
export type CodigoBlocoDof = z.infer<typeof codigoBlocoDofSchema>;
export const TITULOS_BLOCOS_DOF: Record<CodigoBlocoDof, string> = {
  contratacao: 'Contratação ou nomeação',
  transposicao: 'Transposição ou enquadramento',
  progressao: 'Progressão',
  complementares: 'Informações complementares',
};

export const blocoRascunhoDofSchema = z.strictObject({
  id: z.uuid(),
  codigo: codigoBlocoDofSchema,
  ativo: z.boolean(),
  texto: z.string().max(8000).regex(/^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/),
});

const blocosDofSchema = z.array(blocoRascunhoDofSchema).max(200).superRefine((blocos, contexto) => {
  if (new Set(blocos.map((bloco) => bloco.id)).size !== blocos.length) {
    contexto.addIssue({ code: 'custom', message: 'Identificadores de bloco devem ser únicos.' });
  }
  if (blocos.reduce((total, bloco) => total + bloco.texto.length, 0) > 20000) {
    contexto.addIssue({ code: 'custom', message: 'O texto total dos blocos excede o limite técnico.' });
  }
});

export const atualizarBlocosDofSchema = z.strictObject({
  revisao: revisaoSchema,
  motivo: motivoSchema,
  blocos: blocosDofSchema,
});

export const atualizarProcessoDofSchema = z.strictObject({
  revisao: revisaoSchema,
  motivo: motivoSchema,
  processo: numeroProcessoSchema.nullable(),
  confirmarRemocao: z.boolean().optional(),
}).superRefine((dados, contexto) => {
  if ((dados.processo === null) !== (dados.confirmarRemocao === true)) {
    contexto.addIssue({ code: 'custom', message: 'A remoção do processo exige confirmação explícita.' });
  }
});

export const encaminharRascunhoDofSchema = z.strictObject({
  revisao: revisaoSchema,
  destinatarioId: z.uuid(),
});

export const recolherRascunhoDofSchema = z.strictObject({
  revisao: revisaoSchema,
  motivo: motivoSchema,
});

export const devolverRascunhoDofSchema = recolherRascunhoDofSchema;

export const conferirDofSchema = z.strictObject({
  revisao: revisaoSchema,
  provaFonte: provaFonteDofSchema,
  provaRelatorio: provaFonteDofSchema,
  confirmar: z.literal(true),
});

export const devolverConferidoDofSchema = recolherRascunhoDofSchema;

export const resultadoConferenciaDofSchema = z.strictObject({
  documentoId: z.uuid(),
  revisao: revisaoSchema,
  status: z.literal('conferido'),
  conferidoEm: z.iso.datetime(),
});

export const resultadoDevolucaoConferidoDofSchema = z.strictObject({
  documentoId: z.uuid(),
  revisao: revisaoSchema,
  status: z.literal('rascunho'),
  devolvidoEm: z.iso.datetime(),
});

export const resultadoDevolucaoDofSchema = z.strictObject({
  documentoId: z.uuid(),
  revisao: revisaoSchema,
  devolvidoEm: z.iso.datetime(),
});

export const ultimaDevolucaoDofSchema = z.strictObject({
  documentoId: z.uuid(),
  revisao: revisaoSchema,
  devolucao: z.strictObject({
    coordenadorNome: z.string().min(1),
    devolvidoEm: z.iso.datetime(),
    motivo: motivoSchema,
  }).nullable(),
});

export const confirmarInicioDofSchema = z.strictObject({
  revisao: revisaoSchema,
  confirmar: z.literal(true),
});

export const criarRascunhoDofSchema = z.strictObject({
  calculo: solicitarCalculoDofSchema,
  admissaoEsperada: dataFuncionalSchema,
  motivo: motivoSchema,
});

export const atualizarRascunhoDofSchema = criarRascunhoDofSchema.extend({
  revisao: revisaoSchema,
  anosRemovidosConfirmados: z.array(z.number().int().min(1).max(9999)).max(9999)
    .refine((anos) => new Set(anos).size === anos.length).optional(),
});

const resumoRascunhoDofSchema = z.strictObject({
  id: z.uuid(),
  pessoaId: z.uuid(),
  vinculoId: z.uuid(),
  nome: z.string(),
  matricula: z.string(),
  revisao: revisaoSchema,
  atualizadoEm: z.iso.datetime(),
});

export const paginaRascunhosDofSchema = z.strictObject({
  itens: z.array(resumoRascunhoDofSchema),
  proximoCursor: z.uuid().nullable(),
});

export const paginaCoordenadoresDofSchema = z.strictObject({
  itens: z.array(z.strictObject({ id: z.uuid(), nome: z.string(), matricula: z.string() })),
  proximoCursor: z.uuid().nullable(),
});

export const paginaEncaminhamentosDofSchema = z.strictObject({
  itens: z.array(resumoRascunhoDofSchema.extend({
    autorNome: z.string(),
    encaminhadoEm: z.iso.datetime(),
  })),
  proximoCursor: z.uuid().nullable(),
});

export const paginaConferidosDofSchema = z.strictObject({
  itens: z.array(resumoRascunhoDofSchema.extend({
    autorNome: z.string(),
    conferidoPorNome: z.string(),
    conferidoEm: z.iso.datetime(),
    fonteSelecionadaAlterada: z.boolean(),
  })),
  proximoCursor: z.uuid().nullable(),
});

export const dadosFontePreviaDofSchema = z.strictObject({
  documentoId: z.uuid(),
  revisao: revisaoSchema,
  provaFonte: provaFonteDofSchema,
  consultadoEm: z.iso.datetime(),
  nome: z.string(),
  matricula: z.string(),
  cpf: cpfSchema,
  nascimento: dataFuncionalSchema.nullable(),
  nomeMae: z.string().nullable(),
  regimeJuridico: z.string().nullable(),
  cargo: z.string().nullable(),
  nivel: z.string().nullable(),
  avisoNivel: z.string().nullable(),
  referencia: z.string().nullable(),
  orgao: z.string().nullable(),
  admissao: dataFuncionalSchema.nullable(),
  removidoNaFonte: z.boolean(),
});

export const previaConferidaDofSchema = z.strictObject({
  documentoId: z.uuid(),
  revisao: revisaoSchema,
  status: z.literal('conferido'),
  nome: z.string(),
  matricula: z.string(),
  resultado: resultadoCalculoDofSchema,
  blocos: blocosDofSchema,
  processo: numeroProcessoSchema.nullable(),
  fonte: dadosFontePreviaDofSchema,
  fonteSelecionadaAlterada: z.boolean(),
}).superRefine((dados, contexto) => {
  if (dados.documentoId !== dados.fonte.documentoId || dados.revisao !== dados.fonte.revisao
      || dados.nome !== dados.fonte.nome || dados.matricula !== dados.fonte.matricula) {
    contexto.addIssue({ code: 'custom', message: 'A prévia conferida e os dados da fonte são inconsistentes.' });
  }
});

const fontePdfProvisorioDofSchema = dadosFontePreviaDofSchema.omit({
  documentoId: true, revisao: true, provaFonte: true,
});

export const dadosPdfProvisorioDofSchema = z.strictObject({
  classificacao: z.literal('provisorio'),
  documentoId: z.uuid(),
  revisao: revisaoSchema,
  nome: z.string().min(1),
  matricula: z.string().min(1),
  resultado: resultadoCalculoDofSchema,
  blocos: blocosDofSchema,
  processo: numeroProcessoSchema.nullable(),
  fonte: fontePdfProvisorioDofSchema,
  fonteSelecionadaAlterada: z.boolean(),
}).superRefine((dados, contexto) => {
  if (dados.nome !== dados.fonte.nome || dados.matricula !== dados.fonte.matricula) {
    contexto.addIssue({ code: 'custom', message: 'A identidade do PDF provisório é inconsistente.' });
  }
  if (dados.resultado.periodo.linhas.length > 9999) {
    contexto.addIssue({ code: 'custom', message: 'A tabela anual excede o limite técnico.' });
  }
});

/** Captura prévia validada para PDF provisório, removendo a prova transacional e sem emitir documento oficial. */
export function capturarDadosPdfProvisorioDof(entrada: PreviaConferidaDof): DadosPdfProvisorioDof {
  const previa = previaConferidaDofSchema.parse(entrada);
  const { documentoId: _documentoId, revisao: _revisao, provaFonte: _provaFonte, ...fonte } = previa.fonte;
  return dadosPdfProvisorioDofSchema.parse({
    classificacao: 'provisorio', documentoId: previa.documentoId, revisao: previa.revisao,
    nome: previa.nome, matricula: previa.matricula, resultado: previa.resultado, blocos: previa.blocos,
    processo: previa.processo, fonte, fonteSelecionadaAlterada: previa.fonteSelecionadaAlterada,
  });
}

const codigoPendenciaConferenciaDofSchema = z.enum([
  'cpf_indisponivel',
  'cpf_invalido',
  'cpf_hash_inconsistente',
  'nome_mae_indisponivel',
  'nome_mae_invalido',
  'matricula_inconsistente',
  'matricula_ambigua',
  'vinculo_removido',
  'admissao_ausente',
  'admissao_alterada',
  'nascimento_inconsistente',
  'periodo_inconsistente',
  'regra_incompativel',
  'calculo_invalido',
  'calculo_divergente',
  'processo_ausente',
  'mascaras_ausentes',
  'processo_invalido',
  'variaveis_ausentes',
  'variaveis_malformadas',
  'inicio_ajustado_sem_confirmacao',
  'campos_referencia_ausentes',
]);

const codigoAvisoConferenciaDofSchema = z.enum([
  'aprovacao_modelo_nao_verificada',
  'regra_provisoria',
  'dados_sem_data',
  'dados_antigos',
  'data_fonte_futura',
  'nivel_referencia',
]);

export const preconferenciaDofSchema = z.strictObject({
  documentoId: z.uuid(),
  revisao: revisaoSchema,
  verificadoEm: z.iso.datetime(),
  status: z.literal('nao_conferido'),
  conferenciaDisponivel: z.literal(true),
  fontePreviaValidada: z.boolean(),
  provaRelatorio: provaFonteDofSchema.nullable(),
  bloqueios: z.array(z.strictObject({ codigo: codigoPendenciaConferenciaDofSchema, mensagem: z.string().min(1) })),
  avisos: z.array(z.strictObject({ codigo: codigoAvisoConferenciaDofSchema, mensagem: z.string().min(1) })),
}).superRefine((dados, contexto) => {
  if (dados.fontePreviaValidada !== (dados.provaRelatorio !== null)) {
    contexto.addIssue({ code: 'custom', message: 'A prova do relatório exige uma prévia validada.' });
  }
  for (const itens of [dados.bloqueios, dados.avisos]) {
    if (new Set(itens.map((item) => item.codigo)).size !== itens.length) {
      contexto.addIssue({ code: 'custom', message: 'Códigos de pendência ou aviso devem ser únicos.' });
    }
  }
});

export const rascunhoDofSchema = resumoRascunhoDofSchema.extend({
  status: z.literal('rascunho'),
  admissao: dataFuncionalSchema.nullable(),
  criadoEm: z.iso.datetime(),
  entrada: solicitarCalculoDofSchema,
  resultado: resultadoCalculoDofSchema,
  inicioAjustadoConfirmado: z.boolean(),
  blocos: blocosDofSchema,
  processo: numeroProcessoSchema.nullable(),
  mascarasProcesso: z.array(mascaraProcessoSchema).max(10),
  encaminhamento: z.strictObject({
    destinatarioId: z.uuid(),
    destinatarioNome: z.string(),
    destinatarioDisponivel: z.boolean(),
    encaminhadoEm: z.iso.datetime(),
  }).nullable(),
}).superRefine((rascunho, contexto) => {
  if (rascunho.inicioAjustadoConfirmado
      && (rascunho.entrada.inicio >= rascunho.resultado.admissaoConsiderada
        || rascunho.admissao !== rascunho.resultado.admissaoConsiderada)) {
    contexto.addIssue({
      code: 'custom', path: ['inicioAjustadoConfirmado'],
      message: 'A confirmação exige início anterior à admissão atual utilizada no cálculo.',
    });
  }
});

export type AtualizarProcessoDof = z.infer<typeof atualizarProcessoDofSchema>;
export type BlocoRascunhoDof = z.infer<typeof blocoRascunhoDofSchema>;
export type AtualizarBlocosDof = z.infer<typeof atualizarBlocosDofSchema>;
export type CriarRascunhoDof = z.infer<typeof criarRascunhoDofSchema>;
export type AtualizarRascunhoDof = z.infer<typeof atualizarRascunhoDofSchema>;
export type EncaminharRascunhoDof = z.infer<typeof encaminharRascunhoDofSchema>;
export type RecolherRascunhoDof = z.infer<typeof recolherRascunhoDofSchema>;
export type DevolverRascunhoDof = z.infer<typeof devolverRascunhoDofSchema>;
export type DevolverConferidoDof = z.infer<typeof devolverConferidoDofSchema>;
export type ResultadoDevolucaoDof = z.infer<typeof resultadoDevolucaoDofSchema>;
export type ResultadoConferenciaDof = z.infer<typeof resultadoConferenciaDofSchema>;
export type ResultadoDevolucaoConferidoDof = z.infer<typeof resultadoDevolucaoConferidoDofSchema>;
export type UltimaDevolucaoDof = z.infer<typeof ultimaDevolucaoDofSchema>;
export type ConfirmarInicioDof = z.infer<typeof confirmarInicioDofSchema>;
export type ConferirDof = z.infer<typeof conferirDofSchema>;
export type PaginaCoordenadoresDof = z.infer<typeof paginaCoordenadoresDofSchema>;
export type PaginaEncaminhamentosDof = z.infer<typeof paginaEncaminhamentosDofSchema>;
export type PaginaConferidosDof = z.infer<typeof paginaConferidosDofSchema>;
export type PaginaRascunhosDof = z.infer<typeof paginaRascunhosDofSchema>;
export type DadosFontePreviaDof = z.infer<typeof dadosFontePreviaDofSchema>;
export type PreviaConferidaDof = z.infer<typeof previaConferidaDofSchema>;
export type DadosPdfProvisorioDof = z.infer<typeof dadosPdfProvisorioDofSchema>;
export type ProvaFontePreviaDof = Pick<DadosFontePreviaDof, 'documentoId' | 'revisao' | 'provaFonte'>;
export type PreconferenciaDof = z.infer<typeof preconferenciaDofSchema>;
export type RascunhoDof = z.infer<typeof rascunhoDofSchema>;
