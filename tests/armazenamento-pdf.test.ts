import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { capturarDadosPdfProvisorioDof } from '@sisdoc/contratos';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chromium } from 'playwright';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArmazenamentoPdf } from '../apps/api/dist/documentos/armazenamento-pdf.js';
import { renderizarPdfProvisorioDof } from '../apps/api/dist/documentos/pdf-provisorio-dof.js';
import { previaDofSintetica } from './dof-sintetica.js';

describe('armazenamento isolado de PDF', () => {
  let diretorio = '';
  let pdf: Buffer;

  beforeAll(async () => {
    const navegador = await chromium.launch({ headless: true });
    try {
      pdf = await renderizarPdfProvisorioDof(navegador, capturarDadosPdfProvisorioDof(previaDofSintetica()));
    } finally {
      await navegador.close();
    }
  });

  beforeEach(async () => {
    diretorio = await fs.mkdtemp(path.join(os.tmpdir(), 'sisdoc-pdf-teste-'));
  });

  afterEach(async () => {
    if (diretorio && path.basename(diretorio).startsWith('sisdoc-pdf-teste-')) {
      await fs.rm(diretorio, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('grava, verifica e reutiliza somente o mesmo PDF para a mesma emissão', async () => {
    const armazenamento = new ArmazenamentoPdf(diretorio);
    const emissaoId = randomUUID();
    const sha256 = createHash('sha256').update(pdf).digest('hex');
    const primeiro = await armazenamento.gravar(emissaoId, pdf);
    expect(primeiro).toEqual({ caminhoRelativo: `${emissaoId}.pdf`, sha256, reutilizado: false });
    expect(await fs.readdir(diretorio)).toEqual([`${emissaoId}.pdf`]);
    const lido = await armazenamento.ler(emissaoId, sha256);
    expect(lido.equals(pdf)).toBe(true);
    const tarefa = getDocument({ data: new Uint8Array(lido), useSystemFonts: true, verbosity: 0 });
    try {
      const documento = await tarefa.promise;
      expect(documento.numPages).toBeGreaterThan(1);
      expect((await (await documento.getPage(1)).getTextContent()).items.length).toBeGreaterThan(0);
    } finally {
      await tarefa.destroy();
    }
    expect(await armazenamento.gravar(emissaoId, pdf)).toEqual({ ...primeiro, reutilizado: true });
    expect(await fs.readdir(diretorio)).toEqual([`${emissaoId}.pdf`]);
  });

  it('publica um único arquivo em gravações simultâneas iguais', async () => {
    const armazenamento = new ArmazenamentoPdf(diretorio);
    const emissaoId = randomUUID();
    const resultados = await Promise.all([
      armazenamento.gravar(emissaoId, pdf), armazenamento.gravar(emissaoId, pdf),
    ]);
    expect(resultados.map((item) => item.reutilizado).sort()).toEqual([false, true]);
    expect(new Set(resultados.map((item) => item.sha256)).size).toBe(1);
    expect(await fs.readdir(diretorio)).toEqual([`${emissaoId}.pdf`]);
    expect((await armazenamento.ler(emissaoId, resultados[0].sha256)).equals(pdf)).toBe(true);
  });

  it('não sobrescreve conteúdo diferente em concorrência', async () => {
    const armazenamento = new ArmazenamentoPdf(diretorio);
    const emissaoId = randomUUID();
    const diferente = Buffer.concat([pdf, Buffer.from('\n')]);
    const resultados = await Promise.allSettled([
      armazenamento.gravar(emissaoId, pdf), armazenamento.gravar(emissaoId, diferente),
    ]);
    const sucessos = resultados.filter((resultado) => resultado.status === 'fulfilled');
    const falhas = resultados.filter((resultado) => resultado.status === 'rejected');
    expect(sucessos).toHaveLength(1);
    expect(falhas).toHaveLength(1);
    expect(falhas[0].reason).toBeInstanceOf(Error);
    expect(falhas[0].reason.message).toContain('PDF diferente');
    const gravado = await fs.readFile(path.join(diretorio, `${emissaoId}.pdf`));
    expect(gravado.equals(pdf) || gravado.equals(diferente)).toBe(true);
    expect(await fs.readdir(diretorio)).toEqual([`${emissaoId}.pdf`]);
  });

  it('recusa caminho, identificador, hash e conteúdo inválidos', async () => {
    expect(() => new ArmazenamentoPdf(path.parse(diretorio).root)).toThrow('raiz do volume');
    expect(() => new ArmazenamentoPdf('pasta-relativa')).toThrow('absoluto');
    const armazenamento = new ArmazenamentoPdf(diretorio);
    const emissaoId = randomUUID();
    await expect(armazenamento.gravar('..\\fora', pdf)).rejects.toThrow('Identificador de emissão inválido');
    await expect(armazenamento.gravar(emissaoId, Buffer.from('%PDF-1.7\nincompleto'))).rejects.toThrow('incompleto ou inválido');
    await expect(armazenamento.ler(emissaoId, '../fora')).rejects.toThrow('hash esperado');
    expect(await fs.readdir(diretorio)).toEqual([]);
  });

  it('recusa diretórios e artefatos que são junções', async () => {
    const pasta = path.join(diretorio, 'pasta');
    const juncao = path.join(diretorio, 'juncao');
    const emissaoId = randomUUID();
    const artefato = path.join(diretorio, `${emissaoId}.pdf`);
    await fs.mkdir(pasta);
    await fs.symlink(pasta, juncao, 'junction');
    await fs.symlink(pasta, artefato, 'junction');
    try {
      await expect(new ArmazenamentoPdf(juncao).gravar(emissaoId, pdf)).rejects.toThrow('não é uma pasta regular');
      await expect(new ArmazenamentoPdf(diretorio).ler(emissaoId, 'a'.repeat(64)))
        .rejects.toThrow('não é um arquivo regular');
    } finally {
      await fs.unlink(juncao);
      await fs.unlink(artefato);
    }
  });

  it('detecta alteração do arquivo e não substitui artefato divergente', async () => {
    const armazenamento = new ArmazenamentoPdf(diretorio);
    const emissaoId = randomUUID();
    const resultado = await armazenamento.gravar(emissaoId, pdf);
    const caminho = path.join(diretorio, resultado.caminhoRelativo);
    await fs.writeFile(caminho, Buffer.concat([pdf, Buffer.from('\n')]));
    await expect(armazenamento.ler(emissaoId, resultado.sha256)).rejects.toThrow('não corresponde ao hash');
    await expect(armazenamento.gravar(emissaoId, pdf)).rejects.toThrow('PDF diferente');
    expect(await fs.readdir(diretorio)).toEqual([`${emissaoId}.pdf`]);
  });

  it('remove o temporário quando uma escrita parcial falha', async () => {
    const abrirComFalha: typeof fs.open = async (...argumentos) => {
      const arquivo = await fs.open(...argumentos);
      const escrever = arquivo.writeFile.bind(arquivo);
      vi.spyOn(arquivo, 'writeFile').mockImplementationOnce(async () => {
        await escrever(Buffer.from('%PDF-'));
        throw new Error('Falha sintética de escrita.');
      });
      return arquivo;
    };
    const armazenamento = new ArmazenamentoPdf(diretorio, { ...fs, open: abrirComFalha });
    await expect(armazenamento.gravar(randomUUID(), pdf)).rejects.toThrow('Falha sintética de escrita.');
    expect(await fs.readdir(diretorio)).toEqual([]);
  });

  it('não publica o arquivo quando a sincronização com o disco falha', async () => {
    const abrirComFalha: typeof fs.open = async (...argumentos) => {
      const arquivo = await fs.open(...argumentos);
      vi.spyOn(arquivo, 'sync').mockRejectedValueOnce(new Error('Falha sintética de sincronização.'));
      return arquivo;
    };
    const armazenamento = new ArmazenamentoPdf(diretorio, { ...fs, open: abrirComFalha });
    await expect(armazenamento.gravar(randomUUID(), pdf)).rejects.toThrow('Falha sintética de sincronização.');
    expect(await fs.readdir(diretorio)).toEqual([]);
  });

  it('remove o temporário quando a publicação atômica falha', async () => {
    const publicarComFalha: typeof fs.link = async () => { throw new Error('Falha sintética de publicação.'); };
    const armazenamento = new ArmazenamentoPdf(diretorio, { ...fs, link: publicarComFalha });
    await expect(armazenamento.gravar(randomUUID(), pdf)).rejects.toThrow('Falha sintética de publicação.');
    expect(await fs.readdir(diretorio)).toEqual([]);
  });

  it('informa falhas simultâneas de escrita e limpeza', async () => {
    const abrirComFalha: typeof fs.open = async (...argumentos) => {
      const arquivo = await fs.open(...argumentos);
      vi.spyOn(arquivo, 'writeFile').mockRejectedValueOnce(new Error('Falha sintética de escrita.'));
      return arquivo;
    };
    const removerComFalha: typeof fs.unlink = async (caminho) => {
      await fs.unlink(caminho);
      throw new Error('Falha sintética de limpeza.');
    };
    const armazenamento = new ArmazenamentoPdf(diretorio, { ...fs, open: abrirComFalha, unlink: removerComFalha });
    await expect(armazenamento.gravar(randomUUID(), pdf)).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [{ message: 'Falha sintética de escrita.' }, { message: 'Falha sintética de limpeza.' }],
    });
    expect(await fs.readdir(diretorio)).toEqual([]);
  });

  it('informa falha de limpeza e permite verificar arquivo já publicado', async () => {
    const emissaoId = randomUUID();
    const removerComFalha: typeof fs.unlink = async (caminho) => {
      await fs.unlink(caminho);
      throw new Error('Falha sintética de limpeza.');
    };
    const falho = new ArmazenamentoPdf(diretorio, { ...fs, unlink: removerComFalha });
    await expect(falho.gravar(emissaoId, pdf)).rejects.toThrow('PDF pode ter sido gravado');
    const armazenamento = new ArmazenamentoPdf(diretorio);
    const resultado = await armazenamento.gravar(emissaoId, pdf);
    expect(resultado.reutilizado).toBe(true);
    expect((await armazenamento.ler(emissaoId, resultado.sha256)).equals(pdf)).toBe(true);
    expect(await fs.readdir(diretorio)).toEqual([`${emissaoId}.pdf`]);
  });
});
