import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

type OperacoesArquivo = Pick<typeof fs, 'lstat' | 'realpath' | 'open' | 'readFile' | 'link' | 'unlink'>;
type ResultadoArmazenamento = { caminhoRelativo: string; sha256: string; reutilizado: boolean };

function identificadorEmissao(entrada: string): string {
  const resultado = z.uuid().safeParse(entrada);
  if (!resultado.success) throw new Error('Identificador de emissão inválido.');
  return resultado.data.toLowerCase();
}

function validarPdf(pdf: Buffer): void {
  if (!Buffer.isBuffer(pdf) || pdf.length < 16 || pdf.subarray(0, 5).toString('ascii') !== '%PDF-'
      || !/%%EOF[\t\n\r ]*$/.test(pdf.subarray(-128).toString('latin1'))) {
    throw new Error('O conteúdo do PDF está incompleto ou inválido.');
  }
}

function hash(pdf: Buffer): string {
  return createHash('sha256').update(pdf).digest('hex');
}

function temCodigo(erro: unknown, codigo: string): boolean {
  return typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === codigo;
}

async function escreverCompleto(arquivo: FileHandle, pdf: Buffer): Promise<void> {
  let falhou = false;
  let falha: unknown;
  try {
    await arquivo.writeFile(pdf);
    await arquivo.sync();
  } catch (erro) {
    falhou = true;
    falha = erro;
  }
  try {
    await arquivo.close();
  } catch (erro) {
    if (falhou) throw new AggregateError([falha, erro], 'Falha ao gravar e ao fechar o PDF temporário.');
    throw erro;
  }
  if (falhou) throw falha;
}

export class ArmazenamentoPdf {
  private readonly diretorio: string;

  constructor(diretorio: string, private readonly arquivos: OperacoesArquivo = fs) {
    if (!path.isAbsolute(diretorio) || path.parse(path.resolve(diretorio)).root === path.resolve(diretorio)) {
      throw new Error('O diretório de PDFs deve ser absoluto e não pode ser a raiz do volume.');
    }
    this.diretorio = path.resolve(diretorio);
  }

  private async raiz(): Promise<string> {
    const atributos = await this.arquivos.lstat(this.diretorio);
    if (!atributos.isDirectory() || atributos.isSymbolicLink()) {
      throw new Error('O diretório de PDFs não é uma pasta regular.');
    }
    const real = await this.arquivos.realpath(this.diretorio);
    if (path.parse(real).root === path.resolve(real)) throw new Error('O diretório de PDFs não pode ser a raiz do volume.');
    return real;
  }

  private async lerArquivo(caminho: string): Promise<Buffer> {
    const atributos = await this.arquivos.lstat(caminho);
    if (!atributos.isFile() || atributos.isSymbolicLink()) {
      throw new Error('O artefato de PDF não é um arquivo regular.');
    }
    return this.arquivos.readFile(caminho);
  }

  async gravar(emissaoId: string, pdf: Buffer): Promise<ResultadoArmazenamento> {
    const id = identificadorEmissao(emissaoId);
    validarPdf(pdf);
    const sha256 = hash(pdf);
    const raiz = await this.raiz();
    const caminhoRelativo = `${id}.pdf`;
    const destino = path.join(raiz, caminhoRelativo);
    const temporario = path.join(raiz, `.${id}.${randomUUID()}.tmp`);
    let criado = false;
    let falhou = false;
    let falha: unknown;
    let resultado: ResultadoArmazenamento | undefined;
    try {
      const arquivo = await this.arquivos.open(temporario, 'wx', 0o600);
      criado = true;
      await escreverCompleto(arquivo, pdf);
      const gravado = await this.lerArquivo(temporario);
      if (gravado.length !== pdf.length || hash(gravado) !== sha256) {
        throw new Error('A verificação do PDF temporário falhou.');
      }
      try {
        await this.arquivos.link(temporario, destino);
        resultado = { caminhoRelativo, sha256, reutilizado: false };
      } catch (erro) {
        if (!temCodigo(erro, 'EEXIST')) throw erro;
        const existente = await this.lerArquivo(destino);
        if (existente.length !== pdf.length || hash(existente) !== sha256) {
          throw new Error('Já existe um PDF diferente para esta emissão; verifique o artefato antes de continuar.');
        }
        resultado = { caminhoRelativo, sha256, reutilizado: true };
      }
    } catch (erro) {
      falhou = true;
      falha = erro;
    }
    if (criado) {
      try {
        await this.arquivos.unlink(temporario);
      } catch (erro) {
        if (falhou) throw new AggregateError([falha, erro], 'Falha ao gravar o PDF e ao limpar o arquivo temporário.');
        throw new Error('O PDF pode ter sido gravado, mas não foi possível limpar o arquivo temporário.', { cause: erro });
      }
    }
    if (falhou) throw falha;
    if (!resultado) throw new Error('Não foi possível confirmar a gravação do PDF.');
    return resultado;
  }

  async ler(emissaoId: string, sha256Esperado: string): Promise<Buffer> {
    const id = identificadorEmissao(emissaoId);
    if (!/^[0-9a-f]{64}$/.test(sha256Esperado)) throw new Error('O hash esperado do PDF é inválido.');
    const raiz = await this.raiz();
    const pdf = await this.lerArquivo(path.join(raiz, `${id}.pdf`));
    if (hash(pdf) !== sha256Esperado) throw new Error('O PDF armazenado não corresponde ao hash esperado.');
    validarPdf(pdf);
    return pdf;
  }
}
