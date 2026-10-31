import { z } from 'zod';
import { normalizarMatricula } from '@sisdoc/contratos';

const vinculoSchema = z.strictObject({
  id: z.uuid(),
  pessoaId: z.uuid(),
  matricula: z.string().trim().min(1),
  sistemaOrigem: z.string().trim().min(1),
  matriculaAnteriorId: z.uuid().nullable(),
});
const consultaSchema = z.strictObject({
  matricula: z.string().trim().min(1),
  sistemaOrigem: z.string().trim().min(1).optional(),
  vinculos: z.array(vinculoSchema),
});

export type VinculoParaConsulta = z.infer<typeof vinculoSchema>;
export type ResultadoVinculo =
  | { sucesso: true; atual: VinculoParaConsulta; historico: VinculoParaConsulta[] }
  | { sucesso: false; codigo: string; mensagem: string };

export function localizarVinculo(entrada: unknown): ResultadoVinculo {
  const resultado = consultaSchema.safeParse(entrada);
  if (!resultado.success) return { sucesso: false, codigo: 'entrada_invalida', mensagem: 'Dados da consulta inválidos.' };
  const { matricula, sistemaOrigem, vinculos } = resultado.data;
  const porId = new Map(vinculos.map((vinculo) => [vinculo.id, vinculo]));
  if (porId.size !== vinculos.length) return { sucesso: false, codigo: 'identificador_ambiguo', mensagem: 'Identificadores de vínculo duplicados.' };
  const encontrados = vinculos.filter((vinculo) =>
    normalizarMatricula(vinculo.matricula) === normalizarMatricula(matricula)
    && (!sistemaOrigem || vinculo.sistemaOrigem === sistemaOrigem));
  if (encontrados.length === 0) return { sucesso: false, codigo: 'matricula_incorreta', mensagem: 'Matrícula incorreta' };
  if (encontrados.length > 1) return { sucesso: false, codigo: 'matricula_ambigua', mensagem: 'Matrícula ambígua; selecione a origem.' };
  const atual = encontrados[0];
  const visitados = new Set([atual.id]);
  const historico = [atual];
  let anteriorId = atual.matriculaAnteriorId;
  while (anteriorId) {
    const anterior = porId.get(anteriorId);
    if (!anterior || anterior.pessoaId !== atual.pessoaId || visitados.has(anteriorId)) {
      return { sucesso: false, codigo: 'historico_inconsistente', mensagem: 'Histórico de matrícula incompleto ou inconsistente.' };
    }
    visitados.add(anteriorId);
    historico.unshift(anterior);
    anteriorId = anterior.matriculaAnteriorId;
  }
  return { sucesso: true, atual, historico };
}
