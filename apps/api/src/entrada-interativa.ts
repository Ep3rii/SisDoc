import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

class SaidaLeitura extends Writable {
  silenciosa = false;

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (erro?: Error | null) => void): void {
    if (this.silenciosa) callback();
    else process.stdout.write(chunk, callback);
  }
}

export class EntradaInterativa {
  private readonly saida = new SaidaLeitura();
  private readonly leitura;
  private readonly abortar = new AbortController();

  constructor(mensagemSemTerminal: string) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error(mensagemSemTerminal);
    this.leitura = createInterface({ input: process.stdin, output: this.saida, terminal: true });
    this.leitura.on('SIGINT', () => this.abortar.abort());
  }

  perguntar(texto: string): Promise<string> {
    return this.leitura.question(texto, { signal: this.abortar.signal });
  }

  async segredo(texto: string): Promise<string> {
    process.stdout.write(texto);
    this.saida.silenciosa = true;
    try {
      return await this.leitura.question('', { signal: this.abortar.signal });
    } finally {
      this.saida.silenciosa = false;
      process.stdout.write('\n');
    }
  }

  fechar(): void {
    this.leitura.close();
  }
}
