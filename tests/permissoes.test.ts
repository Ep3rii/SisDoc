import { describe, expect, it } from 'vitest';
import { ACOES, perfilPermiteAcao, permiteAcao, type Acao, type Papel } from '../apps/api/dist/seguranca/permissoes.js';

const papeis: Papel[] = ['analista', 'coordenador', 'secretario_adjunto', 'admin'];
const esperado: Record<Acao, Papel[]> = {
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

  it('mantém edição por autoria e exige encaminhamento para conferir ou emitir de terceiros', () => {
    const proprio = { usuarioId: 'usuario', autorId: 'usuario', encaminhado: false };
    const terceiro = { usuarioId: 'usuario', autorId: 'outro', encaminhado: false };
    const encaminhado = { ...terceiro, encaminhado: true };
    expect(permiteAcao('analista', 'editar_rascunho', proprio)).toBe(true);
    expect(permiteAcao('coordenador', 'editar_rascunho', terceiro)).toBe(false);
    expect(permiteAcao('coordenador', 'editar_rascunho', encaminhado)).toBe(false);
    expect(permiteAcao('coordenador', 'conferir', terceiro)).toBe(false);
    expect(permiteAcao('coordenador', 'conferir', encaminhado)).toBe(true);
    expect(permiteAcao('coordenador', 'emitir', encaminhado)).toBe(true);
    expect(permiteAcao('analista', 'conferir', encaminhado)).toBe(false);
    expect(permiteAcao('analista', 'emitir', proprio)).toBe(false);
    expect(permiteAcao('coordenador', 'cancelar_rascunho', terceiro)).toBe(true);
    expect(permiteAcao('analista', 'cancelar_rascunho', terceiro)).toBe(false);
    expect(permiteAcao('coordenador', 'editar_rascunho')).toBe(false);
  });
});
