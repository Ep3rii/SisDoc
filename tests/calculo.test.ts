import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  calcular,
  calcularIncorporacao,
  converterDias,
  diasEntre,
  diasInclusivos,
  distribuirAfastamento,
  linhasDeclaracaoDof,
  localizarVinculo,
  nivelDof,
  REGRAS_PLANILHA,
  textoPeriodos,
  textoTempo,
  type EntradaCalculo,
  type LinhaAnual,
  type TotaisCalculo,
} from '../packages/calculo/dist/index.js';

const ajusteAnoSchema = z.object({
  ano: z.number().int(),
  abrangencia: z.enum(['ano_civil', 'intervalo_declarado']).optional(),
  faltas: z.number().int().optional(),
  ts: z.number().int().optional(),
  pf: z.number().int().optional(),
  ip: z.number().int().optional(),
  outros: z.number().int().optional(),
  pb: z.number().int().optional(),
  pv: z.number().int().optional(),
  licencaPremio: z.number().int().optional(),
});
const periodoFixtureSchema = z.object({
  inicio: z.string(),
  fim: z.string(),
  anos: z.array(ajusteAnoSchema),
  acumuladoAnterior: z.object({ ts: z.number(), pf: z.number(), origem: z.string() }).optional(),
});
const casoMotorSchema = z.object({
  codigo: z.string(),
  tipo: z.enum(['DOF', 'DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS']),
  posse: z.string(),
  dataReferencia: z.string(),
  periodos: z.array(periodoFixtureSchema),
  esperado: z.object({
    totais: z.object({
      diasBrutos: z.number().optional(),
      contribuicaoMunicipio: z.number().optional(),
      efetivoExercicio: z.number().optional(),
      totalContribuicao: z.number().optional(),
      pb: z.number().optional(),
      pv: z.number().optional(),
      licencaPremio: z.number().optional(),
    }).optional(),
    textoContribuicao: z.string().optional(),
    textoPeriodos: z.string().optional(),
    quantidadeLinhas: z.number().optional(),
    inicioEfetivo: z.string().optional(),
    avisos: z.array(z.string()).optional(),
    linhas: z.array(z.object({
      periodo: z.number(),
      ano: z.number(),
      diasBrutos: z.number().optional(),
      excessoTs: z.number().optional(),
      excessoPf: z.number().optional(),
      efetivoExercicio: z.number().optional(),
    })).optional(),
    periodos: z.array(z.object({
      ordem: z.number(),
      excessoTs: z.number(),
      excessoPf: z.number(),
      efetivoExercicio: z.number(),
    })).optional(),
    declaracao: z.array(z.string()).optional(),
    ordemDeclaracao: z.array(z.string()).optional(),
  }),
});
const conversaoSchema = z.array(z.object({
  codigo: z.string(),
  dias: z.number(),
  esperado: z.object({ anos: z.number(), meses: z.number(), dias: z.number() }),
  texto: z.string(),
}));
const vinculosFixtureSchema = z.object({
  codigo: z.literal('GT-08'),
  matriculaInexistente: z.string(),
  matriculaAtual: z.string(),
  vinculos: z.array(z.object({
    id: z.string(),
    pessoaId: z.string(),
    matricula: z.string(),
    sistemaOrigem: z.string(),
    matriculaAnteriorId: z.string().nullable(),
  })),
});

function carregarCaso(nome: string): unknown {
  return JSON.parse(readFileSync(path.join(process.cwd(), 'packages', 'calculo', 'casos', nome), 'utf8'));
}

const casosConversao = conversaoSchema.parse(carregarCaso('conversao.json'));
const casosMotor = z.array(casoMotorSchema).parse(carregarCaso('motor.json'));
const casoVinculos = vinculosFixtureSchema.parse(carregarCaso('vinculos.json'));

