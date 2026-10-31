import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ROTULOS_DTC, type GrupoHistorico, type HistoricoEmissoes, type ItemHistorico } from '@sisdoc/contratos';
import { api, ErroApi } from './api';
import { baixarPdfEmissao, rotuloPdf } from './emissao';

type Props = {
  csrf: string;
  escopos: ReadonlyArray<'proprio' | 'todos'>;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
  onPendente: (valor: boolean) => void;
  onAbrirRascunhos?: () => void;
};

const nomesEscopo = { proprio: 'Minhas emissões (5 últimas)', todos: 'Todas as emissões (50 últimas)' } as const;

export function Historico({ csrf, escopos, onErro, onLimpar, onPendente, onAbrirRascunhos }: Props) {
  const [grupo, setGrupo] = useState<GrupoHistorico>('DOF');
  const [escopo, setEscopo] = useState<'proprio' | 'todos'>(escopos[0] ?? 'proprio');
  const [dados, setDados] = useState<HistoricoEmissoes | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [versao, setVersao] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [cancelando, setCancelando] = useState<ItemHistorico | null>(null);
  const [motivo, setMotivo] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  const ativa = useRef(true);

  useEffect(() => {
    ativa.current = true;
    return () => { ativa.current = false; };
  }, []);

  useEffect(() => {
    let corrente = true;
    setDados(null);
    setFalhou(false);
    api.historico(grupo, escopo).then((resultado) => {
      if (corrente) setDados(resultado);
    }).catch((erro: unknown) => {
      if (corrente) { setFalhou(true); onErro(erro); }
    });
    return () => { corrente = false; };
  }, [grupo, escopo, versao, onErro]);

  async function baixar(item: ItemHistorico) {
    try {
      onLimpar();
      setOcupado(true);
      const nome = await baixarPdfEmissao(item.emissaoId);
      if (ativa.current) setMensagem(`Download iniciado: ${nome}.`);
    } catch (erro) {
      if (ativa.current) onErro(erro);
    } finally {
      if (ativa.current) setOcupado(false);
    }
  }

  async function copiar(item: ItemHistorico) {
    if (!window.confirm(`Criar um novo rascunho a partir da emissão ${item.numero}? A emissão original não é alterada.`)) return;
    try {
      onLimpar();
      setOcupado(true);
      const resultado = await api.copiarEmitido(csrf, item.documentoId, item.tipo);
      if (resultado.origemEmissaoId !== item.emissaoId) {
        throw new ErroApi(0, 'Não foi possível confirmar a cópia. Consulte os rascunhos antes de tentar novamente.');
      }
      if (ativa.current) {
        setMensagem(item.tipo === 'DOF'
          ? `Rascunho criado a partir da emissão ${item.numero}. Ele está em Meus rascunhos.`
          : `Rascunho criado a partir da emissão ${item.numero}. Ele está na tela da ${ROTULOS_DTC[item.tipo]}.`);
      }
    } catch (erro) {
      if (ativa.current) onErro(erro);
    } finally {
      if (ativa.current) setOcupado(false);
    }
  }

  async function cancelar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!cancelando || !confirmado) return;
    try {
      onLimpar();
      setOcupado(true);
      const resultado = await api.cancelarEmitido(csrf, cancelando.documentoId, { motivo, confirmar: true });
      if (resultado.emissaoId !== cancelando.emissaoId || resultado.status !== 'cancelado') {
        throw new ErroApi(0, 'Não foi possível confirmar o cancelamento. Consulte o Histórico antes de tentar novamente.');
      }
      if (ativa.current) {
        setMensagem(`Emissão ${cancelando.numero} cancelada. O número não é reutilizado.`);
        setCancelando(null);
        setMotivo('');
        setConfirmado(false);
        onPendente(false);
        setVersao((atual) => atual + 1);
      }
    } catch (erro) {
      if (ativa.current) onErro(erro);
    } finally {
      if (ativa.current) setOcupado(false);
    }
  }

  if (cancelando) {
    return (
      <section className="painel" aria-labelledby="cancelar-titulo">
        <h2 id="cancelar-titulo">Cancelar emissão {cancelando.numero}</h2>
        <p>O cancelamento é definitivo: o documento continua registrado, o número não é reutilizado e o motivo fica guardado cifrado.</p>
        <form onSubmit={(evento) => void cancelar(evento)}>
          <label>Motivo do cancelamento
            <textarea value={motivo} maxLength={2000} required disabled={ocupado} onChange={(evento) => {
              setMotivo(evento.target.value);
              onPendente(evento.target.value.trim().length > 0);
            }} />
          </label>
          <label className="marcador"><input type="checkbox" checked={confirmado} disabled={ocupado}
            onChange={(evento) => setConfirmado(evento.target.checked)} />
            Confirmo o cancelamento desta emissão</label>
          <div className="acoes">
            <button type="submit" disabled={ocupado || !motivo.trim() || !confirmado}>
              {ocupado ? 'Cancelando...' : 'Cancelar emissão'}
            </button>
            <button type="button" className="secundario" disabled={ocupado} onClick={() => {
              setCancelando(null); setMotivo(''); setConfirmado(false); onPendente(false);
            }}>Voltar ao Histórico</button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="painel" aria-labelledby="historico-titulo">
      <h2 id="historico-titulo">Histórico de emissões</h2>
      <div className="acoes">
        <label>Grupo
          <select value={grupo} onChange={(evento) => setGrupo(evento.target.value === 'DTC' ? 'DTC' : 'DOF')}>
            <option value="DOF">DOF</option>
            <option value="DTC">DTCs</option>
          </select>
        </label>
        {escopos.length > 1 && (
          <label>Escopo
            <select value={escopo} onChange={(evento) => setEscopo(evento.target.value === 'todos' ? 'todos' : 'proprio')}>
              {escopos.map((valor) => <option key={valor} value={valor}>{nomesEscopo[valor]}</option>)}
            </select>
          </label>
        )}
      </div>
      {mensagem && <p className="aviso sucesso" role="status">{mensagem}
        {onAbrirRascunhos && mensagem.includes('Meus rascunhos') && <>{' '}
          <button type="button" className="secundario" onClick={onAbrirRascunhos}>Abrir Meus rascunhos</button></>}
      </p>}
      {falhou ? (
        <button type="button" className="secundario" onClick={() => { onLimpar(); setVersao((atual) => atual + 1); }}>
          Tentar carregar o Histórico novamente
        </button>
      ) : !dados ? <p role="status">Carregando Histórico...</p> : dados.itens.length === 0 ? (
        <p>{grupo === 'DTC' ? 'Nenhuma DTC emitida encontrada.' : 'Nenhuma DOF emitida encontrada.'}</p>
      ) : (
        <div className="tabela"><table>
          <thead><tr><th scope="col">Tipo</th><th scope="col">Número</th><th scope="col">Nome</th><th scope="col">Matrícula</th>
            <th scope="col">Emitida em</th><th scope="col">Emitida por</th><th scope="col">Situação</th>
            <th scope="col">PDF</th><th scope="col">Ações</th></tr></thead>
          <tbody>{dados.itens.map((item) => (
            <tr key={item.emissaoId}>
              <td>{item.tipo === 'DOF' ? 'DOF' : ROTULOS_DTC[item.tipo]}</td><td>{item.numero}</td><td>{item.nome ?? '—'}</td><td>{item.matricula ?? '—'}</td>
              <td>{new Date(item.emitidoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</td>
              <td>{item.emitidoPorNome}</td>
              <td>{item.status === 'cancelado' ? 'Cancelada' : 'Emitida'}</td>
              <td>{rotuloPdf(item)}</td>
              <td><div className="acoes">
                {item.podeBaixar && <button type="button" className="secundario" disabled={ocupado || !item.pdf.disponivel}
                  onClick={() => void baixar(item)}>Baixar PDF <span className="sr-only">da emissão {item.numero}</span></button>}
                {item.podeCopiar && <button type="button" className="secundario" disabled={ocupado}
                  onClick={() => void copiar(item)}>Copiar como rascunho <span className="sr-only">da emissão {item.numero}</span></button>}
                {item.podeCancelar && item.status === 'emitido' && <button type="button" className="secundario" disabled={ocupado}
                  onClick={() => { onLimpar(); setMensagem(''); setCancelando(item); }}>
                  Cancelar <span className="sr-only">emissão {item.numero}</span></button>}
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}
