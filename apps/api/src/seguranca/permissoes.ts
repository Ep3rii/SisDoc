import { papelSchema } from '@sisdoc/contratos';
import { z } from 'zod';

export type Papel = z.infer<typeof papelSchema>;

const matriz = {
  consultar_pessoa: ['analista', 'coordenador', 'secretario_adjunto'],
  calcular: ['analista', 'coordenador', 'secretario_adjunto'],
  criar_rascunho: ['analista', 'coordenador'],
  editar_rascunho: ['analista', 'coordenador'],
  conferir: ['analista', 'coordenador'],
  emitir: ['coordenador'],
  cancelar_rascunho: ['analista', 'coordenador'],
  cancelar_emitido: ['secretario_adjunto', 'admin'],
  historico_terceiros: ['coordenador', 'secretario_adjunto'],
  pesquisa_avancada: ['coordenador', 'secretario_adjunto'],
  gerenciar_blocos: ['admin'],
  gerenciar_templates: ['admin'],
  gerenciar_usuarios: ['admin'],
  consultar_auditoria: ['secretario_adjunto', 'admin'],
  administrar_importacao: ['admin'],
  sincronizar_individual: ['analista', 'coordenador'],
} as const satisfies Record<string, readonly Papel[]>;

export type Acao = keyof typeof matriz;
export const ACOES = Object.freeze(Object.keys(matriz) as Acao[]);

export function papeisPermitidos(acao: Acao): readonly Papel[] {
  return matriz[acao];
}

export function perfilPermiteAcao(papel: Papel, acao: Acao): boolean {
  return papeisPermitidos(acao).some((perfil) => perfil === papel);
}

export function permiteAcao(
  papel: Papel,
  acao: Acao,
  contexto?: { usuarioId: string; autorId: string; encaminhado: boolean },
): boolean {
  if (!perfilPermiteAcao(papel, acao)) return false;
  if (!['editar_rascunho', 'conferir', 'emitir', 'cancelar_rascunho'].includes(acao)) return true;
  if (!contexto) return false;
  const proprio = contexto.usuarioId === contexto.autorId;
  if (acao === 'editar_rascunho') return proprio;
  if (acao === 'cancelar_rascunho') return proprio || papel === 'coordenador';
  return proprio || (papel === 'coordenador' && contexto.encaminhado);
}
