import {
  respostaSessaoSchema,
  type RespostaSessao
} from '@sisdoc/contratos';
import { confirmar, requisitar, validar } from './http';

export const autenticacaoApi = {
  /** Consulta a sessão atual sem persistir credenciais no navegador. */
  async sessao(): Promise<RespostaSessao> {
    return validar(respostaSessaoSchema, await requisitar('auth/me'));
  },
  /** Autentica por matrícula e valida a sessão e o token CSRF retornados. */
  async entrar(matricula: string, senha: string): Promise<RespostaSessao> {
    return validar(respostaSessaoSchema, await requisitar('auth/login', 'POST', { matricula, senha }));
  },
  /** Encerra a sessão e exige confirmação explícita do servidor. */
  async sair(csrf: string): Promise<void> {
    confirmar(await requisitar('auth/logout', 'POST', undefined, csrf), 'encerrada');
  },
  /** Troca a credencial usando CSRF e confirma a alteração antes de encerrar o fluxo. */
  async trocarSenha(csrf: string, senhaAtual: string, senhaNova: string): Promise<void> {
    confirmar(await requisitar('auth/trocar-senha', 'POST', { senhaAtual, senhaNova }, csrf), 'alterada');
  },
};
