import { StrictMode, useCallback, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { RespostaSessao } from '@sisdoc/contratos';
import { api, ErroApi } from './api';
import { Auditoria } from './auditoria';
import { Servidores } from './servidores';
import { nomesPerfis, Usuarios } from './usuarios';
import './estilos.css';

function campo(formulario: FormData, nome: string): string {
  const valor = formulario.get(nome);
  if (typeof valor !== 'string') throw new ErroApi(400, 'Preencha os campos obrigatórios.');
  return valor;
}

function Login({ onEntrar, onErro }: { onEntrar: (sessao: RespostaSessao) => void; onErro: (erro: unknown) => void }) {
  const [ocupado, setOcupado] = useState(false);
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

function TrocaSenha({ sessao, onConcluir, onErro }: {
  sessao: RespostaSessao; onConcluir: () => void; onErro: (erro: unknown) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
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
      <p>Defina uma senha de pelo menos 12 caracteres. A sessão será encerrada após a troca.</p>
      <label>Senha atual<input name="senhaAtual" type="password" autoComplete="current-password" required /></label>
      <label>Nova senha<input name="senhaNova" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required /></label>
      <label>Confirme a nova senha<input name="confirmacao" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required /></label>
      <button type="submit" disabled={ocupado}>Alterar senha</button>
    </form>
  );
}

function App() {
  const [sessao, setSessao] = useState<RespostaSessao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const [tela, setTela] = useState<'usuarios' | 'auditoria' | 'busca'>('busca');
  const tratarErro = useCallback((problema: unknown) => {
    setMensagem('');
    if (problema instanceof ErroApi && problema.status === 401) {
      setSessao(null);
    }
    setErro(problema instanceof Error ? problema.message : 'Erro inesperado. Contate o administrador.');
  }, []);

  useEffect(() => {
    let ativa = true;
    api.sessao().then((resultado) => {
      if (ativa) {
        setSessao(resultado);
        setTela(resultado.usuario.papel === 'admin' ? 'usuarios' : 'busca');
      }
    }).catch((problema: unknown) => {
      if (ativa && (!(problema instanceof ErroApi) || problema.status !== 401)) tratarErro(problema);
    }).finally(() => {
      if (ativa) setCarregando(false);
    });
    return () => { ativa = false; };
  }, [tratarErro]);

  async function sair() {
    if (!sessao) return;
    try {
      await api.sair(sessao.csrf);
      setSessao(null);
      setErro('');
      setMensagem('Sessão encerrada.');
    } catch (problema) {
      tratarErro(problema);
    }
  }
  const entrar = (resultado: RespostaSessao) => {
    setSessao(resultado);
    setErro('');
    setMensagem('');
    setTela(resultado.usuario.papel === 'admin' ? 'usuarios' : 'busca');
  };
  const encerrarLocal = (texto: string) => {
    setSessao(null);
    setErro('');
    setMensagem(texto);
  };
  const informar = (texto: string) => {
    setErro('');
    setMensagem(texto);
  };
  const limparMensagens = () => {
    setErro('');
    setMensagem('');
  };
  const funcional = sessao && sessao.usuario.papel !== 'admin';

  return (
    <main className="pagina">
      <header className="cabecalho">
        <div><span className="marca">SisDoc</span><span>Declarações funcionais</span></div>
        {sessao && <button type="button" className="cabecalho-botao" onClick={sair}>Sair</button>}
      </header>
      <div className="conteudo">
        <p className="etiqueta">Sistema em construção — não autorizado para uso operacional</p>
        <h1>DOF e DTC</h1>
        <p>O cálculo de referência da DOF é provisório. Documentos e emissão ainda não estão disponíveis.</p>
        {erro && <p className="aviso erro" role="alert">{erro}</p>}
        {mensagem && <p className="aviso sucesso" role="status">{mensagem}</p>}
        {carregando ? <p role="status">Verificando sessão...</p> : !sessao ? (
          <Login onEntrar={entrar} onErro={tratarErro} />
        ) : sessao.usuario.trocaSenhaObrigatoria ? (
          <TrocaSenha sessao={sessao} onConcluir={() => encerrarLocal('Senha alterada. Entre novamente.')} onErro={tratarErro} />
        ) : (
          <>
            <p>Conectado como <strong>{sessao.usuario.nome}</strong> — {nomesPerfis[sessao.usuario.papel]}.</p>
            <nav className="acoes" aria-label="Navegação">
              {funcional && <button type="button" className="secundario" onClick={() => setTela('busca')}>Buscar servidores</button>}
              {sessao.usuario.papel === 'admin' && <button type="button" className="secundario" onClick={() => setTela('usuarios')}>Usuários</button>}
              {(sessao.usuario.papel === 'admin' || sessao.usuario.papel === 'secretario_adjunto') && (
                <button type="button" className="secundario" onClick={() => setTela('auditoria')}>Auditoria</button>
              )}
            </nav>
            {funcional && tela === 'busca' && <Servidores csrf={sessao.csrf} onErro={tratarErro} onLimpar={limparMensagens} />}
            {sessao.usuario.papel === 'admin' && tela === 'usuarios' && (
              <Usuarios sessao={sessao} onErro={tratarErro} onMensagem={informar} onSessaoEncerrada={encerrarLocal} />
            )}
            {((sessao.usuario.papel === 'secretario_adjunto' || sessao.usuario.papel === 'admin') && tela === 'auditoria') && (
              <Auditoria onErro={tratarErro} />
            )}
          </>
        )}
      </div>
    </main>
  );
}

const raiz = document.getElementById('root');
if (!raiz) throw new Error('Elemento principal da aplicação não encontrado.');
createRoot(raiz).render(<StrictMode><App /></StrictMode>);
