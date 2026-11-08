import { type AbaDocumentos, type TipoDtc, type RespostaSessao } from '@sisdoc/contratos';
import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Login, TrocaSenha } from '../autenticacao/acesso';
import { BuscaGlobal } from '../cadastro/busca-global';
import type { Consulta } from '../cadastro/contexto';
import type { Servidor } from '../dtc/contexto';
import '../compartilhado/estilos.css';
import { api, ErroApi } from '../infraestrutura/api';
import { AvisoSincronizacao, EstadoSincronizacao, SincronizacaoAdmin } from '../transferencia/sincronizacao';
import { hashRota, lerRota, telaAdministrativa, type Rota, type Tela } from './rotas';

const Usuarios = lazy(() => import('../administracao/usuarios').then((m) => ({ default: m.Usuarios })));
const Auditoria = lazy(() => import('../administracao/auditoria').then((m) => ({ default: m.Auditoria })));
const Servidores = lazy(() => import('../cadastro/servidores').then((m) => ({ default: m.Servidores })));
const Historico = lazy(() => import('../documentos/historico').then((m) => ({ default: m.Historico })));
const ListaDocumentosTela = lazy(() => import('../documentos/lista-documentos').then((m) => ({ default: m.ListaDocumentosTela })));
const ImportacaoAdmin = lazy(() => import('../transferencia/importacao').then((m) => ({ default: m.ImportacaoAdmin })));
const nomesPerfis = { admin: 'Administrador', analista: 'Analista', coordenador: 'Coordenador' };

class ProtecaoTela extends Component<{ children: ReactNode; confirmarSaida: () => boolean }, { falhou: boolean }> {
  state = { falhou: false };
  static getDerivedStateFromError() { return { falhou: true }; }
  render() {
    if (this.state.falhou) return <section className="aviso erro" role="alert">
      <h2>Não foi possível abrir esta tela.</h2>
      <p>Verifique a conexão e recarregue a aplicação. Alterações não salvas não serão recuperadas.</p>
      <button type="button" onClick={() => { if (this.props.confirmarSaida()) window.location.reload(); }}>Recarregar aplicação</button>
    </section>;
    return this.props.children;
  }
}

