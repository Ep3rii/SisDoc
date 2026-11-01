import { StrictMode, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { RespostaSessao } from '@sisdoc/contratos';
import { api, ErroApi } from './api';
import { Auditoria } from './auditoria';
import { ConferidosDof } from './conferidos-dof';
import { TelaDtc } from './dtc';
import { Historico } from './historico';
import { RascunhosDof } from './rascunhos-dof';
import { BuscaGlobal, Servidores, type Consulta } from './servidores';
import { AvisoSincronizacao, EstadoSincronizacao, SincronizacaoAdmin } from './sincronizacao';
import { ImportacaoAdmin } from './importacao';
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
  const [tela, setTela] = useState<'usuarios' | 'auditoria' | 'busca' | 'rascunhos' | 'encaminhados' | 'conferidos' | 'historico'
    | 'DTC_IPAM' | 'DTC_COMISSIONADO' | 'DTC_INSS' | 'sincronizacao' | 'importacao'>('busca');
  const [chaveTela, setChaveTela] = useState(0);
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  const [alteracoesPendentes, setAlteracoesPendentes] = useState(false);
  const pendencias = useRef(false);
  const registrarPendencia = useCallback((valor: boolean) => {
    pendencias.current = valor;
    setAlteracoesPendentes(valor);
  }, []);
  const confirmarSaida = useCallback(() => !pendencias.current
    || window.confirm('Há alterações não salvas. Se uma gravação estiver em andamento, ela ainda poderá ser concluída. Deseja sair mesmo assim?'), []);
  const tratarErro = useCallback((problema: unknown) => {
    setMensagem('');
    if (problema instanceof ErroApi && problema.status === 401) {
      setSessao(null);
      setConsulta(null);
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
      setConsulta(null);
      registrarPendencia(false);
      setErro('');
      setMensagem('Sessão encerrada.');
    } catch (problema) {
      tratarErro(problema);
    }
  }
  const entrar = (resultado: RespostaSessao) => {
    setConsulta(null);
    setSessao(resultado);
    setErro('');
    setMensagem('');
    setTela(resultado.usuario.papel === 'admin' ? 'usuarios' : 'busca');
  };
  const encerrarLocal = (texto: string) => {
    setSessao(null);
    setConsulta(null);
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
  const navegar = (destino: typeof tela, busca: Consulta | null = null) => {
    if (!confirmarSaida()) return;
    registrarPendencia(false);
    limparMensagens();
    setChaveTela((atual) => atual + 1);
    setTela(destino);
    setConsulta(busca);
    setMenuAberto(false);
  };
  const funcional = sessao;
  const podeSalvar = sessao?.usuario.papel === 'analista' || sessao?.usuario.papel === 'coordenador' || sessao?.usuario.papel === 'admin';
  const podeEmitir = sessao?.usuario.papel === 'coordenador' || sessao?.usuario.papel === 'admin';
  const escoposHistorico: ReadonlyArray<'proprio' | 'todos'> = podeEmitir ? ['proprio', 'todos']
    : sessao?.usuario.papel === 'analista' ? ['proprio'] : ['todos'];

  return (
    <div className="pagina">
      <aside className={`barra-lateral${menuAberto ? ' aberta' : ''}`} aria-label="Menu principal">
        <div className="identidade"><span className="marca">SisDOC</span><span>SEMAD · Declarações funcionais</span></div>
        {sessao && !sessao.usuario.trocaSenhaObrigatoria && (
          <>
            <button type="button" className="menu-toggle" aria-expanded={menuAberto} aria-controls="navegacao-principal"
              onClick={() => setMenuAberto((valor) => !valor)}>Menu</button>
            <nav id="navegacao-principal" aria-label="Navegação">
              {funcional && <>
                <p className="grupo-menu">DOFs</p>
                <button type="button" aria-label="Buscar servidores" aria-current={tela === 'busca' ? 'page' : undefined}
                  onClick={() => navegar('busca')}>Buscar servidores<span>DOF · Ocorrências funcionais</span></button>
                {podeSalvar && <>
                  <button type="button" aria-current={tela === 'rascunhos' ? 'page' : undefined} onClick={() => navegar('rascunhos')}>{sessao.usuario.papel === 'admin' ? 'Todos os rascunhos' : 'Meus rascunhos'}</button>
                  <button type="button" aria-current={tela === 'conferidos' ? 'page' : undefined} onClick={() => navegar('conferidos')}>DOFs conferidas</button>
                </>}
                {podeEmitir && <button type="button"
                  aria-current={tela === 'encaminhados' ? 'page' : undefined} onClick={() => navegar('encaminhados')}>{sessao.usuario.papel === 'admin' ? 'Todos os encaminhados' : 'Encaminhados a mim'}</button>}
                {podeSalvar && <>
                  <p className="grupo-menu">DTCs</p>
                  <button type="button" aria-current={tela === 'DTC_IPAM' ? 'page' : undefined}
                    onClick={() => navegar('DTC_IPAM')}>DTC IPAM<span>Anexo III</span></button>
                  <button type="button" aria-current={tela === 'DTC_COMISSIONADO' ? 'page' : undefined}
                    onClick={() => navegar('DTC_COMISSIONADO')}>DTC Comissionado<span>Benefício junto ao INSS</span></button>
                  <button type="button" aria-current={tela === 'DTC_INSS' ? 'page' : undefined}
                    onClick={() => navegar('DTC_INSS')}>DTC INSS<span>RGPS · modelo provisório</span></button>
                </>}
                <div className="menu-separado"><button type="button" aria-current={tela === 'historico' ? 'page' : undefined}
                  onClick={() => navegar('historico')}>Histórico<span>Emissões, PDF e cópias</span></button></div>
              </>}
              {(sessao.usuario.papel === 'admin' || sessao.usuario.papel === 'secretario_adjunto') && <p className="grupo-menu">Administração</p>}
              {sessao.usuario.papel === 'admin' && <button type="button" aria-current={tela === 'usuarios' ? 'page' : undefined}
                onClick={() => navegar('usuarios')}>Usuários</button>}
              {sessao.usuario.papel === 'admin' && <button type="button" aria-current={tela === 'sincronizacao' ? 'page' : undefined}
                onClick={() => navegar('sincronizacao')}>Sincronização</button>}
              {sessao.usuario.papel === 'admin' && <button type="button" aria-current={tela === 'importacao' ? 'page' : undefined}
                onClick={() => navegar('importacao')}>Importação</button>}
              {(sessao.usuario.papel === 'admin' || sessao.usuario.papel === 'secretario_adjunto') && <button type="button"
                aria-current={tela === 'auditoria' ? 'page' : undefined} onClick={() => navegar('auditoria')}>Auditoria</button>}
            </nav>
          </>
        )}
        {sessao && <div className="usuario-local">
          <p>Conectado como <strong>{sessao.usuario.nome}</strong> — {nomesPerfis[sessao.usuario.papel]}.</p>
          <button type="button" className="cabecalho-botao" onClick={sair}>Sair</button>
        </div>}
      </aside>
      <div className="area-principal">
      <header className="cabecalho">
        {funcional && !sessao.usuario.trocaSenhaObrigatoria
          ? <BuscaGlobal onBuscar={(busca) => navegar('busca', busca)} onErro={tratarErro} />
          : <span>Declarações funcionais e de tempo de contribuição</span>}
        {funcional && !sessao.usuario.trocaSenhaObrigatoria ? <EstadoSincronizacao key={`estado-${chaveTela}`} /> : <span className="estado-fonte">Consulta local</span>}
      </header>
      <main>
      <div className="conteudo">
        <h1 className="sr-only">DOF e DTC</h1>
        <details className="situacao-implantacao">
          <summary>Uso operacional autorizado em 31/10/2026 — emissão de DOF e DTCs depende de aprovação formal de cada modelo</summary>
          <p>Consulta, cálculo, rascunhos, prévia e conferência da DOF e das DTCs (IPAM, Comissionado e INSS) estão liberados. A emissão com número e PDF só é liberada, por tipo, depois que a regra e o modelo forem aprovados formalmente pelo administrador com npm run aprovar-modelo. Até lá, as regras e a prévia seguem identificadas como provisórias. Os totais da DTC Comissionado são inferidos e o modelo da DTC INSS é provisório (textos oficiais pendentes).</p>
        </details>
        {erro && <p className="aviso erro" role="alert">{erro}</p>}
        {mensagem && <p className="aviso sucesso" role="status">{mensagem}</p>}
        {carregando ? <p role="status">Verificando sessão...</p> : !sessao ? (
          <Login onEntrar={entrar} onErro={tratarErro} />
        ) : sessao.usuario.trocaSenhaObrigatoria ? (
          <TrocaSenha sessao={sessao} onConcluir={() => encerrarLocal('Senha alterada. Entre novamente.')} onErro={tratarErro} />
        ) : (
          <>
            {alteracoesPendentes && <p className="etiqueta" role="status">Há alterações não salvas.</p>}
            {funcional && <AvisoSincronizacao key={`situacao-${chaveTela}`} />}
            {sessao.usuario.papel === 'admin' && tela === 'sincronizacao' && (
              <SincronizacaoAdmin key={chaveTela} csrf={sessao.csrf} onErro={tratarErro} onMensagem={informar} />
            )}
            {sessao.usuario.papel === 'admin' && tela === 'importacao' && (
              <ImportacaoAdmin key={chaveTela} csrf={sessao.csrf} onErro={tratarErro} onMensagem={informar} />
            )}
            {funcional && tela === 'busca' && <Servidores key={chaveTela} csrf={sessao.csrf} podeSalvar={podeSalvar}
              consulta={consulta}
              onErro={tratarErro} onLimpar={limparMensagens} onPendente={registrarPendencia} confirmarSaida={confirmarSaida} />}
            {podeSalvar && tela === 'rascunhos' && <RascunhosDof key={chaveTela} csrf={sessao.csrf} administrador={sessao.usuario.papel === 'admin'}
              onErro={tratarErro} onLimpar={limparMensagens} onPendente={registrarPendencia} confirmarSaida={confirmarSaida} />}
            {podeSalvar && tela === 'conferidos' && <ConferidosDof key={chaveTela} csrf={sessao.csrf}
              administrador={sessao.usuario.papel === 'admin'} podeDevolver={podeEmitir} podeEmitir={podeEmitir}
              onErro={tratarErro} onLimpar={limparMensagens}
              onPendente={registrarPendencia} confirmarSaida={confirmarSaida} />}
            {podeEmitir && tela === 'encaminhados' && (
              <RascunhosDof key={chaveTela} csrf={sessao.csrf} recebidos administrador={sessao.usuario.papel === 'admin'}
                onErro={tratarErro} onLimpar={limparMensagens} onPendente={registrarPendencia} confirmarSaida={confirmarSaida} />
            )}
            {podeSalvar && (tela === 'DTC_IPAM' || tela === 'DTC_COMISSIONADO' || tela === 'DTC_INSS') && (
              <TelaDtc key={`dtc-${tela}-${chaveTela}`} tipo={tela} csrf={sessao.csrf} papel={sessao.usuario.papel}
                onErro={tratarErro} onLimpar={limparMensagens} onPendente={registrarPendencia} confirmarSaida={confirmarSaida} />
            )}
            {tela === 'historico' && (
              <Historico key={chaveTela} csrf={sessao.csrf} escopos={escoposHistorico}
                onErro={tratarErro} onLimpar={limparMensagens} onPendente={registrarPendencia}
                {...(podeSalvar ? { onAbrirRascunhos: () => navegar('rascunhos') } : {})} />
            )}
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
      </div>
    </div>
  );
}

const raiz = document.getElementById('root');
if (!raiz) throw new Error('Elemento principal da aplicação não encontrado.');
createRoot(raiz).render(<StrictMode><App /></StrictMode>);
