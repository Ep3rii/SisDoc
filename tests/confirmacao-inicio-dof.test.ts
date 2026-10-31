import { confirmarInicioDofSchema } from '@sisdoc/contratos';
import { describe, expect, it } from 'vitest';

describe('contrato de confirmação do início da DOF', () => {
  it('exige revisão válida e confirmação explícita, sem aceitar outros campos', () => {
    expect(confirmarInicioDofSchema.safeParse({ revisao: 1, confirmar: true }).success).toBe(true);
    for (const invalido of [
      { revisao: 0, confirmar: true },
      { revisao: 2147483648, confirmar: true },
      { revisao: 1, confirmar: false },
      { revisao: 1 },
      { revisao: 1, confirmar: true, status: 'conferido' },
    ]) expect(confirmarInicioDofSchema.safeParse(invalido).success).toBe(false);
  });
});
