import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { criarUsuarioSchema, redefinirSenhaSchema, trocarSenhaSchema } from '../packages/contratos/dist/index.js';
import { verificarSenha } from '../apps/api/dist/seguranca/senhas.js';

it('exige exatamente o mínimo de dez caracteres em criação, redefinição e troca', async () => {
  const diretorio = await mkdtemp(path.join(os.tmpdir(), 'sisdoc-senha-'));
  const arquivo = path.join(diretorio, 'comuns.txt');
  try {
    await writeFile(arquivo, 'Comum12345\n');
    for (const tamanho of [9, 10, 11, 12]) {
      const senha = `X${'a'.repeat(tamanho - 1)}`;
      const esperado = tamanho >= 10;
      expect(criarUsuarioSchema.safeParse({ matricula: 'FICTICIO', nome: 'Pessoa fictícia', papel: 'analista', senha }).success).toBe(esperado);
      expect(redefinirSenhaSchema.safeParse({ senha }).success).toBe(esperado);
      expect(trocarSenhaSchema.safeParse({ senhaAtual: 'anterior', senhaNova: senha }).success).toBe(esperado);
      if (esperado) await expect(verificarSenha(senha, arquivo)).resolves.toBeUndefined();
      else await expect(verificarSenha(senha, arquivo)).rejects.toThrow('entre 10 e 1024');
    }
    await expect(verificarSenha('Comum12345', arquivo)).rejects.toThrow('lista local');
  } finally {
    await rm(arquivo, { force: true });
    await rmdir(diretorio);
  }
});
