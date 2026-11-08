import type { DocumentosServidor } from '@sisdoc/contratos';
import { useEffect, useState } from 'react';
import { dataTabela } from '../compartilhado/datas-tabela';
import { api } from '../infraestrutura/api';

export function DocumentosDaPessoa({ pessoaId, onErro }: { pessoaId: string; onErro: (erro: unknown) => void }) {
  const [pagina, setPagina] = useState<DocumentosServidor | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [versao, setVersao] = useState(0);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    let ativa = true;
    setPagina(null); setFalhou(false);
    api.documentosServidor(pessoaId, cursor).then((dados) => { if (ativa) setPagina(dados); })
      .catch((erro: unknown) => { if (ativa) { setFalhou(true); onErro(erro); } });
    return () => { ativa = false; };
  }, [pessoaId, cursor, versao, onErro]);
  const situacoes = { rascunho: 'Rascunho', encaminhado: 'Encaminhado', conferido: 'Conferido', emitido: 'Emitido', cancelado: 'Cancelado' };
  return <section className="separado" aria-labelledby="documentos-servidor"><h3 id="documentos-servidor">Documentos deste servidor</h3>
    {falhou ? <button type="button" className="secundario" onClick={() => setVersao((v) => v + 1)}>Tentar carregar documentos novamente</button>
      : !pagina ? <p role="status">Carregando documentos...</p>
        : <>
          {!pagina.itens.length ? <p>Nenhum documento visível para este servidor. Use as ações acima para criar um documento.</p>
            : <div className="tabela"><table><thead><tr><th>Documento</th><th>Matrícula</th><th>Situação</th><th>Número</th><th>Atualizado em</th></tr></thead>
              <tbody>{pagina.itens.map((item) => <tr key={item.id}><td>{item.tipo.replaceAll('_', ' ')}</td><td>{item.matricula}</td>
                <td>{situacoes[item.situacao]}</td><td>{item.numero ?? '—'}</td><td>{dataTabela(item.atualizadoEm)}</td></tr>)}</tbody>
            </table></div>}
          <div className="acoes">
            <button type="button" className="secundario" disabled={!cursor} onClick={() => setCursor(undefined)}>Primeira página de documentos</button>
            <button type="button" className="secundario" disabled={!pagina.proximoCursor} onClick={() => setCursor(pagina.proximoCursor ?? undefined)}>Próxima página de documentos</button>
          </div>
        </>}
  </section>;
}
