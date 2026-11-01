import type { LoteSincronizacao, PaginaSincronizacoes, SituacaoSincronizacao } from '@sisdoc/contratos';
import { useEffect, useState } from 'react';
import { api } from '../infraestrutura/api';

const nomesStatus: Record<LoteSincronizacao['status'], string> = {
  processando: 'Em processamento',
  concluido: 'Concluído',
  falhou: 'Falhou',
};

const nomesTipo: Record<LoteSincronizacao['tipo'], string> = {
  completa: 'Completa',
  incremental: 'Incremental',
  servidor: 'Servidor individual',
};

function dataHora(valor: string | null): string {
  return valor ? new Date(valor).toLocaleString('pt-BR') : '—';
}

function useSituacaoSincronizacao(): SituacaoSincronizacao | null {
  const [situacao, setSituacao] = useState<SituacaoSincronizacao | null>(null);
  useEffect(() => {
    let ativa = true;
    api.situacaoSincronizacao().then((resultado) => {
      if (ativa) setSituacao(resultado);
    }).catch(() => undefined);
    return () => { ativa = false; };
  }, []);
  return situacao;
}

function textoUltima(situacao: SituacaoSincronizacao): string {
  return situacao.ultimaSincronizacaoEm
    ? `Última sincronização com a fonte: ${dataHora(situacao.ultimaSincronizacaoEm)}.`
    : 'Nenhuma sincronização com a fonte foi concluída ainda.';
}

// Estado discreto no cabeçalho, sem ocupar espaço na área de trabalho.
export function EstadoSincronizacao() {
  const situacao = useSituacaoSincronizacao();
  let texto = 'Consulta local';
  if (situacao && !situacao.configurada) texto = 'Consulta local · sincronização não configurada';
  else if (situacao?.ultimaSincronizacaoEm) texto = `Consulta local · sincronizado em ${dataHora(situacao.ultimaSincronizacaoEm)}`;
  else if (situacao) texto = 'Consulta local · sem sincronização concluída';
  return <span className="estado-fonte">{texto}</span>;
}

// Aviso informativo, exibido só após o limite ou com o disjuntor aberto; nunca bloqueia busca, cálculo, prévia ou emissão.
export function AvisoSincronizacao() {
  const situacao = useSituacaoSincronizacao();
  if (!situacao || !situacao.configurada || (!situacao.avisoAtraso && !situacao.disjuntorAberto)) return null;
  const ultima = textoUltima(situacao);
  return (
    <p className="aviso atraso situacao-sincronizacao" role="status">
      {ultima} {situacao.avisoAtraso && `Os dados podem estar desatualizados (limite de ${situacao.limiteHoras} h). `}
      {situacao.disjuntorAberto && 'A sincronização está temporariamente suspensa após falhas consecutivas. '}
      O trabalho pode continuar; confira os dados funcionais antes de emitir.
    </p>
  );
}

