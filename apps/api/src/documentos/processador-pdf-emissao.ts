import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { transacao } from '../banco';
import { ProtetorDados } from '../seguranca/protecao-dados';
import { ArmazenamentoPdf } from './armazenamento-pdf';

export type TipoEmissao = 'DOF' | 'DTC_IPAM' | 'DTC_COMISSIONADO' | 'DTC_INSS';
export type RenderizadorEmissao = (snapshot: unknown, contexto: { documentoId: string; emissaoId: string }) => Promise<Buffer>;
export type RenderizadoresEmissao = Partial<Record<TipoEmissao, RenderizadorEmissao>>;
type Armazenar = Pick<ArmazenamentoPdf, 'gravar'>;
type Trabalho = {
  id: string;
  emissaoId: string;
  documentoId: string;
  tipo: TipoEmissao;
  snapshotCifrado: Buffer;
  posse: string;
};
export type ResultadoProcessamentoEmissao =
  | { estado: 'sem_trabalho' }
  | { estado: 'posse_perdida'; jobId: string; emissaoId: string }
  | { estado: 'falhou'; jobId: string; emissaoId: string }
  | { estado: 'concluido'; jobId: string; emissaoId: string; artefatoId: string };

export const MAXIMO_TENTATIVAS_PDF = 5;
const erroSanitizado = 'Falha ao gerar ou gravar o PDF da emissão; nova tentativa automática com o mesmo número.';

// Processa apenas emissões oficiais (com aprovação formal vinculada); jobs provisórios ficam fora deste worker.
export class ProcessadorPdfEmissao {
  constructor(
    private readonly banco: Pool,
    private readonly protetor: ProtetorDados,
    private readonly armazenamento: Armazenar,
    private readonly renderizadores: RenderizadoresEmissao,
    private readonly duracaoPosseMs: number,
  ) {
    if (!Number.isSafeInteger(duracaoPosseMs) || duracaoPosseMs < 1 || duracaoPosseMs > 2147483647) {
      throw new Error('A duração da posse do job de PDF é inválida.');
    }
  }

  private tipos(): TipoEmissao[] {
    return (Object.keys(this.renderizadores) as TipoEmissao[]).filter((tipo) => this.renderizadores[tipo]);
  }

  async reagendarFalhos(): Promise<number> {
    const tipos = this.tipos();
    if (tipos.length === 0) return 0;
    return transacao(this.banco, async (cliente) => {
      const atualizado = await cliente.query(`
        UPDATE documentos.job_pdf j SET status = 'pendente', atualizado_em = clock_timestamp()
        FROM documentos.emissao e, documentos.emissao_aprovacao a
        WHERE e.id = j.emissao_id AND a.emissao_id = e.id AND e.tipo = ANY($1::text[])
          AND j.status = 'falhou' AND j.tentativas < $2 AND j.posse IS NULL
          AND NOT EXISTS (SELECT 1 FROM documentos.artefato_pdf p WHERE p.job_id = j.id)
          AND j.atualizado_em <= clock_timestamp() - (least(j.tentativas, 5) * interval '2 seconds')
      `, [tipos, MAXIMO_TENTATIVAS_PDF]);
      return atualizado.rowCount ?? 0;
    });
  }

  async reagendar(jobId: string): Promise<'reagendado' | 'pendente' | 'processando' | 'concluido'> {
    const identificador = z.uuid().safeParse(jobId);
    if (!identificador.success) throw new Error('Identificador de job de PDF inválido.');
    return transacao(this.banco, async (cliente) => {
      const consulta = await cliente.query<{ status: 'pendente' | 'processando' | 'concluido' | 'falhou' }>(`
        SELECT j.status FROM documentos.job_pdf j
        JOIN documentos.emissao_aprovacao a ON a.emissao_id = j.emissao_id
        WHERE j.id = $1 FOR UPDATE OF j
      `, [identificador.data]);
      const linha = consulta.rows[0];
      if (!linha) throw new Error('Job de PDF não encontrado.');
      if (linha.status !== 'falhou') return linha.status;
      await cliente.query(`
        UPDATE documentos.job_pdf SET status = 'pendente', erro_sanitizado = NULL,
          atualizado_em = clock_timestamp() WHERE id = $1 AND status = 'falhou'
      `, [identificador.data]);
      return 'reagendado';
    });
  }

