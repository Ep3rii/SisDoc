import {
  dadosFontePreviaDofSchema,
  paginaConferidosDofSchema,
  paginaCoordenadoresDofSchema,
  paginaEncaminhamentosDofSchema,
  paginaRascunhosDofSchema,
  preconferenciaDofSchema,
  previaConferidaDofSchema,
  rascunhoDofSchema,
  resultadoCalculoDofSchema,
  resultadoConferenciaDofSchema,
  resultadoDevolucaoConferidoDofSchema,
  resultadoDevolucaoDofSchema,
  situacaoEmissaoSchema,
  ultimaDevolucaoDofSchema,
  type AtualizarBlocosDof,
  type AtualizarProcessoDof,
  type AtualizarRascunhoDof,
  type ConferirDof,
  type ConfirmarInicioDof,
  type CriarRascunhoDof,
  type DadosFontePreviaDof,
  type DevolverConferidoDof,
  type DevolverRascunhoDof,
  type EmitirDof,
  type EncaminharRascunhoDof,
  type PaginaConferidosDof,
  type PaginaCoordenadoresDof,
  type PaginaEncaminhamentosDof,
  type PaginaRascunhosDof,
  type PreconferenciaDof,
  type PreviaConferidaDof,
  type RascunhoDof,
  type RecolherRascunhoDof,
  type ResultadoCalculoDof,
  type ResultadoConferenciaDof,
  type ResultadoDevolucaoConferidoDof,
  type ResultadoDevolucaoDof,
  type SituacaoEmissao,
  type SolicitarCalculoDof,
  type UltimaDevolucaoDof
} from '@sisdoc/contratos';
import { parametros, requisitar, validar } from './http';