/** Compõe navegação por perfil, sessão e proteção global de alterações não salvas. */
export function App() {
  const [sessao, setSessao] = useState<RespostaSessao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const [tela, setTela] = useState<Tela>('busca');
  const [aba, setAba] = useState<AbaDocumentos>('rascunhos');
  const [tipoDtc, setTipoDtc] = useState<TipoDtc | undefined>();
  const [chaveTela, setChaveTela] = useState(0);
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  const [servidorDtc, setServidorDtc] = useState<Servidor | undefined>();
  const [menuAberto, setMenuAberto] = useState(false);
  const [alteracoesPendentes, setAlteracoesPendentes] = useState(false);
  const aoMudarHash = useRef<() => void>(() => {});
  const pendencias = useRef(false);
  const buscaSelecionarServidor = useRef<((consulta: Consulta) => void) | null>(null);
  const registrarBusca = useCallback((buscar: ((consulta: Consulta) => void) | null) => {
    buscaSelecionarServidor.current = buscar;
  }, []);
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
    const mudar = () => aoMudarHash.current();
    window.addEventListener('hashchange', mudar);
    return () => window.removeEventListener('hashchange', mudar);
  }, []);

  useEffect(() => {
    function focarBusca(evento: KeyboardEvent) {
      if (evento.key !== '/' || evento.ctrlKey || evento.altKey || evento.metaKey || evento.isComposing) return;
      const alvo = evento.target;
      if (alvo instanceof HTMLElement && (alvo.closest('input, textarea, select') || alvo.isContentEditable)) return;
      const campo = document.querySelector<HTMLInputElement>('.busca-inicio input[name="q"]')
        ?? document.querySelector<HTMLInputElement>('.cabecalho input[name="q"]');
      if (campo) { evento.preventDefault(); campo.focus(); }
    }
    window.addEventListener('keydown', focarBusca);
    return () => window.removeEventListener('keydown', focarBusca);
  }, []);

  useEffect(() => {
    /** Solicita confirmação nativa ao fechar a página enquanto houver edição pendente. */
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
        const rota = lerRota(window.location.hash || `#${window.location.pathname}`);
        if (telaAdministrativa(rota.tela) && resultado.usuario.papel !== 'admin') {
          rota.tela = 'busca'; setErro('Administração disponível apenas para administradores.');
        }
        setTela(rota.tela); setAba(rota.aba); setTipoDtc(rota.tipo);
        window.history.replaceState(null, '', `/${hashRota(rota)}`);
      }
    }).catch((problema: unknown) => {
      if (ativa && (!(problema instanceof ErroApi) || problema.status !== 401)) tratarErro(problema);
    }).finally(() => {
      if (ativa) setCarregando(false);
    });
    return () => { ativa = false; };
  }, [tratarErro]);

  /** Encerra sessão no servidor somente após confirmar descarte de alterações pendentes. */
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
    setServidorDtc(undefined);
    setTela('busca');
    setAba('rascunhos'); setTipoDtc(undefined);
    window.history.replaceState(null, '', '#/inicio');
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
  const aplicarRota = (rota: Rota, busca: Consulta | null = null) => {
    setTela(rota.tela); setAba(rota.aba); setTipoDtc(rota.tipo);
    setChaveTela((atual) => atual + 1); setConsulta(busca); setServidorDtc(undefined);
    setMenuAberto(false); registrarPendencia(false); limparMensagens();
  };
  const navegar = (destino: Tela, busca: Consulta | null = null, abaDestino: AbaDocumentos = 'rascunhos', tipo?: TipoDtc) => {
    if (!confirmarSaida()) return;
    const rota = { tela: destino, aba: abaDestino, tipo };
    aplicarRota(rota, busca);
    const hash = hashRota(rota);
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  };
  aoMudarHash.current = () => {
    if (!sessao || sessao.usuario.trocaSenhaObrigatoria) return;
    if (!confirmarSaida()) { window.history.replaceState(null, '', hashRota({ tela, aba, tipo: tipoDtc })); return; }
    const rota = lerRota(window.location.hash);
    const acessoNegado = telaAdministrativa(rota.tela) && sessao.usuario.papel !== 'admin';
    if (acessoNegado) rota.tela = 'busca';
    aplicarRota(rota);
    if (acessoNegado) setErro('Administração disponível apenas para administradores.');
    window.history.replaceState(null, '', hashRota(rota));
  };
  const buscarServidor = (busca: Consulta) => {
    if (buscaSelecionarServidor.current) {
      limparMensagens();
      buscaSelecionarServidor.current(busca);
    }
    else navegar('busca', busca);
  };
  const funcional = sessao;
  const podeSalvar = sessao?.usuario.papel === 'analista' || sessao?.usuario.papel === 'coordenador' || sessao?.usuario.papel === 'admin';
  const podeEmitir = sessao?.usuario.papel === 'coordenador' || sessao?.usuario.papel === 'admin';
  const escoposHistorico: ReadonlyArray<'proprio' | 'todos'> = podeEmitir ? ['proprio', 'todos']
    : sessao?.usuario.papel === 'analista' ? ['proprio'] : ['todos'];

  return (
    <div className={`pagina${sessao ? '' : ' sem-sessao'}`}>
      {sessao && <aside className={`barra-lateral${menuAberto ? ' aberta' : ''}`} aria-label="Menu principal">
        <div className="identidade"><span className="marca">SisDOC</span><span>SEMAD · Declarações funcionais</span></div>
        {sessao && !sessao.usuario.trocaSenhaObrigatoria && (
          <>
            <button type="button" className="menu-toggle" aria-expanded={menuAberto} aria-controls="navegacao-principal"
              onClick={() => setMenuAberto((valor) => !valor)}>Menu</button>
            <nav id="navegacao-principal" aria-label="Navegação">
              <button type="button" aria-current={tela === 'busca' ? 'page' : undefined} onClick={() => navegar('busca')}>Início</button>
              <button type="button" aria-current={tela === 'dofs' ? 'page' : undefined} onClick={() => navegar('dofs')}>DOFs</button>
              <button type="button" aria-current={tela === 'dtcs' ? 'page' : undefined} onClick={() => navegar('dtcs')}>DTCs</button>
              <button type="button" aria-current={tela === 'historico' ? 'page' : undefined} onClick={() => navegar('historico')}>Histórico</button>
              {sessao.usuario.papel === 'admin' && <button type="button"
                aria-current={telaAdministrativa(tela) ? 'page' : undefined} onClick={() => navegar('usuarios')}>Administração</button>}
            </nav>
          </>
        )}
        {sessao && <div className="usuario-local">
          <p>Conectado como <strong>{sessao.usuario.nome}</strong> — {nomesPerfis[sessao.usuario.papel]}.</p>
          <button type="button" className="secundario" onClick={sair}>Sair</button>
        </div>}
      </aside>}
      <div className="area-principal">
      <header className="cabecalho">
        {funcional && !sessao.usuario.trocaSenhaObrigatoria
          ? <BuscaGlobal onBuscar={buscarServidor} onErro={tratarErro} />
          : <span>Declarações funcionais e de tempo de contribuição</span>}
        {funcional && !sessao.usuario.trocaSenhaObrigatoria ? <EstadoSincronizacao key={`estado-${chaveTela}`} /> : (
          <span className="estado-fonte" role="status" tabIndex={0} title="Acesse o SisDoc para verificar a situação da sincronização."
            aria-label="Acesse o SisDoc para verificar a situação da sincronização.">
            <span className="ponto-status atencao" aria-hidden="true" />
          </span>
        )}
      </header>
      <main>
      <div className="conteudo">
        <h1 className="sr-only">DOF e DTC</h1>
        {erro && <p className="aviso erro" role="alert">{erro}</p>}
        {mensagem && <p className="aviso sucesso" role="status">{mensagem}</p>}
        {carregando ? <p role="status">Verificando sessão...</p> : !sessao ? (
          <Login onEntrar={entrar} onErro={tratarErro} />
        ) : sessao.usuario.trocaSenhaObrigatoria ? (
          <TrocaSenha sessao={sessao} onConcluir={() => encerrarLocal('Senha alterada. Entre novamente.')} onErro={tratarErro} />
        ) : (
          <ProtecaoTela key={`${tela}-${chaveTela}`} confirmarSaida={confirmarSaida}>
          <Suspense fallback={<p role="status">Carregando tela...</p>}>
            {alteracoesPendentes && <p className="etiqueta" role="status">Há alterações não salvas.</p>}
            {sessao.usuario.papel === 'admin' && telaAdministrativa(tela) && <>
              <h2>Administração</h2>
              <nav className="abas-documentos" aria-label="Seções da Administração">
                {([['usuarios', 'Usuários'], ['importacao', 'Importação e exportação'], ['sincronizacao', 'Sincronização'], ['auditoria', 'Auditoria']] as const)
                  .map(([destino, rotulo]) => <button type="button" className="secundario" key={destino}
                    aria-current={tela === destino ? 'page' : undefined} onClick={() => navegar(destino)}>{rotulo}</button>)}
              </nav>
            </>}
            {funcional && <AvisoSincronizacao key={`situacao-${chaveTela}`} />}
            {sessao.usuario.papel === 'admin' && tela === 'sincronizacao' && (
              <SincronizacaoAdmin key={chaveTela} csrf={sessao.csrf} onErro={tratarErro} onMensagem={informar} />
            )}
            {sessao.usuario.papel === 'admin' && tela === 'importacao' && (
              <ImportacaoAdmin key={chaveTela} csrf={sessao.csrf} onErro={tratarErro} onMensagem={informar} />
            )}
            {funcional && tela === 'busca' && <Servidores key={chaveTela} csrf={sessao.csrf}
              podeSalvar={podeSalvar && sessao.usuario.papel !== 'admin'}
              podeEditarCadastro={sessao.usuario.papel === 'admin'}
              consulta={consulta} onBuscar={buscarServidor} onTrocarServidor={() => navegar('busca')}
              onNovaDtc={(tipo, servidor) => {
                if (sessao.usuario.papel === 'admin' || !confirmarSaida()) return;
                navegar('dtcs', null, 'rascunhos', tipo); setServidorDtc(servidor);
              }}
              onErro={tratarErro} onLimpar={limparMensagens} onPendente={registrarPendencia} confirmarSaida={confirmarSaida} />}
            {(tela === 'dofs' || tela === 'dtcs') && <ListaDocumentosTela key={`${tela}-${chaveTela}`} grupo={tela === 'dofs' ? 'DOF' : 'DTC'}
              aba={aba} tipo={tipoDtc} csrf={sessao.csrf} papel={sessao.usuario.papel} servidorInicial={servidorDtc}
              onNavegar={(destino, tipo) => navegar(tela, null, destino, tipo)}
              onBuscarServidor={() => navegar('busca')} onRegistrarBusca={registrarBusca}
              onErro={tratarErro} onLimpar={limparMensagens} onPendente={registrarPendencia} confirmarSaida={confirmarSaida} />}
            {tela === 'historico' && (
              <Historico key={chaveTela} csrf={sessao.csrf} escopos={escoposHistorico}
                onErro={tratarErro} onLimpar={limparMensagens} onPendente={registrarPendencia} confirmarSaida={confirmarSaida}
                {...(podeSalvar ? { onAbrirRascunhos: () => navegar('dofs') } : {})} />
            )}
            {sessao.usuario.papel === 'admin' && tela === 'usuarios' && (
              <Usuarios sessao={sessao} onErro={tratarErro} onMensagem={informar} onSessaoEncerrada={encerrarLocal}
                onPendente={registrarPendencia} confirmarSaida={confirmarSaida} />
            )}
            {(sessao.usuario.papel === 'admin' && tela === 'auditoria') && (
              <Auditoria onErro={tratarErro} />
            )}
          </Suspense>
          </ProtecaoTela>
        )}
      </div>
      </main>
      </div>
    </div>
  );
}
