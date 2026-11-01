import {
  documentoDtcSchema,
  paginaDtcSchema,
  previaDtcSchema,
  resultadoTransicaoDtcSchema,
  type AtualizarDtc,
  type ConferirDtc,
  type CriarDtc,
  type DevolverDtc,
  type DocumentoDtc,
  type EmitirDtc,
  type PaginaDtc,
  type PreviaDtc,
  type ResultadoTransicaoDtc,
  type TipoDtc,
  historicoEmissoesSchema,
  resultadoExclusaoDocumentoSchema,
  type ExcluirDocumento,
  type ResultadoExclusaoDocumento,
  resultadoCopiaEmitidoSchema,
  situacaoEmissaoSchema,
  type CancelarEmitido,
  type EmitirDof,
  type GrupoHistorico,
  type HistoricoEmissoes,
  type ResultadoCopiaEmitido,
  type SituacaoEmissao,
  paginaAuditoriaSchema,
  paginaBuscaServidoresSchema,
  paginaEventosServidorSchema,
  paginaCoordenadoresDofSchema,
  paginaConferidosDofSchema,
  paginaEncaminhamentosDofSchema,
  paginaRascunhosDofSchema,
  paginaUsuariosSchema,
  dadosFontePreviaDofSchema,
  preconferenciaDofSchema,
  previaConferidaDofSchema,
  detalheServidorSchema,
  rascunhoDofSchema,
  resultadoCalculoDofSchema,
  resultadoConferenciaDofSchema,
  resultadoDevolucaoConferidoDofSchema,
  resultadoDevolucaoDofSchema,
  respostaSessaoSchema,
  ultimaDevolucaoDofSchema,
  usuarioAdministrativoSchema,
  type AtualizarUsuario,
  type AtualizarServidor,
  type AtualizarBlocosDof,
  type AtualizarProcessoDof,
  type AtualizarRascunhoDof,
  type CriarRascunhoDof,
  type CriarUsuario,
  type ConfirmarInicioDof,
  type ConferirDof,
  type DadosFontePreviaDof,
  type DevolverRascunhoDof,
  type DevolverConferidoDof,
  type DetalheServidor,
  type PaginaAuditoria,
  type PaginaBuscaServidores,
  type PaginaEventosServidor,
  type EncaminharRascunhoDof,
  type PaginaCoordenadoresDof,
  type PaginaConferidosDof,
  type PaginaEncaminhamentosDof,
  type PaginaRascunhosDof,
  type PaginaUsuarios,
  type PreconferenciaDof,
  type PreviaConferidaDof,
  type RascunhoDof,
  type RecolherRascunhoDof,
  type ResultadoDevolucaoDof,
  type ResultadoConferenciaDof,
  type ResultadoDevolucaoConferidoDof,
  type RespostaSessao,
  type ResultadoCalculoDof,
  type SolicitarCalculoDof,
  type TipoBuscaServidor,
  resultadoEdicaoServidorSchema,
  type ResultadoEdicaoServidor,
  type UsuarioAdministrativo,
  type UltimaDevolucaoDof,
} from '@sisdoc/contratos';
import {
  loteSincronizacaoSchema,
  paginaSincronizacoesSchema,
  situacaoSincronizacaoSchema,
  type IniciarSincronizacao,
  type LoteSincronizacao,
  type PaginaSincronizacoes,
  type SituacaoSincronizacao,
} from '@sisdoc/contratos';

export class ErroApi extends Error {
  constructor(readonly status: number, mensagem: string) {
    super(mensagem);
  }
}

