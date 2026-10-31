import { randomUUID } from 'node:crypto';
import { dadosPdfProvisorioDofSchema, type DadosPdfProvisorioDof } from '@sisdoc/contratos';
import type { Pool } from 'pg';
import { z } from 'zod';
import { transacao } from '../banco';
import { ProtetorDados } from '../seguranca/protecao-dados';
import { ArmazenamentoPdf } from './armazenamento-pdf';

type Renderizar = (dados: DadosPdfProvisorioDof) => Promise<Buffer>;
type Armazenar = Pick<ArmazenamentoPdf, 'gravar'>;
type Trabalho = {
  id: string;
  emissaoId: string;
  documentoId: string;
  snapshotCifrado: Buffer;
  posse: string;
};
type Resultado =
  | { estado: 'sem_trabalho' }
  | { estado: 'posse_perdida'; jobId: string; emissaoId: string }
  | { estado: 'concluido'; jobId: string; emissaoId: string; artefatoId: string };
type ResultadoReagendamento = {
  estado: 'reagendado' | 'pendente' | 'processando' | 'concluido';
  jobId: string;
  emissaoId: string;
};

export class ProcessadorPdfProvisorio {
  constructor(
    private readonly banco: Pool,
    private readonly protetor: ProtetorDados,
    private readonly armazenamento: Armazenar,
    private readonly renderizar: Renderizar,
    private readonly duracaoPosseMs: number,
  ) {
    if (!Number.isSafeInteger(duracaoPosseMs) || duracaoPosseMs < 1 || duracaoPosseMs > 2147483647) {
      throw new Error('A duração da posse do job de PDF é inválida.');
    }
  }

