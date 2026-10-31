import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  afastamentoSchema,
  ajusteCampoSchema,
  buscarServidoresQuerySchema,
  cpfSchema,
  criarDocumentoSchema,
  criarRascunhoDofSchema,
  dataFuncionalSchema,
  detalheServidorSchema,
  eventosServidorQuerySchema,
  incorporacaoSchema,
  atualizarRascunhoDofSchema,
  solicitarCalculoDofSchema,
} from '../packages/contratos/dist/index.js';
import { cpfSintetico } from './dados-sinteticos.js';

describe('contratos de domínio', () => {
  it('valida datas civis sem depender do fuso e respeita os séculos bissextos', () => {
    for (const data of ['0001-01-01', '2000-02-29', '2024-02-29', '9999-12-31']) {
      expect(dataFuncionalSchema.parse(data)).toBe(data);
    }
    for (const data of [
      '0000-01-01', '1900-02-29', '2023-02-29', '2024-04-31', '2024-13-01',
      '2024-00-01', '2024-01-00', '2024-1-01', '29/02/2024', '2024-01-01T00:00:00Z',
    ]) {
      expect(dataFuncionalSchema.safeParse(data).success).toBe(false);
    }
  });

  it('normaliza CPF sintético e rejeita formato ou dígitos inválidos', () => {
    const cpf = cpfSintetico();
    const formatado = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
    expect(cpfSchema.parse(` ${formatado} `)).toBe(cpf);
    expect(cpfSchema.parse(cpf)).toBe(cpf);
    expect(cpfSchema.safeParse(`${cpf.slice(0, -1)}${(Number(cpf.at(-1)) + 1) % 10}`).success).toBe(false);
    expect(cpfSchema.safeParse('000.000.000-00').success).toBe(false);
    expect(cpfSchema.safeParse(`${cpf.slice(0, 3)}-${cpf.slice(3)}`).success).toBe(false);
  });

  it('valida consultas e paginação de servidores sem aceitar parâmetros ambíguos', () => {
    const cpf = cpfSintetico();
    expect(buscarServidoresQuerySchema.parse({ q: '  Árvore  ', tipo: 'nome' }))
      .toEqual({ q: 'Árvore', tipo: 'nome', limite: 25 });
    expect(buscarServidoresQuerySchema.parse({ q: cpf, tipo: 'cpf', limite: '50' }).limite).toBe(50);
    expect(buscarServidoresQuerySchema.safeParse({ q: '1.000001-2', tipo: 'matricula' }).success).toBe(true);
    for (const entrada of [
      { q: 'áé', tipo: 'nome' }, { q: 'abc\u0000', tipo: 'nome' },
      { q: '00000000000', tipo: 'cpf' }, { q: 'x'.repeat(101), tipo: 'matricula' },
      { q: 'nome', tipo: 'nome', limite: '0' }, { q: 'nome', tipo: 'nome', limite: '51' },
      { q: 'nome', tipo: 'nome', cursor: 'inválido' }, { q: 'nome', tipo: 'outro' },
      { q: 'nome', tipo: 'nome', campoExtra: true },
    ]) {
      expect(buscarServidoresQuerySchema.safeParse(entrada).success).toBe(false);
    }
    expect(eventosServidorQuerySchema.parse({ vinculoId: randomUUID(), limite: '1' }).limite).toBe(1);
    expect(eventosServidorQuerySchema.safeParse({ vinculoId: 'inválido' }).success).toBe(false);
  });

  it('exige CPF mascarado na resposta de detalhes', () => {
    const pessoa = { id: randomUUID(), nome: 'Pessoa fictícia', cpfMascarado: '***.***.123-**' };
    const detalhe = { pessoa, vinculos: [], proximoCursor: null };
    expect(detalheServidorSchema.safeParse(detalhe).success).toBe(true);
    expect(detalheServidorSchema.safeParse({
      ...detalhe, pessoa: { ...pessoa, cpfMascarado: cpfSintetico() },
    }).success).toBe(false);
    expect(detalheServidorSchema.safeParse({
      ...detalhe, pessoa: { ...pessoa, cpfMascarado: '***.***.12-**' },
    }).success).toBe(false);
  });

  it('exige confirmação e não permite escolher a regra ou a posse no cálculo de DOF', () => {
    const entrada = {
      pessoaId: randomUUID(), vinculoId: randomUUID(), inicio: '2024-01-01', fim: '2024-12-31',
      anos: [{
        ano: 2024, abrangencia: 'intervalo_declarado', faltas: 0, ts: 0, pf: 0,
        ip: 0, outros: 0, pb: 0, pv: 0, licencaPremio: 0,
      }],
      confirmacaoDados: true,
    };
    expect(solicitarCalculoDofSchema.safeParse(entrada).success).toBe(true);
    for (const invalida of [
      { ...entrada, confirmacaoDados: false },
      { ...entrada, posse: '2024-01-01' },
      { ...entrada, regras: {} },
      { ...entrada, fim: '2023-12-31' },
      { ...entrada, anos: [{ ...entrada.anos[0], faltas: -1 }] },
    ]) {
      expect(solicitarCalculoDofSchema.safeParse(invalida).success).toBe(false);
    }
  });

  it('valida limites, ordem e sobreposição inclusiva dos períodos', () => {
    const pessoaId = randomUUID();
    const vinculoId = randomUUID();
    const periodos = [
      { inicio: '2000-01-01', fim: '2000-12-31' },
      { inicio: '2001-01-01', fim: '2001-12-31' },
      { inicio: '2002-01-01', fim: '2002-12-31' },
      { inicio: '2003-01-01', fim: '2003-12-31' },
    ];
    const entrada = { tipo: 'DTC_INSS', pessoaId, vinculoId, periodos };
    expect(criarDocumentoSchema.safeParse(entrada).success).toBe(true);
    expect(criarDocumentoSchema.safeParse({ ...entrada, periodos: [...periodos].reverse() }).success).toBe(true);
    expect(criarDocumentoSchema.safeParse({ ...entrada, tipo: 'DOF', periodos: [periodos[0]] }).success).toBe(true);
    expect(criarDocumentoSchema.safeParse({ ...entrada, tipo: 'DOF' }).success).toBe(false);
    expect(criarDocumentoSchema.safeParse({ ...entrada, periodos: [] }).success).toBe(false);
    expect(criarDocumentoSchema.safeParse({ ...entrada, periodos: [...periodos, periodos[0]] }).success).toBe(false);
    expect(criarDocumentoSchema.safeParse({
      ...entrada, periodos: [periodos[0], { inicio: '2000-12-31', fim: '2001-12-31' }],
    }).success).toBe(false);
    expect(criarDocumentoSchema.safeParse({
      ...entrada, periodos: [{ inicio: '2000-12-31', fim: '2000-01-01' }],
    }).success).toBe(false);
    expect(criarDocumentoSchema.safeParse({ ...entrada, status: 'emitido' }).success).toBe(false);
    expect(criarDocumentoSchema.safeParse({ ...entrada, pessoaId: 'inválido' }).success).toBe(false);
  });

  it('exige justificativa não vazia para ajustes', () => {
    const ajuste = { campo: 'cargo', valorOriginal: 'anterior', valorNovo: 'novo', motivo: 'Correção justificada' };
    expect(ajusteCampoSchema.parse(ajuste)).toEqual(ajuste);
    expect(ajusteCampoSchema.safeParse({ ...ajuste, motivo: '  ' }).success).toBe(false);
    expect(ajusteCampoSchema.safeParse({ ...ajuste, campo: '' }).success).toBe(false);
    expect(ajusteCampoSchema.safeParse({ ...ajuste, valorNovo: undefined }).success).toBe(false);
    expect(ajusteCampoSchema.safeParse({ ...ajuste, outro: true }).success).toBe(false);
  });

  it('valida motivo, revisão e identidade fixa nos contratos de rascunho', () => {
    const calculo = {
      pessoaId: randomUUID(), vinculoId: randomUUID(), inicio: '2024-01-01', fim: '2024-12-31',
      anos: [{
        ano: 2024, abrangencia: 'intervalo_declarado', faltas: 0, ts: 0, pf: 0,
        ip: 0, outros: 0, pb: 0, pv: 0, licencaPremio: 0,
      }],
      confirmacaoDados: true,
    };
    const admissaoEsperada = '2024-01-01';
    expect(criarRascunhoDofSchema.parse({ calculo, admissaoEsperada, motivo: '  Conferência  ' }).motivo).toBe('Conferência');
    expect(criarRascunhoDofSchema.safeParse({ calculo, admissaoEsperada, motivo: ' ' }).success).toBe(false);
    expect(criarRascunhoDofSchema.safeParse({ calculo, admissaoEsperada, motivo: 'x'.repeat(2001) }).success).toBe(false);
    expect(criarRascunhoDofSchema.safeParse({ calculo, motivo: 'Motivo' }).success).toBe(false);
    expect(criarRascunhoDofSchema.safeParse({ calculo, admissaoEsperada: 'data inválida', motivo: 'Motivo' }).success).toBe(false);
    expect(criarRascunhoDofSchema.safeParse({ calculo, admissaoEsperada, motivo: 'Motivo', status: 'emitido' }).success).toBe(false);
    expect(atualizarRascunhoDofSchema.safeParse({ calculo, admissaoEsperada, motivo: 'Motivo', revisao: 1 }).success).toBe(true);
    expect(atualizarRascunhoDofSchema.safeParse({
      calculo, admissaoEsperada, motivo: 'Motivo', revisao: 1, anosRemovidosConfirmados: [2023, 2024],
    }).success).toBe(true);
    expect(atualizarRascunhoDofSchema.safeParse({
      calculo, admissaoEsperada, motivo: 'Motivo', revisao: 1, anosRemovidosConfirmados: [2024, 2024],
    }).success).toBe(false);
    for (const revisao of [0, -1, 1.5, 2147483648, '1']) {
      expect(atualizarRascunhoDofSchema.safeParse({ calculo, admissaoEsperada, motivo: 'Motivo', revisao }).success).toBe(false);
    }
  });

  it('distingue afastamentos anuais e intervalos sem aceitar formas misturadas', () => {
    expect(afastamentoSchema.safeParse({ forma: 'anual', tipo: 'licenca_ts', ano: 2024, dias: 366 }).success).toBe(true);
    expect(afastamentoSchema.safeParse({
      forma: 'intervalo', tipo: 'falta', intervalo: { inicio: '2024-02-01', fim: '2024-02-29' },
    }).success).toBe(true);
    for (const entrada of [
      { forma: 'anual', tipo: 'falta', ano: 2024, dias: -1 },
      { forma: 'anual', tipo: 'falta', ano: 2024, dias: 367 },
      { forma: 'anual', tipo: 'falta', ano: 0, dias: 1 },
      { forma: 'anual', tipo: 'falta', ano: 2024, dias: 1, intervalo: {} },
      { forma: 'intervalo', tipo: 'falta', intervalo: { inicio: '2024-02-29', fim: '2024-02-01' } },
      { forma: 'intervalo', tipo: 'desconhecido', intervalo: { inicio: '2024-01-01', fim: '2024-01-02' } },
    ]) {
      expect(afastamentoSchema.safeParse(entrada).success).toBe(false);
    }
  });

  it('exige origem e convenção explícita para incorporações por intervalo', () => {
    expect(incorporacaoSchema.safeParse({
      forma: 'anual', tipo: 'PB', ano: 2024, dias: 90, origem: 'Registro sintético',
    }).success).toBe(true);
    expect(incorporacaoSchema.safeParse({
      forma: 'intervalo', tipo: 'PV', intervalo: { inicio: '2024-01-01', fim: '2024-01-31' },
      convencao: 'exclusivo', origem: 'Registro sintético',
    }).success).toBe(true);
    for (const entrada of [
      { forma: 'anual', tipo: 'PB', ano: 2024, dias: -1, origem: 'Registro sintético' },
      { forma: 'anual', tipo: 'PB', ano: 2024, dias: 1, origem: ' ' },
      { forma: 'intervalo', tipo: 'PB', intervalo: { inicio: '2024-01-01', fim: '2024-01-31' }, origem: 'Teste' },
      { forma: 'intervalo', tipo: 'PV', intervalo: { inicio: '2024-02-01', fim: '2024-01-31' }, convencao: 'inclusivo', origem: 'Teste' },
      { forma: 'anual', tipo: 'inexistente', ano: 2024, dias: 1, origem: 'Teste' },
    ]) {
      expect(incorporacaoSchema.safeParse(entrada).success).toBe(false);
    }
  });
});
