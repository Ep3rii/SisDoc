import { z } from 'zod';
import { papelSchema } from './dominio';
import { limitePaginaSchema } from './paginacao';

const matricula = z.string().trim().min(1).max(100);
const senhaInformada = z.string().min(1).max(1024);
const senhaNova = z.string().min(12).max(1024);

export const loginSchema = z.strictObject({
  matricula,
  senha: senhaInformada,
});

export const trocarSenhaSchema = z.strictObject({
  senhaAtual: senhaInformada,
  senhaNova,
});

export const criarUsuarioSchema = z.strictObject({
  matricula,
  nome: z.string().trim().min(3).max(200),
  email: z.email().max(254).nullable().optional(),
  papel: papelSchema,
  senha: senhaNova,
});

export const atualizarUsuarioSchema = z.strictObject({
  nome: z.string().trim().min(3).max(200).optional(),
  email: z.email().max(254).nullable().optional(),
  papel: papelSchema.optional(),
  ativo: z.boolean().optional(),
}).refine((dados) => Object.keys(dados).length > 0, 'Informe ao menos um campo para alteração.');

export const redefinirSenhaSchema = z.strictObject({ senha: senhaNova });

export const paginaUsuariosQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  limite: limitePaginaSchema,
});

export const paginaAuditoriaQuerySchema = z.strictObject({
  cursor: z.string().regex(/^[1-9]\d{0,18}$/)
    .refine((valor) => BigInt(valor) <= 9223372036854775807n).optional(),
  limite: limitePaginaSchema,
});

export const usuarioSessaoSchema = z.strictObject({
  id: z.uuid(),
  matricula: z.string(),
  nome: z.string(),
  papel: papelSchema,
  trocaSenhaObrigatoria: z.boolean(),
});

export const respostaSessaoSchema = z.strictObject({
  usuario: usuarioSessaoSchema,
  csrf: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export const usuarioAdministrativoSchema = usuarioSessaoSchema.extend({
  email: z.email().nullable(),
  ativo: z.boolean(),
});

export const paginaUsuariosSchema = z.strictObject({
  itens: z.array(usuarioAdministrativoSchema),
  proximoCursor: z.uuid().nullable(),
});

export const paginaAuditoriaSchema = z.strictObject({
  itens: z.array(z.strictObject({
    id: z.string(),
    usuarioId: z.uuid().nullable(),
    acao: z.string(),
    entidade: z.string(),
    entidadeId: z.uuid().nullable(),
    em: z.iso.datetime(),
  })),
  proximoCursor: z.string().nullable(),
});

export type CriarUsuario = z.infer<typeof criarUsuarioSchema>;
export type AtualizarUsuario = z.infer<typeof atualizarUsuarioSchema>;
export type RespostaSessao = z.infer<typeof respostaSessaoSchema>;
export type UsuarioAdministrativo = z.infer<typeof usuarioAdministrativoSchema>;
export type PaginaUsuarios = z.infer<typeof paginaUsuariosSchema>;
export type PaginaAuditoria = z.infer<typeof paginaAuditoriaSchema>;
