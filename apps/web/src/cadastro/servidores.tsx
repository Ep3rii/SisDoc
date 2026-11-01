import {
  type PaginaBuscaServidores
} from '@sisdoc/contratos';
import { useEffect, useState } from 'react';
import { FiltrosLista, useFiltroLista } from '../compartilhado/filtros-lista';
import { api } from '../infraestrutura/api';
import { Consulta, Props, ProtecaoEdicao } from './contexto';
import { Detalhe } from './detalhe';

/** Lista vínculos locais por matrícula e abre a pessoa mantendo o vínculo selecionado. */
export function Servidores({ csrf, podeSalvar, podeEditarCadastro, consulta, onErro, onLimpar, onPendente, confirmarSaida }: Props & ProtecaoEdicao & {
  csrf: string; podeSalvar: boolean; podeEditarCadastro: boolean; consulta: Consulta | null;
}) {
  const [pagina, setPagina] = useState<PaginaBuscaServidores | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [pessoaId, setPessoaId] = useState<string | null>(null);
  const [vinculoInicial, setVinculoInicial] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [versao, setVersao] = useState(0);
  const filtro = useFiltroLista(pagina?.itens ?? [], (item) =>
    `${item.nome} ${item.cpf} ${item.matricula} ${item.orgao ?? ''} ${item.sistemaOrigem} ${item.removidoNaFonte ? 'Removido na fonte' : ''}`);
  /** Protege a edição antes de substituir detalhe, paginação ou seleção atual. */
  const trocarContexto = (acao: () => void) => {
    if (confirmarSaida()) { onPendente(false); acao(); }
  };
  useEffect(() => {
    let ativa = true;
    setPagina(null);
    setFalhou(false);
    api.buscarServidores(consulta?.q, consulta?.tipo, cursor).then((resultado) => {
      if (ativa) setPagina(resultado);
    }).catch((erro: unknown) => {
      if (ativa) { setFalhou(true); onErro(erro); }
    });
    return () => { ativa = false; };
  }, [consulta, cursor, versao, onErro]);

  return (
    <section aria-labelledby="busca-titulo">
      <h2 id="busca-titulo" className={pessoaId ? 'sr-only' : undefined}>Consulta de servidores</h2>
      {!pessoaId && <p>Os resultados são locais. Matrículas e sufixos são preservados; confira a origem quando houver duplicidade.</p>}
      {!consulta && <p>Vínculos por matrícula em ordem natural crescente, 50 por página. Use a busca no topo para filtrar por nome, CPF ou matrícula.</p>}
      {!pessoaId && <p className="aviso">Dados pessoais completos para atividades autorizadas do setor. O acesso é auditado.</p>}
      {!pessoaId && <FiltrosLista filtro={filtro} onAtualizar={() => setVersao((atual) => atual + 1)} />}
      {!pessoaId && (falhou ? <button type="button" className="secundario" onClick={() => { onLimpar(); setVersao((atual) => atual + 1); }}>Tentar buscar novamente</button> : !pagina ? <p role="status">Buscando...</p> : pagina && (
        <>
          <h3>Resultados</h3>
          {pagina.itens.length === 0 ? <p>Nenhum vínculo encontrado.</p> : (
            <div className="tabela"><table>
              <thead><tr><th scope="col">Nome</th><th scope="col">CPF</th><th scope="col">Matrícula</th><th scope="col">Órgão</th><th scope="col">Origem</th><th scope="col">Detalhes</th></tr></thead>
              <tbody>{filtro.itens.map((item) => (
                <tr key={item.vinculoId}>
                  <td>{item.nome}</td><td>{item.cpf}</td><td>{item.matricula}{item.removidoNaFonte ? ' — removido na fonte' : ''}</td>
                  <td>{item.orgao ?? 'Não informado'}</td><td>{item.sistemaOrigem}</td>
                  <td><button type="button" className="secundario" onClick={() => {
                    if (pessoaId === item.pessoaId) return;
                    trocarContexto(() => { onLimpar(); setVinculoInicial(item.vinculoId); setPessoaId(item.pessoaId); });
                  }}>Ver vínculos <span className="sr-only">de {item.nome}, matrícula {item.matricula}</span></button></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <div className="acoes">
            <button type="button" className="secundario" disabled={!cursor}
              onClick={() => trocarContexto(() => { setPessoaId(null); setCursor(undefined); })}>Primeira página de resultados</button>
            <button type="button" className="secundario" disabled={!pagina.proximoCursor}
              onClick={() => trocarContexto(() => { setPessoaId(null); setCursor(pagina.proximoCursor ?? undefined); })}>Próxima página de resultados</button>
          </div>
        </>
      ))}
      {pessoaId && <Detalhe key={pessoaId} pessoaId={pessoaId} vinculoInicial={vinculoInicial} csrf={csrf} podeSalvar={podeSalvar}
        podeEditarCadastro={podeEditarCadastro} onCadastroAtualizado={() => setVersao((atual) => atual + 1)}
        onFechar={() => setPessoaId(null)} onErro={onErro} onLimpar={onLimpar}
        onPendente={onPendente} confirmarSaida={confirmarSaida} />}
    </section>
  );
}
