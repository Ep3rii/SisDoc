import { z } from 'zod';
import { resultadoCalculoDofSchema, solicitarCalculoDofSchema } from './calculo';
import { dataFuncionalSchema } from './dominio';
import { mascaraProcessoSchema, numeroProcessoSchema } from './processo';

const motivoSchema = z.string().trim().min(1, 'Informe o motivo dos lançamentos.').max(2000);
const revisaoSchema = z.number().int().min(1).max(2147483647);

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

export const rascunhoDofSchema = resumoRascunhoDofSchema.extend({
  status: z.literal('rascunho'),
  admissao: dataFuncionalSchema.nullable(),
  criadoEm: z.iso.datetime(),
  entrada: solicitarCalculoDofSchema,
  resultado: resultadoCalculoDofSchema,
  blocos: blocosDofSchema,
  processo: numeroProcessoSchema.nullable(),
  mascarasProcesso: z.array(mascaraProcessoSchema).max(10),
});

export type AtualizarProcessoDof = z.infer<typeof atualizarProcessoDofSchema>;
export type BlocoRascunhoDof = z.infer<typeof blocoRascunhoDofSchema>;
export type AtualizarBlocosDof = z.infer<typeof atualizarBlocosDofSchema>;
export type CriarRascunhoDof = z.infer<typeof criarRascunhoDofSchema>;
export type AtualizarRascunhoDof = z.infer<typeof atualizarRascunhoDofSchema>;
export type PaginaRascunhosDof = z.infer<typeof paginaRascunhosDofSchema>;
export type RascunhoDof = z.infer<typeof rascunhoDofSchema>;
