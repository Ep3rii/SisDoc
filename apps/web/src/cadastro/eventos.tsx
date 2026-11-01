import {
  type PaginaEventosServidor
} from '@sisdoc/contratos';
import { useEffect, useState } from 'react';
import { api } from '../infraestrutura/api';
import type { Props } from './contexto';

/** Apresenta eventos paginados de um vínculo, sem misturar eventos de outros servidores. */
export function Eventos({ pessoaId, vinculoId, onErro, onLimpar }: Props & { pessoaId: string; vinculoId: string }) {
  const [pagina, setPagina] = useState<PaginaEventosServidor | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [falhou, setFalhou] = useState(false);
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    let ativa = true;
    setPagina(null);
    setFalhou(false);
    api.eventosServidor(pessoaId, vinculoId, cursor).then((resultado) => {
      if (ativa) setPagina(resultado);
    }).catch((erro: unknown) => {
      if (ativa) { setFalhou(true); onErro(erro); }
    });
    return () => { ativa = false; };
  }, [pessoaId, vinculoId, cursor, versao, onErro]);
  return (
    <section aria-labelledby="eventos-titulo">
      <h4 id="eventos-titulo">Eventos do vínculo</h4>
      {falhou ? <button type="button" className="secundario" onClick={() => { onLimpar(); setVersao((atual) => atual + 1); }}>Tentar carregar eventos novamente</button> : !pagina ? <p role="status">Carregando eventos...</p> : (
        <>
          {pagina.itens.length === 0 ? <p>Nenhum evento encontrado.</p> : (
            <div className="tabela"><table>
              <thead><tr><th scope="col">Tipo</th><th scope="col">Data</th><th scope="col">Ato</th><th scope="col">Publicação</th><th scope="col">Fonte</th></tr></thead>
              <tbody>{pagina.itens.map((evento) => (
                <tr key={evento.id}>
                  <td>{evento.tipo}</td><td>{evento.dataEvento ?? 'Não informada'}</td>
                  <td>{[evento.atoTipo, evento.atoNumero].filter(Boolean).join(' ') || 'Não informado'}</td>
                  <td>{evento.dataPublicacao ?? 'Não informada'}</td>
                  <td>{evento.fonte}{evento.removidoNaFonte ? ' — removido na fonte' : ''}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <div className="acoes">
            <button type="button" className="secundario" disabled={!cursor} onClick={() => setCursor(undefined)}>Primeira página de eventos</button>
            <button type="button" className="secundario" disabled={!pagina.proximoCursor} onClick={() => setCursor(pagina.proximoCursor ?? undefined)}>Próxima página de eventos</button>
          </div>
        </>
      )}
    </section>
  );
}