function gerarAnos(posse: string, periodo: z.infer<typeof periodoFixtureSchema>): EntradaCalculo['periodos'][number] {
  const inicioEfetivo = periodo.inicio < posse ? posse : periodo.inicio;
  const primeiro = Number(inicioEfetivo.slice(0, 4));
  const ultimo = Number(periodo.fim.slice(0, 4));
  const anos: EntradaCalculo['periodos'][number]['anos'] = [];
  for (let ano = primeiro; ano <= ultimo; ano += 1) {
    const ajuste = periodo.anos.find((item) => item.ano === ano);
    anos.push({
      ano,
      abrangencia: ajuste?.abrangencia ?? 'ano_civil',
      faltas: ajuste?.faltas ?? 0,
      ts: ajuste?.ts ?? 0,
      pf: ajuste?.pf ?? 0,
      ip: ajuste?.ip ?? 0,
      outros: ajuste?.outros ?? 0,
      pb: ajuste?.pb ?? 0,
      pv: ajuste?.pv ?? 0,
      licencaPremio: ajuste?.licencaPremio ?? 0,
    });
  }
  return { inicio: periodo.inicio, fim: periodo.fim, anos, acumuladoAnterior: periodo.acumuladoAnterior };
}

function entradaCaso(caso: z.infer<typeof casoMotorSchema>): EntradaCalculo {
  return {
    tipo: caso.tipo,
    posse: caso.posse,
    dataReferencia: caso.dataReferencia,
    periodos: caso.periodos.map((periodo) => gerarAnos(caso.posse, periodo)),
    regras: REGRAS_PLANILHA,
  };
}

function ordemDeclaracao(linhas: string[]): string[] {
  return linhas.map((linha) => {
    if (linha.startsWith('- Tempo de efetivo exercício:')) return 'efetivo';
    if (linha.startsWith('- Tempo de contribuição ao município:')) return 'municipio';
    if (linha.startsWith('- Incorporação de PV-PB:')) return 'pb_pv';
    if (linha.startsWith('- Incorporação de LICENÇA-PRÊMIO:')) return 'licenca_premio';
    if (linha.startsWith('- Tempo total de contribuição:')) return 'total';
    throw new Error('Linha de declaração não reconhecida.');
  });
}

