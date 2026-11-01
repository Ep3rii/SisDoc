import type { PaginaConferidosDof, PreviaConferidaDof, SituacaoEmissao } from '@sisdoc/contratos';
import { renderizarPreviaDof } from '@sisdoc/templates';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FiltrosLista, useFiltroLista } from '../compartilhado/filtros-lista';
import { PainelEmissao } from '../documentos/emissao';
import { ExclusaoDocumento } from '../documentos/exclusao-documento';
import { api, ErroApi } from '../infraestrutura/api';

type Props = {
  csrf: string;
  podeDevolver: boolean;
  podeEmitir: boolean;
  administrador?: boolean;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
  onPendente: (valor: boolean) => void;
  confirmarSaida: () => boolean;
};

type Conferido = PaginaConferidosDof['itens'][number];

export function ConferidosDof({ csrf, podeDevolver, podeEmitir, administrador = false, onErro, onLimpar, onPendente, confirmarSaida }: Props) {
  const [pagina, setPagina] = useState<PaginaConferidosDof | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [selecionado, setSelecionado] = useState<Conferido | null>(null);
  const [previa, setPrevia] = useState<PreviaConferidaDof | null>(null);
  const [falhaPrevia, setFalhaPrevia] = useState(false);
  const [versaoPrevia, setVersaoPrevia] = useState(0);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [versao, setVersao] = useState(0);
  const [revisado, setRevisado] = useState(false);
  const [emissao, setEmissao] = useState<SituacaoEmissao | null>(null);
  const chaveEmissao = useRef<{ documento: string; revisao: number; chave: string } | null>(null);
  const ativa = useRef(true);
  const filtro = useFiltroLista(pagina?.itens ?? [], (item) =>
    `${item.nome} ${item.matricula} ${item.autorNome} ${item.conferidoPorNome} ${item.revisao} ${item.fonteSelecionadaAlterada ? 'Fonte alterada' : 'Sem alteração'}`);

  useEffect(() => {
    ativa.current = true;
    return () => { ativa.current = false; };
  }, []);

  useEffect(() => {
    let corrente = true;
    setPagina(null);
    setFalhou(false);
    api.listarConferidosDof(cursor).then((resultado) => {
      if (corrente) setPagina(resultado);
    }).catch((erro: unknown) => {
      if (corrente) { setFalhou(true); onErro(erro); }
    });
    return () => { corrente = false; };
  }, [cursor, versao, onErro]);

  useEffect(() => {
    let corrente = true;
    setPrevia(null);
    setFalhaPrevia(false);
    if (selecionado) {
      api.obterPreviaConferidaDof(selecionado.id).then((resultado) => {
        if (resultado.documentoId !== selecionado.id || resultado.revisao !== selecionado.revisao) {
          throw new ErroApi(409, 'A DOF conferida mudou. Volte à lista e abra-a novamente.');
        }
        if (corrente) setPrevia(resultado);
      }).catch((erro: unknown) => {
        if (corrente) { setFalhaPrevia(true); onErro(erro); }
      });
    }
    return () => { corrente = false; };
  }, [selecionado, versaoPrevia, onErro]);

  async function devolver(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!selecionado) return;
    let concluido = false;
    try {
      onLimpar();
      setOcupado(true);
      onPendente(true);
      const resultado = await api.devolverConferidoDof(csrf, selecionado.id, {
        revisao: selecionado.revisao, motivo,
      });
      if (ativa.current) {
        if (resultado.documentoId !== selecionado.id || resultado.revisao !== selecionado.revisao + 1) {
          throw new ErroApi(0, 'Não foi possível confirmar a devolução. Consulte os rascunhos antes de tentar novamente.');
        }
        setSelecionado(null);
        setMotivo('');
        setVersao((atual) => atual + 1);
        setMensagem('DOF devolvida ao autor como rascunho. A conferência anterior foi preservada no registro.');
        concluido = true;
      }
    } catch (erro) {
      if (ativa.current) onErro(erro instanceof ErroApi && erro.status === 0
        ? new ErroApi(0, 'Não foi possível confirmar a devolução. Consulte os rascunhos antes de tentar novamente.')
        : erro);
    } finally {
      if (ativa.current) {
        setOcupado(false);
        onPendente(!concluido && motivo.trim().length > 0);
      }
    }
  }

  async function emitir() {
    if (!selecionado || !previa || previa.documentoId !== selecionado.id || previa.revisao !== selecionado.revisao) return;
    if (chaveEmissao.current?.documento !== selecionado.id || chaveEmissao.current.revisao !== selecionado.revisao) {
      chaveEmissao.current = { documento: selecionado.id, revisao: selecionado.revisao, chave: crypto.randomUUID() };
    }
    try {
      onLimpar();
      setOcupado(true);
      const resultado = await api.emitirDof(csrf, selecionado.id, chaveEmissao.current.chave, {
        revisao: selecionado.revisao, provaFonte: previa.fonte.provaFonte,
      });
      if (resultado.documentoId !== selecionado.id) {
        throw new ErroApi(0, 'Não foi possível confirmar a emissão. Consulte o Histórico antes de tentar novamente.');
      }
      if (ativa.current) {
        setEmissao(resultado);
        setVersao((atual) => atual + 1);
      }
    } catch (erro) {
      if (ativa.current) onErro(erro instanceof ErroApi && erro.status === 0
        ? new ErroApi(0, 'Não foi possível confirmar a emissão. Tente novamente: a mesma solicitação não gera número duplicado.')
        : erro);
    } finally {
      if (ativa.current) setOcupado(false);
    }
  }

  function fechar() {
    setSelecionado(null); setMotivo(''); setRevisado(false); setEmissao(null); onPendente(false);
  }

  if (selecionado && emissao) {
    return (
      <section className="painel" aria-labelledby="emitido-titulo">
        <h2 id="emitido-titulo">DOF emitida</h2>
        <p>{selecionado.nome} — matrícula {selecionado.matricula}.</p>
        <PainelEmissao situacao={emissao} onErro={onErro} onLimpar={onLimpar} />
        <button type="button" className="secundario" onClick={fechar}>Voltar às DOFs conferidas</button>
      </section>
    );
  }

  if (selecionado) {
    return (
      <section className="painel" aria-labelledby="conferido-titulo">
        <h2 id="conferido-titulo">DOF conferida provisoriamente</h2>
        <p>{selecionado.nome} — matrícula {selecionado.matricula}. Revisão {selecionado.revisao},
          conferida por {selecionado.conferidoPorNome} em{' '}
          {new Date(selecionado.conferidoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.</p>
        <p>A conferência não aprova regras nem modelo. A emissão só é liberada depois da aprovação formal da regra e do modelo.</p>
        {(selecionado.fonteSelecionadaAlterada || previa?.fonteSelecionadaAlterada) && (
          <p className="aviso erro">A pessoa ou o vínculo mudou após a conferência. Devolva para revisão antes de emitir.</p>
        )}
        <p>A prévia abaixo usa a fonte atual, que pode ter mudado desde a conferência. Não é um snapshot nem um documento oficial.</p>
        {falhaPrevia ? (
          <button type="button" className="secundario" onClick={() => {
            onLimpar(); setVersaoPrevia((atual) => atual + 1);
          }}>Tentar carregar prévia novamente</button>
        ) : previa && previa.documentoId === selecionado.id && previa.revisao === selecionado.revisao ? (
          <iframe className="previa-conferida" title="Prévia atual da DOF conferida" sandbox=""
            srcDoc={renderizarPreviaDof(previa)} />
        ) : <p role="status">Carregando prévia da DOF conferida...</p>}
        {podeEmitir && (
          <div className="separado">
            <h3>Emitir DOF</h3>
            <p>A emissão reserva o número oficial, grava um snapshot imutável e gera o PDF. Depois de emitida, a DOF não pode ser editada; apenas cancelada.</p>
            <label className="marcador"><input type="checkbox" checked={revisado} disabled={ocupado}
              onChange={(evento) => setRevisado(evento.target.checked)} />
              Revisei a prévia e confirmo a emissão desta DOF</label>
            <button type="button" disabled={ocupado || !revisado || !previa || previa.fonteSelecionadaAlterada
              || selecionado.fonteSelecionadaAlterada} onClick={() => void emitir()}>
              {ocupado ? 'Emitindo...' : 'Emitir DOF'}
            </button>
          </div>
        )}
        {podeDevolver && (
          <form className="zona-perigo separado" onSubmit={(evento) => void devolver(evento)}>
            <h3>Devolução para ajustes</h3>
            <label>Motivo da devolução ao autor
              <textarea value={motivo} maxLength={2000} required disabled={ocupado} onChange={(evento) => {
                setMotivo(evento.target.value);
                onPendente(evento.target.value.trim().length > 0);
              }} />
            </label>
            <button type="submit" className="perigo" disabled={ocupado || !motivo.trim()}>
              {ocupado ? 'Devolvendo...' : 'Devolver DOF para ajustes'}
            </button>
          </form>
        )}
        <button type="button" className="secundario" disabled={ocupado} onClick={() => {
          if (confirmarSaida()) fechar();
        }}>Voltar às DOFs conferidas</button>
      </section>
    );
  }

  return (
    <section className="painel" aria-labelledby="conferidos-titulo">
      <h2 id="conferidos-titulo">DOFs conferidas</h2>
      <FiltrosLista filtro={filtro} antesAlterar={confirmarSaida} onAtualizar={() => setVersao((atual) => atual + 1)} />
      <p>{administrador ? 'Todas as DOFs conferidas são exibidas. O administrador pode emitir ou devolver documentos de qualquer autoria.'
        : 'Somente suas DOFs e as encaminhadas a você são exibidas. A emissão é feita pelo coordenador.'} A emissão depende da aprovação formal da regra e do modelo.</p>
      {mensagem && <p className="aviso sucesso" role="status">{mensagem}</p>}
      {falhou ? (
        <button type="button" className="secundario" onClick={() => { onLimpar(); setVersao((atual) => atual + 1); }}>
          Tentar carregar DOFs conferidas novamente
        </button>
      ) : !pagina ? <p role="status">Carregando DOFs conferidas...</p> : (
        <>
          {pagina.itens.length === 0 ? <p>Nenhuma DOF conferida encontrada.</p> : (
            <div className="tabela"><table>
              <thead><tr><th scope="col">Nome</th><th scope="col">Matrícula</th><th scope="col">Autor</th>
                <th scope="col">Revisão</th><th scope="col">Conferida por</th><th scope="col">Fonte</th><th scope="col">Ações</th></tr></thead>
              <tbody>{filtro.itens.map((item) => (
                <tr key={item.id}>
                  <td>{item.nome}</td><td>{item.matricula}</td><td>{item.autorNome}</td><td>{item.revisao}</td>
                  <td>{item.conferidoPorNome}</td>
                  <td>{item.fonteSelecionadaAlterada ? 'Pessoa ou vínculo alterado' : 'Sem alteração detectada na pessoa e no vínculo'}</td>
                  <td><div className="acoes">
                    <button type="button" className="secundario" onClick={() => {
                      onLimpar(); setMensagem(''); setRevisado(false); setEmissao(null); setSelecionado(item);
                    }}>Abrir <span className="sr-only">DOF de {item.nome}, matrícula {item.matricula}</span></button>
                    {administrador && <ExclusaoDocumento csrf={csrf} documentoId={item.id} revisao={item.revisao}
                      descricao={`DOF conferida de ${item.nome}`} onErro={onErro} onPendente={onPendente}
                      onConcluido={(resultado) => {
                        setMensagem(resultado.estado === 'concluido'
                          ? 'Documento apagado fisicamente; registros de auditoria foram preservados.'
                          : 'Solicitação registrada e pendente de remoção segura do PDF ou liberação de dependências.');
                        setVersao((atual) => atual + 1);
                      }} />}
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <div className="acoes">
            <button type="button" className="secundario" disabled={!cursor}
              onClick={() => setCursor(undefined)}>Primeira página de conferidas</button>
            <button type="button" className="secundario" disabled={!pagina.proximoCursor}
              onClick={() => setCursor(pagina.proximoCursor ?? undefined)}>Próxima página de conferidas</button>
          </div>
        </>
      )}
    </section>
  );
}
