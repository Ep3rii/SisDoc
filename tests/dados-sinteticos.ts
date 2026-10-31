export function cpfSintetico(indice = 1): string {
  if (!Number.isInteger(indice) || indice < 1 || indice > 999999999) {
    throw new Error('Índice de CPF sintético inválido.');
  }
  const digitos = String(indice).padStart(9, '0').split('').map(Number);
  for (let posicao = 9; posicao <= 10; posicao += 1) {
    const soma = digitos.reduce((total, digito, indice) => total + digito * (posicao + 1 - indice), 0);
    const verificador = (soma * 10) % 11;
    digitos.push(verificador === 10 ? 0 : verificador);
  }
  return digitos.join('');
}
