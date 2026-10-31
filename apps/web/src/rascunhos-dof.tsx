import { useEffect, useRef, useState } from 'react';
import type { PaginaEncaminhamentosDof, PaginaRascunhosDof, RascunhoDof } from '@sisdoc/contratos';
import { api } from './api';
import { CalculoDof } from './calculo-dof';

type Props = {
  csrf: string;
  recebidos?: boolean;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
  onPendente: (valor: boolean) => void;
  confirmarSaida: () => boolean;
};

export function RascunhosDof({ csrf, recebidos = false, onErro, onLimpar, onPendente, confirmarSaida }: Props) {
  const [pagina, setPagina] = useState<PaginaRascunhosDof | PaginaEncaminhamentosDof | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [rascunho, setRascunho] = useState<RascunhoDof | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);
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
    const consulta = recebidos ? api.listarEncaminhadosDof(cursor) : api.listarRascunhosDof(cursor);
    consulta.then((resultado) => {
      if (corrente) setPagina(resultado);
    }).catch((erro: unknown) => {
      if (corrente) { setFalhou(true); onErro(erro); }
    });
    return () => { corrente = false; };
  }, [cursor, versao, onErro, recebidos]);

  async function abrir(id: string) {
    try {
      onLimpar();
      setMensagem('');
      setAbrindo(id);
      const resultado = await api.obterRascunhoDof(id);
      if (ativa.current) setRascunho(resultado);
    } catch (erro) {
      if (ativa.current) onErro(erro);
    } finally {
      if (ativa.current) setAbrindo(null);
    }
  }

  if (rascunho) {
    return (
      <CalculoDof
        key={rascunho.id} pessoaId={rascunho.pessoaId} vinculoId={rascunho.vinculoId}
        nome={rascunho.nome} matricula={rascunho.matricula} admissao={rascunho.admissao}
        csrf={csrf} podeSalvar={!recebidos} somenteLeitura={recebidos} rascunhoInicial={rascunho} onErro={onErro} onLimpar={onLimpar}
        onPendente={onPendente} confirmarSaida={confirmarSaida}
        onFechar={(aviso) => { setRascunho(null); setVersao((atual) => atual + 1); onLimpar(); setMensagem(aviso ?? ''); }}
      />
    );
  }

  return (
    <section aria-labelledby="rascunhos-titulo">
      <h2 id="rascunhos-titulo">{recebidos ? 'Rascunhos encaminhados a mim' : 'Meus rascunhos de DOF'}</h2>
      <p>{recebidos
        ? 'Somente os rascunhos encaminhados a você estão disponíveis para consulta e devolução. A conferência ainda não está disponível.'
        : 'Somente rascunhos de sua autoria são exibidos. Você pode encaminhá-los a um coordenador para análise.'}</p>
      {mensagem && <p className="aviso sucesso" role="status">{mensagem}</p>}
      {falhou ? (
        <button type="button" className="secundario" onClick={() => { onLimpar(); setVersao((atual) => atual + 1); }}>
          Tentar carregar rascunhos novamente
        </button>
      ) : !pagina ? <p role="status">Carregando rascunhos...</p> : (
        <>
          {pagina.itens.length === 0 ? <p>Nenhum rascunho encontrado.</p> : (
            <div className="tabela"><table>
              <thead><tr><th scope="col">Nome</th><th scope="col">Matrícula</th>{recebidos && <th scope="col">Autor</th>}<th scope="col">Revisão</th><th scope="col">Atualizado</th><th scope="col">Rascunho</th></tr></thead>
              <tbody>{pagina.itens.map((item) => {
                if (recebidos && !('autorNome' in item)) throw new Error('O encaminhamento não identifica o autor.');
                return (
                <tr key={item.id}>
                  <td>{item.nome}</td><td>{item.matricula}</td>
                  {recebidos && <td>{'autorNome' in item ? item.autorNome : null}</td>}<td>{item.revisao}</td>
                  <td>{new Date(item.atualizadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</td>
                  <td><button type="button" className="secundario" disabled={Boolean(abrindo)} onClick={() => void abrir(item.id)}>
                    {abrindo === item.id ? 'Abrindo...' : 'Abrir'} <span className="sr-only">rascunho de {item.nome}, matrícula {item.matricula}</span>
                  </button></td>
                </tr>
                );
              })}</tbody>
            </table></div>
          )}
          <div className="acoes">
            <button type="button" className="secundario" disabled={!cursor || Boolean(abrindo)}
              onClick={() => setCursor(undefined)}>Primeira página de rascunhos</button>
            <button type="button" className="secundario" disabled={!pagina.proximoCursor || Boolean(abrindo)}
              onClick={() => setCursor(pagina.proximoCursor ?? undefined)}>Próxima página de rascunhos</button>
          </div>
        </>
      )}
    </section>
  );
}
