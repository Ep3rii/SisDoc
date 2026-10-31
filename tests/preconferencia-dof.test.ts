import { randomUUID } from 'node:crypto';
import { conferirDofSchema, preconferenciaDofSchema } from '@sisdoc/contratos';
import { describe, expect, it } from 'vitest';

describe('contrato de pré-conferência de DOF', () => {
  it('não admite que uma consulta preliminar seja interpretada como conferência', () => {
    const consulta = {
      documentoId: randomUUID(), revisao: 1, verificadoEm: '2026-01-01T12:00:00.000Z',
      status: 'nao_conferido', conferenciaDisponivel: true, fontePreviaValidada: false, provaRelatorio: null,
      bloqueios: [{ codigo: 'processo_ausente', mensagem: 'Falta processo.' }],
      avisos: [{ codigo: 'regra_provisoria', mensagem: 'Regra provisória.' }],
    };
    expect(preconferenciaDofSchema.safeParse(consulta).success).toBe(true);
    expect(preconferenciaDofSchema.safeParse({
      ...consulta, fontePreviaValidada: true, provaRelatorio: 'a'.repeat(64), bloqueios: [],
    }).success).toBe(true);
    for (const invalido of [
      { ...consulta, status: 'conferido' },
      { ...consulta, conferenciaDisponivel: false },
      { ...consulta, fontePreviaValidada: 'sim' },
      { ...consulta, fontePreviaValidada: true },
      { ...consulta, provaRelatorio: 'a'.repeat(64) },
      { ...consulta, fontePreviaValidada: true, provaRelatorio: 'inválida' },
      { ...consulta, bloqueios: [...consulta.bloqueios, ...consulta.bloqueios] },
      { ...consulta, avisos: [...consulta.avisos, ...consulta.avisos] },
      { ...consulta, bloqueios: [{ codigo: 'erro_desconhecido', mensagem: 'Erro.' }] },
      { ...consulta, documentoId: 'inválido' },
      { ...consulta, revisao: 0 },
      { ...consulta, dadoPessoal: 'não deve ser retornado' },
    ]) expect(preconferenciaDofSchema.safeParse(invalido).success).toBe(false);
  });

  it('exige confirmação explícita, revisão e provas completas para conferir', () => {
    const pedido = { revisao: 1, provaFonte: 'a'.repeat(64), provaRelatorio: 'b'.repeat(64), confirmar: true };
    expect(conferirDofSchema.safeParse(pedido).success).toBe(true);
    for (const invalido of [
      { ...pedido, confirmar: false },
      { ...pedido, provaFonte: '' },
      { ...pedido, provaRelatorio: 'f'.repeat(63) },
      { ...pedido, revisao: 0 },
      { ...pedido, campoExtra: true },
    ]) expect(conferirDofSchema.safeParse(invalido).success).toBe(false);
  });
});
