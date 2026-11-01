import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  historicoEmissoesSchema,
  situacaoEmissaoSchema,
  type CancelarEmitido,
  type Configuracao,
  type ConsultaHistorico,
  type HistoricoEmissoes,
  type ItemHistorico,
  type SituacaoEmissao,
} from '@sisdoc/contratos';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { transacao } from '../banco';
import { dataEmSaoPaulo } from '../data';
import { auditarConsultaFuncional } from '../seguranca/auditoria-funcional';
import type { SessaoAutenticada } from '../seguranca/autenticacao';
import { papeisPermitidos, perfilPermiteAcao } from '../seguranca/permissoes';
import { ProtetorDados } from '../seguranca/protecao-dados';
import { confirmarSessao } from '../seguranca/sessao-transacao';
import { ArmazenamentoPdf } from './armazenamento-pdf';
import { MAXIMO_TENTATIVAS_PDF } from './processador-pdf-emissao';
import { nomePdf } from './nome-pdf';

type Falha = { tipo: 'invalido' | 'conflito' | 'nao_encontrado'; mensagem: string };
type Tentativa<T> = { valor: T } | { falha: Falha };
type LinhaSituacao = {
  id: string;
  documento_id: string;
  pessoa_id: string;
  tipo: SituacaoEmissao['tipo'];
  numero_formatado: string;
  emitido_em: Date;
  emitido_por: string;
  emitido_por_nome: string;
  criado_por: string;
  status: 'emitido' | 'cancelado';
  cancelado_em: Date | null;
  pdf_status: SituacaoEmissao['pdf']['status'];
  tentativas: number;
  erro_sanitizado: string | null;
  artefato_id: string | null;
  sha256: Buffer | null;
  nome: string;
  matricula: string;
};
export type PdfEmissao = { nome: string; conteudo: Buffer };

// O nome é o único campo do snapshot usado aqui; vale para DOF e DTC.
const nomeSnapshotSchema = z.looseObject({ nome: z.string().min(1) });

const tiposPorGrupo = {
  DOF: ['DOF'],
  DTC: ['DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS'],
} as const;

function concluir<T>(tentativa: Tentativa<T>): T {
  if ('valor' in tentativa) return tentativa.valor;
  if (tentativa.falha.tipo === 'conflito') throw new ConflictException(tentativa.falha.mensagem);
  if (tentativa.falha.tipo === 'nao_encontrado') throw new NotFoundException(tentativa.falha.mensagem);
  throw new BadRequestException(tentativa.falha.mensagem);
}

const consultaSituacao = `
  SELECT e.id, e.documento_id, d.pessoa_id, e.tipo, e.numero_formatado, e.emitido_em, e.emitido_por,
    emitente.nome AS emitido_por_nome, d.criado_por, d.status, d.cancelado_em,
    j.status AS pdf_status, j.tentativas, j.erro_sanitizado, p.id AS artefato_id, p.sha256,
    pessoa.nome, v.matricula
  FROM documentos.emissao e
  JOIN documentos.emissao_aprovacao a ON a.emissao_id = e.id
  JOIN documentos.documento d ON d.id = e.documento_id
  JOIN nucleo.pessoa pessoa ON pessoa.id = d.pessoa_id
  JOIN nucleo.vinculo v ON v.id = d.vinculo_id
  JOIN seguranca.usuario emitente ON emitente.id = e.emitido_por
  JOIN documentos.job_pdf j ON j.emissao_id = e.id
  LEFT JOIN documentos.artefato_pdf p ON p.emissao_id = e.id
`;

function apresentarSituacao(linha: LinhaSituacao): SituacaoEmissao {
  const disponivel = linha.pdf_status === 'concluido' && linha.artefato_id !== null;
  let erro = linha.erro_sanitizado;
  if (linha.pdf_status === 'falhou' && linha.tentativas >= MAXIMO_TENTATIVAS_PDF) {
    erro = 'A geração do PDF falhou repetidamente. Solicite ao administrador a verificação do Chromium e do diretório de PDFs; o número da emissão está preservado.';
  }
  return situacaoEmissaoSchema.parse({
    emissaoId: linha.id,
    documentoId: linha.documento_id,
    tipo: linha.tipo,
    numero: linha.numero_formatado,
    emitidoEm: linha.emitido_em.toISOString(),
    emitidoPorNome: linha.emitido_por_nome,
    status: linha.status,
    canceladoEm: linha.cancelado_em?.toISOString() ?? null,
    pdf: { status: linha.pdf_status, tentativas: linha.tentativas, erro, disponivel },
  });
}

export async function consultarSituacaoEmissao(cliente: PoolClient, emissaoId: string): Promise<SituacaoEmissao> {
  const consulta = await cliente.query<LinhaSituacao>(`${consultaSituacao} WHERE e.id = $1`, [emissaoId]);
  if (!consulta.rows[0]) throw new Error('Emissão oficial não encontrada.');
  return apresentarSituacao(consulta.rows[0]);
}

