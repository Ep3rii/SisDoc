import {
  documentoDtcSchema,
  paginaDtcSchema,
  previaDtcSchema,
  resultadoTransicaoDtcSchema,
  situacaoEmissaoSchema,
  type AtualizarDtc,
  type ConferirDtc,
  type CriarDtc,
  type DevolverDtc,
  type DocumentoDtc,
  type EmitirDtc,
  type PaginaDtc,
  type PreviaDtc,
  type ResultadoTransicaoDtc,
  type SituacaoEmissao,
  type TipoDtc
} from '@sisdoc/contratos';
import { requisitar, validar } from './http';

export const dtcApi = {
  /** Carrega DTCs filtradas por situação e tipo no escopo autorizado. */
  async listarDtc(estado: 'rascunho' | 'conferido', tipo?: TipoDtc): Promise<PaginaDtc> {
    const consulta = new URLSearchParams({ estado });
    if (tipo) consulta.set('tipo', tipo);
    return validar(paginaDtcSchema, await requisitar(`dtc?${consulta.toString()}`));
  },
  /** Consulta conteúdo e revisão de uma DTC existente. */
  async obterDtc(id: string): Promise<DocumentoDtc> {
    return validar(documentoDtcSchema, await requisitar(`dtc/${id}`));
  },
  /** Cria rascunho DTC a partir dos dados e confirmações do operador. */
  async criarDtc(csrf: string, dados: CriarDtc): Promise<DocumentoDtc> {
    return validar(documentoDtcSchema, await requisitar('dtc', 'POST', dados, csrf));
  },
  /** Salva edição DTC com motivo e revisão para detectar concorrência. */
  async atualizarDtc(csrf: string, id: string, dados: AtualizarDtc): Promise<DocumentoDtc> {
    return validar(documentoDtcSchema, await requisitar(`dtc/${id}`, 'PATCH', dados, csrf));
  },
  /** Consulta prévia auditada da revisão salva e prova da fonte. */
  async previaDtc(id: string): Promise<PreviaDtc> {
    return validar(previaDtcSchema, await requisitar(`dtc/${id}/previa`));
  },
  /** Confere DTC usando a prova vinculada à fonte consultada. */
  async conferirDtc(csrf: string, id: string, dados: ConferirDtc): Promise<ResultadoTransicaoDtc> {
    return validar(resultadoTransicaoDtcSchema, await requisitar(`dtc/${id}/conferir`, 'POST', dados, csrf));
  },
  /** Devolve DTC conferida para edição com motivo obrigatório. */
  async devolverDtc(csrf: string, id: string, dados: DevolverDtc): Promise<ResultadoTransicaoDtc> {
    return validar(resultadoTransicaoDtcSchema, await requisitar(`dtc/${id}/devolver`, 'POST', dados, csrf));
  },
  /** Emite DTC de forma idempotente sem dispensar aprovação do modelo. */
  async emitirDtc(csrf: string, id: string, chave: string, dados: EmitirDtc): Promise<SituacaoEmissao> {
    return validar(situacaoEmissaoSchema, await requisitar(
      `dtc/${id}/emitir`, 'POST', dados, csrf, undefined, { 'Idempotency-Key': chave },
    ));
  },
};
