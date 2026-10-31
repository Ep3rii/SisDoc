import { z } from 'zod';

function dataValida(valor: string): boolean {
  const [ano, mes, dia] = valor.split('-').map(Number);
  if (ano < 1 || mes < 1 || mes > 12 || dia < 1) return false;
  const bissexto = ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0);
  const dias = [31, bissexto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return dia <= dias[mes - 1];
}

function cpfValido(cpf: string): boolean {
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  for (let posicao = 9; posicao <= 10; posicao += 1) {
    let soma = 0;
    for (let indice = 0; indice < posicao; indice += 1) {
      soma += Number(cpf[indice]) * (posicao + 1 - indice);
    }
    const digito = (soma * 10) % 11;
    if (Number(cpf[posicao]) !== (digito === 10 ? 0 : digito)) return false;
  }
  return true;
}

export const dataFuncionalSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data no formato AAAA-MM-DD.')
  .refine(dataValida, 'Informe uma data válida.');

export const cpfSchema = z.string().trim()
  .regex(/^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/, 'Informe um CPF no formato válido.')
  .transform((valor) => valor.replace(/[.-]/g, ''))
  .refine(cpfValido, 'Informe um CPF com dígitos verificadores válidos.');

export const tipoDocumentoSchema = z.enum(['DOF', 'DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS']);
export const estadoDocumentoSchema = z.enum(['rascunho', 'conferido', 'emitido', 'cancelado']);
export const papelSchema = z.enum(['analista', 'coordenador', 'secretario_adjunto', 'admin']);
export const tipoAfastamentoSchema = z.enum(['falta', 'licenca_ts', 'licenca_pf', 'licenca_ip', 'outro']);
export const tipoIncorporacaoSchema = z.enum(['PB', 'PV', 'LIC_PREMIO']);

export const periodoSchema = z.strictObject({
  inicio: dataFuncionalSchema,
  fim: dataFuncionalSchema,
  cargo: z.string().trim().min(1).optional(),
  categoria: z.string().trim().min(1).optional(),
  observacao: z.string().optional(),
}).refine((periodo) => periodo.fim >= periodo.inicio, {
  path: ['fim'],
  message: 'A data final não pode ser anterior à inicial.',
});

export const criarDocumentoSchema = z.strictObject({
  tipo: tipoDocumentoSchema,
  pessoaId: z.uuid(),
  vinculoId: z.uuid(),
  periodos: z.array(periodoSchema).min(1).max(4),
}).superRefine((documento, contexto) => {
  if (documento.tipo === 'DOF' && documento.periodos.length !== 1) {
    contexto.addIssue({ code: 'custom', path: ['periodos'], message: 'A DOF exige exatamente um período.' });
  }
  const ordenados = [...documento.periodos].sort((a, b) => a.inicio.localeCompare(b.inicio));
  for (let indice = 1; indice < ordenados.length; indice += 1) {
    if (ordenados[indice].inicio <= ordenados[indice - 1].fim) {
      contexto.addIssue({ code: 'custom', path: ['periodos'], message: 'Os períodos não podem se sobrepor.' });
      break;
    }
  }
});

export const ajusteCampoSchema = z.strictObject({
  campo: z.string().trim().min(1),
  valorOriginal: z.json().optional(),
  valorNovo: z.json(),
  motivo: z.string().trim().min(1, 'Informe o motivo do ajuste.'),
});

const intervaloSchema = z.strictObject({
  inicio: dataFuncionalSchema,
  fim: dataFuncionalSchema,
}).refine((intervalo) => intervalo.fim >= intervalo.inicio, {
  path: ['fim'],
  message: 'A data final não pode ser anterior à inicial.',
});

export const afastamentoSchema = z.discriminatedUnion('forma', [
  z.strictObject({
    forma: z.literal('anual'),
    tipo: tipoAfastamentoSchema,
    ano: z.number().int().min(1).max(9999),
    dias: z.number().int().min(0).max(366),
  }),
  z.strictObject({
    forma: z.literal('intervalo'),
    tipo: tipoAfastamentoSchema,
    intervalo: intervaloSchema,
  }),
]);

export const incorporacaoSchema = z.discriminatedUnion('forma', [
  z.strictObject({
    forma: z.literal('anual'),
    tipo: tipoIncorporacaoSchema,
    ano: z.number().int().min(1).max(9999),
    dias: z.number().int().min(0),
    origem: z.string().trim().min(1),
  }),
  z.strictObject({
    forma: z.literal('intervalo'),
    tipo: tipoIncorporacaoSchema,
    intervalo: intervaloSchema,
    convencao: z.enum(['inclusivo', 'exclusivo']),
    origem: z.string().trim().min(1),
  }),
]);