export function SincronizacaoAdmin({ csrf, onErro, onMensagem }: {
  csrf: string;
  onErro: (erro: unknown) => void;
  onMensagem: (mensagem: string) => void;
}) {
  const [pagina, setPagina] = useState<PaginaSincronizacoes | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [versao, setVersao] = useState(0);
  const [falhou, setFalhou] = useState(false);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    let ativa = true;
    setFalhou(false);
    api.listarSincronizacoes(cursor).then((resultado) => {
      if (ativa) setPagina(resultado);
    }).catch((erro: unknown) => {
      if (ativa) {
        setFalhou(true);
        onErro(erro);
      }
    });
    return () => { ativa = false; };
  }, [cursor, versao, onErro]);

  const iniciar = async (tipo: 'completa' | 'incremental') => {
    const texto = tipo === 'completa'
      ? 'Iniciar uma sincronização COMPLETA? Todas as páginas da API serão lidas; registros ausentes só são marcados como removidos se a carga terminar sem falhas.'
      : 'Iniciar uma sincronização INCREMENTAL com as alterações desde a última carga concluída?';
    if (!window.confirm(texto)) return;
    setEnviando(true);
    try {
      await api.iniciarSincronizacao(csrf, tipo);
      onMensagem(`Sincronização ${tipo} iniciada. Atualize a lista para acompanhar o lote.`);
      setCursor(undefined);
      setVersao((atual) => atual + 1);
    } catch (erro) {
      onErro(erro);
    } finally {
      setEnviando(false);
    }
  };

  const situacao = pagina?.situacao;
  return (
    <section aria-labelledby="sincronizacao-titulo">
      <h2 id="sincronizacao-titulo">Sincronização</h2>
      <p>Lotes de sincronização com a API externa. Os erros mostram apenas posição, referência técnica e motivo, sem dados pessoais.</p>
      {situacao && (
        <div className="painel">
          {!situacao.configurada ? (
            <p className="aviso atraso">A sincronização não está configurada. Preencha o bloco <code>sincronizacao</code> da configuração externa e reinicie o serviço.</p>
          ) : (
            <>
              <p>Última sincronização concluída: <strong>{dataHora(situacao.ultimaSincronizacaoEm)}</strong>
                {situacao.avisoAtraso && <span className="etiqueta"> · acima do limite de {situacao.limiteHoras} h</span>}</p>
              <p>Falhas consecutivas: {pagina.falhasConsecutivas}
                {pagina.disjuntorAbertoAte && <span className="etiqueta"> · disjuntor aberto até {dataHora(pagina.disjuntorAbertoAte)}</span>}</p>
            </>
          )}
          <div className="acoes">
            <button type="button" disabled={enviando || !situacao.configurada} onClick={() => void iniciar('completa')}>Sincronização completa</button>
            <button type="button" disabled={enviando || !situacao.configurada} onClick={() => void iniciar('incremental')}>Sincronização incremental</button>
            <button type="button" className="secundario" onClick={() => setVersao((atual) => atual + 1)}>Atualizar lista</button>
          </div>
        </div>
      )}
      {falhou ? <button type="button" className="secundario" onClick={() => setVersao((atual) => atual + 1)}>Tentar carregar novamente</button> : !pagina ? <p role="status">Carregando sincronizações...</p> : (
        <>
          <div className="tabela">
            <table>
              <thead><tr><th scope="col">Início</th><th scope="col">Tipo</th><th scope="col">Situação</th><th scope="col">Lidos</th><th scope="col">Inseridos</th><th scope="col">Atualizados</th><th scope="col">Removidos</th><th scope="col">Erros</th></tr></thead>
              <tbody>
                {pagina.itens.length === 0 && <tr><td colSpan={8}>Nenhuma sincronização registrada.</td></tr>}
                {pagina.itens.map((lote) => (
                  <tr key={lote.id}>
                    <td>{dataHora(lote.iniciadoEm)}</td><td>{nomesTipo[lote.tipo]}</td><td>{nomesStatus[lote.status]}</td>
                    <td>{lote.lidos}</td><td>{lote.inseridos}</td><td>{lote.atualizados}</td><td>{lote.removidos}</td>
                    <td>
                      {lote.totalErros === 0 ? '0' : (
                        <details>
                          <summary>{lote.totalErros}</summary>
                          <ul>
                            {lote.erros.map((erro, indice) => (
                              <li key={indice}>
                                {erro.posicao !== null && `Item ${erro.posicao}: `}
                                {erro.referencia && <code>{erro.referencia}</code>} {erro.motivo}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="acoes">
            <button type="button" className="secundario" disabled={!cursor} onClick={() => setCursor(undefined)}>Primeira página</button>
            <button type="button" className="secundario" disabled={!pagina.proximoCursor} onClick={() => setCursor(pagina.proximoCursor ?? undefined)}>Próxima página</button>
          </div>
        </>
      )}
    </section>
  );
}
