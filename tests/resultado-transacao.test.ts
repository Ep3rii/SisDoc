import { describe, expect, it } from 'vitest';
import { concluir } from '../apps/api/dist/documentos/resultado-transacao.js';

describe('resultado de domínio após a transação', () => {
  it('preserva a referência do valor confirmado', () => {
    const valor = { documentoId: 'sintetico', revisao: 2 };
    expect(concluir({ valor })).toBe(valor);
  });

  it.each([
    ['invalido', 400],
    ['conflito', 409],
    ['nao_encontrado', 404],
  ] as const)('traduz %s sem perder a mensagem de domínio', (tipo, status) => {
    expect(() => concluir({ falha: { tipo, mensagem: 'Falha sintética auditada.' } }))
      .toThrowError(expect.objectContaining({ status, message: 'Falha sintética auditada.' }));
  });
});
