import {
  type PaginaBuscaServidores
} from '@sisdoc/contratos';
import { useEffect, useState } from 'react';
import type { Consulta } from '../cadastro/contexto';
import { api } from '../infraestrutura/api';
import { Servidor } from './contexto';

/** Localiza vínculo elegível para um novo rascunho, sem criar documentos ao selecionar. */
export function BuscaServidor({ onSelecionar, onRegistrarBusca, onErro }: {
  onSelecionar: (servidor: Servidor) => void;
  onRegistrarBusca: (buscar: ((consulta: Consulta) => void) | null) => void;
  onErro: (erro: unknown) => void;
}) {
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  const [resultado, setResultado] = useState<PaginaBuscaServidores | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    onRegistrarBusca(setConsulta);
    document.querySelector<HTMLInputElement>('.cabecalho input[name="q"]')?.focus();
    return () => onRegistrarBusca(null);
  }, [onRegistrarBusca]);

  useEffect(() => {
    if (!consulta) return;
    let ativa = true;
    setResultado(null);
    setOcupado(true);
    api.buscarServidores(consulta.q, consulta.tipo).then((dados) => {
      if (ativa) setResultado(dados);
    }).catch((erro: unknown) => {
      if (ativa) onErro(erro);
    }).finally(() => {
      if (ativa) setOcupado(false);
    });
    return () => { ativa = false; };
  }, [consulta, onErro]);

  return (
    <section className="painel" aria-labelledby="busca-dtc-titulo">
      <h2 id="busca-dtc-titulo">Selecionar servidor</h2>
      <p>Use a busca do topo por nome ou matrícula e pressione Enter. Selecione o vínculo para preparar a DTC.</p>
      {ocupado && <p role="status">Buscando servidores...</p>}
      {resultado && (resultado.itens.length === 0 ? <p>Nenhum servidor encontrado.</p> : <div className="tabela"><table>
        <thead><tr><th scope="col">Nome</th><th scope="col">Matrícula</th><th scope="col">Órgão</th><th scope="col">Ação</th></tr></thead>
        <tbody>{resultado.itens.map((item) => (
          <tr key={item.vinculoId}><td>{item.nome}</td><td>{item.matricula}</td><td>{item.orgao ?? '—'}</td>
            <td><button type="button" className="secundario" disabled={item.removidoNaFonte}
              onClick={() => onSelecionar({ pessoaId: item.pessoaId, vinculoId: item.vinculoId, nome: item.nome, matricula: item.matricula })}>
              Selecionar <span className="sr-only">{item.nome}</span></button></td></tr>
        ))}</tbody>
      </table></div>)}
    </section>
  );
}