export class EmissoesService {
  private readonly protetor: ProtetorDados;
  private readonly armazenamento: ArmazenamentoPdf | null;

  constructor(private readonly banco: Pool, configuracao: Configuracao) {
    this.protetor = new ProtetorDados(configuracao.chaves);
    const diretorio = configuracao.pdf?.diretorio;
    this.armazenamento = diretorio ? new ArmazenamentoPdf(diretorio) : null;
  }

  private participa(sessao: SessaoAutenticada, linha: Pick<LinhaSituacao, 'criado_por' | 'emitido_por'>): boolean {
    return linha.criado_por === sessao.usuario.id || linha.emitido_por === sessao.usuario.id;
  }

  private podeVer(sessao: SessaoAutenticada, linha: LinhaSituacao): boolean {
    return (this.participa(sessao, linha) && perfilPermiteAcao(sessao.usuario.papel, 'consultar_emissoes'))
      || perfilPermiteAcao(sessao.usuario.papel, 'historico_terceiros');
  }

  private snapshot(linha: Pick<LinhaSituacao, 'id'>, cifrado: Buffer): { nome: string } {
    return nomeSnapshotSchema.parse(JSON.parse(this.protetor.decifrar(cifrado, {
      schema: 'documentos', tabela: 'emissao', registroId: linha.id, campo: 'snapshot_cifrado',
    }).toString('utf8')));
  }

