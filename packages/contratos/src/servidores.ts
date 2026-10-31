import { z } from 'zod';
import { cpfSchema } from './dominio';
import { normalizarNomeBusca } from './identificadores';
import { limitePaginaSchema } from './paginacao';

const tipoBuscaSchema = z.enum(['nome', 'cpf', 'matricula']);

export const buscarServidoresQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/),
  tipo: tipoBuscaSchema.optional(),
  cursor: z.uuid().optional(),
  limite: limitePaginaSchema,
}).superRefine((dados, contexto) => {
  if (dados.tipo === 'nome' && normalizarNomeBusca(dados.q).length < 3) {
    contexto.addIssue({ code: 'custom', path: ['q'], message: 'Informe ao menos três caracteres para buscar por nome.' });
  }
  if (dados.tipo === 'cpf' && !cpfSchema.safeParse(dados.q).success) {
    contexto.addIssue({ code: 'custom', path: ['q'], message: 'Informe um CPF válido.' });
  }
  if (dados.tipo === 'matricula' && dados.q.length > 100) {
    contexto.addIssue({ code: 'custom', path: ['q'], message: 'Matrícula excede o limite permitido.' });
  }
});

export const eventosServidorQuerySchema = z.strictObject({
  vinculoId: z.uuid(),
  cursor: z.uuid().optional(),
  limite: limitePaginaSchema,
});

const dataOpcional = z.iso.date().nullable();

export const paginaBuscaServidoresSchema = z.strictObject({
  itens: z.array(z.strictObject({
    pessoaId: z.uuid(),
    vinculoId: z.uuid(),
    nome: z.string(),
    matricula: z.string(),
    orgao: z.string().nullable(),
    sistemaOrigem: z.string(),
    removidoNaFonte: z.boolean(),
  })),
  proximoCursor: z.uuid().nullable(),
});

export const detalheServidorSchema = z.strictObject({
  pessoa: z.strictObject({ id: z.uuid(), nome: z.string(), cpfMascarado: z.string().regex(/^\*\*\*\.\*\*\*\.\d{3}-\*\*$/) }),
  vinculos: z.array(z.strictObject({
    id: z.uuid(),
    matricula: z.string(),
    sistemaOrigem: z.string(),
    matriculaAnteriorId: z.uuid().nullable(),
    regimeJuridico: z.string().nullable(),
    cargo: z.string().nullable(),
    classe: z.string().nullable(),
    nivel: z.string().nullable(),
    referencia: z.string().nullable(),
    setor: z.string().nullable(),
    orgao: z.string().nullable(),
    admissao: dataOpcional,
    desligamento: dataOpcional,
    removidoNaFonte: z.boolean(),
  })),
  proximoCursor: z.uuid().nullable(),
});

export const paginaEventosServidorSchema = z.strictObject({
  itens: z.array(z.strictObject({
    id: z.uuid(),
    tipo: z.string(),
    dataEvento: dataOpcional,
    dataPublicacao: dataOpcional,
    atoTipo: z.string().nullable(),
    atoNumero: z.string().nullable(),
    fonte: z.string(),
    removidoNaFonte: z.boolean(),
  })),
  proximoCursor: z.uuid().nullable(),
});

export type BuscarServidoresQuery = z.infer<typeof buscarServidoresQuerySchema>;
export type TipoBuscaServidor = z.infer<typeof tipoBuscaSchema>;
export type PaginaBuscaServidores = z.infer<typeof paginaBuscaServidoresSchema>;
export type DetalheServidor = z.infer<typeof detalheServidorSchema>;
export type PaginaEventosServidor = z.infer<typeof paginaEventosServidorSchema>;
