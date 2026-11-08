import {
  buscarServidoresQuerySchema
} from '@sisdoc/contratos';
import { useId, type FormEvent } from 'react';
import { ErroApi } from '../infraestrutura/api';
import type { Consulta } from './contexto';

/** Valida critério e termo antes de solicitar navegação para a busca local. */
export function BuscaGlobal({ onBuscar, onErro, inicio = false }: {
  onBuscar: (consulta: Consulta) => void; onErro: (erro: unknown) => void;
  inicio?: boolean;
}) {
  const orientacaoId = useId();
  function buscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const valores = new FormData(evento.currentTarget);
    const termo = valores.get('q');
    const q = typeof termo === 'string' ? termo.trim() : '';
    const tipo = /^\d+(?:-\d+)*$/.test(q) ? 'matricula' : 'nome';
    const resultado = buscarServidoresQuerySchema.safeParse({ q, tipo });
    if (!resultado.success || !resultado.data.tipo || !resultado.data.q) {
      onErro(new ErroApi(400, 'Informe nome com ao menos três caracteres ou matrícula exata, como 15-1.'));
      return;
    }
    onBuscar({ q: resultado.data.q, tipo: resultado.data.tipo });
  }
  return (
    <form className={`busca-global${inicio ? ' busca-inicio' : ''}`} onSubmit={buscar} aria-label={inicio ? 'Busca de servidores no Início' : 'Busca de servidores no topo'}>
      <label><span className="sr-only">{inicio ? 'Buscar servidor no Início' : 'Termo de busca'}</span>
        <input name="q" maxLength={200} required autoComplete="off" autoFocus={inicio}
          placeholder="Nome ou matrícula do servidor" aria-describedby={orientacaoId} aria-keyshortcuts="/" />
      </label>
      <button type="submit">Buscar</button>
      <span className="sr-only" id={orientacaoId}>Nome: mínimo de três caracteres. Números ou matrícula com sufixo, como 15-1: matrícula exata. Enter busca; barra foca a busca.</span>
    </form>
  );
}
