import {
  type PaginaBuscaServidores
} from '@sisdoc/contratos';
import { useState, type FormEvent } from 'react';
import { api } from '../infraestrutura/api';
import { Servidor } from './contexto';

/** Localiza vínculo elegível para um novo rascunho, sem criar documentos ao selecionar. */
export function BuscaServidor({ onSelecionar, onCancelar, onErro, onLimpar }: {
  onSelecionar: (servidor: Servidor) => void; onCancelar: () => void; onErro: (erro: unknown) => void; onLimpar: () => void;
}) {
  const [termo, setTermo] = useState('');
  const [criterio, setCriterio] = useState<'nome' | 'cpf' | 'matricula'>('nome');
  const [resultado, setResultado] = useState<PaginaBuscaServidores | null>(null);
  const [ocupado, setOcupado] = useState(false);

  /** Consulta o banco local pelo critério informado e apresenta erros da API. */
  async function buscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    try {
      onLimpar();
      setOcupado(true);
      setResultado(await api.buscarServidores(termo, criterio));
    } catch (erro) {
      onErro(erro);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="painel" aria-labelledby="busca-dtc-titulo">
      <h2 id="busca-dtc-titulo">Selecionar servidor</h2>
      <form className="grade-busca" onSubmit={(evento) => void buscar(evento)}>
        <label>Buscar por<select value={criterio} onChange={(evento) => setCriterio(evento.target.value as typeof criterio)}>
          <option value="nome">Nome</option><option value="cpf">CPF</option><option value="matricula">Matrícula</option>
        </select></label>
        <label>Termo<input required value={termo} onChange={(evento) => setTermo(evento.target.value)} /></label>
        <button type="submit" disabled={ocupado}>{ocupado ? 'Buscando...' : 'Buscar'}</button>
      </form>
      {resultado && (resultado.itens.length === 0 ? <p>Nenhum servidor encontrado.</p> : <div className="tabela"><table>
        <thead><tr><th scope="col">Nome</th><th scope="col">Matrícula</th><th scope="col">Órgão</th><th scope="col">Ação</th></tr></thead>
        <tbody>{resultado.itens.map((item) => (
          <tr key={item.vinculoId}><td>{item.nome}</td><td>{item.matricula}</td><td>{item.orgao ?? '—'}</td>
            <td><button type="button" className="secundario" disabled={item.removidoNaFonte}
              onClick={() => onSelecionar({ pessoaId: item.pessoaId, vinculoId: item.vinculoId, nome: item.nome, matricula: item.matricula })}>
              Selecionar <span className="sr-only">{item.nome}</span></button></td></tr>
        ))}</tbody>
      </table></div>)}
      <div className="acoes"><button type="button" className="secundario" onClick={onCancelar}>Voltar à lista</button></div>
    </section>
  );
}
