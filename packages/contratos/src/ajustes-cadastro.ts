import { z } from 'zod';
import { cpfSchema, dataFuncionalSchema } from './dominio';

const texto = z.string().trim().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/);
export const ajustesCadastroSchema = z.strictObject({
  nome: texto.optional(),
  matricula: texto.max(100).optional(),
  cpf: cpfSchema.optional(),
  nascimento: dataFuncionalSchema.nullable().optional(),
  nomeMae: texto.nullable().optional(),
  nomePai: texto.nullable().optional(),
  cargo: texto.nullable().optional(),
  regimeJuridico: texto.nullable().optional(),
  referencia: texto.nullable().optional(),
  orgao: texto.nullable().optional(),
  admissao: dataFuncionalSchema.optional(),
  pisPasep: texto.nullable().optional(),
  rg: texto.nullable().optional(),
  rgOrgao: texto.nullable().optional(),
  rgExpedicao: dataFuncionalSchema.nullable().optional(),
  tituloEleitor: texto.nullable().optional(),
  endereco: texto.max(500).nullable().optional(),
});
export type AjustesCadastro = z.infer<typeof ajustesCadastroSchema>;
export const CAMPOS_AJUSTE_CADASTRO: ReadonlyArray<[keyof AjustesCadastro, string, 'text' | 'date']> = [
  ['nome', 'Nome completo', 'text'], ['matricula', 'Matrícula', 'text'], ['cpf', 'CPF', 'text'],
  ['nascimento', 'Nascimento', 'date'], ['nomeMae', 'Nome da mãe', 'text'], ['nomePai', 'Nome do pai', 'text'],
  ['cargo', 'Cargo', 'text'], ['regimeJuridico', 'Regime jurídico', 'text'],
  ['referencia', 'Referência', 'text'], ['orgao', 'Órgão', 'text'], ['admissao', 'Admissão', 'date'],
  ['pisPasep', 'PIS/PASEP', 'text'], ['rg', 'RG', 'text'], ['rgOrgao', 'Órgão expedidor', 'text'],
  ['rgExpedicao', 'Expedição do RG', 'date'], ['tituloEleitor', 'Título de eleitor', 'text'], ['endereco', 'Endereço', 'text'],
];

export function aplicarAjustesCadastro<T extends { nome: string; matricula: string; admissao: string | null }>(
  fonte: T, ajustes: AjustesCadastro | undefined,
): T {
  return { ...fonte, ...Object.fromEntries(Object.entries(ajustes ?? {}).filter(([campo]) => campo in fonte)) };
}

export const sugestoesCadastroSchema = z.strictObject({
  itens: z.array(z.strictObject({
    documentoId: z.uuid(), tipo: z.string(), revisao: z.number().int().positive(),
    vinculoId: z.uuid(), atualizadoEm: z.iso.datetime(), ajustes: ajustesCadastroSchema,
  })),
  proximoCursor: z.uuid().nullable(),
});
export const notificacoesDeclaracoesSchema = z.strictObject({
  encaminhados: z.number().int().nonnegative(),
  retornos: z.number().int().nonnegative(),
});
export type NotificacoesDeclaracoes = z.infer<typeof notificacoesDeclaracoesSchema>;
export const retornosDeclaracoesSchema = z.strictObject({
  itens: z.array(z.strictObject({
    id: z.uuid(), tipo: z.enum(['DOF', 'DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS']),
    nome: z.string(), matricula: z.string(), devolvidoEm: z.iso.datetime(),
  })), proximoCursor: z.uuid().nullable(),
});
