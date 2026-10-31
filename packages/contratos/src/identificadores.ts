export function normalizarMatricula(valor: string): string {
  return valor.trim().toUpperCase();
}

export function normalizarNomeBusca(valor: string): string {
  return valor.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
}
