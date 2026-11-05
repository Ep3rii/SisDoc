import { z } from 'zod';
import { dataFuncionalSchema } from './dominio';
import { origemImportacaoSchema } from './importacao';

const texto = z.string().trim().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/);
const opcional = texto.nullable();
export const valorMonetarioSchema = z.string().regex(/^(0|[1-9][0-9]{0,12})\.[0-9]{2}$/, 'Use valor não negativo, com ponto e duas casas decimais.');
export const registroHistoricoSchema = z.strictObject({
  grupo: z.enum(['funcional', 'financeiro']),
  tipo: z.enum(['ferias', 'licenca', 'abono_pecuniario', 'abono_permanencia', 'outro', 'lancamento']),
  situacao: z.enum(['informado', 'concedido', 'gozado', 'cancelado', 'previsto', 'pago', 'estornado']),
  inicio: dataFuncionalSchema.nullable(),
  fim: dataFuncionalSchema.nullable(),
  aquisitivoInicio: dataFuncionalSchema.nullable(),
  aquisitivoFim: dataFuncionalSchema.nullable(),
  diasInformados: z.number().int().min(0).max(3660).nullable(),
  especieLicenca: opcional,
  ato: opcional,
  descricao: z.string().trim().min(1).max(2000).regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*$/),
  efeitoTempo: z.enum(['nao_informado', 'sem_efeito', 'com_efeito']),
  efeitoRemuneracao: z.enum(['nao_informado', 'sem_efeito', 'com_efeito']),
  competencia: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/).nullable(),
  competenciaOrigem: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/).nullable(),
  pagamento: dataFuncionalSchema.nullable(),
  rubrica: opcional,
  natureza: z.enum(['provento', 'desconto']).nullable(),
  valor: valorMonetarioSchema.nullable(),
  folha: z.enum(['normal', 'complementar', 'retroativa']).nullable(),
  origem: origemImportacaoSchema,
  idOrigem: texto.max(100).nullable(),
  eventoId: z.uuid().nullable(),
  relacionadoId: z.uuid().nullable(),
}).superRefine((dados, contexto) => {
  const erro = (path: string, message: string) => contexto.addIssue({ code: 'custom', path: [path], message });
  if (dados.inicio && dados.fim && dados.fim < dados.inicio) erro('fim', 'O fim não pode anteceder o início.');
  if (dados.aquisitivoInicio && dados.aquisitivoFim && dados.aquisitivoFim < dados.aquisitivoInicio) erro('aquisitivoFim', 'Período aquisitivo invertido.');
  if ((dados.aquisitivoInicio === null) !== (dados.aquisitivoFim === null)) erro('aquisitivoInicio', 'Informe início e fim do período aquisitivo juntos.');
  if (dados.grupo === 'financeiro') {
    if (dados.tipo !== 'lancamento' || !dados.competencia || !dados.rubrica || !dados.natureza || !dados.valor || !dados.folha) erro('valor', 'Informe competência, rubrica, natureza, valor e modalidade da folha.');
    if (!['previsto', 'informado', 'pago', 'estornado'].includes(dados.situacao)) erro('situacao', 'Situação financeira inválida.');
    if (dados.situacao === 'pago' && !dados.pagamento) erro('pagamento', 'Pagamento confirmado exige data.');
    if (dados.folha === 'retroativa' && !dados.competenciaOrigem) erro('competenciaOrigem', 'Retroativo exige competência de origem.');
    if (dados.situacao === 'estornado' && !dados.relacionadoId) erro('relacionadoId', 'Estorno exige o lançamento relacionado.');
    if (dados.inicio || dados.fim || dados.aquisitivoInicio || dados.diasInformados !== null || dados.especieLicenca) erro('inicio', 'Dados funcionais pertencem ao registro relacionado, não ao lançamento financeiro.');
  } else {
    if (dados.tipo === 'lancamento' || !['informado', 'concedido', 'gozado', 'cancelado'].includes(dados.situacao)) erro('tipo', 'Tipo/situação funcional inválidos.');
    if (dados.tipo === 'ferias' && (!dados.inicio || !dados.fim || !dados.aquisitivoInicio)) erro('inicio', 'Férias exigem intervalo e período aquisitivo.');
    if (dados.tipo === 'licenca' && (!dados.inicio || !dados.fim || !dados.especieLicenca)) erro('especieLicenca', 'Licença exige espécie e intervalo.');
    if (dados.valor || dados.rubrica || dados.competencia || dados.competenciaOrigem || dados.natureza || dados.pagamento || dados.folha) erro('valor', 'Valores/pagamentos devem ser registrados separadamente no histórico financeiro.');
  }
});
export type RegistroHistorico = z.infer<typeof registroHistoricoSchema>;
export const salvarHistoricoSchema = z.strictObject({
  vinculoId: z.uuid(), registro: registroHistoricoSchema,
  motivo: z.string().trim().min(15).max(2000),
  revisao: z.number().int().positive().max(2147483646).optional(),
});
export const itemHistoricoServidorSchema = z.strictObject({
  id: z.uuid(), pessoaId: z.uuid(), vinculoId: z.uuid(), revisao: z.number().int().positive(),
  registro: registroHistoricoSchema, atualizadoEm: z.iso.datetime(),
  loteId: z.uuid().nullable(), linhaOrigem: z.number().int().positive().nullable(),
});
export const paginaHistoricoServidorSchema = z.strictObject({
  itens: z.array(itemHistoricoServidorSchema), proximoCursor: z.uuid().nullable(),
  totais: z.strictObject({
    registros: z.number().int().nonnegative(),
    proventosPagos: z.string().regex(/^[0-9]+\.[0-9]{2}$/),
    descontosPagos: z.string().regex(/^[0-9]+\.[0-9]{2}$/),
    proventosEstornados: z.string().regex(/^[0-9]+\.[0-9]{2}$/),
    descontosEstornados: z.string().regex(/^[0-9]+\.[0-9]{2}$/),
  }),
});
const competenciaFiltro = z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/);
export const consultaHistoricoServidorSchema = z.strictObject({
  vinculoId: z.uuid(), limite: z.coerce.number().int().min(1).max(100).default(50), cursor: z.uuid().optional(),
  grupo: z.enum(['funcional', 'financeiro']).optional(),
  competenciaInicio: competenciaFiltro.optional(), competenciaFim: competenciaFiltro.optional(),
  inicio: dataFuncionalSchema.optional(), fim: dataFuncionalSchema.optional(),
  rubrica: z.string().trim().min(1).max(200).optional(),
}).superRefine((dados, contexto) => {
  if (dados.inicio && dados.fim && dados.inicio > dados.fim)
    contexto.addIssue({ code: 'custom', path: ['fim'], message: 'Período invertido.' });
  if (dados.competenciaInicio && dados.competenciaFim && dados.competenciaInicio > dados.competenciaFim)
    contexto.addIssue({ code: 'custom', path: ['competenciaFim'], message: 'Competências invertidas.' });
});
export type ConsultaHistoricoServidor = z.infer<typeof consultaHistoricoServidorSchema>;
export function filtrarHistorico(registro: RegistroHistorico, consulta: ConsultaHistoricoServidor): boolean {
  if (consulta.grupo && registro.grupo !== consulta.grupo) return false;
  if (consulta.competenciaInicio && (!registro.competencia || registro.competencia < consulta.competenciaInicio)) return false;
  if (consulta.competenciaFim && (!registro.competencia || registro.competencia > consulta.competenciaFim)) return false;
  const inicio = registro.grupo === 'financeiro' ? registro.pagamento : registro.inicio;
  const fim = registro.grupo === 'financeiro' ? registro.pagamento : registro.fim ?? registro.inicio;
  if (consulta.inicio && (!fim || fim < consulta.inicio)) return false;
  if (consulta.fim && (!inicio || inicio > consulta.fim)) return false;
  return !consulta.rubrica || (registro.rubrica ?? '').toLocaleLowerCase('pt-BR').includes(consulta.rubrica.toLocaleLowerCase('pt-BR'));
}
export const resultadoHistoricoServidorSchema = z.strictObject({
  item: itemHistoricoServidorSchema, avisos: z.array(z.string()),
});
export const alteracaoHistoricoSchema = z.strictObject({
  anterior: registroHistoricoSchema.nullable(), novo: registroHistoricoSchema,
  motivo: z.string().trim().min(15).max(2000),
});
export const revisoesHistoricoSchema = z.strictObject({
  itens: z.array(z.strictObject({
    id: z.uuid(), em: z.iso.datetime(), autor: z.string(), alteracao: alteracaoHistoricoSchema,
  })),
  proximoCursor: z.uuid().nullable(),
});
export const importarHistoricoQuerySchema = z.strictObject({
  vinculoId: z.uuid(), grupo: z.enum(['funcional', 'financeiro']), origem: origemImportacaoSchema, modo: z.enum(['validar','gravar']),
  aba: z.string().min(1).max(200).optional(),
  validacao: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).refine((dados) => dados.modo !== 'gravar' || !!dados.validacao, 'Valide o arquivo antes de gravar.');
export const relatorioImportacaoHistoricoSchema = z.strictObject({
  modo: z.enum(['validar','gravar']), validacao: z.string().regex(/^[0-9a-f]{64}$/),
  inseridos: z.number().int().nonnegative(), inalterados: z.number().int().nonnegative(),
  divergentes: z.number().int().nonnegative(), rejeitados: z.number().int().nonnegative(),
  ocorrencias: z.array(z.strictObject({ linha: z.number().int().positive(), motivo: z.string() })),
  loteId: z.uuid().nullable(),
});
export function somarValoresMonetarios(valores: string[]): string {
  const centavos = valores.reduce((total, valor) => {
    const [inteiro, fracao] = valorMonetarioSchema.parse(valor).split('.');
    return total + BigInt(inteiro) * 100n + BigInt(fracao);
  }, 0n);
  return `${centavos / 100n}.${String(centavos % 100n).padStart(2, '0')}`;
}
