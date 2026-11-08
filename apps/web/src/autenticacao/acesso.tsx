import type { RespostaSessao } from '@sisdoc/contratos';
import { useId, useState, type FormEvent } from 'react';
import { api, ErroApi } from '../infraestrutura/api';

/** Lê um campo textual obrigatório sem converter arquivos ou valores ausentes silenciosamente. */
function campo(formulario: FormData, nome: string): string {
  const valor = formulario.get(nome);
  if (typeof valor !== 'string') throw new ErroApi(400, 'Preencha os campos obrigatórios.');
  return valor;
}
function CampoSenha({ nome, titulo, nova = false }: { nome: string; titulo: string; nova?: boolean }) {
  const [visivel, setVisivel] = useState(false);
  const id = useId();
  return <div className="campo-senha"><label htmlFor={id}>{titulo}</label>
    <input id={id} name={nome} type={visivel ? 'text' : 'password'} autoComplete={nova ? 'new-password' : 'current-password'}
      minLength={nova ? 10 : undefined} maxLength={1024} required aria-describedby={nova ? `${id}-requisito` : undefined} />
    <button type="button" className="secundario campo-senha-botao" aria-label={`${visivel ? 'Ocultar' : 'Mostrar'} ${titulo.toLocaleLowerCase('pt-BR')}`}
      aria-pressed={visivel} aria-controls={id} onClick={() => setVisivel((valor) => !valor)}>
      {visivel ? (
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A11 11 0 0112 5c5 0 8.5 4.5 9.5 7a11 11 0 01-3 4.2M6.2 6.2A14 14 0 002.5 12c1 2.5 4.5 7 9.5 7a10 10 0 004.1-.9" /></svg>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" /><circle cx="12" cy="12" r="2.5" /></svg>
      )}
    </button>
    {nova && <small id={`${id}-requisito`}>Pelo menos 10 caracteres; evite senhas comuns.</small>}
  </div>;
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
      <label>Matrícula<input name="matricula" autoComplete="off" maxLength={100} required /></label>
      <CampoSenha nome="senha" titulo="Senha" />
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
      <CampoSenha nome="senhaAtual" titulo="Senha atual" />
      <CampoSenha nome="senhaNova" titulo="Nova senha" nova />
      <CampoSenha nome="confirmacao" titulo="Confirme a nova senha" nova />
      <button type="submit" disabled={ocupado}>Alterar senha</button>
    </form>
  );
}
