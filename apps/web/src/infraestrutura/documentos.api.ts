import {
  historicoEmissoesSchema,
  resultadoCopiaEmitidoSchema,
  resultadoExclusaoDocumentoSchema,
  situacaoEmissaoSchema,
  type CancelarEmitido,
  type ExcluirDocumento,
  type GrupoHistorico,
  type HistoricoEmissoes,
  type ResultadoCopiaEmitido,
  type ResultadoExclusaoDocumento,
  type SituacaoEmissao,
  type TipoDtc
} from '@sisdoc/contratos';
import { ErroApi, requisitar, validar } from './http';

export const documentosApi = {
  /** Consulta estado do PDF e identificação de uma emissão existente. */
  async situacaoEmissao(id: string): Promise<SituacaoEmissao> {
    return validar(situacaoEmissaoSchema, await requisitar(`emissoes/${id}`));
  },
  /** Consulta emissões no grupo e escopo autorizados, sem simular paginação global. */
  async historico(tipo: GrupoHistorico, escopo: 'proprio' | 'todos'): Promise<HistoricoEmissoes> {
    return validar(historicoEmissoesSchema, await requisitar(`historico?${new URLSearchParams({ tipo, escopo }).toString()}`));
  },
  /** Cria rascunho a partir de emissão, preservando o original. */
  async copiarEmitido(csrf: string, documentoId: string, tipo: 'DOF' | TipoDtc = 'DOF'): Promise<ResultadoCopiaEmitido> {
    return validar(resultadoCopiaEmitidoSchema, await requisitar(
      `${tipo === 'DOF' ? 'documentos' : 'dtc'}/${documentoId}/copia`, 'POST', { confirmar: true }, csrf,
    ));
  },
  /** Solicita exclusão física com motivo e confirmação textual obrigatórios. */
  async excluirDocumento(
    csrf: string, documentoId: string, dados: ExcluirDocumento,
  ): Promise<ResultadoExclusaoDocumento> {
    return validar(resultadoExclusaoDocumentoSchema, await requisitar(
      `admin/documentos/${documentoId}/excluir`, 'POST', dados, csrf,
    ));
  },
  /** Cancela emissão com motivo, preservando número e registro original. */
  async cancelarEmitido(csrf: string, documentoId: string, dados: CancelarEmitido): Promise<SituacaoEmissao> {
    return validar(situacaoEmissaoSchema, await requisitar(`documentos/${documentoId}/cancelar`, 'POST', dados, csrf));
  },
  /** Baixa PDF autenticado, validando tipo de conteúdo e nome seguro retornado. */
  async baixarPdf(emissaoId: string): Promise<{ nome: string; arquivo: Blob }> {
    let resposta: Response;
    try {
      resposta = await fetch(`/api/v1/emissoes/${emissaoId}/pdf`, {
        credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/pdf' },
      });
    } catch {
      throw new ErroApi(0, 'Não foi possível conectar ao SisDoc. Verifique a conexão e tente novamente.');
    }
    if (!resposta.ok) {
      let detalhe = 'Não foi possível baixar o PDF. Tente novamente mais tarde.';
      try {
        const dados: unknown = await resposta.json();
        if (typeof dados === 'object' && dados !== null && 'detail' in dados && typeof dados.detail === 'string') {
          detalhe = dados.detail;
        }
      } catch {
        // Mantém a mensagem genérica quando o corpo não é JSON.
      }
      throw new ErroApi(resposta.status, detalhe);
    }
    const nome = /filename="([A-Za-z0-9_.-]+\.pdf)"/.exec(resposta.headers.get('Content-Disposition') ?? '')?.[1];
    if (!nome || resposta.headers.get('Content-Type') !== 'application/pdf') {
      throw new ErroApi(0, 'O servidor retornou um arquivo inválido. Contate o administrador.');
    }
    return { nome, arquivo: await resposta.blob() };
  },
};
