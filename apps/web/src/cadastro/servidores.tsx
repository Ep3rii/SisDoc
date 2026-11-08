import {
  type PaginaBuscaServidores, type TipoDtc
} from '@sisdoc/contratos';
import { useEffect, useState } from 'react';
import { api } from '../infraestrutura/api';
import { Consulta, Props, ProtecaoEdicao } from './contexto';
import { Detalhe } from './detalhe';
import { BuscaGlobal } from './busca-global';
import type { Servidor } from '../dtc/contexto';

/** Lista vínculos locais por matrícula e abre a pessoa mantendo o vínculo selecionado. */
export function Servidores({ csrf, podeSalvar, podeEditarCadastro, consulta, onBuscar, onTrocarServidor, onNovaDtc, onErro, onLimpar, onPendente, confirmarSaida }: Props & ProtecaoEdicao & {
  csrf: string; podeSalvar: boolean; podeEditarCadastro: boolean; consulta: Consulta | null;
  onBuscar: (consulta: Consulta) => void;
  onTrocarServidor: () => void;
  onNovaDtc: (tipo: TipoDtc, servidor: Servidor) => void;
}) {
  const [pagina, setPagina] = useState<PaginaBuscaServidores | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [pessoaId, setPessoaId] = useState<string | null>(null);
  const [vinculoInicial, setVinculoInicial] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [versao, setVersao] = useState(0);
  /** Protege a edição antes de substituir detalhe, paginação ou seleção atual. */
  const trocarContexto = (acao: () => void) => {
    if (confirmarSaida()) { onPendente(false); acao(); }
  };
  useEffect(() => {
    let ativa = true;
    setPagina(null);
    setFalhou(false);
    async function buscar() {
      const resultado = await api.buscarServidores(consulta?.q, consulta?.tipo, cursor);
      const primeiro = resultado.itens[0];
      let unicaPessoa = !!primeiro && resultado.itens.every((item) => item.pessoaId === primeiro.pessoaId);
      if (!cursor && consulta?.tipo === 'matricula') {
        let proximo = resultado.proximoCursor;
        while (ativa && unicaPessoa && proximo) {
          const seguinte = await api.buscarServidores(consulta.q, consulta.tipo, proximo);
          unicaPessoa = seguinte.itens.every((item) => item.pessoaId === primeiro.pessoaId);
          proximo = seguinte.proximoCursor;
        }
      }
      if (ativa) {
        setPagina(resultado);
        if (!cursor && consulta?.tipo === 'matricula' && primeiro && unicaPessoa) {
          setPessoaId(primeiro.pessoaId);
          setVinculoInicial(primeiro.vinculoId);
        }
      }
    }
    buscar().catch((erro: unknown) => {
      if (ativa) { setFalhou(true); onErro(erro); }
    });
    return () => { ativa = false; };
  }, [consulta, cursor, versao, onErro]);

  return (
    <section aria-labelledby="busca-titulo">
      <h2 id="busca-titulo" className={pessoaId ? 'sr-only' : undefined}>Início</h2>
      {!pessoaId && <BuscaGlobal inicio onBuscar={onBuscar} onErro={onErro} />}
      {!pessoaId && <p>Os resultados são locais. Matrículas e sufixos são preservados; confira a origem quando houver duplicidade.</p>}
      {!pessoaId && !consulta && <p>Vínculos por matrícula em ordem natural crescente, 50 por página. Busque por nome ou matrícula no campo central ou no topo.</p>}
      {!pessoaId && <p className="aviso">Dados pessoais completos para atividades autorizadas do setor. O acesso é auditado.</p>}
      {!pessoaId && <div className="acoes"><button type="button" className="secundario" onClick={() => setVersao((atual) => atual + 1)}>Atualizar resultados</button></div>}
      {!pessoaId && (falhou ? <button type="button" className="secundario" onClick={() => { onLimpar(); setVersao((atual) => atual + 1); }}>Tentar buscar novamente</button> : !pagina ? <p role="status">Buscando...</p> : pagina && (
        <>
          <h3>Resultados</h3>
          {pagina.itens.length === 0 ? <p>Nenhum vínculo encontrado.</p> : (
            <div className="tabela"><table>
              <thead><tr><th scope="col">Nome</th><th scope="col">CPF</th><th scope="col">Matrícula</th><th scope="col">Órgão</th><th scope="col">Origem</th><th scope="col">Detalhes</th></tr></thead>
              <tbody>{pagina.itens.map((item) => (
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
        onFechar={onTrocarServidor} onNovaDtc={onNovaDtc} onErro={onErro} onLimpar={onLimpar}
        onPendente={onPendente} confirmarSaida={confirmarSaida} />}
    </section>
  );
}
