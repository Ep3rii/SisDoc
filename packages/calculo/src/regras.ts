import { z } from 'zod';

const inteiroNaoNegativo = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const escopo = z.enum(['vinculo', 'periodo']);

export const regrasVersaoSchema = z.strictObject({
  codigo: z.string().trim().min(1),
  versao: z.string().trim().min(1),
  classificacao: z.literal('provisoria'),
  diasAno: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  diasMes: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  limiteTs: inteiroNaoNegativo,
  limitePf: inteiroNaoNegativo,
  pfEntraNaSoma: z.boolean(),
  escopoPorTipo: z.strictObject({
    DOF: escopo,
    DTC_IPAM: escopo,
    DTC_COMISSIONADO: escopo,
    DTC_INSS: escopo,
  }),
}).refine((regra) => regra.diasMes <= regra.diasAno, {
  path: ['diasMes'],
  message: 'A base do mês não pode exceder a do ano.',
});

export type RegrasVersao = z.infer<typeof regrasVersaoSchema>;

const escoposPlanilha = Object.freeze({
  DOF: 'vinculo',
  DTC_IPAM: 'periodo',
  DTC_COMISSIONADO: 'periodo',
  DTC_INSS: 'periodo',
} as const);

export const REGRAS_PLANILHA = Object.freeze({
  codigo: 'planilha',
  versao: '1',
  classificacao: 'provisoria',
  diasAno: 365,
  diasMes: 30,
  limiteTs: 730,
  limitePf: 180,
  pfEntraNaSoma: true,
  escopoPorTipo: escoposPlanilha,
} as const);
