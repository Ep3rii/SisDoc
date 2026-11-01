import { configuracaoSincronizacaoSchema } from '@sisdoc/contratos';
import { describe, expect, it } from 'vitest';
import { idDoItem, mapearItem } from '../apps/api/dist/sincronizacao/mapeamento-sincronizacao.js';

const configuracao = configuracaoSincronizacaoSchema.parse({
  origem: 'teste-mapeamento', url: 'http://127.0.0.1:1',
});
const comAliases = configuracaoSincronizacaoSchema.parse({
  ...configuracao,
  mapeamento: { id: 'codigo', vinculos: 'lotacoes', 'vinculo.id': 'codigo', 'vinculo.matricula': 'registro' },
});

describe('mapeamento puro da sincronização', () => {
  it('preserva a referência da entrada canônica quando não há aliases', () => {
    const entrada = { id: 'pessoa-ficticia', vinculos: [] };
    expect(mapearItem(configuracao, entrada)).toBe(entrada);
  });

  it('renomeia campos configurados e conserva canônicos não mapeados', () => {
    const entrada = {
      codigo: 'pessoa-ficticia', nome: 'PESSOA FICTICIA', extra: 'não deve ser promovido',
      lotacoes: [{ codigo: 'vinculo-ficticio', registro: '000042', cargo: 'CARGO FICTICIO', extra: true }],
    };
    expect(mapearItem(comAliases, entrada)).toEqual({
      id: 'pessoa-ficticia', nome: 'PESSOA FICTICIA',
      vinculos: [{ id: 'vinculo-ficticio', matricula: '000042', cargo: 'CARGO FICTICIO' }],
    });
    expect(entrada.lotacoes[0].registro).toBe('000042');
  });

  it('não transforma entradas malformadas em servidores válidos', () => {
    for (const entrada of [null, undefined, 42, 'inválido', [{ codigo: 'ficticio' }]]) {
      expect(mapearItem(comAliases, entrada)).toBe(entrada);
    }
    expect(mapearItem(comAliases, { codigo: 'ficticio', lotacoes: [null, 42] }))
      .toEqual({ id: 'ficticio', vinculos: [null, 42] });
  });

  it('não exige aliases de vínculos quando só campos da pessoa foram renomeados', () => {
    const apenasPessoa = configuracaoSincronizacaoSchema.parse({ ...configuracao, mapeamento: { id: 'codigo' } });
    expect(mapearItem(apenasPessoa, {
      codigo: 'pessoa-ficticia', vinculos: [{ id: 'vinculo-ficticio', matricula: '000007', orgao_nome: 'ORGAO FICTICIO' }],
    })).toEqual({
      id: 'pessoa-ficticia', vinculos: [{ id: 'vinculo-ficticio', matricula: '000007', orgao_nome: 'ORGAO FICTICIO' }],
    });
  });

  it('exige identificador do contrato sem converter número, vazio ou array', () => {
    expect(idDoItem({ id: 'pessoa-ficticia:001' })).toBe('pessoa-ficticia:001');
    for (const entrada of [null, {}, { id: '' }, { id: 42 }, { id: ['ficticio'] }, { id: '../invalido' }]) {
      expect(idDoItem(entrada)).toBeNull();
    }
  });
});
