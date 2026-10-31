import { z } from 'zod';
import { resultadoCalculoDofSchema, solicitarCalculoDofSchema } from './calculo';
import { dataFuncionalSchema } from './dominio';

const motivoSchema = z.string().trim().min(1, 'Informe o motivo dos lançamentos.').max(2000);
const revisaoSchema = z.number().int().min(1).max(2147483647);

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
});

export type CriarRascunhoDof = z.infer<typeof criarRascunhoDofSchema>;
export type AtualizarRascunhoDof = z.infer<typeof atualizarRascunhoDofSchema>;
export type PaginaRascunhosDof = z.infer<typeof paginaRascunhosDofSchema>;
export type RascunhoDof = z.infer<typeof rascunhoDofSchema>;
