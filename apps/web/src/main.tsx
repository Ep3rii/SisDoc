import { StrictMode, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { RespostaSessao } from '@sisdoc/contratos';
import { api, ErroApi } from './api';
import { Auditoria } from './auditoria';
import { RascunhosDof } from './rascunhos-dof';
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
  const [tela, setTela] = useState<'usuarios' | 'auditoria' | 'busca' | 'rascunhos'>('busca');
  const [chaveTela, setChaveTela] = useState(0);
  const [alteracoesPendentes, setAlteracoesPendentes] = useState(false);
  const pendencias = useRef(false);
  const registrarPendencia = useCallback((valor: boolean) => {
    pendencias.current = valor;
    setAlteracoesPendentes(valor);
  }, []);
  const confirmarSaida = useCallback(() => !pendencias.current
    || window.confirm('Há alterações não salvas. Deseja descartá-las?'), []);
  const tratarErro = useCallback((problema: unknown) => {
    setMensagem('');
    if (problema instanceof ErroApi && problema.status === 401) {
      setSessao(null);
      if (pendencias.current) {
        registrarPendencia(false);
        setErro('A sessão terminou. As alterações não salvas foram descartadas; entre novamente.');
        return;
      }
    }
    setErro(problema instanceof Error ? problema.message : 'Erro inesperado. Contate o administrador.');
  }, [registrarPendencia]);

  useEffect(() => {
    function antesDeSair(evento: BeforeUnloadEvent) {
      if (pendencias.current) {
        evento.preventDefault();
        evento.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', antesDeSair);
    return () => window.removeEventListener('beforeunload', antesDeSair);
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
    if (!sessao || !confirmarSaida()) return;
    try {
      await api.sair(sessao.csrf);
      setSessao(null);
      registrarPendencia(false);
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
  const navegar = (destino: typeof tela) => {
    if (!confirmarSaida()) return;
    registrarPendencia(false);
    limparMensagens();
    setChaveTela((atual) => atual + 1);
    setTela(destino);
  };
  const funcional = sessao && sessao.usuario.papel !== 'admin';
  const podeSalvar = sessao?.usuario.papel === 'analista' || sessao?.usuario.papel === 'coordenador';

  return (
    <main className="pagina">
      <header className="cabecalho">
        <div><span className="marca">SisDoc</span><span>Declarações funcionais</span></div>
        {sessao && <button type="button" className="cabecalho-botao" onClick={sair}>Sair</button>}
      </header>
      <div className="conteudo">
        <p className="etiqueta">Sistema em construção — não autorizado para uso operacional</p>
        <h1>DOF e DTC</h1>
        <p>O cálculo de referência da DOF é provisório. Prévia, conferência e emissão ainda não estão disponíveis.</p>
        {erro && <p className="aviso erro" role="alert">{erro}</p>}
        {mensagem && <p className="aviso sucesso" role="status">{mensagem}</p>}
        {carregando ? <p role="status">Verificando sessão...</p> : !sessao ? (
          <Login onEntrar={entrar} onErro={tratarErro} />
        ) : sessao.usuario.trocaSenhaObrigatoria ? (
          <TrocaSenha sessao={sessao} onConcluir={() => encerrarLocal('Senha alterada. Entre novamente.')} onErro={tratarErro} />
        ) : (
          <>
            <p>Conectado como <strong>{sessao.usuario.nome}</strong> — {nomesPerfis[sessao.usuario.papel]}.</p>
            {alteracoesPendentes && <p className="etiqueta" role="status">Há alterações não salvas.</p>}
            <nav className="acoes" aria-label="Navegação">
              {funcional && <button type="button" className="secundario" onClick={() => navegar('busca')}>Buscar servidores</button>}
              {podeSalvar && <button type="button" className="secundario" onClick={() => navegar('rascunhos')}>Meus rascunhos</button>}
              {sessao.usuario.papel === 'admin' && <button type="button" className="secundario" onClick={() => navegar('usuarios')}>Usuários</button>}
              {(sessao.usuario.papel === 'admin' || sessao.usuario.papel === 'secretario_adjunto') && (
                <button type="button" className="secundario" onClick={() => navegar('auditoria')}>Auditoria</button>
              )}
            </nav>
            {funcional && tela === 'busca' && <Servidores key={chaveTela} csrf={sessao.csrf} podeSalvar={podeSalvar}
              onErro={tratarErro} onLimpar={limparMensagens} onPendente={registrarPendencia} confirmarSaida={confirmarSaida} />}
            {podeSalvar && tela === 'rascunhos' && <RascunhosDof key={chaveTela} csrf={sessao.csrf}
              onErro={tratarErro} onLimpar={limparMensagens} onPendente={registrarPendencia} confirmarSaida={confirmarSaida} />}
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
