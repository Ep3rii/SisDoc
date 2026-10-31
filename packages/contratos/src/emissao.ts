import { z } from 'zod';
import { resultadoCalculoDofSchema, solicitarCalculoDofSchema } from './calculo';
import { tipoDocumentoSchema } from './dominio';
import { numeroProcessoSchema } from './processo';
import { blocoRascunhoDofSchema, dadosFontePreviaDofSchema, provaFonteDofSchema } from './rascunho-dof';

const revisaoSchema = z.number().int().min(1).max(2147483647);
const motivoSchema = z.string().trim().min(1, 'Informe o motivo.').max(2000);

export const grupoHistoricoSchema = z.enum(['DOF', 'DTC']);
export type GrupoHistorico = z.infer<typeof grupoHistoricoSchema>;

export const chaveIdempotenciaSchema = z.string().regex(/^[A-Za-z0-9._:-]{16,200}$/);

export const emitirDofSchema = z.strictObject({
  revisao: revisaoSchema,
  provaFonte: provaFonteDofSchema,
});

export const cancelarEmitidoSchema = z.strictObject({
  motivo: motivoSchema,
  confirmar: z.literal(true),
});

export const copiarEmitidoSchema = z.strictObject({
  confirmar: z.literal(true),
});

export const consultaHistoricoSchema = z.strictObject({
  tipo: grupoHistoricoSchema,
  escopo: z.enum(['proprio', 'todos']).default('proprio'),
});

export const statusPdfSchema = z.enum(['pendente', 'processando', 'concluido', 'falhou']);
export type StatusPdf = z.infer<typeof statusPdfSchema>;

const assinaturaSnapshotSchema = z.strictObject({
  id: z.uuid(),
  nome: z.string().min(1),
});

export const fonteEmissaoDofSchema = dadosFontePreviaDofSchema.omit({
  documentoId: true, revisao: true, provaFonte: true,
});

export const snapshotEmissaoDofSchema = z.strictObject({
  classificacao: z.literal('emissao'),
  tipo: z.literal('DOF'),
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
  fonte: fonteEmissaoDofSchema,
  entrada: solicitarCalculoDofSchema,
  resultado: resultadoCalculoDofSchema,
  blocos: z.array(blocoRascunhoDofSchema).max(200),
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
    autor: assinaturaSnapshotSchema,
    conferente: assinaturaSnapshotSchema,
    emitente: assinaturaSnapshotSchema,
  }),
}).superRefine((dados, contexto) => {
  if (dados.nome !== dados.fonte.nome || dados.matricula !== dados.fonte.matricula) {
    contexto.addIssue({ code: 'custom', message: 'A identidade do snapshot é inconsistente.' });
  }
  if (dados.entrada.inicio !== dados.resultado.periodo.inicioInformado || dados.entrada.fim !== dados.resultado.periodo.fim) {
    contexto.addIssue({ code: 'custom', message: 'O período do snapshot é inconsistente.' });
  }
});

export const situacaoEmissaoSchema = z.strictObject({
  emissaoId: z.uuid(),
  documentoId: z.uuid(),
  tipo: tipoDocumentoSchema,
  numero: z.string().min(1),
  emitidoEm: z.iso.datetime(),
  emitidoPorNome: z.string(),
  status: z.enum(['emitido', 'cancelado']),
  canceladoEm: z.iso.datetime().nullable(),
  pdf: z.strictObject({
    status: statusPdfSchema,
    tentativas: z.number().int().min(0),
    erro: z.string().nullable(),
    disponivel: z.boolean(),
  }),
});

export const itemHistoricoSchema = situacaoEmissaoSchema.extend({
  nome: z.string().nullable(),
  matricula: z.string().nullable(),
  podeCopiar: z.boolean(),
  podeCancelar: z.boolean(),
  podeBaixar: z.boolean(),
});

export const historicoEmissoesSchema = z.strictObject({
  grupo: grupoHistoricoSchema,
  escopo: z.enum(['proprio', 'todos']),
  itens: z.array(itemHistoricoSchema).max(50),
});

export const resultadoCopiaEmitidoSchema = z.strictObject({
  documentoId: z.uuid(),
  revisao: revisaoSchema,
  origemEmissaoId: z.uuid(),
});

export type EmitirDof = z.infer<typeof emitirDofSchema>;
export type CancelarEmitido = z.infer<typeof cancelarEmitidoSchema>;
export type CopiarEmitido = z.infer<typeof copiarEmitidoSchema>;
export type ConsultaHistorico = z.infer<typeof consultaHistoricoSchema>;
export type SnapshotEmissaoDof = z.infer<typeof snapshotEmissaoDofSchema>;
export type SituacaoEmissao = z.infer<typeof situacaoEmissaoSchema>;
export type ItemHistorico = z.infer<typeof itemHistoricoSchema>;
export type HistoricoEmissoes = z.infer<typeof historicoEmissoesSchema>;
export type ResultadoCopiaEmitido = z.infer<typeof resultadoCopiaEmitidoSchema>;
