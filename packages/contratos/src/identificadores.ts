/** Normaliza caixa e espaços externos sem remover zeros ou transformar matrícula em número. */
export function normalizarMatricula(valor: string): string {
  return valor.trim().toUpperCase();
}

/** Remove acentos e diferenças de caixa/espaçamento apenas da chave de busca. */
export function normalizarNomeBusca(valor: string): string {
  return valor.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
}