describe('casos dourados de cálculo', () => {
  it('inclui todos os códigos obrigatórios nos arquivos JSON', () => {
    const codigos = new Set([
      ...casosConversao.map((caso) => caso.codigo),
      ...casosMotor.map((caso) => caso.codigo.replace(/-[a-d]$/, '')),
      casoVinculos.codigo,
    ]);
    expect([...codigos].sort()).toEqual([
      'GT-01', 'GT-02', 'GT-03', 'GT-04', 'GT-05', 'GT-06', 'GT-07', 'GT-08', 'GT-09', 'GT-10', 'GT-11', 'GT-REF',
    ]);
  });

  it.each(casosConversao)('$codigo converte e formata o tempo', (caso) => {
    expect(converterDias(caso.dias, REGRAS_PLANILHA)).toEqual(caso.esperado);
    expect(textoTempo(caso.dias, REGRAS_PLANILHA)).toBe(caso.texto);
  });

  it.each(casosMotor)('$codigo calcula os valores e condicionais esperados', (caso) => {
    const entrada = entradaCaso(caso);
    const resultado = calcular(entrada);
    if (!resultado.sucesso) throw new Error(JSON.stringify(resultado.erros));
    expect(calcular(entrada)).toEqual(resultado);
    expect(resultado.regras.classificacao).toBe('provisoria');
    expect(resultado.avisos.map((aviso) => aviso.codigo)).toContain('regra_provisoria');
    if (caso.esperado.totais) expect(resultado.totais).toMatchObject(caso.esperado.totais);
    if (caso.esperado.textoContribuicao) {
      expect(textoTempo(resultado.totais.contribuicaoMunicipio, resultado.regras)).toBe(caso.esperado.textoContribuicao);
    }
    if (caso.esperado.textoPeriodos) expect(textoPeriodos(resultado.periodos)).toBe(caso.esperado.textoPeriodos);
    if (caso.esperado.quantidadeLinhas) expect(resultado.periodos[0].linhas).toHaveLength(caso.esperado.quantidadeLinhas);
    if (caso.esperado.inicioEfetivo) expect(resultado.periodos[0].inicioEfetivo).toBe(caso.esperado.inicioEfetivo);
    for (const aviso of caso.esperado.avisos ?? []) {
      expect(resultado.avisos.map((item) => item.codigo)).toContain(aviso);
    }
    for (const linha of caso.esperado.linhas ?? []) {
      const { periodo, ...esperado } = linha;
      const calculada = resultado.periodos.find((item) => item.ordem === periodo)?.linhas.find((item) => item.ano === linha.ano);
      expect(calculada).toMatchObject(esperado);
    }
    for (const periodo of caso.esperado.periodos ?? []) {
      const calculado = resultado.periodos.find((item) => item.ordem === periodo.ordem);
      expect(calculado).toMatchObject({
        ordem: periodo.ordem,
        excessoTs: periodo.excessoTs,
        excessoPf: periodo.excessoPf,
        totais: { efetivoExercicio: periodo.efetivoExercicio },
        aplicacaoExcessos: 'total_periodo',
      });
    }
    const declaracao = linhasDeclaracaoDof(resultado.totais, resultado.regras);
    if (caso.esperado.declaracao) expect(declaracao).toEqual(caso.esperado.declaracao);
    if (caso.esperado.ordemDeclaracao) expect(ordemDeclaracao(declaracao)).toEqual(caso.esperado.ordemDeclaracao);
  });

  it('GT-08 rejeita matrícula inexistente e preserva a ligação anterior', () => {
    expect(localizarVinculo({ matricula: casoVinculos.matriculaInexistente, vinculos: casoVinculos.vinculos }))
      .toEqual({ sucesso: false, codigo: 'matricula_incorreta', mensagem: 'Matrícula incorreta' });
    const resultado = localizarVinculo({ matricula: casoVinculos.matriculaAtual, vinculos: casoVinculos.vinculos });
    if (!resultado.sucesso) throw new Error(resultado.mensagem);
    expect(resultado.historico.map((vinculo) => vinculo.id)).toEqual(casoVinculos.vinculos.map((vinculo) => vinculo.id));
    expect(resultado.atual.matriculaAnteriorId).toBe(casoVinculos.vinculos[0].id);
  });
});

function entradaSimples(inicio: string, fim: string): EntradaCalculo {
  return {
    tipo: 'DOF',
    posse: inicio,
    dataReferencia: fim,
    periodos: [gerarAnos(inicio, { inicio, fim, anos: [] })],
    regras: REGRAS_PLANILHA,
  };
}

