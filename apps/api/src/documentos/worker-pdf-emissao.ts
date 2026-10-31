import type { OnModuleDestroy, OnApplicationBootstrap } from '@nestjs/common';
import { snapshotEmissaoDofSchema, type Configuracao } from '@sisdoc/contratos';
import type { Pool } from 'pg';
import type { Browser } from 'playwright';
import { ProtetorDados } from '../seguranca/protecao-dados';
import { ArmazenamentoPdf } from './armazenamento-pdf';
import { renderizarPdfEmissaoDof } from './pdf-emissao-dof';
import { ProcessadorPdfEmissao } from './processador-pdf-emissao';

const INTERVALO_MS = 1000;
const POSSE_MS = 120000;
const LOTE_MAXIMO = 10;

export class WorkerPdfEmissao implements OnApplicationBootstrap, OnModuleDestroy {
  private temporizador: NodeJS.Timeout | undefined;
  private execucao: Promise<void> | undefined;
  private navegador: Promise<Browser> | undefined;
  private encerrando = false;
  private readonly processador: ProcessadorPdfEmissao | undefined;

  constructor(banco: Pool, configuracao: Configuracao) {
    if (!configuracao.pdf) return;
    this.processador = new ProcessadorPdfEmissao(
      banco,
      new ProtetorDados(configuracao.chaves),
      new ArmazenamentoPdf(configuracao.pdf.diretorio),
      {
        DOF: async (snapshot, contexto) => {
          const dados = snapshotEmissaoDofSchema.parse(snapshot);
          if (dados.documentoId !== contexto.documentoId || dados.emissaoId !== contexto.emissaoId) {
            throw new Error('O snapshot não pertence à emissão processada.');
          }
          return renderizarPdfEmissaoDof(await this.obterNavegador(), dados);
        },
      },
      POSSE_MS,
    );
  }

  private obterNavegador(): Promise<Browser> {
    if (!this.navegador) {
      this.navegador = import('playwright').then(({ chromium }) => chromium.launch({ headless: true }));
      this.navegador.catch(() => { this.navegador = undefined; });
    }
    return this.navegador.then((navegador) => {
      if (navegador.isConnected()) return navegador;
      this.navegador = undefined;
      return this.obterNavegador();
    });
  }

  onApplicationBootstrap(): void {
    if (!this.processador || process.env.SISDOC_WORKER_PDF === 'desligado') return;
    this.temporizador = setInterval(() => {
      if (this.execucao || this.encerrando) return;
      this.execucao = this.ciclo().finally(() => { this.execucao = undefined; });
    }, INTERVALO_MS);
    this.temporizador.unref();
  }

  async ciclo(): Promise<void> {
    if (!this.processador) return;
    try {
      await this.processador.reagendarFalhos();
      for (let indice = 0; indice < LOTE_MAXIMO && !this.encerrando; indice += 1) {
        const resultado = await this.processador.processarUm();
        if (resultado.estado === 'sem_trabalho') break;
        if (resultado.estado === 'falhou') {
          process.stderr.write(`PDF da emissão ${resultado.emissaoId} falhou; nova tentativa será feita automaticamente.\n`);
        }
      }
    } catch {
      process.stderr.write('Falha no processamento de PDFs de emissão; nova tentativa no próximo ciclo.\n');
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.encerrando = true;
    if (this.temporizador) clearInterval(this.temporizador);
    if (this.execucao) await this.execucao;
    const navegador = this.navegador;
    this.navegador = undefined;
    if (navegador) {
      try {
        await (await navegador).close();
      } catch {
        // O navegador pode já ter sido encerrado; nada a liberar.
      }
    }
  }
}
