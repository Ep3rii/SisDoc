import { randomUUID } from 'node:crypto';
import { calcular, linhasDeclaracaoDof, REGRAS_PLANILHA } from '@sisdoc/calculo';
import {
  atualizarBlocosDofSchema, dadosFontePreviaDofSchema, resultadoCalculoDofSchema, type BlocoRascunhoDof,
} from '@sisdoc/contratos';
import { analisarTextoDof, renderizarPreviaDof, verificarVariaveisDof } from '@sisdoc/templates';
import { describe, expect, it } from 'vitest';
import { cpfSintetico } from './dados-sinteticos.js';

function resultadoSintetico() {
  const calculo = calcular({
    tipo: 'DOF', posse: '1980-01-01', dataReferencia: '2026-01-01', regras: REGRAS_PLANILHA,
    periodos: [{
      inicio: '1980-01-01', fim: '2024-12-31',
      anos: Array.from({ length: 45 }, (_, indice) => ({
        ano: 1980 + indice, abrangencia: 'intervalo_declarado' as const,
        faltas: 0, ts: 0, pf: 0, ip: 0, outros: 0, pb: 0, pv: 0, licencaPremio: 0,
      })),
    }],
  });
  if (!calculo.sucesso) throw new Error('Cálculo sintético inválido.');
  const periodo = calculo.periodos[0];
  return resultadoCalculoDofSchema.parse({
    admissaoConsiderada: '1980-01-01',
    regra: { codigo: calculo.regras.codigo, versao: calculo.regras.versao, classificacao: calculo.regras.classificacao },
    periodo: {
      inicioInformado: periodo.inicioInformado, inicioEfetivo: periodo.inicioEfetivo,
      fim: periodo.fim, linhas: periodo.linhas,
    },
    totais: calculo.totais,
    declaracao: linhasDeclaracaoDof(calculo.totais, calculo.regras),
    avisos: calculo.avisos,
  });
}

