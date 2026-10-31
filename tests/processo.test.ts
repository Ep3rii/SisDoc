import {
  atualizarProcessoDofSchema, configuracaoProcessosSchema, numeroProcessoSchema, processoCorrespondeMascara,
} from '@sisdoc/contratos';
import { describe, expect, it } from 'vitest';

describe('máscaras configuráveis de processo', () => {
  it('valida somente máscaras explícitas e compara caracteres sem expressões regulares configuráveis', () => {
    expect(configuracaoProcessosSchema.safeParse({ mascaras: ['####/####', 'AB-@@-**'] }).success).toBe(true);
    for (const mascara of ['', 'AB-1234', '[0-9]+', '####\n####', '#'.repeat(101)]) {
      expect(configuracaoProcessosSchema.safeParse({ mascaras: [mascara] }).success).toBe(false);
    }
    expect(processoCorrespondeMascara(' 1234/5678 ', '####/####')).toBe(true);
    expect(processoCorrespondeMascara('ab-cd-9e', 'AB-@@-**')).toBe(true);
    expect(processoCorrespondeMascara('ab-1d-9e', 'AB-@@-**')).toBe(false);
    expect(processoCorrespondeMascara('12345678', '####/####')).toBe(false);
    expect(processoCorrespondeMascara('1234/5678', '[0-9]+')).toBe(false);
    expect(numeroProcessoSchema.safeParse('<script>').success).toBe(false);
    expect(numeroProcessoSchema.parse(' ab-123 ')).toBe('AB-123');
    const remocao = { revisao: 1, motivo: 'Correção fictícia', processo: null };
    expect(atualizarProcessoDofSchema.safeParse(remocao).success).toBe(false);
    expect(atualizarProcessoDofSchema.safeParse({ ...remocao, confirmarRemocao: true }).success).toBe(true);
    expect(atualizarProcessoDofSchema.safeParse({
      ...remocao, processo: '1234/5678', confirmarRemocao: true,
    }).success).toBe(false);
  });
});
