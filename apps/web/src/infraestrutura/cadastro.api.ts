import {
  detalheServidorSchema,
  paginaBuscaServidoresSchema,
  paginaEventosServidorSchema,
  resultadoEdicaoServidorSchema,
  type AtualizarServidor,
  type DetalheServidor,
  type PaginaBuscaServidores,
  type PaginaEventosServidor,
  type ResultadoEdicaoServidor,
  type TipoBuscaServidor
} from '@sisdoc/contratos';
import { parametros, requisitar, validar } from './http';

export const cadastroApi = {
  /** Pesquisa no banco local em páginas de 50; ausência de termo usa ordem natural da matrícula. */
  async buscarServidores(q?: string, tipo?: TipoBuscaServidor, cursor?: string): Promise<PaginaBuscaServidores> {
    const consulta = new URLSearchParams({ limite: '50' });
    if (q) consulta.set('q', q);
    if (tipo) consulta.set('tipo', tipo);
    if (cursor) consulta.set('cursor', cursor);
    return validar(paginaBuscaServidoresSchema, await requisitar(`servidores?${consulta.toString()}`));
  },
  /** Carrega identificação e vínculos locais paginados de uma pessoa. */
  async servidor(id: string, cursor?: string): Promise<DetalheServidor> {
    return validar(detalheServidorSchema, await requisitar(`servidores/${id}?${parametros(cursor)}`));
  },
  /** Envia edição local com motivo e revisões para detectar concorrência. */
  async atualizarServidor(csrf: string, pessoaId: string, dados: AtualizarServidor): Promise<ResultadoEdicaoServidor> {
    return validar(resultadoEdicaoServidorSchema, await requisitar(`servidores/${pessoaId}`, 'PATCH', dados, csrf));
  },
  /** Consulta eventos de um vínculo específico usando cursor. */
  async eventosServidor(id: string, vinculoId: string, cursor?: string): Promise<PaginaEventosServidor> {
    const consulta = new URLSearchParams({ vinculoId, limite: '25' });
    if (cursor) consulta.set('cursor', cursor);
    return validar(paginaEventosServidorSchema, await requisitar(`servidores/${id}/eventos?${consulta.toString()}`));
  },
};
