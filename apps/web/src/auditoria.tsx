import { useEffect, useState } from 'react';
import type { PaginaAuditoria } from '@sisdoc/contratos';
import { api } from './api';

export function Auditoria({ onErro }: { onErro: (erro: unknown) => void }) {
  const [pagina, setPagina] = useState<PaginaAuditoria | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [versao, setVersao] = useState(0);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    let ativa = true;
    setPagina(null);
    setFalhou(false);
    api.auditoria(cursor).then((resultado) => {
      if (ativa) setPagina(resultado);
    }).catch((erro: unknown) => {
      if (ativa) {
        setFalhou(true);
        onErro(erro);
      }
    });
    return () => { ativa = false; };
  }, [cursor, versao, onErro]);
  return (
    <section aria-labelledby="auditoria-titulo">
      <h2 id="auditoria-titulo">Auditoria</h2>
      <p>Eventos apresentados com dados minimizados.</p>
      {falhou ? <button type="button" className="secundario" onClick={() => setVersao((atual) => atual + 1)}>Tentar carregar auditoria novamente</button> : !pagina ? <p role="status">Carregando auditoria...</p> : (
        <>
          <div className="tabela">
            <table>
              <thead><tr><th scope="col">Data e hora</th><th scope="col">Ação</th><th scope="col">Entidade</th><th scope="col">Alvo administrativo</th><th scope="col">Identificador do usuário</th></tr></thead>
              <tbody>
                {pagina.itens.map((evento) => (
                  <tr key={evento.id}>
                    <td>{new Date(evento.em).toLocaleString('pt-BR')}</td><td>{evento.acao}</td><td>{evento.entidade}</td><td>{evento.entidadeId ?? '—'}</td>
                    <td>{evento.usuarioId ?? 'Não identificado'}</td>
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
