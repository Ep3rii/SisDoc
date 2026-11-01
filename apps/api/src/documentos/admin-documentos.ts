import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Configuracao } from '@sisdoc/contratos';
import { DatabaseError, type Pool, type PoolClient } from 'pg';
import { z } from 'zod';
import { transacao } from '../banco';
import type { SessaoAutenticada } from '../seguranca/autenticacao';
import { papeisPermitidos } from '../seguranca/permissoes';
import { confirmarSessao } from '../seguranca/sessao-transacao';
import { ArmazenamentoPdf } from './armazenamento-pdf';

const entradaExclusaoSchema = z.strictObject({
  revisao: z.number().int().min(1).max(2147483647),
  motivo: z.string().trim().min(15).max(2000),
  confirmacao: z.string().min(1).max(100),
});

export type EntradaExclusaoDocumento = z.infer<typeof entradaExclusaoSchema>;
export type ResultadoExclusaoDocumento = {
  solicitacaoId: string;
  estado: 'pendente' | 'concluido';
  numero: string | null;
};

type Solicitacao = {
  id: string;
  documento_id: string;
  solicitado_por: string;
  artefato_id: string | null;
  sha256_pdf: Buffer | null;
  status: 'pendente' | 'concluido';
};

const INTERVALO_MS = 1500;
const TENTATIVAS_CICLO = 5;

function erroBanco(erro: unknown): never {
  if (!(erro instanceof DatabaseError)) throw erro;
  if (erro.code === 'P0002') throw new NotFoundException('Documento não encontrado.');
  if (erro.code === '23503') {
    throw new ConflictException('O documento possui cópias dependentes. Remova essas cópias antes de excluí-lo.');
  }
  if (erro.code === '23505') throw new ConflictException('A exclusão deste documento já foi solicitada.');
  if (erro.code === '40001') throw new ConflictException('A revisão do documento mudou. Atualize a lista antes de excluir.');
  if (erro.code === '42501') throw new ConflictException('A exclusão exige uma conta administradora ativa.');
  if (erro.code === '22023') throw new BadRequestException('Confira a confirmação, a revisão e o motivo da exclusão.');
  throw erro;
}

export class AdminDocumentosService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly armazenamento: ArmazenamentoPdf | null;
  private temporizador: NodeJS.Timeout | undefined;
  private execucao: Promise<void> | undefined;
  private encerrando = false;

  constructor(private readonly banco: Pool, configuracao: Configuracao) {
    this.armazenamento = configuracao.pdf ? new ArmazenamentoPdf(configuracao.pdf.diretorio) : null;
  }

  async excluir(
    sessao: SessaoAutenticada,
    documentoId: string,
    dados: EntradaExclusaoDocumento,
  ): Promise<ResultadoExclusaoDocumento> {
    if (dados.confirmacao !== `EXCLUIR DOCUMENTO ${documentoId}`) {
      throw new BadRequestException('Digite a confirmação exata apresentada para excluir este documento.');
    }
    let solicitacaoId: string;
    try {
      solicitacaoId = await transacao(this.banco, async (cliente) => {
        await confirmarSessao(cliente, sessao, papeisPermitidos('administrar_documentos'));
        const resultado = await cliente.query<{ id: string }>(
          `SELECT documentos.solicitar_exclusao_documento_admin($1, $2, $3, $4, $5) AS id`,
          [documentoId, sessao.usuario.id, dados.revisao, dados.motivo, dados.confirmacao],
        );
        return resultado.rows[0].id;
      });
    } catch (erro) {
      erroBanco(erro);
    }

    const concluida = await this.processarSolicitacao(solicitacaoId);
    const estado = concluida ? 'concluido' : 'pendente';
    const resultado = await transacao(this.banco, async (cliente) => {
      const consulta = await cliente.query<{ status: string; numero_formatado: string | null }>(
        'SELECT * FROM documentos.consultar_exclusao_admin($1)', [solicitacaoId],
      );
      return consulta.rows[0];
    });
    return { solicitacaoId, estado: resultado?.status === 'concluido' ? 'concluido' : estado,
      numero: resultado?.numero_formatado ?? null };
  }

  onApplicationBootstrap(): void {
    if (process.env.SISDOC_WORKER_EXCLUSAO === 'desligado') return;
    this.temporizador = setInterval(() => {
      if (this.execucao || this.encerrando) return;
      this.execucao = this.ciclo().finally(() => { this.execucao = undefined; });
    }, INTERVALO_MS);
    this.temporizador.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.encerrando = true;
    if (this.temporizador) clearInterval(this.temporizador);
    if (this.execucao) await this.execucao;
  }

  private async ciclo(): Promise<void> {
    try {
      const ids = await transacao(this.banco, async (cliente) => {
        const resultado = await cliente.query<{ id: string }>(
          'SELECT * FROM documentos.listar_exclusoes_pendentes_admin($1)', [TENTATIVAS_CICLO],
        );
        return resultado.rows.map((linha) => linha.id);
      });
      for (const id of ids) {
        if (this.encerrando) break;
        await this.processarSolicitacao(id);
      }
    } catch {
      process.stderr.write('Falha ao processar exclusões administrativas; nova tentativa no próximo ciclo.\n');
    }
  }

  private async processarSolicitacao(id: string): Promise<boolean> {
    try {
      return await transacao(this.banco, async (cliente) => {
        const consulta = await cliente.query<Solicitacao>(
          'SELECT * FROM documentos.reservar_exclusao_pendente_admin($1)', [id],
        );
        const solicitacao = consulta.rows[0];
        if (!solicitacao) {
          const estado = await cliente.query<{ status: string }>(
            'SELECT status FROM documentos.consultar_exclusao_admin($1)', [id],
          );
          return estado.rows[0]?.status === 'concluido';
        }
        await cliente.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [solicitacao.documento_id],
        );

        let pdfRemovido = false;
        if (solicitacao.artefato_id) {
          if (!this.armazenamento || !solicitacao.sha256_pdf) {
            throw new ServiceUnavailableException('O diretório do PDF não está configurado.');
          }
          await this.armazenamento.remover(solicitacao.artefato_id, solicitacao.sha256_pdf.toString('hex'));
          pdfRemovido = true;
        }
        await cliente.query(
          'SELECT documentos.finalizar_exclusao_documento_admin($1, $2)',
          [solicitacao.id, pdfRemovido],
        );
        return true;
      });
    } catch {
      try {
        await transacao(this.banco, async (cliente: PoolClient) => {
          await cliente.query('SELECT documentos.registrar_falha_exclusao_documento_admin($1)', [id]);
        });
      } catch {
        process.stderr.write('A exclusão administrativa permanece pendente e será verificada novamente.\n');
      }
      return false;
    }
  }
}

export { entradaExclusaoSchema };
