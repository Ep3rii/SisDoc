import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';

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
    else if (endpoint === 'servidores') dados = { itens: [{ pessoaId, vinculoId, nome: 'Pessoa fictícia', matricula: 'F-1',
      orgao: 'Setor fictício', sistemaOrigem: 'planilha', removidoNaFonte: false }], proximoCursor: null };
    else if (endpoint === `servidores/${pessoaId}`) dados = { pessoa: { id: pessoaId, nome: 'Pessoa fictícia', cpfMascarado: '***.***.123-**' },
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

it('separa sincronização de importação/exportação e baixa dados mediante confirmação', async () => {
  const page = await browser.newPage({ acceptDownloads: true });
  try {
    await simular(page, 'admin');
    await page.goto(origem);
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
