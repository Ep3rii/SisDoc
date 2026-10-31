import { randomUUID } from 'node:crypto';
import {
  encaminharRascunhoDofSchema,
  devolverRascunhoDofSchema,
  paginaCoordenadoresDofSchema,
  paginaEncaminhamentosDofSchema,
  recolherRascunhoDofSchema,
  resultadoDevolucaoDofSchema,
  ultimaDevolucaoDofSchema,
} from '@sisdoc/contratos';
import { describe, expect, it } from 'vitest';

describe('contratos de encaminhamento de DOF', () => {
  it('exige revisão válida, destinatário identificado e motivo para recolher ou devolver', () => {
    const destinatarioId = randomUUID();
    expect(encaminharRascunhoDofSchema.safeParse({ revisao: 1, destinatarioId }).success).toBe(true);
    for (const invalido of [
      { revisao: 0, destinatarioId },
      { revisao: 2147483648, destinatarioId },
      { revisao: 1, destinatarioId: 'coordenador' },
      { revisao: 1, destinatarioId, status: 'conferido' },
    ]) expect(encaminharRascunhoDofSchema.safeParse(invalido).success).toBe(false);
    expect(recolherRascunhoDofSchema.safeParse({ revisao: 1, motivo: 'Ajuste necessário' }).success).toBe(true);
    expect(devolverRascunhoDofSchema.parse({ revisao: 1, motivo: '  Ajuste necessário  ' }).motivo)
      .toBe('Ajuste necessário');
    for (const invalido of [
      { revisao: 0, motivo: 'Ajuste' },
      { revisao: 1, motivo: '  ' },
      { revisao: 1, motivo: 'a'.repeat(2001) },
      { revisao: 1, motivo: 'Ajuste', destinatarioId },
    ]) {
      expect(recolherRascunhoDofSchema.safeParse(invalido).success).toBe(false);
      expect(devolverRascunhoDofSchema.safeParse(invalido).success).toBe(false);
    }
  });

  it('limita as respostas de devolução e exige motivo legível', () => {
    const documentoId = randomUUID();
    const devolvidoEm = '2026-01-01T12:00:00.000Z';
    expect(resultadoDevolucaoDofSchema.safeParse({ documentoId, revisao: 2, devolvidoEm }).success).toBe(true);
    expect(resultadoDevolucaoDofSchema.safeParse({ documentoId, revisao: 2, devolvidoEm, motivo: 'indevido' }).success)
      .toBe(false);
    expect(ultimaDevolucaoDofSchema.safeParse({ documentoId, revisao: 2, devolucao: null }).success).toBe(true);
    expect(ultimaDevolucaoDofSchema.safeParse({
      documentoId, revisao: 2, devolucao: { coordenadorNome: 'Coordenador fictício', devolvidoEm, motivo: '  ' },
    }).success).toBe(false);
    expect(ultimaDevolucaoDofSchema.safeParse({
      documentoId, revisao: 2, devolucao: {
        coordenadorNome: 'Coordenador fictício', devolvidoEm, motivo: 'Ajuste fictício', cpf: 'indevido',
      },
    }).success).toBe(false);
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
