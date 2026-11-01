import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { argon2id, hash } from 'argon2';

export class ErroPoliticaSenha extends Error {
  constructor(message: string, readonly codigo: 'invalida' | 'lista_indisponivel' | 'lista_vazia') {
    super(message);
  }
}

export function gerarHashSenha(senha: string): Promise<string> {
  return hash(senha, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verificarSenha(senha: string, arquivo: string): Promise<void> {
  if (senha.length < 10 || senha.length > 1024) {
    throw new ErroPoliticaSenha('A senha deve ter entre 10 e 1024 caracteres.', 'invalida');
  }
  let quantidade = 0;
  let encontrada = false;
  const entrada = createReadStream(arquivo, { encoding: 'utf8' });
  const linhas = createInterface({ input: entrada, crlfDelay: Infinity });
  try {
    await new Promise<void>((resolve, reject) => {
      entrada.once('error', reject);
      linhas.on('line', (linha: string) => {
        if (linha.length === 0) return;
        quantidade += 1;
        if (linha === senha) encontrada = true;
      });
      linhas.once('close', resolve);
    });
  } catch {
    throw new ErroPoliticaSenha('Não foi possível ler a lista local de senhas comuns.', 'lista_indisponivel');
  } finally {
    linhas.close();
    entrada.destroy();
  }
  if (quantidade === 0) throw new ErroPoliticaSenha('A lista local de senhas comuns está vazia.', 'lista_vazia');
  if (encontrada) throw new ErroPoliticaSenha('A senha consta da lista local de senhas comuns.', 'invalida');
}
