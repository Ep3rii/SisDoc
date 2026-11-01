import {
  paginaAuditoriaSchema,
  paginaUsuariosSchema,
  usuarioAdministrativoSchema,
  type AtualizarUsuario,
  type CriarUsuario,
  type PaginaAuditoria,
  type PaginaUsuarios,
  type UsuarioAdministrativo
} from '@sisdoc/contratos';
import { confirmar, parametros, requisitar, validar } from './http';

export const administracaoApi = {
  /** Carrega uma página de usuários no escopo administrativo autorizado. */
  async listarUsuarios(cursor?: string): Promise<PaginaUsuarios> {
    return validar(paginaUsuariosSchema, await requisitar(`admin/usuarios?${parametros(cursor)}`));
  },
  /** Cria uma conta com os dados validados pelo servidor e token CSRF. */
  async criarUsuario(csrf: string, dados: CriarUsuario): Promise<UsuarioAdministrativo> {
    return validar(usuarioAdministrativoSchema, await requisitar('admin/usuarios', 'POST', dados, csrf));
  },
  /** Atualiza identidade, perfil e situação de uma conta autorizada. */
  async atualizarUsuario(csrf: string, id: string, dados: AtualizarUsuario): Promise<UsuarioAdministrativo> {
    return validar(usuarioAdministrativoSchema, await requisitar(`admin/usuarios/${id}`, 'PATCH', dados, csrf));
  },
  /** Redefine a senha e exige confirmação da revogação das sessões. */
  async redefinirSenha(csrf: string, id: string, senha: string): Promise<void> {
    confirmar(await requisitar(`admin/usuarios/${id}/redefinir-senha`, 'POST', { senha }, csrf), 'redefinida');
  },
  /** Carrega eventos administrativos paginados sem ampliar o conteúdo dos logs. */
  async auditoria(cursor?: string): Promise<PaginaAuditoria> {
    return validar(paginaAuditoriaSchema, await requisitar(`admin/auditoria?${parametros(cursor)}`));
  },
};
