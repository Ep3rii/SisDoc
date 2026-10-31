import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dataEmSaoPaulo } from '../apps/api/dist/data.js';
import { LIMITE_NOME_PDF, nomePdf, type EntradaNomePdf } from '../apps/api/dist/documentos/nome-pdf.js';

const base: EntradaNomePdf = {
  nome: 'Pessoa fictícia', tipo: 'DOF', emitidoEm: new Date('2025-01-01T03:00:00.000Z'), colisao: 1,
};

describe('nomes de PDF preparados para futura emissão', () => {
  it('normaliza o nome e preserva os quatro tipos previstos', () => {
    const tipos: Array<[EntradaNomePdf['tipo'], string]> = [
      ['DOF', 'DOF'], ['DTC_IPAM', 'DTC-IPAM'],
      ['DTC_COMISSIONADO', 'DTC-COMISSIONADO'], ['DTC_INSS', 'DTC-INSS'],
    ];
    for (const [tipo, esperado] of tipos) {
      expect(nomePdf({ ...base, nome: '  Pessoa  Fictícia d’Ávila  ', tipo }))
        .toBe(`PESSOA_FICTICIA_D_AVILA_${esperado}_2025-01-01.pdf`);
    }
  });

  it('usa o fuso de São Paulo e permite especificar colisões sem gravar arquivos', () => {
    const antes = new Date('2025-01-01T02:59:59.999Z');
    const depois = new Date('2025-01-01T03:00:00.000Z');
    expect(dataEmSaoPaulo(antes)).toBe('2024-12-31');
    expect(dataEmSaoPaulo(depois)).toBe('2025-01-01');
    expect(nomePdf({ ...base, emitidoEm: antes })).toBe('PESSOA_FICTICIA_DOF_2024-12-31.pdf');
    expect(nomePdf({ ...base, colisao: 2 })).toBe('PESSOA_FICTICIA_DOF_2025-01-01_2.pdf');
    expect(nomePdf({ ...base, colisao: 3 })).toBe('PESSOA_FICTICIA_DOF_2025-01-01_3.pdf');
  });

  it('representa anos de quatro dígitos e recusa datas fora do intervalo', () => {
    expect(dataEmSaoPaulo(new Date('0001-01-03T12:00:00.000Z'))).toBe('0001-01-03');
    expect(dataEmSaoPaulo(new Date('0999-12-31T12:00:00.000Z'))).toBe('0999-12-31');
    expect(() => dataEmSaoPaulo(new Date('0000-01-03T12:00:00.000Z'))).toThrow('fora do intervalo');
    expect(() => dataEmSaoPaulo(new Date('+010000-01-03T12:00:00.000Z'))).toThrow('fora do intervalo');
  });

  it('mantém a data de referência anterior do cálculo em instantes variados', () => {
    const anterior = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    });
    fc.assert(fc.property(fc.date({
      min: new Date('1970-01-01T00:00:00.000Z'),
      max: new Date('2100-12-31T23:59:59.999Z'),
      noInvalidDate: true,
    }), (instante) => {
      expect(dataEmSaoPaulo(instante)).toBe(anterior.format(instante));
    }));
  });

  it('limita o nome completo incluindo extensão e sufixo de colisão', () => {
    const arquivo = nomePdf({
      ...base, nome: 'P'.repeat(500), tipo: 'DTC_COMISSIONADO', colisao: Number.MAX_SAFE_INTEGER,
    });
    expect(arquivo).toHaveLength(LIMITE_NOME_PDF);
    expect(arquivo).toMatch(/_DTC-COMISSIONADO_2025-01-01_9007199254740991\.pdf$/);
    expect(Buffer.byteLength(arquivo, 'utf8')).toBeLessThanOrEqual(LIMITE_NOME_PDF);
    const colisoes = [1, 2, 3].map((colisao) => nomePdf({ ...base, nome: 'P'.repeat(500), colisao }));
    expect(new Set(colisoes).size).toBe(3);
    expect(colisoes.every((nome) => nome.length <= LIMITE_NOME_PDF)).toBe(true);
  });

  it('remove separadores e números do nome, sem aceitar identificadores adicionais', () => {
    const arquivo = nomePdf({ ...base, nome: '..\\../PESSOA 12345678901 987654\x00< >:|?*' });
    expect(arquivo).toBe('PESSOA_DOF_2025-01-01.pdf');
    expect(path.win32.basename(arquivo)).toBe(arquivo);
    expect(arquivo).not.toContain('12345678901');
    expect(arquivo).not.toContain('987654');
    const comCampoExtra = { ...base, matricula: 'FICTICIA' };
    expect(() => nomePdf(comCampoExtra)).toThrow('Dados inválidos');
  });

  it('rejeita entrada inválida e nomes que não produzem letras utilizáveis', () => {
    for (const entrada of [
      { ...base, nome: '' }, { ...base, nome: '  ' }, { ...base, nome: '123/987' },
      { ...base, nome: '😀' }, { ...base, colisao: 0 }, { ...base, colisao: 1.5 },
      { ...base, colisao: Number.MAX_SAFE_INTEGER + 1 }, { ...base, emitidoEm: new Date('inválido') },
    ]) {
      expect(() => nomePdf(entrada)).toThrow();
    }
    expect(() => dataEmSaoPaulo(new Date('inválido'))).toThrow('O instante informado é inválido.');
  });

  it('mantém nome seguro e o limite para entradas e colisões variadas', () => {
    fc.assert(fc.property(
      fc.string({ maxLength: 500 }), fc.integer({ min: 1, max: 1000000 }),
      (texto, colisao) => {
        const arquivo = nomePdf({ ...base, nome: `A ${texto}`, colisao });
        expect(arquivo.length).toBeLessThanOrEqual(80);
        expect(arquivo).toMatch(/^[A-Z_]+_DOF_2025-01-01(?:_[2-9][0-9]*|_1[0-9]+)?\.pdf$/);
        expect(path.win32.basename(arquivo)).toBe(arquivo);
      },
    ));
  });
});