describe('fronteiras e segurança do cálculo', () => {
  it('disponibiliza o pacote para o processo Node do servidor', () => {
    const require = createRequire(import.meta.url);
    const pacote: typeof import('../packages/calculo/dist/index.js') = require('@sisdoc/calculo');
    expect(pacote.converterDias(1311, pacote.REGRAS_PLANILHA)).toEqual({ anos: 3, meses: 7, dias: 6 });
  });

  it('não reinicia acumuladores nem aplica valores anuais a intervalo parcial sem confirmação', () => {
    const entrada = entradaSimples('2024-01-01', '2024-01-02');
    entrada.posse = '2020-01-01';
    expect(calcular(entrada)).toMatchObject({ sucesso: false, erros: [{ codigo: 'acumulado_anterior_necessario' }] });
    entrada.periodos[0].acumuladoAnterior = { ts: 729, pf: 180, origem: 'Histórico sintético conferido' };
    entrada.periodos[0].anos[0].ts = 1;
    entrada.periodos[0].anos[0].pf = 1;
    expect(calcular(entrada)).toMatchObject({ sucesso: false, erros: [{ codigo: 'ano_parcial_nao_confirmado' }] });
    entrada.periodos[0].anos[0].abrangencia = 'intervalo_declarado';
    const resultado = calcular(entrada);
    expect(resultado).toMatchObject({
      sucesso: true,
      totais: { diasBrutos: 2, contribuicaoMunicipio: 2, efetivoExercicio: 1 },
      periodos: [{ excessoTs: 0, excessoPf: 1 }],
    });
  });

  it('recusa acumulados anteriores maiores que o tempo decorrido desde a posse', () => {
    const entrada = entradaSimples('2024-01-01', '2024-12-31');
    entrada.posse = '2023-01-01';
    entrada.periodos[0].acumuladoAnterior = { ts: 365, pf: 1, origem: 'Histórico sintético' };
    expect(calcular(entrada)).toMatchObject({ sucesso: false, erros: [{ codigo: 'acumulado_inconsistente' }] });
  });

  it('retorna aviso e erro para afastamentos impossíveis, sem produzir resultado negativo', () => {
    const entrada = entradaSimples('2024-01-01', '2024-12-31');
    entrada.periodos[0].anos[0].ts = 366;
    entrada.periodos[0].anos[0].faltas = 1;
    expect(calcular(entrada)).toMatchObject({
      sucesso: false,
      avisos: expect.arrayContaining([expect.objectContaining({ codigo: 'deducoes_excedem_dias', ano: 2024 })]),
      erros: [{ codigo: 'afastamentos_excedem_dias' }],
    });
  });

  it('respeita os parâmetros versionados e não aceita uma marca de aprovação arbitrária', () => {
    const entrada = entradaSimples('2024-01-01', '2024-12-31');
    entrada.periodos[0].anos[0].ts = 2;
    entrada.periodos[0].anos[0].pf = 2;
    entrada.regras = { ...REGRAS_PLANILHA, limiteTs: 1, limitePf: 1, pfEntraNaSoma: false };
    expect(calcular(entrada)).toMatchObject({
      sucesso: true,
      totais: { diasBrutos: 366, contribuicaoMunicipio: 366, efetivoExercicio: 365 },
      periodos: [{ excessoTs: 1, excessoPf: 0 }],
    });
    expect(calcular({ ...entrada, regras: { ...entrada.regras, classificacao: 'aprovada' } }))
      .toMatchObject({ sucesso: false, erros: [{ codigo: 'entrada_invalida' }] });
  });

  it('aceita um único dia inclusivo, rejeita datas futuras e detecta estouro numérico', () => {
    const entrada = entradaSimples('2024-02-29', '2024-02-29');
    expect(calcular(entrada)).toMatchObject({ sucesso: true, totais: { diasBrutos: 1 } });
    expect(calcular({ ...entrada, dataReferencia: '2024-02-28' }))
      .toMatchObject({ sucesso: false, erros: [{ codigo: 'datas_invalidas' }] });
    entrada.periodos[0].anos[0].pb = Number.MAX_SAFE_INTEGER;
    entrada.periodos[0].anos[0].abrangencia = 'intervalo_declarado';
    expect(calcular(entrada)).toMatchObject({ sucesso: false, erros: [{ codigo: 'limite_numerico' }] });
  });

  it('conta corretamente os séculos não bissextos e os limites das datas suportadas', () => {
    expect(diasInclusivos('1899-12-31', '1900-03-01')).toBe(61);
    expect(diasInclusivos('1999-12-31', '2000-03-01')).toBe(62);
    expect(diasInclusivos('0001-01-01', '9999-12-31')).toBe(3652059);
    expect(() => diasEntre('2024-01-02', '2024-01-01')).toThrow('data final');
  });

  it('calcula incorporações somente com convenção e origem explícitas', () => {
    const intervalo = { inicio: '2024-01-01', fim: '2024-01-31' };
    expect(calcularIncorporacao({ forma: 'intervalo', tipo: 'PB', intervalo, convencao: 'exclusivo', origem: 'Sintética' }))
      .toEqual({ dias: 30, origem: 'Sintética', convencao: 'exclusivo' });
    expect(calcularIncorporacao({ forma: 'intervalo', tipo: 'PB', intervalo, convencao: 'inclusivo', origem: 'Sintética' }))
      .toEqual({ dias: 31, origem: 'Sintética', convencao: 'inclusivo' });
    expect(() => calcularIncorporacao({ forma: 'intervalo', tipo: 'PB', intervalo, origem: 'Sintética' })).toThrow();
    const entrada = entradaSimples('2024-01-01', '2024-12-31');
    expect(calcular(entrada)).toMatchObject({ sucesso: true, totais: { totalContribuicao: 366, pb: 0 } });
  });

  it('distribui intervalos exatos por ano sem ratear totais anuais', () => {
    expect(distribuirAfastamento({
      forma: 'intervalo', tipo: 'licenca_ts', intervalo: { inicio: '2020-12-30', fim: '2021-01-02' },
    })).toEqual([
      { ano: 2020, tipo: 'licenca_ts', inicio: '2020-12-30', fim: '2020-12-31', dias: 2, abrangencia: 'intervalo_declarado' },
      { ano: 2021, tipo: 'licenca_ts', inicio: '2021-01-01', fim: '2021-01-02', dias: 2, abrangencia: 'intervalo_declarado' },
    ]);
    expect(distribuirAfastamento({ forma: 'anual', tipo: 'falta', ano: 2020, dias: 3 }))
      .toEqual([{ ano: 2020, tipo: 'falta', dias: 3, abrangencia: 'ano_civil' }]);
  });

  it('preserva pontuação, pluralização e avisos de referência', () => {
    expect(textoPeriodos([])).toBe('');
    expect(textoTempo(0, REGRAS_PLANILHA)).toBe('');
    expect(textoTempo(1, REGRAS_PLANILHA)).toBe('1 dias, que correspondem a 01 dia.');
    expect(textoTempo(30, REGRAS_PLANILHA)).toBe('30 dias, que correspondem a 01 mês');
    expect(textoTempo(365, REGRAS_PLANILHA)).toBe('365 dias, que correspondem a 01 ano');
    expect(textoTempo(395, REGRAS_PLANILHA)).toBe('395 dias, que correspondem a 01 ano e 01 mês');
    expect(nivelDof('PNS-D')).toEqual({ nivel: 'PNS', avisos: [] });
    expect(nivelDof('DAI1')).toEqual({ nivel: '', avisos: [] });
    expect(nivelDof('UNICA')).toEqual({ nivel: '', avisos: ['Referência sem hífen; confira o nível.'] });
    const zero: TotaisCalculo = {
      diasBrutos: 0, contribuicaoMunicipio: 0, efetivoExercicio: 0,
      totalContribuicao: 10, pb: 10, pv: 0, licencaPremio: 0,
    };
    expect(ordemDeclaracao(linhasDeclaracaoDof(zero, REGRAS_PLANILHA))).toEqual(['pb_pv']);
  });

  it('recusa históricos incompletos, ciclos e matrículas ambíguas', () => {
    const base = casoVinculos.vinculos;
    const atual = base[1];
    expect(localizarVinculo({ matricula: atual.matricula, vinculos: [atual] }))
      .toMatchObject({ sucesso: false, codigo: 'historico_inconsistente' });
    expect(localizarVinculo({
      matricula: atual.matricula,
      vinculos: [{ ...base[0], matriculaAnteriorId: atual.id }, atual],
    })).toMatchObject({ sucesso: false, codigo: 'historico_inconsistente' });
    expect(localizarVinculo({
      matricula: atual.matricula,
      vinculos: [...base, { ...atual, id: '00000000-0000-4000-8000-000000000003', sistemaOrigem: 'outra-origem' }],
    })).toMatchObject({ sucesso: false, codigo: 'matricula_ambigua' });
    expect(localizarVinculo({
      matricula: atual.matricula,
      sistemaOrigem: 'origem-sintetica',
      vinculos: [...base, { ...atual, id: '00000000-0000-4000-8000-000000000003', sistemaOrigem: 'outra-origem' }],
    })).toMatchObject({ sucesso: true, atual: { id: atual.id } });
    expect(localizarVinculo({
      matricula: atual.matricula,
      vinculos: [{ ...base[0], pessoaId: '00000000-0000-4000-8000-000000000011' }, atual],
    })).toMatchObject({ sucesso: false, codigo: 'historico_inconsistente' });
  });
});

