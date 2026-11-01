import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { cpfSintetico } from './dados-sinteticos.js';

let browser: Browser;
let servidor: http.Server;
let origem: string;
const pessoaId = randomUUID();
const vinculoId = randomUUID();
const situacao = { configurada: false, ultimaSincronizacaoEm: null, horasDesdeUltima: null,
  limiteHoras: 24, avisoAtraso: false, disjuntorAberto: false };

beforeAll(async () => {
  const dist = path.resolve('apps', 'web', 'dist');
  servidor = http.createServer(async (req, res) => {
    const destino = path.resolve(dist, `.${new URL(req.url ?? '/', 'http://localhost').pathname === '/'
      ? `${path.sep}index.html` : new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\//g, path.sep)}`);
    if (!destino.startsWith(`${dist}${path.sep}`)) { res.writeHead(403).end(); return; }
    try {
      const arquivo = await readFile(destino);
      res.setHeader('Content-Type', destino.endsWith('.js') ? 'text/javascript' : destino.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(arquivo);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const endereco = servidor.address();
  if (!endereco || typeof endereco === 'string') throw new Error('Servidor de interface indisponível.');
  origem = `http://127.0.0.1:${endereco.port}`;
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  if (browser) await browser.close();
  if (servidor) await new Promise<void>((resolve, reject) => servidor.close((erro) => erro ? reject(erro) : resolve()));
});

async function simular(page: Page, papel: 'admin' | 'analista') {
  await page.route('**/api/v1/**', async (rota) => {
    const url = new URL(rota.request().url());
    const endpoint = url.pathname.replace('/api/v1/', '');
    let dados: unknown;
    if (endpoint === 'auth/me') dados = { usuario: { id: randomUUID(), matricula: 'FICTICIO', nome: 'Operador fictício', papel,
      trocaSenhaObrigatoria: false }, csrf: 'A'.repeat(43) };
    else if (endpoint === 'sincronizacao/situacao') dados = situacao;
    else if (endpoint === 'admin/sincronizacoes') dados = { situacao, falhasConsecutivas: 0, disjuntorAbertoAte: null, itens: [], proximoCursor: null };
    else if (endpoint === 'admin/importacoes') dados = { itens: [], proximoCursor: null };
    else if (endpoint === 'admin/importacoes/conferencia') dados = { origens: [], totais: { pessoas: 0, vinculos: 0 } };
    else if (endpoint === 'admin/importacoes/legado') dados = [];
    else if (endpoint === 'servidores') dados = { itens: [{ pessoaId, vinculoId, nome: 'Pessoa fictícia', cpf: cpfSintetico(), matricula: 'F-1',
      orgao: 'Setor fictício', sistemaOrigem: 'planilha', removidoNaFonte: false }], proximoCursor: null };
    else if (endpoint === `servidores/${pessoaId}`) dados = { pessoa: { id: pessoaId, nome: 'Pessoa fictícia', cpf: cpfSintetico() },
      vinculos: [{ id: vinculoId, matricula: 'F-1', sistemaOrigem: 'planilha', matriculaAnteriorId: null, regimeJuridico: 'ESTATUTARIO',
        cargo: 'Cargo fictício', classe: null, nivel: null, referencia: 'A-1', setor: null, orgao: null, admissao: '2000-01-01',
        desligamento: null, removidoNaFonte: false }], proximoCursor: null };
    else if (endpoint === `servidores/${pessoaId}/referencias`) dados = {
      pessoaId, vinculoId, revisaoPessoa: '1', revisaoVinculo: '1',
      cadastro: {
        nome: 'Pessoa fictícia', cpf: '52998224725', nascimento: null, nomeMae: null, nomePai: null,
        pisPasep: null, rgNumero: null, rgOrgao: null, rgExpedicao: null, tituloEleitor: null, endereco: null,
        matricula: 'F-1', regimeJuridico: null, cargo: null, classe: null, nivel: null, referencia: null,
        setor: null, orgaoCodigo: null, orgao: null, admissao: null, desligamento: null,
      },
      pessoa: { Nome: 'Pessoa fictícia', CPF: 'CPF fictício completo', RG: 'RG fictício' },
      registros: [{ id: randomUUID(), campos: { tipo: url.searchParams.get('tipo'), descricao: 'Referência fictícia' } }], proximoCursor: null };
    else {
      await rota.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: `Mock ausente: ${endpoint}` }) });
      return;
    }
    await rota.fulfill({ contentType: 'application/json', body: JSON.stringify(dados) });
  });
}

