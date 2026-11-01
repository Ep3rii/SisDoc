import {
  dataFuncionalSchema,
  type DadosFontePreviaDof,
  type RascunhoDof,
  type SolicitarCalculoDof
} from '@sisdoc/contratos';
import { type PoolClient } from 'pg';
import { z } from 'zod';
import { CHAVE_BLOQUEIO_FONTE_DOF } from '../migracoes/preconferencia-dof';

export type LinhaRascunho = {
  id: string;
  pessoa_id: string;
  vinculo_id: string;
  criado_por: string;
  nome: string;
  matricula: string;
  admissao: string | null;
  revisao: number;
  criado_em: Date;
  atualizado_em: Date;
  entrada_cifrada: Buffer;
  resultado_calculo_cifrado: Buffer | null;
  processo_cifrado: Buffer | null;
  confirmacao_inicio_cifrada: Buffer | null;
  regra_codigo: string;
  regra_versao: string;
  regra_atual: boolean;
};

export type Mudanca = { campo: string; anterior: unknown; novo: unknown };

export type LinhaEncaminhamento = {
  id: string;
  destinatario_id: string;
  destinatario_nome: string;
  destinatario_disponivel: boolean;
  encaminhado_em: Date;
};

export type RevisoesFonte = { pessoa_revisao: string; vinculo_revisao: string };

export type DadosPrevia = {
  conteudo: Omit<RascunhoDof, 'status'>;
  fonte: DadosFontePreviaDof;
  fonteSelecionadaAlterada: boolean | null;
};

export const confirmacaoInicioProtegidaSchema = z.strictObject({
  inicio: dataFuncionalSchema,
  admissao: dataFuncionalSchema,
  confirmadoPor: z.uuid(),
  confirmadoEm: z.iso.datetime(),
  perfilConfirmante: z.literal('admin').optional(),
});

/** Ordena anos antes de gravar para manter entrada e cálculo consistentes. */
export function entradaOrdenada(entrada: SolicitarCalculoDof): SolicitarCalculoDof {
  return { ...entrada, anos: [...entrada.anos].sort((a, b) => a.ano - b.ano) };
}

/** Tenta lock compartilhado transacional sem aguardar uma atualização da fonte em andamento. */
export async function tentarBloqueioFonte(cliente: PoolClient): Promise<boolean> {
  const bloqueio = await cliente.query<{ obtido: boolean }>(
    'SELECT pg_try_advisory_xact_lock_shared($1, $2) AS obtido', [...CHAVE_BLOQUEIO_FONTE_DOF],
  );
  return bloqueio.rows[0].obtido;
}

/** Identifica mudanças de período, acumulados e anos para registrar ajustes cifrados. */
export function mudancas(anterior: SolicitarCalculoDof | null, novo: SolicitarCalculoDof): Mudanca[] {
  const resultado: Mudanca[] = [];
  /** Inclui apenas valores efetivamente diferentes na lista auditável. */
  const adicionar = (campo: string, valorAnterior: unknown, valorNovo: unknown) => {
    if (JSON.stringify(valorAnterior) !== JSON.stringify(valorNovo)) {
      resultado.push({ campo, anterior: valorAnterior, novo: valorNovo });
    }
  };
  adicionar('periodo.inicio', anterior?.inicio ?? null, novo.inicio);
  adicionar('periodo.fim', anterior?.fim ?? null, novo.fim);
  adicionar('acumulado_anterior', anterior?.acumuladoAnterior ?? null, novo.acumuladoAnterior ?? null);
  const anteriores = new Map((anterior?.anos ?? []).map((ano) => [ano.ano, ano]));
  const novos = new Map(novo.anos.map((ano) => [ano.ano, ano]));
  const anos = new Set([...anteriores.keys(), ...novos.keys()]);
  for (const ano of [...anos].sort((a, b) => a - b)) {
    adicionar(`anos.${ano}`, anteriores.get(ano) ?? null, novos.get(ano) ?? null);
  }
  return resultado;
}
