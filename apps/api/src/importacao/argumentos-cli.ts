export type ArgumentosCli = Record<string, string | true>;

/** Lê flags e valores separados/embutidos, recusando argumentos posicionais inesperados. */
export function lerArgumentos(argumentos: readonly string[]): ArgumentosCli {
  const resultado: ArgumentosCli = {};
  for (let indice = 0; indice < argumentos.length; indice += 1) {
    const atual = argumentos[indice];
    if (!atual.startsWith('--')) throw new Error(`Argumento inesperado: ${atual}. Use --ajuda para ver as opções.`);
    const [nome, valorEmbutido] = atual.slice(2).split(/=(.*)/s, 2);
    if (valorEmbutido !== undefined) resultado[nome] = valorEmbutido;
    else if (argumentos[indice + 1] !== undefined && !argumentos[indice + 1].startsWith('--')) {
      resultado[nome] = argumentos[indice + 1];
      indice += 1;
    } else resultado[nome] = true;
  }
  return resultado;
}

/** Exige valor textual para a opção solicitada, distinguindo ausência de flag sem valor. */
export function texto(argumentos: ArgumentosCli, nome: string): string | undefined {
  const valor = argumentos[nome];
  if (valor === true) throw new Error(`Informe um valor para --${nome}.`);
  return valor;
}
