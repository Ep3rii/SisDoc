import {
  paginaAuditoriaSchema,
  paginaUsuariosSchema,
  respostaSessaoSchema,
  usuarioAdministrativoSchema,
  type AtualizarUsuario,
  type CriarUsuario,
  type PaginaAuditoria,
  type PaginaUsuarios,
  type RespostaSessao,
  type UsuarioAdministrativo,
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
};
