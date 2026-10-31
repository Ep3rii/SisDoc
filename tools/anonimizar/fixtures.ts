import { randomUUID } from 'node:crypto';
import { normalizarMatricula, normalizarNomeBusca } from '@sisdoc/contratos';

export type VinculoSintetico = {
  id: string;
  matricula: string;
  matriculaNorm: string;
  sistemaOrigem: string;
  idOrigem: string;
  matriculaAnteriorId: string | null;
  orgao: string;
  regime: string;
  referencia: string;
};

export type PessoaSintetica = {
  id: string;
  cpf: string;
  nome: string;
  nomeBusca: string;
  vinculos: VinculoSintetico[];
};

function cpfFicticio(indice: number): string {
  const digitos = String(indice).padStart(9, '0').split('').map(Number);
  for (let posicao = 9; posicao <= 10; posicao += 1) {
    const soma = digitos.reduce((total, digito, i) => total + digito * (posicao + 1 - i), 0);
    const verificador = (soma * 10) % 11;
    digitos.push(verificador === 10 ? 0 : verificador);
  }
  return digitos.join('');
}

export function gerarPessoasSinteticas(totalVinculos: number): PessoaSintetica[] {
  if (!Number.isInteger(totalVinculos) || totalVinculos < 4 || totalVinculos > 50000) {
    throw new Error('A quantidade de vínculos sintéticos deve estar entre 4 e 50.000.');
  }
  const pessoas: PessoaSintetica[] = [];
  const referencias = ['PNS-D', 'IX-B', 'UNICA', 'SERV00', 'DAI1', 'DAS7'];
  for (let indice = 0; indice < totalVinculos - 1; indice += 1) {
    const id = randomUUID();
    const nome = indice === 0 ? 'Pessoa Árvore Fictícia' : `Pessoa Sintética ${String(indice).padStart(6, '0')}`;
    const matricula = indice === 0 ? '1.000001-1' : indice <= 2 ? '7.777777-1' : `2.${String(indice).padStart(6, '0')}-1`;
    const vinculo: VinculoSintetico = {
      id: randomUUID(),
      matricula,
      matriculaNorm: normalizarMatricula(matricula),
      sistemaOrigem: indice === 2 ? 'fonte-sintetica-b' : 'fonte-sintetica-a',
      idOrigem: randomUUID(),
      matriculaAnteriorId: null,
      orgao: 'Órgão sintético',
      regime: indice % 2 ? 'SERVICO PRESTADO' : 'ESTATUTARIO',
      referencia: referencias[indice % referencias.length],
    };
    const vinculos = [vinculo];
    if (indice === 0) {
      vinculos.push({
        ...vinculo,
        id: randomUUID(),
        matricula: '1.000001-2',
        matriculaNorm: normalizarMatricula('1.000001-2'),
        idOrigem: randomUUID(),
        matriculaAnteriorId: vinculo.id,
      });
    }
    pessoas.push({ id, cpf: cpfFicticio(indice + 1), nome, nomeBusca: normalizarNomeBusca(nome), vinculos });
  }
  return pessoas;
}
