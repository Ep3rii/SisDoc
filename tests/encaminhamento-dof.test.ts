import { randomUUID } from 'node:crypto';
import {
  encaminharRascunhoDofSchema,
  paginaCoordenadoresDofSchema,
  paginaEncaminhamentosDofSchema,
  recolherRascunhoDofSchema,
} from '@sisdoc/contratos';
import { describe, expect, it } from 'vitest';

describe('contratos de encaminhamento de DOF', () => {
  it('exige revisão válida, destinatário identificado e motivo explícito para recolher', () => {
    const destinatarioId = randomUUID();
    expect(encaminharRascunhoDofSchema.safeParse({ revisao: 1, destinatarioId }).success).toBe(true);
    for (const invalido of [
      { revisao: 0, destinatarioId },
      { revisao: 2147483648, destinatarioId },
      { revisao: 1, destinatarioId: 'coordenador' },
      { revisao: 1, destinatarioId, status: 'conferido' },
    ]) expect(encaminharRascunhoDofSchema.safeParse(invalido).success).toBe(false);
    expect(recolherRascunhoDofSchema.safeParse({ revisao: 1, motivo: 'Ajuste necessário' }).success).toBe(true);
    for (const invalido of [
      { revisao: 0, motivo: 'Ajuste' },
      { revisao: 1, motivo: '  ' },
      { revisao: 1, motivo: 'a'.repeat(2001) },
      { revisao: 1, motivo: 'Ajuste', destinatarioId },
    ]) expect(recolherRascunhoDofSchema.safeParse(invalido).success).toBe(false);
  });

  it('rejeita respostas paginadas com campos ou identificadores inesperados', () => {
    const id = randomUUID();
    expect(paginaCoordenadoresDofSchema.safeParse({
      itens: [{ id, nome: 'Coordenador fictício', matricula: 'COORD-FICTICIO' }], proximoCursor: null,
    }).success).toBe(true);
    expect(paginaCoordenadoresDofSchema.safeParse({
      itens: [{ id, nome: 'Coordenador fictício', matricula: 'COORD-FICTICIO', senha: 'indevida' }],
      proximoCursor: null,
    }).success).toBe(false);
    expect(paginaEncaminhamentosDofSchema.safeParse({
      itens: [{
        id, pessoaId: randomUUID(), vinculoId: randomUUID(), nome: 'Pessoa fictícia', matricula: 'FICTICIA',
        revisao: 1, atualizadoEm: '2026-01-01T12:00:00.000Z',
        autorNome: 'Autor fictício', encaminhadoEm: '2026-01-01T12:00:00.000Z',
      }],
      proximoCursor: null,
    }).success).toBe(true);
    expect(paginaEncaminhamentosDofSchema.safeParse({ itens: [], proximoCursor: 'inválido' }).success).toBe(false);
  });
});
