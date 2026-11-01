import { renderizarModeloDof, type DadosModeloDof } from './modelo-dof';
import { ESTILO_MODELOS_OFICIAIS } from './versoes';

export const ESTILO_PREVIA_DOF = ESTILO_MODELOS_OFICIAIS;

/** Usa o formulário oficial sem número/validade de emissão, preservando avisos e variáveis pendentes. */
export function renderizarPreviaDof(dados: Omit<DadosModeloDof, 'classificacao'>): string {
  return renderizarModeloDof({ ...dados, classificacao: 'previa' });
}
