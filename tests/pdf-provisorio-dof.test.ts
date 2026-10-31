import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  capturarDadosPdfProvisorioDof,
  dadosPdfProvisorioDofSchema,
  previaConferidaDofSchema,
  type DadosPdfProvisorioDof,
} from '@sisdoc/contratos';
import { renderizarPreviaDof } from '@sisdoc/templates';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderizarPdfProvisorioDof } from '../apps/api/dist/documentos/pdf-provisorio-dof.js';
import { cpfSintetico } from './dados-sinteticos.js';
import { resultadoDofSintetico } from './dof-sintetica.js';

type ItemTexto = { texto: string; x: number; y: number; largura: number; altura: number };
type PaginaPdf = { largura: number; altura: number; itens: ItemTexto[]; texto: string };

function previaSintetica() {
  const documentoId = randomUUID();
  return previaConferidaDofSchema.parse({
    documentoId, revisao: 2, status: 'conferido',
    nome: 'Pessoa fictícia <img src=x>', matricula: 'FICTICIA-1',
    resultado: resultadoDofSintetico(),
    blocos: [
      { id: randomUUID(), codigo: 'contratacao', ativo: true, texto: 'Linha fictícia para {{nome}}.\nOutra linha.' },
      { id: randomUUID(), codigo: 'complementares', ativo: false, texto: 'BLOCO-INATIVO-FICTICIO' },
    ],
    processo: 'FICTICIO-1',
    fonte: {
      documentoId, revisao: 2, provaFonte: 'a'.repeat(64), consultadoEm: '2026-01-01T12:00:00.000Z',
      nome: 'Pessoa fictícia <img src=x>', matricula: 'FICTICIA-1', cpf: cpfSintetico(),
      nascimento: '1950-05-04', nomeMae: 'Mãe fictícia <script>fictício</script>',
      regimeJuridico: 'ESTATUTARIO', cargo: 'Cargo fictício', nivel: 'A',
      avisoNivel: null, referencia: 'A-1', orgao: 'Órgão fictício',
      admissao: '1980-01-01', removidoNaFonte: false,
    },
    fonteSelecionadaAlterada: false,
  });
}

async function lerPaginas(pdf: Buffer): Promise<PaginaPdf[]> {
  const tarefa = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, verbosity: 0 });
  try {
    const documento = await tarefa.promise;
    const paginas: PaginaPdf[] = [];
    for (let numero = 1; numero <= documento.numPages; numero += 1) {
      const pagina = await documento.getPage(numero);
      const viewport = pagina.getViewport({ scale: 1 });
      const conteudo = await pagina.getTextContent();
      const itens = conteudo.items.flatMap((item) => 'str' in item ? [{
        texto: item.str, x: item.transform[4], y: item.transform[5], largura: item.width, altura: item.height,
      }] : []);
      paginas.push({
        largura: viewport.width, altura: viewport.height, itens,
        texto: itens.map((item) => item.texto).join(' ').replace(/\s+/g, ' '),
      });
    }
    return paginas;
  } finally {
    await tarefa.destroy();
  }
}

function conferirGeometria(paginas: PaginaPdf[]) {
  for (const [indice, pagina] of paginas.entries()) {
    expect(Math.abs(pagina.largura - 595.28)).toBeLessThan(1);
    expect(Math.abs(pagina.altura - 841.89)).toBeLessThan(1);
    expect(pagina.texto).toContain('PRÉVIA PROVISÓRIA');
    expect(pagina.texto).toMatch(new RegExp(`Página\\s+${indice + 1}\\s+de\\s+${paginas.length}`));
    for (const item of pagina.itens.filter((elemento) => elemento.texto.trim())) {
      expect(item.x).toBeGreaterThanOrEqual(24.5);
      expect(item.x + item.largura).toBeLessThanOrEqual(pagina.largura - 24.5);
      expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.y + item.altura).toBeLessThanOrEqual(pagina.altura + 0.5);
    }
  }
}

