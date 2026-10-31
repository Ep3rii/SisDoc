import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { lerNomeMaeDof } from '../apps/api/dist/documentos/identidade-fonte-dof.js';
import { ProtetorDados } from '../apps/api/dist/seguranca/protecao-dados.js';

describe('identidade protegida da DOF', () => {
  it('distingue ausência, conteúdo válido e erros de integridade da filiação', () => {
    const protetor = new ProtetorDados({
      cifra: randomBytes(32).toString('base64'), hmac: randomBytes(32).toString('base64'),
    });
    const pessoaId = randomUUID();
    const contexto = { schema: 'nucleo' as const, tabela: 'pessoa', registroId: pessoaId, campo: 'nome_mae_cifrado' };
    const proteger = (valor: Buffer) => protetor.cifrar(valor, contexto);
    const nome = '  Mãe fictícia para teste  ';

    expect(lerNomeMaeDof(protetor, pessoaId, null)).toEqual({ valor: null });
    expect(lerNomeMaeDof(protetor, pessoaId, proteger(Buffer.from(nome, 'utf8')))).toEqual({ valor: nome });
    expect(lerNomeMaeDof(protetor, pessoaId, Buffer.alloc(0))).toEqual({ erro: 'nome_mae_indisponivel' });
    expect(lerNomeMaeDof(protetor, randomUUID(), proteger(Buffer.from(nome, 'utf8'))))
      .toEqual({ erro: 'nome_mae_indisponivel' });
    for (const valor of [
      Buffer.alloc(0), Buffer.from('   '), Buffer.from('Nome\u0000fictício'),
      Buffer.from([0xc3, 0x28]), Buffer.from('a'.repeat(2001)),
    ]) {
      expect(lerNomeMaeDof(protetor, pessoaId, proteger(valor))).toEqual({ erro: 'nome_mae_invalido' });
    }
  });
});