  private async reivindicar(): Promise<Trabalho | null> {
    return transacao(this.banco, async (cliente) => {
      const consulta = await cliente.query<{
        id: string; emissao_id: string; documento_id: string; snapshot_cifrado: Buffer;
        status: 'pendente' | 'processando'; posse: string | null; posse_expira_em: Date | null;
      }>(`
        SELECT j.id, j.emissao_id, e.documento_id, e.snapshot_cifrado,
          j.status, j.posse, j.posse_expira_em
        FROM documentos.job_pdf j
        JOIN documentos.emissao e ON e.id = j.emissao_id
        JOIN documentos.documento d ON d.id = e.documento_id
        WHERE e.tipo = 'DOF' AND d.status IN ('emitido', 'cancelado')
          AND NOT EXISTS (SELECT 1 FROM documentos.emissao_aprovacao a WHERE a.emissao_id = e.id)
          AND (j.status = 'pendente' OR
            (j.status = 'processando' AND (j.posse IS NULL OR j.posse_expira_em <= clock_timestamp())))
        ORDER BY j.criado_em, j.id
        FOR UPDATE OF j SKIP LOCKED LIMIT 1
      `);
      const linha = consulta.rows[0];
      if (!linha) return null;
      if ((linha.status === 'pendente' && (linha.posse !== null || linha.posse_expira_em !== null))
          || (linha.status === 'processando' && (linha.posse === null || linha.posse_expira_em === null))) {
        throw new Error('O job de PDF está em estado de posse inconsistente.');
      }
      const posse = randomUUID();
      const atualizacao = await cliente.query(`
        UPDATE documentos.job_pdf SET status = 'processando', tentativas = tentativas + 1,
          erro_sanitizado = NULL, posse = $2, posse_expira_em = clock_timestamp() + $3::bigint * interval '1 millisecond',
          atualizado_em = clock_timestamp()
        WHERE id = $1
      `, [linha.id, posse, this.duracaoPosseMs]);
      if (atualizacao.rowCount !== 1) throw new Error('O job de PDF não pôde ser reivindicado.');
      return {
        id: linha.id, emissaoId: linha.emissao_id, documentoId: linha.documento_id,
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
          erro_sanitizado = 'Falha ao gerar ou gravar PDF provisório.', atualizado_em = clock_timestamp()
        WHERE id = $1 AND emissao_id = $2 AND status = 'processando' AND posse = $3
          AND posse_expira_em > clock_timestamp()
      `, [trabalho.id, trabalho.emissaoId, trabalho.posse]);
      return atualizado.rowCount === 1;
    });
  }

  async reagendar(jobId: string): Promise<ResultadoReagendamento> {
    const identificador = z.uuid().safeParse(jobId);
    if (!identificador.success) throw new Error('Identificador de job de PDF inválido.');
    return transacao(this.banco, async (cliente) => {
      const consulta = await cliente.query<{
        id: string; emissao_id: string; tipo: string; documento_status: string; oficial: boolean;
        status: 'pendente' | 'processando' | 'concluido' | 'falhou';
        posse: string | null; posse_expira_em: Date | null;
      }>(`
        SELECT j.id, j.emissao_id, e.tipo, d.status AS documento_status, j.status, j.posse, j.posse_expira_em,
          EXISTS (SELECT 1 FROM documentos.emissao_aprovacao a WHERE a.emissao_id = e.id) AS oficial
        FROM documentos.job_pdf j
        JOIN documentos.emissao e ON e.id = j.emissao_id
        JOIN documentos.documento d ON d.id = e.documento_id
        WHERE j.id = $1 FOR UPDATE OF j
      `, [identificador.data]);
      const linha = consulta.rows[0];
      if (!linha) throw new Error('Job de PDF não encontrado.');
      if (linha.tipo !== 'DOF' || linha.oficial || !['emitido', 'cancelado'].includes(linha.documento_status)) {
        throw new Error('Job incompatível com o processamento de PDF provisório.');
      }
      const artefato = await cliente.query<{ existe: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM documentos.artefato_pdf WHERE job_id = $1) AS existe', [linha.id],
      );
      if ((linha.status === 'processando' && (linha.posse === null || linha.posse_expira_em === null))
          || (linha.status !== 'processando' && (linha.posse !== null || linha.posse_expira_em !== null))
          || (linha.status === 'concluido') !== artefato.rows[0].existe) {
        throw new Error('O job de PDF está em estado inconsistente.');
      }
      if (linha.status === 'falhou') {
        const atualizado = await cliente.query(`
          UPDATE documentos.job_pdf SET status = 'pendente', erro_sanitizado = NULL,
            atualizado_em = clock_timestamp() WHERE id = $1 AND status = 'falhou'
        `, [linha.id]);
        if (atualizado.rowCount !== 1) throw new Error('O job de PDF não pôde ser reagendado.');
        return { estado: 'reagendado', jobId: linha.id, emissaoId: linha.emissao_id };
      }
      return { estado: linha.status, jobId: linha.id, emissaoId: linha.emissao_id };
    });
  }

  async processarUm(): Promise<Resultado> {
    const trabalho = await this.reivindicar();
    if (!trabalho) return { estado: 'sem_trabalho' };
    try {
      const protegido = this.protetor.decifrar(trabalho.snapshotCifrado, {
        schema: 'documentos', tabela: 'emissao', registroId: trabalho.emissaoId, campo: 'snapshot_cifrado',
      });
      const dados = dadosPdfProvisorioDofSchema.parse(JSON.parse(protegido.toString('utf8')));
      if (dados.documentoId.toLowerCase() !== trabalho.documentoId.toLowerCase()) {
        throw new Error('O snapshot não pertence ao documento da emissão.');
      }
      const pdf = await this.renderizar(dados);
      const arquivo = await this.armazenamento.gravar(trabalho.posse, pdf);
      if (arquivo.caminhoRelativo !== `${trabalho.posse}.pdf` || !/^[0-9a-f]{64}$/.test(arquivo.sha256)) {
        throw new Error('Os metadados do artefato de PDF são inválidos.');
      }
      if (!await this.concluir(trabalho, arquivo.caminhoRelativo, arquivo.sha256)) {
        return { estado: 'posse_perdida', jobId: trabalho.id, emissaoId: trabalho.emissaoId };
      }
      return {
        estado: 'concluido', jobId: trabalho.id, emissaoId: trabalho.emissaoId, artefatoId: trabalho.posse,
      };
    } catch (erro) {
      let atualizado: boolean;
      try {
        atualizado = await this.falhar(trabalho);
      } catch (erroAtualizacao) {
        throw new AggregateError([erro, erroAtualizacao], 'Falha no PDF e na atualização do job; consulte seu estado.');
      }
      throw new Error(
        atualizado
          ? 'Falha ao processar o PDF provisório; o job foi marcado como falho.'
          : 'Falha ao processar o PDF provisório; consulte o estado do job antes de tentar novamente.',
        { cause: erro },
      );
    }
  }
}
