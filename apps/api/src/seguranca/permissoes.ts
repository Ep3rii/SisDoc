import { papelSchema } from '@sisdoc/contratos';
import { z } from 'zod';

export type Papel = z.infer<typeof papelSchema>;

const matriz = {
  consultar_pessoa: ['analista', 'coordenador', 'admin'],
  calcular: ['analista', 'coordenador', 'admin'],
  consultar_documentos: ['analista', 'coordenador', 'admin'],
  administrar_documentos: ['admin'],
  criar_rascunho: ['analista', 'coordenador'],
  editar_rascunho: ['analista', 'coordenador', 'admin'],
  receber_encaminhamento: ['coordenador', 'admin'],
  conferir: ['analista', 'coordenador', 'admin'],
  emitir: ['coordenador', 'admin'],
  cancelar_rascunho: ['analista', 'coordenador', 'admin'],
  cancelar_emitido: ['admin'],
  consultar_emissoes: ['analista', 'coordenador', 'admin'],
  historico_terceiros: ['coordenador', 'admin'],
  pesquisa_avancada: ['coordenador', 'admin'],
  gerenciar_blocos: ['admin'],
  gerenciar_templates: ['admin'],
  gerenciar_usuarios: ['admin'],
  consultar_auditoria: ['admin'],
  administrar_importacao: ['admin'],
  administrar_sincronizacao: ['admin'],
  editar_servidor: ['admin'],
  consultar_situacao_sincronizacao: ['analista', 'coordenador', 'admin'],
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
  if (acao === 'editar_rascunho') return true;
  if (acao === 'cancelar_rascunho') return proprio || papel === 'coordenador';
  return proprio || (papel === 'coordenador' && contexto.encaminhado);
}
