import { z } from 'zod';
import { dataFuncionalSchema } from './dominio';

const quantidade = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const anoCalculoSchema = z.strictObject({
  ano: z.number().int().min(1).max(9999),
  abrangencia: z.enum(['ano_civil', 'intervalo_declarado']),
  faltas: quantidade,
  ts: quantidade,
  pf: quantidade,
  ip: quantidade,
  outros: quantidade,
  pb: quantidade,
  pv: quantidade,
  licencaPremio: quantidade,
});

export const acumuladoAnteriorSchema = z.strictObject({
  ts: quantidade,
  pf: quantidade,
  origem: z.string().trim().min(1),
});

export const solicitarCalculoDofSchema = z.strictObject({
  pessoaId: z.uuid(),
  vinculoId: z.uuid(),
  inicio: dataFuncionalSchema,
  fim: dataFuncionalSchema,
  anos: z.array(anoCalculoSchema).min(1).max(9999),
  acumuladoAnterior: acumuladoAnteriorSchema.optional(),
  confirmacaoDados: z.literal(true),
}).refine((dados) => dados.fim >= dados.inicio, {
  path: ['fim'],
  message: 'A data final não pode ser anterior à inicial.',
});

export const linhaAnualSchema = z.strictObject({
  ano: z.number().int().min(1).max(9999),
  inicio: dataFuncionalSchema,
  fim: dataFuncionalSchema,
  diasBrutos: quantidade,
  faltas: quantidade,
  ts: quantidade,
  pf: quantidade,
  ip: quantidade,
  outros: quantidade,
  excessoTs: quantidade,
  excessoPf: quantidade,
  deducaoContribuicao: quantidade,
  deducaoExercicio: quantidade,
  contribuicao: quantidade,
  efetivoExercicio: quantidade,
  pb: quantidade,
  pv: quantidade,
  licencaPremio: quantidade,
});

export const totaisCalculoSchema = z.strictObject({
  diasBrutos: quantidade,
  contribuicaoMunicipio: quantidade,
  efetivoExercicio: quantidade,
  totalContribuicao: quantidade,
  pb: quantidade,
  pv: quantidade,
  licencaPremio: quantidade,
});

export const resultadoCalculoDofSchema = z.strictObject({
  admissaoConsiderada: dataFuncionalSchema,
  regra: z.strictObject({
    codigo: z.string().min(1),
    versao: z.string().min(1),
    classificacao: z.literal('provisoria'),
  }),
  periodo: z.strictObject({
    inicioInformado: dataFuncionalSchema,
    inicioEfetivo: dataFuncionalSchema,
    fim: dataFuncionalSchema,
    linhas: z.array(linhaAnualSchema).min(1),
  }),
  totais: totaisCalculoSchema,
  declaracao: z.array(z.string()),
  avisos: z.array(z.strictObject({
    codigo: z.string(),
    mensagem: z.string(),
    periodo: z.number().int().optional(),
    ano: z.number().int().optional(),
  })),
});

export type AnoCalculo = z.infer<typeof anoCalculoSchema>;
export type SolicitarCalculoDof = z.infer<typeof solicitarCalculoDofSchema>;
export type ResultadoCalculoDof = z.infer<typeof resultadoCalculoDofSchema>;
