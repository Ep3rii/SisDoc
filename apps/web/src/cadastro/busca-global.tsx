import {
  buscarServidoresQuerySchema
} from '@sisdoc/contratos';
import { type FormEvent } from 'react';
import { ErroApi } from '../infraestrutura/api';
import type { Consulta } from './contexto';

/** Valida critério e termo antes de solicitar navegação para a busca local. */
export function BuscaGlobal({ onBuscar, onErro }: {
  onBuscar: (consulta: Consulta) => void; onErro: (erro: unknown) => void;
}) {
  /** Rejeita termos insuficientes ou CPF inválido sem disparar uma consulta ambígua. */
  function buscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const valores = new FormData(evento.currentTarget);
    const resultado = buscarServidoresQuerySchema.safeParse({ q: valores.get('q'), tipo: valores.get('tipo') });
    if (!resultado.success || !resultado.data.tipo || !resultado.data.q) {
      onErro(new ErroApi(400, 'Informe nome com ao menos três caracteres, CPF válido ou matrícula exata.'));
      return;
    }
    onBuscar({ q: resultado.data.q, tipo: resultado.data.tipo });
  }
  return (
    <form className="busca-global" onSubmit={buscar} aria-label="Busca de servidores">
      <label><span className="sr-only">Tipo de busca</span>
        <select name="tipo" defaultValue="nome"><option value="nome">Nome</option><option value="cpf">CPF</option><option value="matricula">Matrícula</option></select>
      </label>
      <label><span className="sr-only">Termo de busca</span>
        <input name="q" maxLength={200} required autoComplete="off" placeholder="Buscar servidor" aria-describedby="orientacao-busca" />
      </label>
      <button type="submit">Buscar</button>
      <span className="sr-only" id="orientacao-busca">Nome: mínimo de três caracteres. CPF: com ou sem máscara. Matrícula: informe o valor exato.</span>
    </form>
  );
}
