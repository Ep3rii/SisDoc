export function cpfSintetico(): string {
  const digitos = '000000001'.split('').map(Number);
  for (let posicao = 9; posicao <= 10; posicao += 1) {
    const soma = digitos.reduce((total, digito, indice) => total + digito * (posicao + 1 - indice), 0);
    const verificador = (soma * 10) % 11;
    digitos.push(verificador === 10 ? 0 : verificador);
  }
  return digitos.join('');
}
