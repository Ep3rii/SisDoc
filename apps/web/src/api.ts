import {
  paginaAuditoriaSchema,
  paginaBuscaServidoresSchema,
  paginaEventosServidorSchema,
  paginaCoordenadoresDofSchema,
  paginaEncaminhamentosDofSchema,
  paginaRascunhosDofSchema,
  paginaUsuariosSchema,
  dadosFontePreviaDofSchema,
  preconferenciaDofSchema,
  detalheServidorSchema,
  rascunhoDofSchema,
  resultadoCalculoDofSchema,
  resultadoDevolucaoDofSchema,
  respostaSessaoSchema,
  ultimaDevolucaoDofSchema,
  usuarioAdministrativoSchema,
  type AtualizarUsuario,
  type AtualizarBlocosDof,
  type AtualizarProcessoDof,
  type AtualizarRascunhoDof,
  type CriarRascunhoDof,
  type CriarUsuario,
  type ConfirmarInicioDof,
  type DadosFontePreviaDof,
  type DevolverRascunhoDof,
  type DetalheServidor,
  type PaginaAuditoria,
  type PaginaBuscaServidores,
  type PaginaEventosServidor,
  type EncaminharRascunhoDof,
  type PaginaCoordenadoresDof,
  type PaginaEncaminhamentosDof,
  type PaginaRascunhosDof,
  type PaginaUsuarios,
  type PreconferenciaDof,
  type RascunhoDof,
  type RecolherRascunhoDof,
  type ResultadoDevolucaoDof,
  type RespostaSessao,
  type ResultadoCalculoDof,
  type SolicitarCalculoDof,
  type TipoBuscaServidor,
  type UsuarioAdministrativo,
  type UltimaDevolucaoDof,
} from '@sisdoc/contratos';

export class ErroApi extends Error {
  constructor(readonly status: number, mensagem: string) {
    super(mensagem);
  }
}

async function requisitar(
  rota: string,
  metodo: 'GET' | 'POST' | 'PATCH' = 'GET',
  corpo?: unknown,
  csrf?: string,
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

function validar<T>(
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
  async buscarServidores(q: string, tipo: TipoBuscaServidor, cursor?: string): Promise<PaginaBuscaServidores> {
    const consulta = new URLSearchParams({ q, tipo, limite: '25' });
    if (cursor) consulta.set('cursor', cursor);
    return validar(paginaBuscaServidoresSchema, await requisitar(`servidores?${consulta.toString()}`));
  },
  async servidor(id: string, cursor?: string): Promise<DetalheServidor> {
    return validar(detalheServidorSchema, await requisitar(`servidores/${id}?${parametros(cursor)}`));
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
  async verificarPreconferenciaDof(id: string): Promise<PreconferenciaDof> {
    return validar(preconferenciaDofSchema, await requisitar(`documentos/${id}/preconferencia`));
  },
  async obterPreviaDof(id: string): Promise<DadosFontePreviaDof> {
    return validar(dadosFontePreviaDofSchema, await requisitar(`documentos/${id}/dados-previa`));
  },
};