describe('blocos e prévia provisória de DOF', () => {
  const bloco: BlocoRascunhoDof = { id: randomUUID(), codigo: 'contratacao', ativo: true, texto: 'Linha\nfictícia' };

  it('valida revisões, motivo, identificadores, caracteres e limites', () => {
    const dados = { revisao: 1, motivo: 'Ajuste fictício', blocos: [bloco] };
    expect(atualizarBlocosDofSchema.safeParse(dados).success).toBe(true);
    for (const invalido of [
      { ...dados, revisao: 0 },
      { ...dados, motivo: '  ' },
      { ...dados, status: 'emitido' },
      { ...dados, blocos: [bloco, bloco] },
      { ...dados, blocos: [{ ...bloco, codigo: 'texto_oficial' }] },
      { ...dados, blocos: [{ ...bloco, texto: 'início\u0000fim' }] },
      { ...dados, blocos: [{ ...bloco, texto: 'a'.repeat(8001) }] },
      {
        ...dados,
        blocos: Array.from({ length: 3 }, () => ({ ...bloco, id: randomUUID(), texto: 'a'.repeat(7000) })),
      },
      { ...dados, blocos: Array.from({ length: 201 }, () => ({ ...bloco, id: randomUUID() })) },
    ]) {
      expect(atualizarBlocosDofSchema.safeParse(invalido).success).toBe(false);
    }
    expect(atualizarBlocosDofSchema.safeParse({
      ...dados,
      blocos: Array.from({ length: 200 }, () => ({ ...bloco, id: randomUUID(), texto: 'á'.repeat(100) })),
    }).success).toBe(true);
  });

  it('escapa dados e variáveis, destaca ausências e omite blocos inativos sem perder anos', () => {
    const html = renderizarPreviaDof({
      nome: 'Pessoa <img src=x onerror=alert(1)>', matricula: 'FICTICIA&1', revisao: 3,
      resultado: resultadoSintetico(), processo: null,
      blocos: [
        { ...bloco, texto: '</style><script>alert(1)</script> {{nome}} {{cargo}} {{constructor}} {{inicio}}' },
        { id: randomUUID(), codigo: 'complementares', ativo: false, texto: 'INATIVO-SINTETICO {{ausente}}' },
      ],
    });
    expect(html).toContain('PRÉVIA PROVISÓRIA — SEM VALIDADE OFICIAL');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('&lt;/style&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Pessoa &lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('FICTICIA&amp;1');
    expect(html).toContain('<mark>Variável não disponível: cargo</mark>');
    expect(html).toContain('<mark>Variável não disponível: constructor</mark>');
    expect(html).toContain('01/01/1980');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('INATIVO-SINTETICO');
    expect(html).not.toContain('Variável não disponível: ausente');
    expect(html.match(/<tr>/g)).toHaveLength(46);
  });

  it('identifica expressões malformadas e variáveis ausentes somente em blocos ativos', () => {
    const dados = {
      nome: 'Pessoa fictícia', matricula: 'FICTICIA', processo: null, revisao: 1, resultado: resultadoSintetico(),
      blocos: [
        { ...bloco, texto: '{{nome}} {{ processo }} {{desconhecida}} {{}} {{a-b}} {{aberta' },
        { id: randomUUID(), codigo: 'complementares' as const, ativo: false, texto: '{{inativa}} }}' },
      ],
    };
    expect(verificarVariaveisDof(dados)).toEqual({ indisponiveis: ['desconhecida', 'processo'], malformadas: true });
    const html = renderizarPreviaDof(dados);
    expect(html).toContain('Pessoa fictícia');
    expect(html).toContain('Variável não disponível: processo');
    expect(html).toContain('Variável não disponível: desconhecida');
    expect(html).toContain('Expressão malformada: {{}}');
    expect(html).toContain('Expressão malformada: {{a-b}}');
    expect(html).toContain('Expressão malformada: {{aberta');
    expect(html).not.toContain('inativa');
    for (const texto of ['}}', '{{{nome}}}', '{{nome}}}', '{{a{{nome}}', '{{a}b}}', '{{']) {
      expect(analisarTextoDof(texto).some((parte) => parte.tipo === 'malformada')).toBe(true);
    }
    const texto = 'texto com { chaves simples } e {{ nome }}';
    const partes = analisarTextoDof(texto);
    expect(partes.map((parte) => parte.conteudo).join('')).toBe(texto);
    expect(partes.filter((parte) => parte.tipo === 'malformada')).toHaveLength(0);
    expect(verificarVariaveisDof({ ...dados, blocos: [{ ...bloco, ativo: false, texto: '{{faltando' }] }))
      .toEqual({ indisponiveis: [], malformadas: false });
  });

  it('exibe os campos consultados e escapa tanto a identidade como as variáveis', () => {
    const fonte = dadosFontePreviaDofSchema.parse({
      documentoId: randomUUID(), revisao: 3, provaFonte: 'a'.repeat(64), consultadoEm: '2026-01-01T12:00:00.000Z',
      nome: 'Pessoa <img src=x>', matricula: 'FICTICIA&1', cpf: cpfSintetico(),
      nascimento: '1960-05-04', nomeMae: 'Mãe <script>fictícia</script>',
      regimeJuridico: 'Regime fictício', cargo: 'Cargo <b>fictício</b>',
      nivel: null, avisoNivel: 'Referência sem hífen; confira o nível.', referencia: 'UNICA',
      orgao: 'Órgão & fictício', admissao: '1981-01-01', removidoNaFonte: true,
    });
    const dados = {
      nome: 'Nome anterior', matricula: 'ANTERIOR', revisao: 3, resultado: resultadoSintetico(), processo: null, fonte,
      blocos: [{ ...bloco, texto: '{{nome_mae}} {{cpf}} {{cargo}} {{nivel}} {{orgao}}' }],
    };
    const html = renderizarPreviaDof(dados);
    expect(html).not.toContain(fonte.provaFonte);
    expect(html).toContain('Pessoa &lt;img src=x&gt;');
    expect(html).toContain('Mãe &lt;script&gt;fictícia&lt;/script&gt;');
    expect(html).toContain('Cargo &lt;b&gt;fictício&lt;/b&gt;');
    expect(html).toContain('Órgão &amp; fictício');
    expect(html).toContain('04/05/1960');
    expect(html).toContain('Referência sem hífen; confira o nível.');
    expect(html).toContain('O vínculo está marcado como removido na fonte.');
    expect(html).toContain('A admissão atual difere da utilizada no cálculo');
    expect(html).toContain('Variável não disponível: nivel');
    expect(html).not.toContain('Nome anterior');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(verificarVariaveisDof(dados)).toEqual({ indisponiveis: ['nivel'], malformadas: false });
    expect(verificarVariaveisDof({ ...dados, fonte: { ...fonte, cargo: '   ' } }))
      .toEqual({ indisponiveis: ['cargo', 'nivel'], malformadas: false });
    expect(dadosFontePreviaDofSchema.safeParse({ ...fonte, dadoExtra: true }).success).toBe(false);
    expect(dadosFontePreviaDofSchema.safeParse({ ...fonte, cpf: '00000000000' }).success).toBe(false);
  });
});
