import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { ajustesCadastroSchema, aplicarAjustesCadastro, registroHistoricoSchema, somarValoresMonetarios,
  consultaHistoricoServidorSchema, filtrarHistorico, type RegistroHistorico } from '@sisdoc/contratos';
import { calcularPreviaDof } from '@sisdoc/calculo';
import { cpfSintetico } from './dados-sinteticos';

const carregar = createRequire(import.meta.url);
const { lerXmlImportacao, ErroXmlImportacao } = carregar('../apps/api/dist/importacao/xml.js') as typeof import('../apps/api/dist/importacao/xml.js');
const { lerPlanilha, escreverXlsx, listarAbasXlsx } = carregar('../apps/api/dist/importacao/planilhas.js') as typeof import('../apps/api/dist/importacao/planilhas.js');
const { analisarHistorico } = carregar('../apps/api/dist/servidores/importacao-historico.js') as typeof import('../apps/api/dist/servidores/importacao-historico.js');

export function pagamentoSintetico(): RegistroHistorico {
  return {
    grupo: 'financeiro', tipo: 'lancamento', situacao: 'pago', descricao: 'Pagamento inteiramente sintético',
    inicio: null, fim: null, aquisitivoInicio: null, aquisitivoFim: null, diasInformados: null, especieLicenca: null, ato: null,
    efeitoTempo: 'nao_informado', efeitoRemuneracao: 'nao_informado', competencia: '2024-01', competenciaOrigem: null,
    pagamento: '2024-01-31', rubrica: 'RUBRICA-FICTICIA', natureza: 'provento', valor: '1234.56', folha: 'normal',
    origem: 'fixture', idOrigem: 'PAGAMENTO-FICTICIO', eventoId: null, relacionadoId: null,
  };
}
describe('evolução local do Núcleo', () => {
  it('filtra histórico completo por competência, rubrica e intervalo sem inventar datas', () => {
    const consulta = consultaHistoricoServidorSchema.parse({ vinculoId: '00000000-0000-4000-8000-000000000001',
      grupo: 'financeiro', competenciaInicio: '2024-01', competenciaFim: '2024-02',
      inicio: '2024-01-15', fim: '2024-02-01', rubrica: 'ficticia' });
    const registro = pagamentoSintetico();
    expect(filtrarHistorico(registro, consulta)).toBe(true);
    for (const mudanca of [{ competencia: null }, { competencia: '2023-12' }, { rubrica: 'Outra' }, { pagamento: null }, { pagamento: '2024-02-02' }])
      expect(filtrarHistorico({ ...registro, ...mudanca }, consulta)).toBe(false);
    expect(consultaHistoricoServidorSchema.safeParse({ ...consulta, inicio: '2024-03-01' }).success).toBe(false);
    expect(consultaHistoricoServidorSchema.safeParse({ ...consulta, competenciaFim: '2023-12' }).success).toBe(false);
    const funcional = registroHistoricoSchema.parse({ ...registro, grupo: 'funcional', tipo: 'outro', situacao: 'informado',
      competencia: null, rubrica: null, natureza: null, valor: null, folha: null, pagamento: null, inicio: '2023-12-01', fim: '2024-01-20' });
    expect(filtrarHistorico(funcional, consultaHistoricoServidorSchema.parse({ vinculoId: consulta.vinculoId, inicio: '2024-01-01', fim: '2024-01-31' }))).toBe(true);
  });
  it('preserva a fonte e remove ajustes sem reaproveitar o valor ajustado', () => {
    const fonte = { nome: 'Nome sintético', matricula: 'FICTICIA', admissao: '1980-01-01', cpf: cpfSintetico(), nomeMae: 'Mãe sintética' };
    const ajustes = ajustesCadastroSchema.parse({ nome: 'Nome ajustado', nomeMae: null, cpf: cpfSintetico(123456780) });
    expect(aplicarAjustesCadastro(fonte, ajustes)).toMatchObject({ nome: 'Nome ajustado', nomeMae: null });
    expect(aplicarAjustesCadastro(fonte, {})).toEqual(fonte);
    expect(fonte.nome).toBe('Nome sintético');
    expect(aplicarAjustesCadastro({ nome: fonte.nome, matricula: fonte.matricula, admissao: fonte.admissao }, ajustes)).not.toHaveProperty('cpf');
    expect(ajustesCadastroSchema.safeParse({ cpf: '00000000000' }).success).toBe(false);
    expect(ajustesCadastroSchema.safeParse({ nome: '', admissao: null }).success).toBe(false);
  });
  it('usa admissão ajustada no motor compartilhado DOF', () => {
    const entrada = {
      pessoaId: '00000000-0000-4000-8000-000000000001', vinculoId: '00000000-0000-4000-8000-000000000002',
      inicio: '2024-01-01', fim: '2024-12-31', confirmacaoDados: true as const,
      ajustesCadastro: { admissao: '2024-02-01' },
      anos: [{ ano: 2024, abrangencia: 'intervalo_declarado' as const, faltas: 0, ts: 0, pf: 0, ip: 0, outros: 0, pb: 0, pv: 0, licencaPremio: 0 }],
    };
    const resultado = calcularPreviaDof(entrada, '1980-01-01', '2025-01-01');
    expect(resultado).toHaveProperty('resultado.admissaoConsiderada', '2024-02-01');
  });
  it('soma centavos exatamente e valida pagamento, estorno e retroativo', () => {
    expect(somarValoresMonetarios(['0.10', '0.20', '9999999999999.99'])).toBe('10000000000000.29');
    expect(() => somarValoresMonetarios(['1.001'])).toThrow();
    const pagamento = pagamentoSintetico();
    expect(registroHistoricoSchema.safeParse(pagamento).success).toBe(true);
    for (const mudanca of [{ valor: '1,00' }, { pagamento: null }, { folha: 'retroativa' }, { situacao: 'estornado' }, { inicio: '2024-01-01' }]) {
      expect(registroHistoricoSchema.safeParse({ ...pagamento, ...mudanca }).success).toBe(false);
    }
    expect(registroHistoricoSchema.safeParse({ ...pagamento, folha: 'retroativa', competenciaOrigem: '2023-12' }).success).toBe(true);
  });
  it('distingue férias, licença e pagamentos sem inferir direitos', () => {
    const funcional = { ...pagamentoSintetico(), grupo: 'funcional', tipo: 'ferias', situacao: 'gozado',
      inicio: '2024-01-01', fim: '2024-01-15', aquisitivoInicio: '2023-01-01', aquisitivoFim: '2023-12-31',
      valor: null, natureza: null, rubrica: null, pagamento: null, competencia: null, folha: null };
    expect(registroHistoricoSchema.safeParse(funcional).success).toBe(true);
    expect(registroHistoricoSchema.safeParse({ ...funcional, fim: '2023-12-31' }).success).toBe(false);
    expect(registroHistoricoSchema.safeParse({ ...funcional, aquisitivoFim: null }).success).toBe(false);
    expect(registroHistoricoSchema.safeParse({ ...funcional, tipo: 'licenca', especieLicenca: null }).success).toBe(false);
  });
  it('lê XML versionado e namespace sem perder campos opcionais ou entidades internas padrão', () => {
    const xml = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><sisdoc xmlns="urn:sisdoc:importacao:1" versao="1"><registro><NOME>A &amp; B</NOME><CARGO><![CDATA[<Cargo>]]></CARGO></registro><registro><NOME>C</NOME></registro></sisdoc>');
    expect(lerXmlImportacao(xml).linhas).toEqual([['NOME', 'CARGO'], ['A & B', '<Cargo>'], ['C', '']]);
    expect(lerPlanilha(Buffer.from(`\uFEFF${' '.repeat(512)}${xml.toString().replace(/<\?xml[^?]*\?>/, '')}`)).linhas).toHaveLength(3);
  });
  it.each([
    '<sisdoc versao="2"><registro><A>x</A></registro></sisdoc>',
    '<sisdoc versao="1"><registro><A>x</A><A>y</A></registro></sisdoc>',
    '<sisdoc versao="1"><registro><A><B>x</B></A></registro></sisdoc>',
    '<sisdoc versao="1"><registro/></sisdoc>',
    '<sisdoc versao="1"><registro><A>x</registro></sisdoc>',
    '<!DOCTYPE sisdoc [<!ENTITY x SYSTEM "file:///nao-existe">]><sisdoc versao="1"><registro><A>&x;</A></registro></sisdoc>',
    '<sisdoc xmlns="urn:desconhecido" versao="1"><registro><A>x</A></registro></sisdoc>',
    '<?instrucao proibida?><sisdoc versao="1"><registro><A>x</A></registro></sisdoc>',
    `<sisdoc versao="1"><registro><A>${'x'.repeat(8001)}</A></registro></sisdoc>`,
  ])('recusa XML incompatível/hostil sem acessar recursos externos (%#)', (xml) => {
    expect(() => lerXmlImportacao(Buffer.from(xml))).toThrow(ErroXmlImportacao);
  });
  it('recusa UTF-8 inválido e excesso de campos', () => {
    expect(() => lerXmlImportacao(Buffer.from([0xff]))).toThrow(ErroXmlImportacao);
    expect(() => lerXmlImportacao(Buffer.from(`<sisdoc versao="1"><registro>${Array.from({ length: 257 }, (_, i) => `<C${i}>x</C${i}>`).join('')}</registro></sisdoc>`))).toThrow(ErroXmlImportacao);
  });
  it('seleciona a aba exata e não usa fallback para uma relação inválida', () => {
    const arquivo = escreverXlsx([['NOME'], ['Nome sintético']], 'Cadastro');
    expect(listarAbasXlsx(arquivo)).toEqual(['Cadastro']);
    expect(lerPlanilha(arquivo, 'Cadastro').linhas[1]).toEqual(['Nome sintético']);
    expect(() => lerPlanilha(arquivo, 'Outra')).toThrow();
    const danificado = Buffer.from(arquivo.toString('latin1').replace('r:id="rId1"', 'r:id="rId9"'), 'latin1');
    expect(() => lerPlanilha(danificado, 'Cadastro')).toThrow();
  });
  it('valida importação histórica canônica, rejeita duplicatas e preserva valores decimais', () => {
    const campos = ['GRUPO', 'TIPO', 'SITUACAO', 'DESCRICAO', 'COMPETENCIA', 'RUBRICA', 'NATUREZA', 'VALOR', 'FOLHA', 'IDORIGEM'];
    const linha = ['financeiro', 'lancamento', 'informado', 'Sintético', '2024-01', 'FICTICIA', 'provento', '0.10', 'normal', 'ID-1'];
    const analise = analisarHistorico([campos, linha, linha, [...linha.slice(0, 7), '0,10', 'normal', 'ID-2']], 'fixture');
    expect(analise.registros).toHaveLength(1);
    expect(analise.registros[0].registro.valor).toBe('0.10');
    expect(analise.ocorrencias).toHaveLength(2);
    expect(() => analisarHistorico([['TIPO', 'tipo']], 'fixture')).toThrow();
    expect(() => analisarHistorico([['desconhecido']], 'fixture')).toThrow();
  });
});
