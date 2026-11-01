import { z } from 'zod';

export const tipoImportacaoSchema = z.enum(['dados_funcionais', 'afastamentos', 'incorporacoes', 'periodos_ipam', 'eventos_funcionais']);
export type TipoImportacao = z.infer<typeof tipoImportacaoSchema>;

export const origemImportacaoSchema = z.string().trim().toLowerCase().regex(
  /^[a-z0-9][a-z0-9_.-]{0,62}$/,
  'A origem deve ter até 63 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.',
);

export const enviarImportacaoQuerySchema = z.strictObject({
  tipo: tipoImportacaoSchema,
  origem: origemImportacaoSchema,
  modo: z.enum(['validar', 'gravar']).default('validar'),
});
export type EnviarImportacaoQuery = z.infer<typeof enviarImportacaoQuerySchema>;

export const tipoOcorrenciaImportacaoSchema = z.enum(['rejeitada', 'quarentena', 'duplicada', 'divergencia', 'anomalia']);

export const ocorrenciaImportacaoSchema = z.strictObject({
  linha: z.number().int().min(0),
  tipo: tipoOcorrenciaImportacaoSchema,
  motivo: z.string(),
  referencia: z.string(),
});
export type OcorrenciaImportacao = z.infer<typeof ocorrenciaImportacaoSchema>;

export const contagensImportacaoSchema = z.strictObject({
  lidos: z.number().int().min(0),
  validos: z.number().int().min(0),
  rejeitados: z.number().int().min(0),
  duplicados: z.number().int().min(0),
  quarentena: z.number().int().min(0),
  anomalias: z.number().int().min(0),
  inseridos: z.number().int().min(0),
  atualizados: z.number().int().min(0),
  inalterados: z.number().int().min(0),
});
export type ContagensImportacao = z.infer<typeof contagensImportacaoSchema>;

export const relatorioImportacaoSchema = z.strictObject({
  loteId: z.uuid().nullable(),
  tipo: tipoImportacaoSchema,
  origem: z.string(),
  modo: z.enum(['validacao', 'gravacao']),
  loteExistente: z.uuid().nullable(),
  contagens: contagensImportacaoSchema,
  ocorrencias: z.array(ocorrenciaImportacaoSchema),
  ocorrenciasOmitidas: z.number().int().min(0),
  avisos: z.array(z.string()),
  duracaoMs: z.number().int().min(0),
});
export type RelatorioImportacao = z.infer<typeof relatorioImportacaoSchema>;

export const statusLoteImportacaoSchema = z.enum(['processando', 'concluido', 'falhou', 'desfeito']);

export const loteImportacaoSchema = z.strictObject({
  id: z.uuid(),
  tipo: tipoImportacaoSchema,
  origem: z.string(),
  canal: z.enum(['cli', 'tela', 'legado']),
  status: statusLoteImportacaoSchema,
  contagens: z.record(z.string(), z.number()),
  usuario: z.string(),
  iniciadoEm: z.string(),
  concluidoEm: z.string().nullable(),
  desfeitoEm: z.string().nullable(),
});
export type LoteImportacao = z.infer<typeof loteImportacaoSchema>;

export const paginaLotesImportacaoSchema = z.strictObject({
  itens: z.array(loteImportacaoSchema),
  proximoCursor: z.string().nullable(),
});
export type PaginaLotesImportacao = z.infer<typeof paginaLotesImportacaoSchema>;

export const paginaLotesImportacaoQuerySchema = z.strictObject({
  limite: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.iso.datetime({ offset: true }).optional(),
});

export const conferenciaImportacaoSchema = z.strictObject({
  origens: z.array(z.strictObject({
    origem: z.string(),
    pessoas: z.number().int().min(0),
    vinculos: z.number().int().min(0),
    afastamentos: z.number().int().min(0),
    incorporacoes: z.number().int().min(0),
    periodosIpam: z.number().int().min(0),
    eventos: z.number().int().min(0),
    removidosNaFonte: z.number().int().min(0),
  })),
  totais: z.strictObject({
    pessoas: z.number().int().min(0),
    vinculos: z.number().int().min(0),
  }),
});
export type ConferenciaImportacao = z.infer<typeof conferenciaImportacaoSchema>;

export function mascararCpf(cpf: string): string {
  const digitos = cpf.replace(/\D/g, '');
  return digitos.length === 11 ? `***.***.${digitos.slice(6, 9)}-**` : '***.***.***-**';
}

export function mascararMatricula(matricula: string): string {
  const valor = matricula.trim();
  if (valor.length <= 3) return '*'.repeat(valor.length);
  return `${'*'.repeat(valor.length - 3)}${valor.slice(-3)}`;
}
