import { z } from 'zod';

export * from './dominio';
export * from './autenticacao';

const porta = z.number().int().min(1).max(65535);
const chave = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);

export const configuracaoSchema = z.strictObject({
  porta,
  banco: z.strictObject({
    host: z.literal('127.0.0.1'),
    porta,
    nome: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(63),
    usuario: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(63),
    senha: z.string().min(1),
  }),
  tls: z.strictObject({
    certificado: z.string().min(1),
    chave: z.string().min(1),
    ca: z.string().min(1),
    nome: z.string().min(1),
  }),
  chaves: z.strictObject({
    cifra: chave,
    hmac: chave,
  }),
  seguranca: z.strictObject({
    listaSenhas: z.string().min(1),
  }).optional(),
});

export type Configuracao = z.infer<typeof configuracaoSchema>;
