import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { COLUNAS, sugerirMapeamento } from '../apps/api/dist/importacao/formatos.js';
import { mapearPlanilhaLegado } from '../apps/api/dist/importacao/promocao-legado.js';

it('mapeia as 18 colunas independentemente da posição e preserva zeros/textos', () => {
  const cabecalhos = ['CPF', 'Nome', 'Matr', 'FONTE'];
  const mapeamento = sugerirMapeamento('dados_funcionais', cabecalhos);
  const resultado = mapearPlanilhaLegado(cabecalhos, [['52998224725', 'PESSOA FICTICIA', '00002', 'origem original']], {
    loteId: randomUUID(), tipo: 'dados_funcionais', modo: 'validar', mapeamento,
  });
  expect(COLUNAS.dados_funcionais).toHaveLength(18);
  expect(resultado).toEqual([['MATRICULA', 'NOME', 'CPF'], ['00002', 'PESSOA FICTICIA', '52998224725']]);
  expect(sugerirMapeamento('dados_funcionais', ['ADMISSAO', 'ADMISSAO']).EXPEDICAO).toBe(1);
});

it('recusa campos desconhecidos, posições repetidas/ausentes e cadastro sem CPF mapeado', () => {
  const dados = { loteId: randomUUID(), tipo: 'dados_funcionais' as const, modo: 'validar' as const };
  const cabecalhos = ['MATRICULA', 'NOME', 'CPF'];
  const invalidos: Array<Record<string, number | null>> = [
    { MATRICULA: 0, NOME: 1 }, { MATRICULA: 0, NOME: 0, CPF: 2 },
    { MATRICULA: 0, NOME: 1, CPF: 100 }, { MATRICULA: 0, NOME: 1, CPF: 2, OUTRO: 3 },
  ];
  for (const mapeamento of invalidos) expect(() => mapearPlanilhaLegado(cabecalhos, [], { ...dados, mapeamento })).toThrow();
});

it('converte afastamentos por intervalo sem fabricar coluna ANO ou mudar de modalidade', () => {
  const cabecalhos = ['MATRICULA', 'TIPO', 'DT_INICIO', 'DT_FIM'];
  const resultado = mapearPlanilhaLegado(cabecalhos, [['0001', 'TS', '2001-01-01', '2001-01-02']], {
    loteId: randomUUID(), tipo: 'afastamentos', modo: 'validar',
    mapeamento: { MATRICULA: 0, ANO: null, TIPO: 1, DT_INICIO: 2, DT_FIM: 3 },
  });
  expect(resultado[0]).toEqual(cabecalhos);
  expect(resultado[1]).toEqual(['0001', 'TS', '2001-01-01', '2001-01-02']);
});
