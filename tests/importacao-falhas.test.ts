import { createRequire } from 'node:module';
import { Client } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpcoesImportacao } from '../apps/api/dist/importacao/estado-importacao.js';
import { COLUNAS } from '../apps/api/dist/importacao/formatos.js';
import { ProtetorDados } from '../apps/api/dist/seguranca/protecao-dados.js';

// O build da API é CommonJS; usar um único loader mantém a identidade das classes de erro extraídas.
const carregar = createRequire(import.meta.url);
const { ErroTransacaoImportacao, hashArquivo } = carregar('../apps/api/dist/importacao/estado-importacao.js') as typeof import('../apps/api/dist/importacao/estado-importacao.js');
const { importarLinhas } = carregar('../apps/api/dist/importacao/importador.js') as typeof import('../apps/api/dist/importacao/importador.js');
const { desfazerLote } = carregar('../apps/api/dist/importacao/rollback-importacao.js') as typeof import('../apps/api/dist/importacao/rollback-importacao.js');

const protetor = new ProtetorDados({
  cifra: Buffer.alloc(32, 1).toString('base64'),
  hmac: Buffer.alloc(32, 2).toString('base64'),
});
const vazio = { command: '', rowCount: 1, oid: 0, fields: [], rows: [] };
const opcoes: OpcoesImportacao = {
  tipo: 'dados_funcionais', origem: 'teste-falhas', canal: 'cli',
  usuarioId: '00000000-0000-4000-8000-000000000001',
  gravar: true, hashArquivo: hashArquivo(Buffer.from('arquivo sintético vazio')),
};
const linhas = [[...COLUNAS.dados_funcionais]];

afterEach(() => vi.restoreAllMocks());

describe('falhas transacionais de importação sem conexão real', () => {
  it('sinaliza início incerto sem tentar registrar ou reverter transação inexistente', async () => {
    const cliente = new Client();
    const falha = new Error('Falha sintética de BEGIN.');
    const query = vi.spyOn(cliente, 'query').mockRejectedValueOnce(falha);
    await expect(importarLinhas(cliente, protetor, linhas, opcoes))
      .rejects.toMatchObject({ errors: [falha] });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('BEGIN');
  });

  it('preserva causa e falha de rollback sem registrar lote falso', async () => {
    const cliente = new Client();
    const causa = new Error('Falha sintética anterior à carga.');
    const rollback = new Error('Falha sintética de ROLLBACK.');
    const query = vi.spyOn(cliente, 'query').mockImplementationOnce(async () => vazio).mockRejectedValueOnce(rollback);
    const tentativa = importarLinhas(cliente, protetor, linhas, {
      ...opcoes, antes: async () => { throw causa; },
    });
    await expect(tentativa).rejects.toBeInstanceOf(ErroTransacaoImportacao);
    await expect(tentativa).rejects.toMatchObject({ errors: [causa, rollback] });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('preserva a causa original quando validação é revertida com sucesso', async () => {
    const cliente = new Client();
    const causa = new Error('Falha sintética de validação.');
    const query = vi.spyOn(cliente, 'query')
      .mockImplementationOnce(async () => vazio).mockImplementationOnce(async () => vazio);
    await expect(importarLinhas(cliente, protetor, linhas, {
      ...opcoes, gravar: false, antes: async () => { throw causa; },
    })).rejects.toBe(causa);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('expõe também falha de registro após rollback confirmado', async () => {
    const cliente = new Client();
    const causa = new Error('Falha sintética de carga.');
    const registro = new Error('Falha sintética ao registrar lote.');
    const query = vi.spyOn(cliente, 'query')
      .mockImplementationOnce(async () => vazio).mockImplementationOnce(async () => vazio).mockRejectedValueOnce(registro);
    await expect(importarLinhas(cliente, protetor, linhas, {
      ...opcoes, antes: async () => { throw causa; },
    })).rejects.toMatchObject({ errors: [causa, registro] });
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[1][0]).toBe('ROLLBACK');
    expect(query.mock.calls[2][0]).toContain("'falhou'");
  });

  it('não interpreta erro de COMMIT como carga desfeita', async () => {
    const cliente = new Client();
    const falha = new Error('Falha sintética de COMMIT.');
    const query = vi.spyOn(cliente, 'query');
    for (let indice = 0; indice < 7; indice += 1) query.mockImplementationOnce(async () => vazio);
    query.mockRejectedValueOnce(falha);
    const tentativa = importarLinhas(cliente, protetor, linhas, opcoes);
    await expect(tentativa).rejects.toBeInstanceOf(ErroTransacaoImportacao);
    await expect(tentativa).rejects.toThrow('confira o lote antes de tentar novamente');
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(false);
  });

  it('preserva falhas de operação e limpeza ao desfazer lote', async () => {
    const cliente = new Client();
    const causa = new Error('Falha sintética no lock.');
    const rollback = new Error('Falha sintética de ROLLBACK.');
    const query = vi.spyOn(cliente, 'query')
      .mockImplementationOnce(async () => vazio).mockRejectedValueOnce(causa).mockRejectedValueOnce(rollback);
    await expect(desfazerLote(cliente, opcoes.usuarioId))
      .rejects.toMatchObject({ errors: [causa, rollback] });
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });

  it('sinaliza falha no início do rollback sem executar consultas adicionais', async () => {
    const cliente = new Client();
    const falha = new Error('Falha sintética de BEGIN.');
    const query = vi.spyOn(cliente, 'query').mockRejectedValueOnce(falha);
    const tentativa = desfazerLote(cliente, opcoes.usuarioId);
    await expect(tentativa).rejects.toBeInstanceOf(ErroTransacaoImportacao);
    await expect(tentativa).rejects.toMatchObject({ errors: [falha] });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('não afirma que lote foi desfeito quando COMMIT do rollback falha', async () => {
    const cliente = new Client();
    const falha = new Error('Falha sintética de COMMIT de rollback.');
    const query = vi.spyOn(cliente, 'query')
      .mockImplementationOnce(async () => vazio)
      .mockImplementationOnce(async () => vazio)
      .mockImplementationOnce(async () => ({
        ...vazio, rows: [{ status: 'concluido', iniciado_em: new Date('2026-01-01'), tipo: 'dados_funcionais', sistema_origem: 'teste-falhas' }],
      }))
      .mockImplementationOnce(async () => vazio)
      .mockImplementationOnce(async () => ({ ...vazio, rows: [{ total: '0' }] }))
      .mockImplementationOnce(async () => vazio)
      .mockImplementationOnce(async () => vazio)
      .mockImplementationOnce(async () => vazio)
      .mockRejectedValueOnce(falha);
    const tentativa = desfazerLote(cliente, opcoes.usuarioId);
    await expect(tentativa).rejects.toBeInstanceOf(ErroTransacaoImportacao);
    await expect(tentativa).rejects.toThrow('confira sua situação antes de tentar novamente');
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(false);
  });
});
