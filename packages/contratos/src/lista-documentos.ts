import { z } from 'zod';
import { paginaConferidosDofSchema } from './rascunho-dof';

export const abaDocumentosSchema = z.enum(['rascunhos', 'encaminhadas', 'devolvidas', 'conferidas']);
export const ordemDocumentosSchema = z.enum(['nome', 'matricula', 'autor', 'situacao', 'atualizadoEm']);
export const consultaListaDocumentosSchema = z.strictObject({
  grupo: z.enum(['DOF', 'DTC']),
  aba: abaDocumentosSchema.default('rascunhos'),
  tipo: z.enum(['DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS']).optional(),
  ordem: ordemDocumentosSchema.default('atualizadoEm'),
  direcao: z.enum(['asc', 'desc']).default('desc'),
  limite: z.coerce.number().int().min(1).max(50).default(50),
  pagina: z.coerce.number().int().min(1).max(1000000).default(1),
}).refine((dados) => dados.grupo === 'DTC' || !dados.tipo, 'Tipo DTC só pode ser usado no grupo DTC.');

export const listaDocumentosSchema = z.strictObject({
  itens: z.array(z.strictObject({
    id: z.uuid(),
    pessoaId: z.uuid(),
    vinculoId: z.uuid(),
    tipo: z.enum(['DOF', 'DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS']),
    nome: z.string(),
    matricula: z.string(),
    autorNome: z.string(),
    situacao: abaDocumentosSchema,
    revisao: z.number().int().positive(),
    atualizadoEm: z.iso.datetime(),
    somenteLeitura: z.boolean(),
    conferenciaDof: paginaConferidosDofSchema.shape.itens.element.nullable(),
  })),
  contagens: z.strictObject({
    rascunhos: z.number().int().nonnegative(),
    encaminhadas: z.number().int().nonnegative(),
    devolvidas: z.number().int().nonnegative(),
    conferidas: z.number().int().nonnegative(),
  }),
  pagina: z.number().int().positive(),
  totalPaginas: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export type AbaDocumentos = z.infer<typeof abaDocumentosSchema>;
export type ConsultaListaDocumentos = z.infer<typeof consultaListaDocumentosSchema>;
export type ListaDocumentos = z.infer<typeof listaDocumentosSchema>;
