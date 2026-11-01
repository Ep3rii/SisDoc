import type { RespostaSessao } from '@sisdoc/contratos';
import { useState, type FormEvent } from 'react';
import { api, ErroApi } from '../infraestrutura/api';

/** Lê um campo textual obrigatório sem converter arquivos ou valores ausentes silenciosamente. */
function campo(formulario: FormData, nome: string): string {
  const valor = formulario.get(nome);
  if (typeof valor !== 'string') throw new ErroApi(400, 'Preencha os campos obrigatórios.');
  return valor;
}

/** Apresenta autenticação e descarta os valores do formulário somente após receber a sessão. */
export function Login({ onEntrar, onErro }: { onEntrar: (sessao: RespostaSessao) => void; onErro: (erro: unknown) => void }) {
  const [ocupado, setOcupado] = useState(false);
  /** Envia credenciais e mantém erro explícito sem persistir senha no estado global. */
  async function entrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    const valores = new FormData(formulario);
    try {
      setOcupado(true);
      const sessao = await api.entrar(campo(valores, 'matricula'), campo(valores, 'senha'));
      formulario.reset();
      onEntrar(sessao);
    } catch (erro) {
      onErro(erro);
    } finally {
      setOcupado(false);
    }
  }
  return (
    <form className="painel login" onSubmit={entrar}>
      <h2>Entrar</h2>
      <label>Matrícula<input name="matricula" autoComplete="username" maxLength={100} required /></label>
      <label>Senha<input name="senha" type="password" autoComplete="current-password" maxLength={1024} required /></label>
      <button type="submit" disabled={ocupado}>{ocupado ? 'Entrando...' : 'Entrar'}</button>
    </form>
  );
}

/** Exige troca da senha inicial e encaminha o encerramento da sessão ao componente raiz. */
export function TrocaSenha({ sessao, onConcluir, onErro }: {
  sessao: RespostaSessao; onConcluir: () => void; onErro: (erro: unknown) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  /** Confere as duas entradas antes de solicitar troca autenticada e limpar o formulário. */
  async function trocar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    const valores = new FormData(formulario);
    try {
      const senhaNova = campo(valores, 'senhaNova');
      if (senhaNova !== campo(valores, 'confirmacao')) throw new ErroApi(400, 'As senhas informadas não coincidem.');
      setOcupado(true);
      await api.trocarSenha(sessao.csrf, campo(valores, 'senhaAtual'), senhaNova);
      formulario.reset();
      onConcluir();
    } catch (erro) {
      onErro(erro);
    } finally {
      setOcupado(false);
    }
  }
  return (
    <form className="painel login" onSubmit={trocar}>
      <h2>Troca obrigatória de senha</h2>
      <p>Defina uma senha de pelo menos 10 caracteres. A sessão será encerrada após a troca.</p>
      <label>Senha atual<input name="senhaAtual" type="password" autoComplete="current-password" required /></label>
      <label>Nova senha<input name="senhaNova" type="password" autoComplete="new-password" minLength={10} maxLength={1024} required /></label>
      <label>Confirme a nova senha<input name="confirmacao" type="password" autoComplete="new-password" minLength={10} maxLength={1024} required /></label>
      <button type="submit" disabled={ocupado}>Alterar senha</button>
    </form>
  );
}
