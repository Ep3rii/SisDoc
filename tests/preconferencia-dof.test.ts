import { randomUUID } from 'node:crypto';
import { preconferenciaDofSchema } from '@sisdoc/contratos';
import { describe, expect, it } from 'vitest';

describe('contrato de pré-conferência de DOF', () => {
  it('não admite que uma consulta preliminar seja interpretada como conferência', () => {
    const consulta = {
      documentoId: randomUUID(), revisao: 1, verificadoEm: '2026-01-01T12:00:00.000Z',
      status: 'nao_conferido', conferenciaDisponivel: false, fontePreviaValidada: false,
      bloqueios: [{ codigo: 'conferencia_indisponivel', mensagem: 'Ainda não disponível.' }],
      avisos: [{ codigo: 'regra_provisoria', mensagem: 'Regra provisória.' }],
    };
    expect(preconferenciaDofSchema.safeParse(consulta).success).toBe(true);
    expect(preconferenciaDofSchema.safeParse({ ...consulta, fontePreviaValidada: true }).success).toBe(true);
    for (const invalido of [
      { ...consulta, status: 'conferido' },
      { ...consulta, conferenciaDisponivel: true },
      { ...consulta, fontePreviaValidada: 'sim' },
      { ...consulta, bloqueios: [] },
      { ...consulta, bloqueios: [{ codigo: 'processo_ausente', mensagem: 'Falta processo.' }] },
      { ...consulta, bloqueios: [...consulta.bloqueios, ...consulta.bloqueios] },
      { ...consulta, avisos: [...consulta.avisos, ...consulta.avisos] },
      { ...consulta, bloqueios: [{ codigo: 'erro_desconhecido', mensagem: 'Erro.' }] },
      { ...consulta, documentoId: 'inválido' },
      { ...consulta, revisao: 0 },
      { ...consulta, dadoPessoal: 'não deve ser retornado' },
    ]) expect(preconferenciaDofSchema.safeParse(invalido).success).toBe(false);
  });
});