it('confere prévia completa, invalida mapeamento alterado e confirma conversão do legado', async () => {
  const page = await browser.newPage({ acceptDownloads: true });
  const loteId = randomUUID();
  const mapeamento = { MATRICULA: 0, NOME: 1, CPF: 2 };
  const modos: string[] = [];
  try {
    await simular(page, 'admin');
    await page.route('**/api/v1/admin/importacoes/legado', (rota) => rota.fulfill({
      contentType: 'application/json', body: JSON.stringify([{
        id: loteId, origem: 'legado-ficticio', cabecalhos: ['MATRICULA', 'NOME', 'CPF', 'FONTE'],
        linhas: 1, importadoEm: new Date().toISOString(),
      }]),
    }));
    await page.route('**/api/v1/admin/importacoes/legado/previa', (rota) => rota.fulfill({
      contentType: 'application/json', body: JSON.stringify({
        loteId, origem: 'legado-ficticio', tipo: 'dados_funcionais',
        cabecalhos: ['MATRICULA', 'NOME', 'CPF', 'FONTE'], linhas: 1,
        amostra: [['00002', 'PESSOA FICTICIA', '52998224725', 'metadado ficticio']],
        colunas: ['MATRICULA', 'NOME', 'CPF'], mapeamento,
      }),
    }));
    await page.route('**/api/v1/admin/importacoes/legado/promover', async (rota) => {
      const dados = rota.request().postDataJSON();
      modos.push(dados.modo);
      expect(dados.mapeamento).toEqual(mapeamento);
      if (dados.modo === 'gravar') expect(dados.validacao).toBe('1'.repeat(64));
      await rota.fulfill({ contentType: 'application/json', body: JSON.stringify({
        loteLegadoId: loteId, validacao: '1'.repeat(64),
        relatorio: {
          loteId: dados.modo === 'gravar' ? randomUUID() : null, loteExistente: null,
          tipo: 'dados_funcionais', origem: 'legado-ficticio', modo: dados.modo === 'gravar' ? 'gravacao' : 'validacao',
          contagens: { lidos: 1, validos: 1, rejeitados: 0, duplicados: 0, quarentena: 0, anomalias: 0, inseridos: 2, atualizados: 0, inalterados: 0 },
          ocorrencias: [], ocorrenciasOmitidas: 0, avisos: [], duracaoMs: 1,
        },
      }) });
    });
    await page.goto(origem);
    await page.getByRole('button', { name: /^Importação/ }).click();
    await page.getByLabel('Lote para disponibilizar').selectOption(loteId);
    await page.getByRole('heading', { name: /Prévia completa/ }).waitFor();
    expect(await page.getByRole('cell', { name: '52998224725', exact: true }).count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Aplicar no Núcleo', exact: true }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: 'Validar conversão', exact: true }).click();
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Aplicar no Núcleo')?.disabled);
    await page.getByRole('combobox', { name: 'Coluna de origem para CPF', exact: true }).selectOption('');
    expect(await page.getByRole('button', { name: 'Aplicar no Núcleo', exact: true }).isDisabled()).toBe(true);
    await page.getByRole('combobox', { name: 'Coluna de origem para CPF', exact: true }).selectOption('2');
    await page.getByRole('button', { name: 'Validar conversão', exact: true }).click();
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Aplicar no Núcleo')?.disabled);
    page.once('dialog', (dialog) => void dialog.dismiss());
    await page.getByRole('button', { name: 'Aplicar no Núcleo', exact: true }).click();
    expect(modos).toEqual(['validar', 'validar']);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Aplicar no Núcleo', exact: true }).click();
    await page.getByText('Conversão aplicada. Consulte os servidores por matrícula', { exact: false }).waitFor();
    expect(modos).toEqual(['validar', 'validar', 'gravar']);
  } finally { await page.close(); }
});

it('separa sincronização de importação/exportação e baixa dados mediante confirmação', async () => {
  const page = await browser.newPage({ acceptDownloads: true });
  try {
    await simular(page, 'admin');
    await page.goto(origem);
    const categorias = await page.locator('aside .grupo-menu').allTextContents();
    expect(categorias).toEqual(['Administração', 'Cadastro de pessoas', 'DOFs', 'DTCs', 'Documentos emitidos']);
    const menu = await page.locator('aside nav button').allTextContents();
    expect(menu.findIndex((texto) => texto === 'Usuários')).toBeLessThan(menu.findIndex((texto) => texto.includes('Buscar servidores')));
    expect(menu.filter((texto) => texto === 'Importação e exportação')).toHaveLength(1);
    await page.getByRole('button', { name: /^Sincronização/ }).click();
    await page.getByRole('heading', { name: 'Sincronização', exact: true }).waitFor();
    expect(await page.getByRole('heading', { name: 'Exportação de dados' }).count()).toBe(0);
    await page.getByRole('button', { name: /^Importação/ }).click();
    await page.getByRole('heading', { name: 'Exportação de dados', exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Validar arquivo' }).count()).toBe(1);
    let exportados: unknown;
    await page.route('**/api/v1/admin/importacoes/exportar', async (rota) => {
      exportados = rota.request().postDataJSON();
      expect(rota.request().headers()['x-csrf-token']).toBe('A'.repeat(43));
      await rota.fulfill({ status: 200, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: Buffer.from('arquivo fictício') });
    });

    page.once('dialog', (dialog) => void dialog.accept());
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar dados completos' }).click();
    expect((await download).suggestedFilename()).toBe('dados_funcionais-planilha.xlsx');
    expect(exportados).toEqual({ tipo: 'dados_funcionais', origem: 'planilha', formato: 'xlsx', afastamentos: 'anual' });
  } finally { await page.close(); }
});

it('seleciona legado na interface e valida/grava XLSX com cabeçalhos originais', async () => {
      const page = await browser.newPage();
      try {
        await simular(page, 'admin');
        await page.route('**/api/v1/admin/importacoes/legado', async (rota) => {
          await rota.fulfill({ contentType: 'application/json', body: '[]' });
        });
        const { escreverXlsx } = await import('../apps/api/dist/importacao/planilhas.js');
        const buffer = escreverXlsx([['Cabeçalho original', 'Código'], ['Pessoa fictícia', '0001']]);
        const modos: string[] = [];
        await page.route('**/api/v1/admin/importacoes?**', async (rota) => {
          if (rota.request().method() === 'GET') {
            await rota.fulfill({ contentType: 'application/json', body: JSON.stringify({ itens: [], proximoCursor: null }) });
            return;
          }
          const url = new URL(rota.request().url());
          expect(url.searchParams.get('destino')).toBe('legado');
          const modo = url.searchParams.get('modo');
          expect(rota.request().postDataBuffer()).toEqual(buffer);
          modos.push(modo ?? '');
          await rota.fulfill({ contentType: 'application/json', body: JSON.stringify({
            destino: 'legado', modo, cabecalhos: ['Cabeçalho original', 'Código'], linhas: 1,
            loteId: modo === 'gravar' ? randomUUID() : null, loteExistente: null,
          }) });
        });
        await page.goto(origem);
        await page.getByRole('button', { name: /^Importação/ }).click();
        await page.getByLabel('Schema de destino').selectOption('legado');
        expect(await page.getByLabel('Tipo de dado', { exact: true }).count()).toBe(0);
        await page.getByLabel('Arquivo', { exact: true }).setInputFiles({ name: 'dados-ficticios.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
        expect(await page.getByRole('button', { name: 'Gravar importação' }).isDisabled()).toBe(true);
        await page.getByRole('button', { name: 'Validar arquivo' }).click();
        await page.getByRole('heading', { name: 'Legado validado — nada foi gravado' }).waitFor();
        await page.getByText(/Cabeçalhos preservados: Cabeçalho original/).waitFor();
        page.once('dialog', (dialog) => void dialog.accept());
        await page.getByRole('button', { name: 'Gravar importação' }).click();
        await page.getByRole('heading', { name: 'Planilha no legado' }).waitFor();
        expect(modos).toEqual(['validar', 'gravar']);
        await page.getByLabel('Schema de destino').selectOption('nucleo');
        expect(await page.getByRole('button', { name: 'Gravar importação' }).isDisabled()).toBe(true);
      } finally { await page.close(); }
});

it('permite ao Cadastro consultar os dados completos e alternar as referências', async () => {
  const page = await browser.newPage();
  try {
    await simular(page, 'analista');
    await page.goto(origem);
    await page.getByRole('textbox', { name: 'Termo de busca' }).fill('Pessoa');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await page.getByRole('button', { name: /^Ver vínculos/ }).click();
    await page.getByLabel('Dados de referência do vínculo').selectOption(vinculoId);
    await page.getByText('CPF fictício completo', { exact: true }).waitFor();
    await page.getByLabel('Referências').selectOption('incorporacoes');
    await page.getByText('incorporacoes', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: /^Sincronização/ }).count()).toBe(0);
  } finally { await page.close(); }
});

it('lista vínculos previamente e solicita páginas de 50 sem ordenar somente na interface', async () => {
  const page = await browser.newPage();
  const itens = Array.from({ length: 52 }, (_, indice) => ({
    pessoaId, vinculoId: randomUUID(), nome: `Pessoa fictícia ${indice}`, cpf: cpfSintetico(indice + 910),
    matricula: indice === 2 ? '002' : String(indice), orgao: null, sistemaOrigem: 'fixture',
    removidoNaFonte: false,
  }));
  try {
    await simular(page, 'analista');
    await page.route('**/api/v1/servidores?**', async (rota) => {
      const query = new URL(rota.request().url()).searchParams;
      expect(query.get('limite')).toBe('50');
      expect(query.has('q')).toBe(false);
      expect(query.has('tipo')).toBe(false);
      const segunda = query.has('cursor');
      if (segunda) expect(query.get('cursor')).toBe(itens[49].vinculoId);
      await rota.fulfill({ contentType: 'application/json', body: JSON.stringify({
        itens: segunda ? itens.slice(50) : itens.slice(0, 50),
        proximoCursor: segunda ? null : itens[49].vinculoId,
      }) });
    });
    await page.goto(origem);
    await page.getByRole('button', { name: /^Ver vínculos/ }).first().waitFor();
    expect(await page.getByRole('button', { name: /^Ver vínculos/ }).count()).toBe(50);
    expect(await page.locator('tbody tr').nth(2).locator('td').nth(2).innerText()).toBe('002');
    expect(await page.locator('tbody tr').first().locator('td').nth(1).innerText()).toBe(itens[0].cpf);
    await page.getByRole('button', { name: 'Próxima página de resultados' }).click();
    await page.getByText('Pessoa fictícia 50', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: /^Ver vínculos/ }).count()).toBe(2);
    expect(await page.getByRole('button', { name: 'Próxima página de resultados' }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: 'Primeira página de resultados' }).click();
    await page.getByText('Pessoa fictícia 0', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: /^Ver vínculos/ }).count()).toBe(50);
  } finally { await page.close(); }
});
