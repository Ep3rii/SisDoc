import { notificacoesDeclaracoesSchema, type NotificacoesDeclaracoes, type RespostaSessao } from '@sisdoc/contratos';
import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Login, TrocaSenha } from '../autenticacao/acesso';
import { BuscaGlobal } from '../cadastro/busca-global';
import type { Consulta } from '../cadastro/contexto';
import '../compartilhado/estilos.css';
import { api, ErroApi, requisitar, validar } from '../infraestrutura/api';
import { AvisoSincronizacao, EstadoSincronizacao, SincronizacaoAdmin } from '../transferencia/sincronizacao';

const Usuarios = lazy(() => import('../administracao/usuarios').then((m) => ({ default: m.Usuarios })));
const Auditoria = lazy(() => import('../administracao/auditoria').then((m) => ({ default: m.Auditoria })));
const Servidores = lazy(() => import('../cadastro/servidores').then((m) => ({ default: m.Servidores })));
const Historico = lazy(() => import('../documentos/historico').then((m) => ({ default: m.Historico })));
const ConferidosDof = lazy(() => import('../dof/conferidos-dof').then((m) => ({ default: m.ConferidosDof })));
const RascunhosDof = lazy(() => import('../dof/rascunhos-dof').then((m) => ({ default: m.RascunhosDof })));
const TelaDtc = lazy(() => import('../dtc/dtc').then((m) => ({ default: m.TelaDtc })));
const Retornos = lazy(() => import('../documentos/retornos').then((m) => ({ default: m.Retornos })));
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
  const [tela, setTela] = useState<'usuarios' | 'auditoria' | 'busca' | 'rascunhos' | 'encaminhados' | 'retornos' | 'conferidos' | 'historico'
    | 'DTC_IPAM' | 'DTC_COMISSIONADO' | 'DTC_INSS' | 'sincronizacao' | 'importacao'>('busca');
  const [chaveTela, setChaveTela] = useState(0);
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  const [alteracoesPendentes, setAlteracoesPendentes] = useState(false);
  const [notificacoes, setNotificacoes] = useState<NotificacoesDeclaracoes | null>(null);
  const [erroNotificacoes, setErroNotificacoes] = useState(false);
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
    if (!sessao || sessao.usuario.trocaSenhaObrigatoria) { setNotificacoes(null); return; }
    let ativa = true;
    let ocupado = false;
    let pendente = false;
    async function atualizar() {
      if (!ativa || document.visibilityState === 'hidden') return;
      if (ocupado) { pendente = true; return; }
      ocupado = true;
      try {
        const dados = validar(notificacoesDeclaracoesSchema, await requisitar('notificacoes/declaracoes'));
        if (ativa) { setNotificacoes(dados); setErroNotificacoes(false); }
      } catch (erro: unknown) {
        if (ativa) { setNotificacoes(null); setErroNotificacoes(true); if (erro instanceof ErroApi && erro.status === 401) tratarErro(erro); }
      } finally {
        ocupado = false;
        if (pendente && ativa) { pendente = false; void atualizar(); }
      }
    }
    void atualizar();
    const intervalo = window.setInterval(() => void atualizar(), 30000);
    window.addEventListener('sisdoc:alteracao', atualizar);
    window.addEventListener('focus', atualizar);
    document.addEventListener('visibilitychange', atualizar);
    return () => {
      ativa = false; window.clearInterval(intervalo);
      window.removeEventListener('sisdoc:alteracao', atualizar);
      window.removeEventListener('focus', atualizar);
      document.removeEventListener('visibilitychange', atualizar);
    };
  }, [sessao, tratarErro]);

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
        setTela(resultado.usuario.papel === 'admin' ? 'usuarios' : 'busca');
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
    <div className={`pagina${sessao ? '' : ' sem-sessao'}`}>
      {sessao && <aside className={`barra-lateral${menuAberto ? ' aberta' : ''}`} aria-label="Menu principal">
        <div className="identidade"><span className="marca">SisDOC</span><span>SEMAD · Declarações funcionais</span></div>
        {sessao && !sessao.usuario.trocaSenhaObrigatoria && (
          <>
            <button type="button" className="menu-toggle" aria-expanded={menuAberto} aria-controls="navegacao-principal"
              onClick={() => setMenuAberto((valor) => !valor)}>Menu</button>
            <nav id="navegacao-principal" aria-label="Navegação">
              {sessao.usuario.papel === 'admin' && <>
                <details className="categoria-menu" open><summary>Administração</summary>
                  <button type="button" aria-current={tela === 'usuarios' ? 'page' : undefined}
                    onClick={() => navegar('usuarios')}>Usuários</button>
                  <button type="button" aria-current={tela === 'importacao' ? 'page' : undefined}
                    onClick={() => navegar('importacao')}>Importação e exportação</button>
                  <button type="button" aria-current={tela === 'sincronizacao' ? 'page' : undefined}
                    onClick={() => navegar('sincronizacao')}>Sincronização</button>
                <button type="button" aria-current={tela === 'auditoria' ? 'page' : undefined}
                  onClick={() => navegar('auditoria')}>Auditoria</button>
                </details>
              </>}
              {funcional && <>
                <details className="categoria-menu" open><summary>Cadastro de pessoas</summary>
                <button type="button" aria-label="Buscar servidores" aria-current={tela === 'busca' ? 'page' : undefined}
                  onClick={() => navegar('busca')}>Buscar servidores<span>Dados de referência · DOF e DTC</span></button>
                </details>
                <details className="categoria-menu" open><summary>DOFs</summary>
                {podeSalvar && <>
                  <button type="button" aria-current={tela === 'rascunhos' ? 'page' : undefined} onClick={() => navegar('rascunhos')}>Rascunhos</button>
                  <button type="button" aria-current={tela === 'conferidos' ? 'page' : undefined} onClick={() => navegar('conferidos')}>DOFs conferidas</button>
                </>}
                {podeEmitir && <button type="button" className="aba-notificada"
                  aria-current={tela === 'encaminhados' ? 'page' : undefined} onClick={() => navegar('encaminhados')}>
                  {sessao.usuario.papel === 'admin' ? 'Todos os encaminhados' : 'Encaminhados a mim'}
                  {notificacoes && notificacoes.encaminhados > 0 && <span className="contador-notificacao" aria-label={`${notificacoes.encaminhados} declarações encaminhadas pendentes`}>{notificacoes.encaminhados}</span>}
                </button>}
                {podeSalvar && <button type="button" className="aba-notificada" aria-current={tela === 'retornos' ? 'page' : undefined}
                  onClick={() => navegar('retornos')}>Retornos para ajustes
                  {notificacoes && notificacoes.retornos > 0 && <span className="contador-notificacao" aria-label={`${notificacoes.retornos} declarações devolvidas pendentes`}>{notificacoes.retornos}</span>}
                </button>}
                {erroNotificacoes && <p role="status">Contagem de notificações indisponível. A atualização será tentada novamente.</p>}
                </details>
                {podeSalvar && <>
                  <details className="categoria-menu" open><summary>DTCs</summary>
                  <button type="button" aria-current={tela === 'DTC_IPAM' ? 'page' : undefined}
                    onClick={() => navegar('DTC_IPAM')}>DTC IPAM<span>Anexo III</span></button>
                  <button type="button" aria-current={tela === 'DTC_COMISSIONADO' ? 'page' : undefined}
                    onClick={() => navegar('DTC_COMISSIONADO')}>DTC Comissionado<span>Benefício junto ao INSS</span></button>
                  <button type="button" aria-current={tela === 'DTC_INSS' ? 'page' : undefined}
                    onClick={() => navegar('DTC_INSS')}>DTC INSS<span>RGPS · modelo provisório</span></button>
                  </details>
                </>}
                <details className="categoria-menu" open><summary>Documentos emitidos</summary>
                <div className="menu-separado"><button type="button" aria-current={tela === 'historico' ? 'page' : undefined}
                  onClick={() => navegar('historico')}>Histórico<span>Emissões, PDF e cópias</span></button></div>
                </details>
              </>}
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
          ? <BuscaGlobal onBuscar={(busca) => navegar('busca', busca)} onErro={tratarErro} />
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
              consulta={consulta}
              onErro={tratarErro} onLimpar={limparMensagens} onPendente={registrarPendencia} confirmarSaida={confirmarSaida} />}
            {podeSalvar && tela === 'rascunhos' && <RascunhosDof key={chaveTela} csrf={sessao.csrf} administrador={sessao.usuario.papel === 'admin'}
              onErro={tratarErro} onLimpar={limparMensagens} onPendente={registrarPendencia} confirmarSaida={confirmarSaida}
              onBuscarServidor={() => navegar('busca')} />}
            {podeSalvar && tela === 'retornos' && <Retornos key={chaveTela} csrf={sessao.csrf} papel={sessao.usuario.papel}
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
                onErro={tratarErro} onLimpar={limparMensagens} onPendente={registrarPendencia} confirmarSaida={confirmarSaida}
                {...(podeSalvar ? { onAbrirRascunhos: () => navegar('rascunhos') } : {})} />
            )}
            {sessao.usuario.papel === 'admin' && tela === 'usuarios' && (
              <Usuarios sessao={sessao} onErro={tratarErro} onMensagem={informar} onSessaoEncerrada={encerrarLocal} />
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