  async situacao(sessao: SessaoAutenticada, ip: string, id: string): Promise<SituacaoEmissao> {
    const tentativa = await transacao<Tentativa<SituacaoEmissao>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_emissoes'));
      const consulta = await cliente.query<LinhaSituacao>(`${consultaSituacao} WHERE e.id = $1`, [id]);
      const linha = consulta.rows[0];
      const visivel = linha && (this.podeVer(sessao, linha) || perfilPermiteAcao(sessao.usuario.papel, 'cancelar_emitido'));
      if (!linha || !visivel) {
        await auditarConsultaFuncional(cliente, sessao, 'emissao_nao_encontrada', 'emissao', id, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'Emissão não encontrada.' } };
      }
      await auditarConsultaFuncional(cliente, sessao, 'emissao_consultada', 'emissao', id, linha.pessoa_id, ip);
      return { valor: apresentarSituacao(linha) };
    });
    return concluir(tentativa);
  }

  async pdf(sessao: SessaoAutenticada, ip: string, id: string): Promise<PdfEmissao> {
    if (!this.armazenamento) {
      throw new ServiceUnavailableException('O diretório de PDFs não está configurado. Solicite a verificação da instalação.');
    }
    const armazenamento = this.armazenamento;
    const tentativa = await transacao<Tentativa<PdfEmissao>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_emissoes'));
      const consulta = await cliente.query<LinhaSituacao & { snapshot_cifrado: Buffer }>(`
        ${consultaSituacao.replace('SELECT e.id,', 'SELECT e.snapshot_cifrado, e.id,')} WHERE e.id = $1
      `, [id]);
      const linha = consulta.rows[0];
      if (!linha || !this.podeVer(sessao, linha)) {
        await auditarConsultaFuncional(cliente, sessao, 'pdf_nao_encontrado', 'emissao', id, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'Emissão não encontrada.' } };
      }
      if (linha.pdf_status !== 'concluido' || !linha.artefato_id || !linha.sha256) {
        await auditarConsultaFuncional(cliente, sessao, 'pdf_indisponivel', 'emissao', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'O PDF ainda não está disponível. Aguarde a geração e tente novamente.' } };
      }
      const dados = this.snapshot(linha, linha.snapshot_cifrado);
      const mesmoDia = await cliente.query<{ id: string; snapshot_cifrado: Buffer }>(`
        SELECT e.id, e.snapshot_cifrado FROM documentos.emissao e
        JOIN documentos.emissao_aprovacao a ON a.emissao_id = e.id
        WHERE e.tipo = $1 AND (e.emitido_em AT TIME ZONE 'America/Sao_Paulo')::date = $2::date
          AND (e.emitido_em, e.id) < (SELECT r.emitido_em, r.id FROM documentos.emissao r WHERE r.id = $3)
      `, [linha.tipo, dataEmSaoPaulo(linha.emitido_em), linha.id]);
      const base = nomePdf({ nome: dados.nome, tipo: linha.tipo, emitidoEm: linha.emitido_em, colisao: 1 });
      const anteriores = mesmoDia.rows.filter((outra) => nomePdf({
        nome: this.snapshot(outra, outra.snapshot_cifrado).nome, tipo: linha.tipo, emitidoEm: linha.emitido_em, colisao: 1,
      }) === base).length;
      let conteudo: Buffer;
      try {
        conteudo = await armazenamento.ler(linha.artefato_id, linha.sha256.toString('hex'));
      } catch {
        await auditarConsultaFuncional(cliente, sessao, 'pdf_integridade_falhou', 'emissao', id, linha.pessoa_id, ip);
        return {
          falha: {
            tipo: 'conflito',
            mensagem: 'O arquivo PDF armazenado não pôde ser validado. Solicite ao administrador a verificação de integridade.',
          },
        };
      }
      await auditarConsultaFuncional(cliente, sessao, 'pdf_baixado', 'emissao', id, linha.pessoa_id, ip);
      return {
        valor: {
          nome: nomePdf({ nome: dados.nome, tipo: linha.tipo, emitidoEm: linha.emitido_em, colisao: anteriores + 1 }),
          conteudo,
        },
      };
    });
    return concluir(tentativa);
  }

  async historico(sessao: SessaoAutenticada, ip: string, consulta: ConsultaHistorico): Promise<HistoricoEmissoes> {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_emissoes'));
      const papel = sessao.usuario.papel;
      const todos = consulta.escopo === 'todos';
      if (todos && !perfilPermiteAcao(papel, 'historico_terceiros') && !perfilPermiteAcao(papel, 'cancelar_emitido')) {
        throw new BadRequestException('Seu perfil consulta apenas as próprias emissões.');
      }
      const linhas = await cliente.query<LinhaSituacao>(`
        ${consultaSituacao}
        WHERE e.tipo = ANY($1::text[]) AND ($2::boolean OR d.criado_por = $3 OR e.emitido_por = $3)
        ORDER BY e.emitido_em DESC, e.id DESC LIMIT $4
      `, [tiposPorGrupo[consulta.tipo], todos, sessao.usuario.id, todos ? 50 : 5]);
      await auditarConsultaFuncional(
        cliente, sessao, todos ? 'historico_geral_consultado' : 'historico_consultado', 'emissao', null, null, ip,
      );
      const itens: ItemHistorico[] = linhas.rows.map((linha) => {
        const situacao = apresentarSituacao(linha);
        const participa = this.participa(sessao, linha);
        const ve = this.podeVer(sessao, linha);
        return {
          ...situacao,
          nome: ve ? linha.nome : null,
          matricula: ve ? linha.matricula : null,
          podeCopiar: perfilPermiteAcao(papel, 'criar_rascunho')
            && (participa || papel === 'coordenador' || papel === 'admin'),
          podeCancelar: linha.status === 'emitido' && perfilPermiteAcao(papel, 'cancelar_emitido'),
          podeBaixar: ve && situacao.pdf.disponivel,
        };
      });
      return historicoEmissoesSchema.parse({ grupo: consulta.tipo, escopo: consulta.escopo, itens });
    });
  }

  async cancelar(sessao: SessaoAutenticada, ip: string, documentoId: string, dados: CancelarEmitido): Promise<SituacaoEmissao> {
    const tentativa = await transacao<Tentativa<SituacaoEmissao>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('cancelar_emitido'));
      const documento = await cliente.query<{ status: string; pessoa_id: string; emissao_id: string | null }>(`
        SELECT d.status, d.pessoa_id, a.emissao_id FROM documentos.documento d
        LEFT JOIN documentos.emissao e ON e.documento_id = d.id
        LEFT JOIN documentos.emissao_aprovacao a ON a.emissao_id = e.id
        WHERE d.id = $1 FOR UPDATE OF d
      `, [documentoId]);
      const linha = documento.rows[0];
      if (!linha || !linha.emissao_id) {
        await auditarConsultaFuncional(cliente, sessao, 'cancelamento_emitido_nao_encontrado', 'documento', documentoId, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'Documento emitido não encontrado.' } };
      }
      if (linha.status !== 'emitido') {
        await auditarConsultaFuncional(cliente, sessao, 'cancelamento_emitido_recusado', 'documento', documentoId, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'O documento já está cancelado.' } };
      }
      const motivo = this.protetor.cifrar(Buffer.from(dados.motivo, 'utf8'), {
        schema: 'documentos', tabela: 'documento', registroId: documentoId, campo: 'motivo_cancelamento_cifrado',
      });
      const atualizado = await cliente.query(`
        UPDATE documentos.documento SET status = 'cancelado', cancelado_por = $2, cancelado_em = now(),
          motivo_cancelamento_cifrado = $3, atualizado_por = $2, atualizado_em = now()
        WHERE id = $1 AND status = 'emitido'
      `, [documentoId, sessao.usuario.id, motivo]);
      if (atualizado.rowCount !== 1) throw new Error('O cancelamento do documento emitido não pôde ser registrado.');
      await auditarConsultaFuncional(cliente, sessao, 'documento_emitido_cancelado', 'documento', documentoId, linha.pessoa_id, ip);
      return { valor: await consultarSituacaoEmissao(cliente, linha.emissao_id) };
    });
    return concluir(tentativa);
  }
}