export async function requisitar(
  rota: string,
  metodo: 'GET' | 'POST' | 'PATCH' = 'GET',
  corpo?: unknown,
  csrf?: string,
  provaFonte?: string,
  extras: Record<string, string> = {},
): Promise<unknown> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api/v1/${rota}`, {
      method: metodo,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(provaFonte === undefined ? {} : { 'X-Sisdoc-Fonte-Dof': provaFonte }),
        ...extras,
      },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
  } catch {
    throw new ErroApi(0, 'Não foi possível conectar ao SisDoc. Verifique a conexão e tente novamente.');
  }
  let dados: unknown;
  try {
    dados = await resposta.json();
  } catch {
    throw new ErroApi(resposta.status, 'O servidor retornou uma resposta inválida. Contate o administrador.');
  }
  if (!resposta.ok) {
    const detalhe = typeof dados === 'object' && dados !== null && 'detail' in dados && typeof dados.detail === 'string'
      ? dados.detail : 'Não foi possível concluir a operação. Contate o administrador.';
    throw new ErroApi(resposta.status, detalhe);
  }
  return dados;
}

export function validar<T>(
  esquema: { safeParse: (entrada: unknown) => { success: true; data: T } | { success: false } },
  entrada: unknown,
): T {
  const resultado = esquema.safeParse(entrada);
  if (!resultado.success) throw new ErroApi(0, 'O servidor retornou dados inválidos. Contate o administrador.');
  return resultado.data;
}

function confirmar(entrada: unknown, campo: string): void {
  if (typeof entrada !== 'object' || entrada === null || !(campo in entrada)
      || Reflect.get(entrada, campo) !== true) {
    throw new ErroApi(0, 'O servidor não confirmou a operação. Contate o administrador.');
  }
}

function parametros(cursor?: string): string {
  const consulta = new URLSearchParams({ limite: '25' });
  if (cursor) consulta.set('cursor', cursor);
  return consulta.toString();
}

export const api = {
  async sessao(): Promise<RespostaSessao> {
    return validar(respostaSessaoSchema, await requisitar('auth/me'));
  },
  async entrar(matricula: string, senha: string): Promise<RespostaSessao> {
    return validar(respostaSessaoSchema, await requisitar('auth/login', 'POST', { matricula, senha }));
  },
  async sair(csrf: string): Promise<void> {
    confirmar(await requisitar('auth/logout', 'POST', undefined, csrf), 'encerrada');
  },
  async trocarSenha(csrf: string, senhaAtual: string, senhaNova: string): Promise<void> {
    confirmar(await requisitar('auth/trocar-senha', 'POST', { senhaAtual, senhaNova }, csrf), 'alterada');
  },
  async listarUsuarios(cursor?: string): Promise<PaginaUsuarios> {
    return validar(paginaUsuariosSchema, await requisitar(`admin/usuarios?${parametros(cursor)}`));
  },
  async criarUsuario(csrf: string, dados: CriarUsuario): Promise<UsuarioAdministrativo> {
    return validar(usuarioAdministrativoSchema, await requisitar('admin/usuarios', 'POST', dados, csrf));
  },
  async atualizarUsuario(csrf: string, id: string, dados: AtualizarUsuario): Promise<UsuarioAdministrativo> {
    return validar(usuarioAdministrativoSchema, await requisitar(`admin/usuarios/${id}`, 'PATCH', dados, csrf));
  },
  async redefinirSenha(csrf: string, id: string, senha: string): Promise<void> {
    confirmar(await requisitar(`admin/usuarios/${id}/redefinir-senha`, 'POST', { senha }, csrf), 'redefinida');
  },
  async auditoria(cursor?: string): Promise<PaginaAuditoria> {
    return validar(paginaAuditoriaSchema, await requisitar(`admin/auditoria?${parametros(cursor)}`));
  },
  async situacaoSincronizacao(): Promise<SituacaoSincronizacao> {
    return validar(situacaoSincronizacaoSchema, await requisitar('sincronizacao/situacao'));
  },
  async listarSincronizacoes(cursor?: string): Promise<PaginaSincronizacoes> {
    return validar(paginaSincronizacoesSchema, await requisitar(`admin/sincronizacoes?${parametros(cursor)}`));
  },
  async iniciarSincronizacao(csrf: string, tipo: IniciarSincronizacao['tipo']): Promise<LoteSincronizacao> {
    return validar(loteSincronizacaoSchema, await requisitar('admin/sincronizacoes', 'POST', { tipo }, csrf));
  },
  async buscarServidores(q: string, tipo: TipoBuscaServidor, cursor?: string): Promise<PaginaBuscaServidores> {
    const consulta = new URLSearchParams({ q, tipo, limite: '25' });
    if (cursor) consulta.set('cursor', cursor);
    return validar(paginaBuscaServidoresSchema, await requisitar(`servidores?${consulta.toString()}`));
  },
  async servidor(id: string, cursor?: string): Promise<DetalheServidor> {
    return validar(detalheServidorSchema, await requisitar(`servidores/${id}?${parametros(cursor)}`));
  },
  async atualizarServidor(csrf: string, pessoaId: string, dados: AtualizarServidor): Promise<ResultadoEdicaoServidor> {
    return validar(resultadoEdicaoServidorSchema, await requisitar(`servidores/${pessoaId}`, 'PATCH', dados, csrf));
  },
  async eventosServidor(id: string, vinculoId: string, cursor?: string): Promise<PaginaEventosServidor> {
    const consulta = new URLSearchParams({ vinculoId, limite: '25' });
    if (cursor) consulta.set('cursor', cursor);
    return validar(paginaEventosServidorSchema, await requisitar(`servidores/${id}/eventos?${consulta.toString()}`));
  },
  async calcularDof(csrf: string, dados: SolicitarCalculoDof): Promise<ResultadoCalculoDof> {
    return validar(resultadoCalculoDofSchema, await requisitar('calculos', 'POST', dados, csrf));
  },
  async listarRascunhosDof(cursor?: string): Promise<PaginaRascunhosDof> {
    return validar(paginaRascunhosDofSchema, await requisitar(`documentos?${parametros(cursor)}`));
  },
  async listarCoordenadoresDof(cursor?: string): Promise<PaginaCoordenadoresDof> {
    return validar(paginaCoordenadoresDofSchema, await requisitar(`documentos/coordenadores?${parametros(cursor)}`));
  },
  async listarEncaminhadosDof(cursor?: string): Promise<PaginaEncaminhamentosDof> {
    return validar(paginaEncaminhamentosDofSchema, await requisitar(`documentos/encaminhados?${parametros(cursor)}`));
  },
  async listarConferidosDof(cursor?: string): Promise<PaginaConferidosDof> {
    return validar(paginaConferidosDofSchema, await requisitar(`documentos/conferidos?${parametros(cursor)}`));
  },
  async obterRascunhoDof(id: string): Promise<RascunhoDof> {
    return validar(rascunhoDofSchema, await requisitar(`documentos/${id}`));
  },
  async ultimaDevolucaoDof(id: string): Promise<UltimaDevolucaoDof> {
    return validar(ultimaDevolucaoDofSchema, await requisitar(`documentos/${id}/ultima-devolucao`));
  },
  async criarRascunhoDof(csrf: string, dados: CriarRascunhoDof): Promise<RascunhoDof> {
    return validar(rascunhoDofSchema, await requisitar('documentos', 'POST', dados, csrf));
  },
  async atualizarRascunhoDof(csrf: string, id: string, dados: AtualizarRascunhoDof): Promise<RascunhoDof> {
    return validar(rascunhoDofSchema, await requisitar(`documentos/${id}`, 'PATCH', dados, csrf));
  },
  async atualizarBlocosDof(csrf: string, id: string, dados: AtualizarBlocosDof): Promise<RascunhoDof> {
    return validar(rascunhoDofSchema, await requisitar(`documentos/${id}/blocos`, 'PATCH', dados, csrf));
  },
  async atualizarProcessoDof(csrf: string, id: string, dados: AtualizarProcessoDof): Promise<RascunhoDof> {
    return validar(rascunhoDofSchema, await requisitar(`documentos/${id}/processo`, 'PATCH', dados, csrf));
  },
  async confirmarInicioDof(csrf: string, id: string, dados: ConfirmarInicioDof): Promise<RascunhoDof> {
    return validar(rascunhoDofSchema, await requisitar(`documentos/${id}/confirmar-inicio`, 'POST', dados, csrf));
  },
  async encaminharRascunhoDof(csrf: string, id: string, dados: EncaminharRascunhoDof): Promise<RascunhoDof> {
    return validar(rascunhoDofSchema, await requisitar(`documentos/${id}/encaminhar`, 'POST', dados, csrf));
  },
  async devolverRascunhoDof(csrf: string, id: string, dados: DevolverRascunhoDof): Promise<ResultadoDevolucaoDof> {
    return validar(resultadoDevolucaoDofSchema, await requisitar(`documentos/${id}/devolver`, 'POST', dados, csrf));
  },
  async recolherRascunhoDof(csrf: string, id: string, dados: RecolherRascunhoDof): Promise<RascunhoDof> {
    return validar(rascunhoDofSchema, await requisitar(`documentos/${id}/recolher`, 'POST', dados, csrf));
  },
  async verificarPreconferenciaDof(id: string, provaFonte?: string): Promise<PreconferenciaDof> {
    return validar(preconferenciaDofSchema, await requisitar(
      `documentos/${id}/preconferencia`, 'GET', undefined, undefined, provaFonte,
    ));
  },
  async conferirDof(csrf: string, id: string, dados: ConferirDof): Promise<ResultadoConferenciaDof> {
    return validar(resultadoConferenciaDofSchema, await requisitar(`documentos/${id}/conferir`, 'POST', dados, csrf));
  },
  async devolverConferidoDof(
    csrf: string, id: string, dados: DevolverConferidoDof,
  ): Promise<ResultadoDevolucaoConferidoDof> {
    return validar(
      resultadoDevolucaoConferidoDofSchema, await requisitar(`documentos/${id}/devolver-conferido`, 'POST', dados, csrf),
    );
  },
  async obterPreviaDof(id: string): Promise<DadosFontePreviaDof> {
    return validar(dadosFontePreviaDofSchema, await requisitar(`documentos/${id}/dados-previa`));
  },
  async obterPreviaConferidaDof(id: string): Promise<PreviaConferidaDof> {
    return validar(previaConferidaDofSchema, await requisitar(`documentos/${id}/dados-previa-conferida`));
  },
  async emitirDof(csrf: string, id: string, chave: string, dados: EmitirDof): Promise<SituacaoEmissao> {
    return validar(situacaoEmissaoSchema, await requisitar(
      `documentos/${id}/emitir`, 'POST', dados, csrf, undefined, { 'Idempotency-Key': chave },
    ));
  },
  async situacaoEmissao(id: string): Promise<SituacaoEmissao> {
    return validar(situacaoEmissaoSchema, await requisitar(`emissoes/${id}`));
  },
  async historico(tipo: GrupoHistorico, escopo: 'proprio' | 'todos'): Promise<HistoricoEmissoes> {
    return validar(historicoEmissoesSchema, await requisitar(`historico?${new URLSearchParams({ tipo, escopo }).toString()}`));
  },
  async copiarEmitido(csrf: string, documentoId: string, tipo: 'DOF' | TipoDtc = 'DOF'): Promise<ResultadoCopiaEmitido> {
    return validar(resultadoCopiaEmitidoSchema, await requisitar(
      `${tipo === 'DOF' ? 'documentos' : 'dtc'}/${documentoId}/copia`, 'POST', { confirmar: true }, csrf,
    ));
  },
  async excluirDocumento(
    csrf: string, documentoId: string, dados: ExcluirDocumento,
  ): Promise<ResultadoExclusaoDocumento> {
    return validar(resultadoExclusaoDocumentoSchema, await requisitar(
      `admin/documentos/${documentoId}/excluir`, 'POST', dados, csrf,
    ));
  },
  async listarDtc(estado: 'rascunho' | 'conferido', tipo?: TipoDtc): Promise<PaginaDtc> {
    const consulta = new URLSearchParams({ estado });
    if (tipo) consulta.set('tipo', tipo);
    return validar(paginaDtcSchema, await requisitar(`dtc?${consulta.toString()}`));
  },
  async obterDtc(id: string): Promise<DocumentoDtc> {
    return validar(documentoDtcSchema, await requisitar(`dtc/${id}`));
  },
  async criarDtc(csrf: string, dados: CriarDtc): Promise<DocumentoDtc> {
    return validar(documentoDtcSchema, await requisitar('dtc', 'POST', dados, csrf));
  },
  async atualizarDtc(csrf: string, id: string, dados: AtualizarDtc): Promise<DocumentoDtc> {
    return validar(documentoDtcSchema, await requisitar(`dtc/${id}`, 'PATCH', dados, csrf));
  },
  async previaDtc(id: string): Promise<PreviaDtc> {
    return validar(previaDtcSchema, await requisitar(`dtc/${id}/previa`));
  },
  async conferirDtc(csrf: string, id: string, dados: ConferirDtc): Promise<ResultadoTransicaoDtc> {
    return validar(resultadoTransicaoDtcSchema, await requisitar(`dtc/${id}/conferir`, 'POST', dados, csrf));
  },
  async devolverDtc(csrf: string, id: string, dados: DevolverDtc): Promise<ResultadoTransicaoDtc> {
    return validar(resultadoTransicaoDtcSchema, await requisitar(`dtc/${id}/devolver`, 'POST', dados, csrf));
  },
  async emitirDtc(csrf: string, id: string, chave: string, dados: EmitirDtc): Promise<SituacaoEmissao> {
    return validar(situacaoEmissaoSchema, await requisitar(
      `dtc/${id}/emitir`, 'POST', dados, csrf, undefined, { 'Idempotency-Key': chave },
    ));
  },
  async cancelarEmitido(csrf: string, documentoId: string, dados: CancelarEmitido): Promise<SituacaoEmissao> {
    return validar(situacaoEmissaoSchema, await requisitar(`documentos/${documentoId}/cancelar`, 'POST', dados, csrf));
  },
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