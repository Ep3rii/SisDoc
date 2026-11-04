import { describe, expect, it } from 'vitest';
import { ACOES, perfilPermiteAcao, permiteAcao, type Acao, type Papel } from '../apps/api/dist/seguranca/permissoes.js';

const papeis: Papel[] = ['analista', 'coordenador', 'admin'];
const esperado: Record<Acao, Papel[]> = {
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
};

describe('matriz de perfis', () => {
  it('cobre todas as ações sem conceder acesso funcional por hierarquia', () => {
    expect([...ACOES].sort()).toEqual(Object.keys(esperado).sort());
    for (const acao of ACOES) {
      for (const papel of papeis) {
        expect(perfilPermiteAcao(papel, acao), `${papel}/${acao}`).toBe(esperado[acao].includes(papel));
      }
    }
  });

  it('permite editar rascunhos entre perfis e exige encaminhamento para conferir ou emitir de terceiros', () => {
    const proprio = { usuarioId: 'usuario', autorId: 'usuario', encaminhado: false };
    const terceiro = { usuarioId: 'usuario', autorId: 'outro', encaminhado: false };
    const encaminhado = { ...terceiro, encaminhado: true };
    expect(permiteAcao('analista', 'editar_rascunho', proprio)).toBe(true);
    expect(permiteAcao('coordenador', 'editar_rascunho', terceiro)).toBe(true);
    expect(permiteAcao('coordenador', 'editar_rascunho', encaminhado)).toBe(true);
    expect(permiteAcao('coordenador', 'conferir', terceiro)).toBe(false);
    expect(permiteAcao('coordenador', 'conferir', encaminhado)).toBe(true);
    expect(permiteAcao('coordenador', 'emitir', encaminhado)).toBe(true);
    expect(permiteAcao('analista', 'conferir', encaminhado)).toBe(false);
    expect(permiteAcao('analista', 'emitir', proprio)).toBe(false);
    expect(permiteAcao('coordenador', 'cancelar_rascunho', terceiro)).toBe(true);
    expect(permiteAcao('analista', 'cancelar_rascunho', terceiro)).toBe(false);
    expect(permiteAcao('coordenador', 'editar_rascunho')).toBe(false);
    for (const acao of ['editar_rascunho', 'conferir', 'emitir', 'cancelar_rascunho'] as const) {
      expect(permiteAcao('admin', acao, terceiro)).toBe(true);
      expect(permiteAcao('admin', acao)).toBe(false);
    }
  });
});
