import { timingSafeEqual } from 'node:crypto';
import { cpfSchema } from '@sisdoc/contratos';
import type { ProtetorDados } from '../seguranca/protecao-dados';

type ErroCpfDof = 'cpf_indisponivel' | 'cpf_invalido' | 'cpf_hash_inconsistente';
type ErroNomeMaeDof = 'nome_mae_indisponivel' | 'nome_mae_invalido';
type Leitura<T, E extends string> = { valor: T } | { erro: E };

function decifrarPessoa(
  protetor: ProtetorDados, pessoaId: string, campo: string, valor: Buffer,
): Buffer | null {
  try {
    return protetor.decifrar(valor, { schema: 'nucleo', tabela: 'pessoa', registroId: pessoaId, campo });
  } catch (erro) {
    if (!(erro instanceof Error) || erro.message !== 'Dado protegido inválido ou corrompido.') throw erro;
    return null;
  }
}

export function lerCpfDof(
  protetor: ProtetorDados, pessoaId: string, cifrado: Buffer, hash: Buffer,
): Leitura<string, ErroCpfDof> {
  const protegido = decifrarPessoa(protetor, pessoaId, 'cpf_cifrado', cifrado);
  if (!protegido) return { erro: 'cpf_indisponivel' };
  const cpf = cpfSchema.safeParse(protegido.toString('utf8'));
  if (!cpf.success) return { erro: 'cpf_invalido' };
  const esperado = protetor.hashCpf(cpf.data);
  if (hash.length !== esperado.length || !timingSafeEqual(hash, esperado)) {
    return { erro: 'cpf_hash_inconsistente' };
  }
  return { valor: cpf.data };
}

export function lerNomeMaeDof(
  protetor: ProtetorDados, pessoaId: string, cifrado: Buffer | null,
): Leitura<string | null, ErroNomeMaeDof> {
  if (cifrado === null) return { valor: null };
  const protegido = decifrarPessoa(protetor, pessoaId, 'nome_mae_cifrado', cifrado);
  if (!protegido) return { erro: 'nome_mae_indisponivel' };
  const nome = protegido.toString('utf8');
  if (!Buffer.from(nome, 'utf8').equals(protegido) || !nome.trim() || nome.length > 2000
      || /[\u0000-\u001f\u007f]/.test(nome)) {
    return { erro: 'nome_mae_invalido' };
  }
  return { valor: nome };
}
