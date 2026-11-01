'use strict';
// Gera os modelos de importação (CSV e XLSX) com dados sintéticos. Requer `npm run build` antes.
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { escreverCsv, escreverXlsx } = require('../apps/api/dist/importacao/planilhas.js');

function cpf(indice) {
  const digitos = String(indice).padStart(9, '0').split('').map(Number);
  for (let posicao = 9; posicao <= 10; posicao += 1) {
    const soma = digitos.reduce((total, digito, i) => total + digito * (posicao + 1 - i), 0);
    const verificador = (soma * 10) % 11;
    digitos.push(verificador === 10 ? 0 : verificador);
  }
  return digitos.join('');
}

const modelos = {
  dados_funcionais: [
    ['MATRICULA', 'NOME', 'CPF', 'NASCIMENTO', 'MAE', 'ADMISSAO', 'REGIMEJUR', 'CARGO', 'REFERENCIA', 'SETOR', 'ORGAO',
      'DESLIGAMENTO', 'PISPASEP', 'NUMRG', 'NUMTITEL', 'ORGAORG', 'ENDERECO', 'EXPEDICAO'],
    ['90001', 'SERVIDORA FICTICIA UM', cpf(900000001), '15/03/1980', 'MAE FICTICIA UM', '01/02/2005', 'ESTATUTARIO',
      'PROFESSOR', 'A-01', 'ESCOLA MODELO', 'SECRETARIA DE EDUCACAO', '', '10000000001', '1000001', '100000000001', 'SSP/SP',
      'RUA FICTICIA, 1', '10/05/1998'],
    ['90002', 'SERVIDOR FICTICIO DOIS', cpf(900000002), '22/07/1975', 'MAE FICTICIA DOIS', '03/03/2010', 'SERVICO PRESTADO',
      'AUXILIAR ADMINISTRATIVO', 'B-02', 'SETOR MODELO', 'SECRETARIA DE ADMINISTRACAO', '31/12/2015', '', '', '', '',
      'AVENIDA FICTICIA, 200', ''],
  ],
  afastamentos: [
    ['MATRICULA', 'ANO', 'FALTAS', 'TS', 'PF', 'IP', 'OUTROS'],
    ['90001', '2020', '2', '0', '', '', ''],
    ['90001', '2021', '', '30', '', '', '1'],
  ],
  incorporacoes: [
    ['MATRICULA', 'TIPO', 'DT_INICIO', 'DT_FIM'],
    ['90001', 'PB', '01/01/2010', '31/12/2014'],
    ['90001', 'LIC_PREMIO', '01/02/2015', '01/05/2015'],
  ],
  periodos_ipam: [
    ['CPF', 'MES_INICIO', 'MES_FIM'],
    [cpf(900000001), '02/2005', '12/2015'],
    [cpf(900000002), '03/2010', '12/2015'],
  ],
  eventos_funcionais: [
    ['MATRICULA', 'TIPO', 'DATA', 'ATO_NUMERO', 'DATA_PUBLICACAO', 'DESCRICAO'],
    ['90001', 'NOMEACAO', '01/02/2005', 'PORTARIA 1/2005', '25/01/2005', 'NOMEACAO EM CARATER EFETIVO'],
    ['90002', 'EXONERACAO', '31/12/2015', 'PORTARIA 99/2015', '30/12/2015', 'EXONERACAO A PEDIDO'],
  ],
};

const destino = path.resolve(__dirname, '..', 'referencias', 'modelos-importacao');
mkdirSync(destino, { recursive: true });
for (const [tipo, linhas] of Object.entries(modelos)) {
  writeFileSync(path.join(destino, `${tipo}.csv`), escreverCsv(linhas));
  writeFileSync(path.join(destino, `${tipo}.xlsx`), escreverXlsx(linhas, tipo.slice(0, 31)));
}
process.stdout.write(`Modelos gravados em ${destino}\n`);
