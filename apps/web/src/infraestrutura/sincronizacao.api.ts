import {
  loteSincronizacaoSchema,
  paginaSincronizacoesSchema,
  situacaoSincronizacaoSchema,
  type IniciarSincronizacao,
  type LoteSincronizacao,
  type PaginaSincronizacoes,
  type SituacaoSincronizacao,
} from '@sisdoc/contratos';
import { parametros, requisitar, validar } from './http';

export const sincronizacaoApi = {
  /** Consulta situação da fonte externa sem iniciar sincronização. */
  async situacaoSincronizacao(): Promise<SituacaoSincronizacao> {
    return validar(situacaoSincronizacaoSchema, await requisitar('sincronizacao/situacao'));
  },
  /** Carrega histórico paginado de execuções administrativas. */
  async listarSincronizacoes(cursor?: string): Promise<PaginaSincronizacoes> {
    return validar(paginaSincronizacoesSchema, await requisitar(`admin/sincronizacoes?${parametros(cursor)}`));
  },
  /** Solicita execução completa ou incremental com proteção CSRF. */
  async iniciarSincronizacao(csrf: string, tipo: IniciarSincronizacao['tipo']): Promise<LoteSincronizacao> {
    return validar(loteSincronizacaoSchema, await requisitar('admin/sincronizacoes', 'POST', { tipo }, csrf));
  },
};