  private async reivindicar(): Promise<Trabalho | null> {
    const tipos = this.tipos();
    if (tipos.length === 0) return null;
    return transacao(this.banco, async (cliente) => {
      const consulta = await cliente.query<{
        id: string; emissao_id: string; documento_id: string; tipo: TipoEmissao; snapshot_cifrado: Buffer;
        status: 'pendente' | 'processando'; posse: string | null; posse_expira_em: Date | null;
      }>(`
        SELECT j.id, j.emissao_id, e.documento_id, e.tipo, e.snapshot_cifrado, j.status, j.posse, j.posse_expira_em
        FROM documentos.job_pdf j
        JOIN documentos.emissao e ON e.id = j.emissao_id
        JOIN documentos.emissao_aprovacao a ON a.emissao_id = e.id
        JOIN documentos.documento d ON d.id = e.documento_id
        WHERE e.tipo = ANY($1::text[]) AND d.status IN ('emitido', 'cancelado')
          AND (j.status = 'pendente' OR
            (j.status = 'processando' AND (j.posse IS NULL OR j.posse_expira_em <= clock_timestamp())))
        ORDER BY j.criado_em, j.id
        FOR UPDATE OF j SKIP LOCKED LIMIT 1
      `, [tipos]);
      const linha = consulta.rows[0];
      if (!linha) return null;
      const posse = randomUUID();
      const atualizacao = await cliente.query(`
        UPDATE documentos.job_pdf SET status = 'processando', tentativas = tentativas + 1,
          erro_sanitizado = NULL, posse = $2, posse_expira_em = clock_timestamp() + $3::bigint * interval '1 millisecond',
          atualizado_em = clock_timestamp()
        WHERE id = $1
      `, [linha.id, posse, this.duracaoPosseMs]);
      if (atualizacao.rowCount !== 1) throw new Error('O job de PDF não pôde ser reivindicado.');
      return {
        id: linha.id, emissaoId: linha.emissao_id, documentoId: linha.documento_id, tipo: linha.tipo,
        snapshotCifrado: linha.snapshot_cifrado, posse,
      };
    });
  }

  private async concluir(trabalho: Trabalho, caminho: string, sha256: string): Promise<boolean> {
    return transacao(this.banco, async (cliente) => {
      const posse = await cliente.query(`
        SELECT 1 FROM documentos.job_pdf
        WHERE id = $1 AND emissao_id = $2 AND status = 'processando' AND posse = $3
          AND posse_expira_em > clock_timestamp()
        FOR UPDATE
      `, [trabalho.id, trabalho.emissaoId, trabalho.posse]);
      if (posse.rowCount !== 1) return false;
      await cliente.query(`
        INSERT INTO documentos.artefato_pdf (id, emissao_id, job_id, caminho_relativo, sha256)
        VALUES ($1, $2, $3, $4, $5)
      `, [trabalho.posse, trabalho.emissaoId, trabalho.id, caminho, Buffer.from(sha256, 'hex')]);
      const atualizado = await cliente.query(`
        UPDATE documentos.job_pdf SET status = 'concluido', posse = NULL, posse_expira_em = NULL,
          erro_sanitizado = NULL, atualizado_em = clock_timestamp() WHERE id = $1
      `, [trabalho.id]);
      if (atualizado.rowCount !== 1) throw new Error('O job de PDF não pôde ser concluído.');
      return true;
    });
  }

  private async falhar(trabalho: Trabalho): Promise<boolean> {
    return transacao(this.banco, async (cliente) => {
      const atualizado = await cliente.query(`
        UPDATE documentos.job_pdf SET status = 'falhou', posse = NULL, posse_expira_em = NULL,
          erro_sanitizado = $4, atualizado_em = clock_timestamp()
        WHERE id = $1 AND emissao_id = $2 AND status = 'processando' AND posse = $3
          AND posse_expira_em > clock_timestamp()
      `, [trabalho.id, trabalho.emissaoId, trabalho.posse, erroSanitizado]);
      return atualizado.rowCount === 1;
    });
  }

  async processarUm(): Promise<ResultadoProcessamentoEmissao> {
    const trabalho = await this.reivindicar();
    if (!trabalho) return { estado: 'sem_trabalho' };
    try {
      const renderizar = this.renderizadores[trabalho.tipo];
      if (!renderizar) throw new Error('Tipo de documento sem template de emissão.');
      const protegido = this.protetor.decifrar(trabalho.snapshotCifrado, {
        schema: 'documentos', tabela: 'emissao', registroId: trabalho.emissaoId, campo: 'snapshot_cifrado',
      });
      const snapshot: unknown = JSON.parse(protegido.toString('utf8'));
      const pdf = await renderizar(snapshot, { documentoId: trabalho.documentoId, emissaoId: trabalho.emissaoId });
      const arquivo = await this.armazenamento.gravar(trabalho.posse, pdf);
      if (arquivo.caminhoRelativo !== `${trabalho.posse}.pdf` || !/^[0-9a-f]{64}$/.test(arquivo.sha256)) {
        throw new Error('Os metadados do artefato de PDF são inválidos.');
      }
      if (!await this.concluir(trabalho, arquivo.caminhoRelativo, arquivo.sha256)) {
        return { estado: 'posse_perdida', jobId: trabalho.id, emissaoId: trabalho.emissaoId };
      }
      return { estado: 'concluido', jobId: trabalho.id, emissaoId: trabalho.emissaoId, artefatoId: trabalho.posse };
    } catch (erro) {
      let atualizado: boolean;
      try {
        atualizado = await this.falhar(trabalho);
      } catch (erroAtualizacao) {
        throw new AggregateError([erro, erroAtualizacao], 'Falha no PDF e na atualização do job; consulte seu estado.');
      }
      if (!atualizado) return { estado: 'posse_perdida', jobId: trabalho.id, emissaoId: trabalho.emissaoId };
      return { estado: 'falhou', jobId: trabalho.id, emissaoId: trabalho.emissaoId };
    }
  }
}