export const dofApi = {
  /** Solicita cálculo de referência sem criar ou conferir um documento. */
  async calcularDof(csrf: string, dados: SolicitarCalculoDof): Promise<ResultadoCalculoDof> {
    return validar(resultadoCalculoDofSchema, await requisitar('calculos', 'POST', dados, csrf));
  },
  /** Carrega rascunhos no escopo de autoria permitido pela API. */
  async listarRascunhosDof(cursor?: string): Promise<PaginaRascunhosDof> {
    return validar(paginaRascunhosDofSchema, await requisitar(`documentos?${parametros(cursor)}`));
  },
  /** Carrega somente destinatários operacionais elegíveis para encaminhamento. */
  async listarCoordenadoresDof(cursor?: string): Promise<PaginaCoordenadoresDof> {
    return validar(paginaCoordenadoresDofSchema, await requisitar(`documentos/coordenadores?${parametros(cursor)}`));
  },
  /** Consulta encaminhamentos recebidos ou o escopo administrativo autorizado. */
  async listarEncaminhadosDof(cursor?: string): Promise<PaginaEncaminhamentosDof> {
    return validar(paginaEncaminhamentosDofSchema, await requisitar(`documentos/encaminhados?${parametros(cursor)}`));
  },
  /** Carrega DOFs conferidas disponíveis para revisão e emissão. */
  async listarConferidosDof(cursor?: string): Promise<PaginaConferidosDof> {
    return validar(paginaConferidosDofSchema, await requisitar(`documentos/conferidos?${parametros(cursor)}`));
  },
  /** Abre conteúdo completo de um rascunho com validação do contrato. */
  async obterRascunhoDof(id: string): Promise<RascunhoDof> {
    return validar(rascunhoDofSchema, await requisitar(`documentos/${id}`));
  },
  /** Consulta o motivo cifrado da devolução no escopo autorizado. */
  async ultimaDevolucaoDof(id: string): Promise<UltimaDevolucaoDof> {
    return validar(ultimaDevolucaoDofSchema, await requisitar(`documentos/${id}/ultima-devolucao`));
  },
  /** Grava o cálculo como rascunho sem conferir ou emitir. */
  async criarRascunhoDof(csrf: string, dados: CriarRascunhoDof): Promise<RascunhoDof> {
    return validar(rascunhoDofSchema, await requisitar('documentos', 'POST', dados, csrf));
  },
  /** Salva conteúdo e revisão do rascunho com controle otimista. */
  async atualizarRascunhoDof(csrf: string, id: string, dados: AtualizarRascunhoDof): Promise<RascunhoDof> {
    return validar(rascunhoDofSchema, await requisitar(`documentos/${id}`, 'PATCH', dados, csrf));
  },
  /** Salva blocos textuais sem sobrescrever o restante do cálculo. */
  async atualizarBlocosDof(csrf: string, id: string, dados: AtualizarBlocosDof): Promise<RascunhoDof> {
    return validar(rascunhoDofSchema, await requisitar(`documentos/${id}/blocos`, 'PATCH', dados, csrf));
  },
  /** Salva processo validado conforme máscaras da instalação. */
  async atualizarProcessoDof(csrf: string, id: string, dados: AtualizarProcessoDof): Promise<RascunhoDof> {
    return validar(rascunhoDofSchema, await requisitar(`documentos/${id}/processo`, 'PATCH', dados, csrf));
  },
  /** Registra confirmação específica do ajuste da admissão. */
  async confirmarInicioDof(csrf: string, id: string, dados: ConfirmarInicioDof): Promise<RascunhoDof> {
    return validar(rascunhoDofSchema, await requisitar(`documentos/${id}/confirmar-inicio`, 'POST', dados, csrf));
  },
  /** Encaminha revisão salva para coordenador autorizado. */
  async encaminharRascunhoDof(csrf: string, id: string, dados: EncaminharRascunhoDof): Promise<RascunhoDof> {
    return validar(rascunhoDofSchema, await requisitar(`documentos/${id}/encaminhar`, 'POST', dados, csrf));
  },
  /** Devolve encaminhamento ao autor com motivo e revisão. */
  async devolverRascunhoDof(csrf: string, id: string, dados: DevolverRascunhoDof): Promise<ResultadoDevolucaoDof> {
    return validar(resultadoDevolucaoDofSchema, await requisitar(`documentos/${id}/devolver`, 'POST', dados, csrf));
  },
  /** Recolhe encaminhamento antes de editar a revisão salva. */
  async recolherRascunhoDof(csrf: string, id: string, dados: RecolherRascunhoDof): Promise<RascunhoDof> {
    return validar(rascunhoDofSchema, await requisitar(`documentos/${id}/recolher`, 'POST', dados, csrf));
  },
  /** Consulta bloqueios vinculados à prova da fonte vista na prévia. */
  async verificarPreconferenciaDof(id: string, provaFonte?: string): Promise<PreconferenciaDof> {
    return validar(preconferenciaDofSchema, await requisitar(
      `documentos/${id}/preconferencia`, 'GET', undefined, undefined, provaFonte,
    ));
  },
  /** Confere revisão e prova da fonte sem reservar número oficial. */
  async conferirDof(csrf: string, id: string, dados: ConferirDof): Promise<ResultadoConferenciaDof> {
    return validar(resultadoConferenciaDofSchema, await requisitar(`documentos/${id}/conferir`, 'POST', dados, csrf));
  },
  /** Retorna DOF conferida ao autor para nova revisão. */
  async devolverConferidoDof(
    csrf: string, id: string, dados: DevolverConferidoDof,
  ): Promise<ResultadoDevolucaoConferidoDof> {
    return validar(
      resultadoDevolucaoConferidoDofSchema, await requisitar(`documentos/${id}/devolver-conferido`, 'POST', dados, csrf),
    );
  },
  /** Consulta fonte auditada vinculada ao identificador e revisão da DOF. */
  async obterPreviaDof(id: string): Promise<DadosFontePreviaDof> {
    return validar(dadosFontePreviaDofSchema, await requisitar(`documentos/${id}/dados-previa`));
  },
  /** Consulta fonte atual e divergências de uma DOF conferida. */
  async obterPreviaConferidaDof(id: string): Promise<PreviaConferidaDof> {
    return validar(previaConferidaDofSchema, await requisitar(`documentos/${id}/dados-previa-conferida`));
  },
  /** Solicita emissão idempotente com revisão, prova da fonte e CSRF. */
  async emitirDof(csrf: string, id: string, chave: string, dados: EmitirDof): Promise<SituacaoEmissao> {
    return validar(situacaoEmissaoSchema, await requisitar(
      `documentos/${id}/emitir`, 'POST', dados, csrf, undefined, { 'Idempotency-Key': chave },
    ));
  },
};
