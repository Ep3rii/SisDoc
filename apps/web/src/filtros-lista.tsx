import { useState, type ReactNode } from 'react';

function normalizar(valor: string) {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

export function useFiltroLista<T>(itens: readonly T[], texto: (item: T) => string) {
  const [busca, setBusca] = useState('');
  const termo = normalizar(busca).trim();
  const filtrados = itens.filter((item) => normalizar(texto(item)).includes(termo));
  return { busca, setBusca, itens: filtrados, total: itens.length };
}

export function FiltrosLista({ filtro, onAtualizar, antesAlterar, children }: {
  filtro: { busca: string; setBusca: (valor: string) => void; itens: readonly unknown[]; total: number };
  onAtualizar?: () => void;
  antesAlterar?: () => boolean;
  children?: ReactNode;
}) {
  return <div className="filtros-lista" role="search" aria-label="Filtros da lista carregada">
    {children}
    <label>Filtrar lista carregada<input type="search" autoComplete="off" maxLength={200}
      placeholder="Nome, matrícula, situação ou outro valor exibido"
      value={filtro.busca} onChange={(evento) => {
        if (!antesAlterar || antesAlterar()) filtro.setBusca(evento.target.value);
      }} /></label>
    <button type="button" className="secundario" disabled={!filtro.busca}
      onClick={() => { if (!antesAlterar || antesAlterar()) filtro.setBusca(''); }}>Limpar filtro</button>
    {onAtualizar && <button type="button" className="secundario"
      onClick={() => { if (!antesAlterar || antesAlterar()) onAtualizar(); }}>Atualizar lista</button>}
    <p role="status">{filtro.itens.length} de {filtro.total} registros carregados. O filtro não pesquisa outras páginas.</p>
    {filtro.busca && filtro.itens.length === 0 && <p>Nenhum registro corresponde ao filtro nesta lista.</p>}
  </div>;
}
