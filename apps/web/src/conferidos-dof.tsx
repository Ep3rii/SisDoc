import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PaginaConferidosDof, PreviaConferidaDof } from '@sisdoc/contratos';
import { renderizarPreviaDof } from '@sisdoc/templates';
import { api, ErroApi } from './api';

type Props = {
  csrf: string;
  podeDevolver: boolean;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
  onPendente: (valor: boolean) => void;
  confirmarSaida: () => boolean;
};

type Conferido = PaginaConferidosDof['itens'][number];

export function ConferidosDof({ csrf, podeDevolver, onErro, onLimpar, onPendente, confirmarSaida }: Props) {
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
  const ativa = useRef(true);

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

  if (selecionado) {
    return (
      <section className="painel" aria-labelledby="conferido-titulo">
        <h2 id="conferido-titulo">DOF conferida provisoriamente</h2>
        <p>{selecionado.nome} — matrícula {selecionado.matricula}. Revisão {selecionado.revisao},
          conferida por {selecionado.conferidoPorNome} em{' '}
          {new Date(selecionado.conferidoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.</p>
        <p>A conferência não aprova regras nem modelo e não autoriza emissão.</p>
        {(selecionado.fonteSelecionadaAlterada || previa?.fonteSelecionadaAlterada) && (
          <p className="aviso erro">A pessoa ou o vínculo mudou após a conferência. Devolva para revisão antes de qualquer emissão futura.</p>
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
        {podeDevolver && (
          <form className="separado" onSubmit={(evento) => void devolver(evento)}>
            <label>Motivo da devolução ao autor
              <textarea value={motivo} maxLength={2000} required disabled={ocupado} onChange={(evento) => {
                setMotivo(evento.target.value);
                onPendente(evento.target.value.trim().length > 0);
              }} />
            </label>
            <button type="submit" disabled={ocupado || !motivo.trim()}>
              {ocupado ? 'Devolvendo...' : 'Devolver DOF para ajustes'}
            </button>
          </form>
        )}
        <button type="button" className="secundario" disabled={ocupado} onClick={() => {
          if (confirmarSaida()) { setSelecionado(null); setMotivo(''); onPendente(false); }
        }}>Voltar às DOFs conferidas</button>
      </section>
    );
  }

  return (
    <section className="painel" aria-labelledby="conferidos-titulo">
      <h2 id="conferidos-titulo">DOFs conferidas</h2>
      <p>Somente suas DOFs e as encaminhadas a você são exibidas. A conferência é provisória; emissão ainda não está disponível.</p>
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
                <th scope="col">Revisão</th><th scope="col">Conferida por</th><th scope="col">Fonte</th><th scope="col">Ação</th></tr></thead>
              <tbody>{pagina.itens.map((item) => (
                <tr key={item.id}>
                  <td>{item.nome}</td><td>{item.matricula}</td><td>{item.autorNome}</td><td>{item.revisao}</td>
                  <td>{item.conferidoPorNome}</td>
                  <td>{item.fonteSelecionadaAlterada ? 'Pessoa ou vínculo alterado' : 'Sem alteração detectada na pessoa e no vínculo'}</td>
                  <td><button type="button" className="secundario" onClick={() => {
                    onLimpar(); setMensagem(''); setSelecionado(item);
                  }}>Abrir <span className="sr-only">DOF de {item.nome}, matrícula {item.matricula}</span></button></td>
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