describe('propriedades com fast-check', () => {
  it('reconstrói os dias pela conversão comercial', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 3652059 }), (dias) => {
      const convertido = converterDias(dias, REGRAS_PLANILHA);
      expect(convertido.anos * 365 + convertido.meses * 30 + convertido.dias).toBe(dias);
      expect(convertido.dias).toBeGreaterThanOrEqual(0);
      expect(convertido.dias).toBeLessThan(30);
    }), { numRuns: 1000 });
  });

  it('soma todos os anos ao total inclusivo sem depender de fuso ou relógio', () => {
    const primeiroDia = Date.UTC(1900, 0, 1) / 86400000;
    const ultimoInicio = Date.UTC(2090, 0, 1) / 86400000;
    fc.assert(fc.property(
      fc.integer({ min: primeiroDia, max: ultimoInicio }),
      fc.integer({ min: 0, max: 3650 }),
      (dia, tamanho) => {
        const inicio = new Date(dia * 86400000).toISOString().slice(0, 10);
        const fim = new Date((dia + tamanho) * 86400000).toISOString().slice(0, 10);
        const resultado = calcular(entradaSimples(inicio, fim));
        if (!resultado.sucesso) throw new Error(JSON.stringify(resultado.erros));
        const soma = resultado.periodos.flatMap((periodo) => periodo.linhas)
          .reduce((total, linha) => total + linha.diasBrutos, 0);
        expect(diasInclusivos(inicio, fim)).toBe(tamanho + 1);
        expect(soma).toBe(tamanho + 1);
        expect(resultado.totais.diasBrutos).toBe(soma);
      },
    ), { numRuns: 500 });
  });

  it('mantém contribuição maior ou igual ao exercício nos perfis DOF e IPAM', () => {
    const linha = fc.record({
      ts: fc.integer({ min: 0, max: 330 }),
      pf: fc.integer({ min: 0, max: 20 }),
      faltas: fc.integer({ min: 0, max: 3 }),
      ip: fc.integer({ min: 0, max: 3 }),
      outros: fc.integer({ min: 0, max: 3 }),
    });
    fc.assert(fc.property(fc.array(linha, { minLength: 4, maxLength: 4 }), (linhas) => {
      for (const tipo of ['DOF', 'DTC_IPAM'] as const) {
        const entrada = entradaSimples('2017-01-01', '2020-12-31');
        entrada.tipo = tipo;
        entrada.periodos[0].anos = entrada.periodos[0].anos.map((ano, indice) => ({ ...ano, ...linhas[indice] }));
        const resultado = calcular(entrada);
        if (!resultado.sucesso) throw new Error(JSON.stringify(resultado.erros));
        expect(resultado.totais.contribuicaoMunicipio).toBeGreaterThanOrEqual(resultado.totais.efetivoExercicio);
        const bruto = resultado.periodos[0].linhas.reduce((soma: number, item: LinhaAnual) => soma + item.diasBrutos, 0);
        const diretas = linhas.reduce((soma, item) => soma + item.faltas + item.ip + item.outros, 0);
        const ts = linhas.reduce((soma, item) => soma + item.ts, 0);
        const pf = linhas.reduce((soma, item) => soma + item.pf, 0);
        expect(resultado.totais.contribuicaoMunicipio).toBe(bruto - diretas);
        expect(resultado.totais.efetivoExercicio)
          .toBe(bruto - diretas - Math.max(0, ts - 730) - Math.max(0, pf - 180));
      }
    }), { numRuns: 500 });
  });
});
