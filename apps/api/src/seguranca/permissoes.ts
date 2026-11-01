import { papelSchema } from '@sisdoc/contratos';
import { z } from 'zod';

export type Papel = z.infer<typeof papelSchema>;

const matriz = {
  consultar_pessoa: ['analista', 'coordenador', 'secretario_adjunto', 'admin'],
  calcular: ['analista', 'coordenador', 'secretario_adjunto', 'admin'],
  criar_rascunho: ['analista', 'coordenador', 'admin'],
  editar_rascunho: ['analista', 'coordenador', 'admin'],
  receber_encaminhamento: ['coordenador', 'admin'],
  conferir: ['analista', 'coordenador', 'admin'],
  emitir: ['coordenador', 'admin'],
  cancelar_rascunho: ['analista', 'coordenador', 'admin'],
  cancelar_emitido: ['secretario_adjunto', 'admin'],
  consultar_emissoes: ['analista', 'coordenador', 'secretario_adjunto', 'admin'],
  historico_terceiros: ['coordenador', 'secretario_adjunto', 'admin'],
  pesquisa_avancada: ['coordenador', 'secretario_adjunto', 'admin'],
  gerenciar_blocos: ['admin'],
  gerenciar_templates: ['admin'],
  gerenciar_usuarios: ['admin'],
  consultar_auditoria: ['secretario_adjunto', 'admin'],
  administrar_importacao: ['admin'],
  administrar_sincronizacao: ['admin'],
  consultar_situacao_sincronizacao: ['analista', 'coordenador', 'secretario_adjunto', 'admin'],
  sincronizar_individual: ['analista', 'coordenador', 'admin'],
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
  if (papel === 'admin') return true;
  const proprio = contexto.usuarioId === contexto.autorId;
  if (acao === 'editar_rascunho') return proprio;
  if (acao === 'cancelar_rascunho') return proprio || papel === 'coordenador';
  return proprio || (papel === 'coordenador' && contexto.encaminhado);
}