describe('PDF provisório de DOF sem emissão', () => {
  let navegador: Browser;

  beforeAll(async () => {
    navegador = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    if (navegador) await navegador.close();
  });

  it('copia e valida os dados da prévia sem incorporar a prova da fonte', () => {
    const previa = previaSintetica();
    const dados = capturarDadosPdfProvisorioDof(previa);
    expect(dados.classificacao).toBe('provisorio');
    expect(dados.fonte).not.toHaveProperty('provaFonte');
    expect(dados).not.toHaveProperty('status');
    previa.fonte.nome = 'Nome alterado posteriormente';
    previa.resultado.periodo.linhas[0].ano = 1999;
    previa.blocos[0].texto = 'Texto alterado posteriormente';
    expect(dados.fonte.nome).toBe('Pessoa fictícia <img src=x>');
    expect(dados.resultado.periodo.linhas[0].ano).toBe(1980);
    expect(dados.blocos[0].texto).toContain('Linha fictícia');
    expect(dadosPdfProvisorioDofSchema.safeParse({ ...dados, classificacao: 'oficial' }).success).toBe(false);
    expect(dadosPdfProvisorioDofSchema.safeParse({ ...dados, matricula: 'OUTRA' }).success).toBe(false);
    expect(dadosPdfProvisorioDofSchema.safeParse({ ...dados, provaFonte: 'a'.repeat(64) }).success).toBe(false);
    expect(() => capturarDadosPdfProvisorioDof(previa)).toThrow();
    expect(renderizarPreviaDof({ ...dados, fonteSelecionadaAlterada: true }))
      .toContain('A pessoa ou o vínculo mudou após a conferência.');
  });

  it('gera A4 com tabela de 45 anos, cabeçalhos, páginas e conteúdo dentro das folhas', async () => {
    const previa = previaSintetica();
    previa.fonteSelecionadaAlterada = true;
    const dados = capturarDadosPdfProvisorioDof(previa);
    const pdf = await renderizarPdfProvisorioDof(navegador, dados);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const paginas = await lerPaginas(pdf);
    expect(paginas.length).toBeGreaterThan(1);
    conferirGeometria(paginas);
    const texto = paginas.map((pagina) => pagina.texto).join(' ');
    expect(texto).toContain('Pessoa fictícia <img src=x>');
    expect(texto).toContain('Mãe fictícia <script>fictício</script>');
    expect(texto).toContain('A pessoa ou o vínculo mudou após a conferência.');
    expect(texto).not.toContain('BLOCO-INATIVO-FICTICIO');
    expect(texto).not.toContain('a'.repeat(64));
    for (const linha of dados.resultado.periodo.linhas) {
      const ocorrencias = paginas.flatMap((pagina) =>
        pagina.itens.filter((item) => item.texto.trim() === String(linha.ano)).map((item) => ({ pagina, item })),
      );
      expect(ocorrencias, `Ano ${linha.ano}`).toHaveLength(1);
      const { pagina, item } = ocorrencias[0];
      expect(pagina.itens.some((elemento) => elemento.texto.trim() === 'Ano')).toBe(true);
      expect(item.y).toBeGreaterThan(44);
      expect(item.y + item.altura).toBeLessThan(pagina.altura - 44);
      const linhaImpressa = pagina.itens
        .filter((elemento) => Math.abs(elemento.y - item.y) < 1 && elemento.texto.trim())
        .flatMap((elemento) => elemento.texto.trim().split(/\s+/));
      expect(linhaImpressa, `Colunas de ${linha.ano}`).toEqual([
        linha.ano, linha.diasBrutos, linha.faltas, linha.ts, linha.pf, linha.ip, linha.outros,
        linha.contribuicao, linha.efetivoExercicio, linha.pb, linha.pv, linha.licencaPremio,
      ].map(String));
    }
    expect(navegador.contexts()).toHaveLength(0);
  });

  it('imprime os limites dos blocos sem perder conteúdo nem ultrapassar as folhas', async () => {
    const base = capturarDadosPdfProvisorioDof(previaSintetica());
    const dados: DadosPdfProvisorioDof = {
      ...base,
      blocos: Array.from({ length: 200 }, (_, indice) => {
        const prefixo = `BLOCO${String(indice).padStart(3, '0')}:`;
        return { id: randomUUID(), codigo: 'complementares', ativo: true, texto: prefixo + 'x'.repeat(100 - prefixo.length) };
      }),
    };
    expect(dados.blocos.reduce((total, bloco) => total + bloco.texto.length, 0)).toBe(20000);
    const paginas = await lerPaginas(await renderizarPdfProvisorioDof(navegador, dados));
    conferirGeometria(paginas);
    const texto = paginas.map((pagina) => pagina.texto).join(' ').replace(/\s+/g, '');
    for (let indice = 0; indice < 200; indice += 1) {
      const prefixo = `BLOCO${String(indice).padStart(3, '0')}:`;
      expect(texto).toContain(prefixo + 'x'.repeat(100 - prefixo.length));
    }
  });

  it('imprime dados longos como texto, sem executar código ou requisitar recursos', async () => {
    const abrirContexto = navegador.newContext.bind(navegador);
    const requisicoes: string[] = [];
    const espiao = vi.spyOn(navegador, 'newContext').mockImplementation(async (opcoes) => {
      const contexto = await abrirContexto(opcoes);
      contexto.on('request', (requisicao) => requisicoes.push(requisicao.url()));
      return contexto;
    });
    const previa = previaSintetica();
    previa.fonte.cargo = 'CARGO' + 'x'.repeat(1000);
    previa.blocos[0].texto = '<script>fetch("http://127.0.0.1:9/dados")</script><img src="http://127.0.0.1:9/imagem">';
    try {
      const pdf = await renderizarPdfProvisorioDof(navegador, capturarDadosPdfProvisorioDof(previa));
      const paginas = await lerPaginas(pdf);
      conferirGeometria(paginas);
      const texto = paginas.map((pagina) => pagina.texto).join(' ');
      expect(texto).toContain('fetch("http://127.0.0.1:9/dados")');
      expect(texto.replace(/\s+/g, '')).toContain('CARGO' + 'x'.repeat(1000));
      expect(requisicoes).toEqual([]);
      expect(navegador.contexts()).toHaveLength(0);
    } finally {
      espiao.mockRestore();
    }
  });

  it('isola o conteúdo de renderizações simultâneas', async () => {
    const previas = ['PESSOA-ALFA-FICTICIA', 'PESSOA-BETA-FICTICIA'].map((nome) => {
      const previa = previaSintetica();
      previa.nome = nome;
      previa.fonte.nome = nome;
      return previa;
    });
    const documentos = await Promise.all(previas.map((previa) =>
      renderizarPdfProvisorioDof(navegador, capturarDadosPdfProvisorioDof(previa)),
    ));
    for (const [indice, documento] of documentos.entries()) {
      const texto = (await lerPaginas(documento)).map((pagina) => pagina.texto).join(' ');
      expect(texto).toContain(previas[indice].nome);
      expect(texto).not.toContain(previas[1 - indice].nome);
    }
    expect(navegador.contexts()).toHaveLength(0);
  });

  it('encerra o contexto e preserva o erro quando o navegador falha', async () => {
    const abrirContexto = navegador.newContext.bind(navegador);
    const espiao = vi.spyOn(navegador, 'newContext').mockImplementation(async (opcoes) => {
      const contexto = await abrirContexto(opcoes);
      vi.spyOn(contexto, 'newPage').mockRejectedValueOnce(new Error('Falha sintética de página.'));
      return contexto;
    });
    try {
      await expect(renderizarPdfProvisorioDof(navegador, capturarDadosPdfProvisorioDof(previaSintetica())))
        .rejects.toThrow('Falha sintética de página.');
      expect(navegador.contexts()).toHaveLength(0);
    } finally {
      espiao.mockRestore();
    }
  });

  it('informa falhas simultâneas da renderização e do encerramento', async () => {
    const abrirContexto = navegador.newContext.bind(navegador);
    const espiao = vi.spyOn(navegador, 'newContext').mockImplementation(async (opcoes) => {
      const contexto = await abrirContexto(opcoes);
      const fecharContexto = contexto.close.bind(contexto);
      vi.spyOn(contexto, 'newPage').mockRejectedValueOnce(new Error('Falha sintética de página.'));
      vi.spyOn(contexto, 'close').mockImplementationOnce(async () => {
        await fecharContexto();
        throw new Error('Falha sintética de encerramento.');
      });
      return contexto;
    });
    try {
      await expect(renderizarPdfProvisorioDof(navegador, capturarDadosPdfProvisorioDof(previaSintetica())))
        .rejects.toMatchObject({
          name: 'AggregateError',
          errors: [{ message: 'Falha sintética de página.' }, { message: 'Falha sintética de encerramento.' }],
        });
      expect(navegador.contexts()).toHaveLength(0);
    } finally {
      espiao.mockRestore();
    }
  });

  it('mede 20 renderizações aquecidas de 45 anos sem incluir fila ou gravação', async () => {
    const dados = capturarDadosPdfProvisorioDof(previaSintetica());
    await renderizarPdfProvisorioDof(navegador, dados);
    const duracoes: number[] = [];
    for (let indice = 0; indice < 20; indice += 1) {
      const inicio = performance.now();
      const pdf = await renderizarPdfProvisorioDof(navegador, dados);
      duracoes.push(performance.now() - inicio);
      expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    }
    const ordenadas = [...duracoes].sort((a, b) => a - b);
    const mediana = (ordenadas[9] + ordenadas[10]) / 2;
    const p95 = ordenadas[18];
    const maximo = ordenadas[19];
    console.info(`PDF provisório aquecido, sem fila/gravação: mediana ${mediana.toFixed(1)} ms; p95 ${p95.toFixed(1)} ms; máximo ${maximo.toFixed(1)} ms.`);
    expect(maximo).toBeLessThan(5000);
  });
});
