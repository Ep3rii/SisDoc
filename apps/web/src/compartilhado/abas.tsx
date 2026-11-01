import { useId, type ReactNode } from 'react';

/** Alterna painéis por clique ou teclado mantendo componentes montados e estado preservado. */
export function Abas({ itens, atual, onSelecionar, rotulo }: {
  itens: ReadonlyArray<{ id: string; titulo: string; conteudo: ReactNode }>;
  atual: string;
  onSelecionar: (id: string) => void;
  rotulo: string;
}) {
  const base = useId();
  return <>
    <div className="abas-dof" role="tablist" aria-label={rotulo}>
      {itens.map((item, indice) => <button key={item.id} type="button" role="tab"
        id={`${base}-aba-${item.id}`} aria-controls={`${base}-painel-${item.id}`}
        aria-selected={atual === item.id} tabIndex={atual === item.id ? 0 : -1}
        onClick={() => onSelecionar(item.id)} onKeyDown={(evento) => {
          let destino: number;
          if (evento.key === 'ArrowRight') destino = (indice + 1) % itens.length;
          else if (evento.key === 'ArrowLeft') destino = (indice + itens.length - 1) % itens.length;
          else if (evento.key === 'Home') destino = 0;
          else if (evento.key === 'End') destino = itens.length - 1;
          else return;
          evento.preventDefault();
          const proxima = itens[destino];
          onSelecionar(proxima.id);
          document.getElementById(`${base}-aba-${proxima.id}`)?.focus();
        }}>{item.titulo}</button>)}
    </div>
    {itens.map((item) => <div key={item.id} role="tabpanel" className="conteudo-aba"
      id={`${base}-painel-${item.id}`} aria-labelledby={`${base}-aba-${item.id}`}
      hidden={atual !== item.id}>{item.conteudo}</div>)}
  </>;
}
