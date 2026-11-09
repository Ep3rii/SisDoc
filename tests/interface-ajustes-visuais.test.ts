import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { preview, type PreviewServer } from 'vite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { CSP_APLICACAO } from '../apps/api/dist/aplicacao.js';
import { simular } from './visual/fixtures';

let navegador: Browser;
let servidor: PreviewServer;
let endereco: string;
beforeAll(async () => {
  servidor = await preview({ configFile: false, root: path.join(process.cwd(), 'apps', 'web'),
    logLevel: 'silent', preview: { host: '127.0.0.1', port: 0, strictPort: true,
      headers: { 'Content-Security-Policy': CSP_APLICACAO } } });
  const porta = servidor.httpServer.address();
  if (!porta || typeof porta === 'string') throw new Error('Preview fictício indisponível');
  endereco = `http://127.0.0.1:${porta.port}/`;
  navegador = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await navegador?.close();
  if (servidor) await new Promise<void>((resolve, reject) =>
    servidor.httpServer.close((erro) => erro ? reject(erro) : resolve()));
});

it('centraliza o olho no campo, bloqueia clipboard e mantém mensagem abaixo do cabeçalho', async () => {
  const pagina = await navegador.newPage({ viewport: { width: 1366, height: 768 } });
  const mock = await simular(pagina, { perfil: 'sem-login', estado: 'dados',
    viewport: { width: 1366, height: 768 }, zoom: 100 });
  try {
    await pagina.goto(endereco);
    await pagina.getByLabel('Senha', { exact: true }).fill('SenhaFicticia!123');
    await pagina.getByRole('button', { name: 'Mostrar senha', exact: true }).click();
    expect(await pagina.getByLabel('Senha', { exact: true }).getAttribute('type')).toBe('text');
    await pagina.getByLabel('Matrícula', { exact: true }).fill('FICTICIO');
    await pagina.getByRole('button', { name: 'Entrar', exact: true }).click();
    await pagina.getByRole('alert').waitFor();
    await pagina.screenshot({ path: path.join(process.env.SISDOC_TEST_TEMP!, 'sisdoc-login-ajustes.png') });
    for (const largura of [1366, 768, 390]) {
      await pagina.setViewportSize({ width: largura, height: 768 });
      const medidas = await pagina.evaluate(() => {
        const campo = document.querySelector<HTMLInputElement>('.campo-senha input');
        const olho = document.querySelector('.campo-senha-botao');
        const aviso = document.querySelector('[role="alert"]');
        const cabecalho = document.querySelector('header');
        const login = document.querySelector('.login');
        if (!campo || !olho || !aviso || !cabecalho || !login) throw new Error('Login incompleto');
        const c = campo.getBoundingClientRect(), o = olho.getBoundingClientRect();
        return { centro: Math.abs(c.y + c.height / 2 - o.y - o.height / 2),
          avisoAbaixo: aviso.getBoundingClientRect().top - cabecalho.getBoundingClientRect().bottom,
          centralizado: Math.abs(login.getBoundingClientRect().x + login.getBoundingClientRect().width / 2 - innerWidth / 2),
          clipboard: ['copy', 'paste', 'cut', 'drop'].map((tipo) => {
            const evento = new Event(tipo, { bubbles: true, cancelable: true });
            campo.dispatchEvent(evento); return evento.defaultPrevented;
          }), overflow: document.documentElement.scrollWidth - innerWidth };
      });
      expect(medidas.centro).toBeLessThanOrEqual(1);
      expect(medidas.avisoAbaixo).toBeLessThanOrEqual(32);
      expect(medidas.avisoAbaixo).toBeGreaterThanOrEqual(0);
      expect(medidas.centralizado).toBeLessThanOrEqual(1);
      expect(medidas.clipboard).toEqual([true, true, true, true]);
      expect(medidas.overflow).toBeLessThanOrEqual(0);
    }
    expect(mock.inesperadas).toEqual([]);
  } finally { await pagina.close(); mock.liberar(); }
});

it('mostra salvar rascunho desde a abertura do cálculo sem conceder criação ao admin', async () => {
  for (const perfil of ['analista', 'admin'] as const) {
    const pagina = await navegador.newPage({ viewport: { width: 1366, height: 768 } });
    const mock = await simular(pagina, { perfil, estado: 'dados',
      viewport: { width: 1366, height: 768 }, zoom: 100 });
    try {
      await pagina.goto(`${endereco}#/inicio`);
      await pagina.getByRole('button', { name: /^Ver vínculos/ }).first().click();
      await pagina.locator('.ficha-vinculo button').first().click();
      await pagina.getByRole('heading', { name: /^DOF —/ }).waitFor();
      await pagina.screenshot({ path: path.join(process.env.SISDOC_TEST_TEMP!, `sisdoc-salvar-${perfil}.png`) });
      const salvar = pagina.getByRole('button', { name: 'Salvar rascunho', exact: true });
      if (perfil === 'analista') {
        expect(await salvar.isVisible()).toBe(true);
        expect(await salvar.isDisabled()).toBe(true);
        expect(await salvar.getAttribute('title')).toContain('Calcule');
      } else expect(await salvar.count()).toBe(0);
      expect(mock.inesperadas).toEqual([]);
    } finally { await pagina.close(); mock.liberar(); }
  }
});

it('posiciona o aviso de sessão encerrada abaixo do cabeçalho após sair', async () => {
  const pagina = await navegador.newPage({ viewport: { width: 1366, height: 768 } });
  const mock = await simular(pagina, { perfil: 'analista', estado: 'dados',
    viewport: { width: 1366, height: 768 }, zoom: 100 });
  await pagina.route('**/api/v1/auth/logout', (rota) => rota.fulfill({
    status: 200, contentType: 'application/json', body: '{"encerrada":true}' }));
  try {
    await pagina.goto(endereco);
    await pagina.getByRole('button', { name: 'Sair', exact: true }).click();
    const aviso = pagina.getByRole('status').filter({ hasText: 'Sessão encerrada.' });
    await aviso.waitFor();
    const header = await pagina.locator('header').boundingBox();
    const caixa = await aviso.boundingBox();
    if (!header || !caixa) throw new Error('Aviso ou cabeçalho indisponível');
    expect(caixa.y - header.y - header.height).toBeGreaterThanOrEqual(0);
    expect(caixa.y - header.y - header.height).toBeLessThanOrEqual(32);
    expect(await pagina.locator('.conteudo [role="status"]').count()).toBe(0);
    expect(mock.inesperadas).toEqual([]);
  } finally { await pagina.close(); mock.liberar(); }
});

it('mantém editor e prévia em metades iguais no desktop sem controles manuais retirados', async () => {
  const pagina = await navegador.newPage();
  const mock = await simular(pagina, { perfil: 'analista', estado: 'dados',
    viewport: { width: 1366, height: 768 }, zoom: 100 });
  try {
    await pagina.goto(`${endereco}#/dofs/rascunhos`);
    await pagina.locator('.linha-documento').first().click();
    await pagina.locator('.painel-previa iframe').waitFor();
    await pagina.screenshot({ path: path.join(process.env.SISDOC_TEST_TEMP!, 'sisdoc-editor-metades.png') });
    for (const largura of [1920, 1366, 1024, 768, 390]) {
      await pagina.setViewportSize({ width: largura, height: 900 });
      const editor = await pagina.locator('.editor-dof').boundingBox();
      const previa = await pagina.locator('.painel-previa').boundingBox();
      if (!editor || !previa) throw new Error('Editor ou prévia indisponível');
      if (largura > 900) {
        expect(Math.abs(editor.width - previa.width)).toBeLessThanOrEqual(1);
        expect(previa.x).toBeGreaterThan(editor.x);
      } else expect(previa.y).toBeGreaterThanOrEqual(editor.y + editor.height);
      expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(await pagina.getByRole('button', { name: /Atualizar prévia|Ampliar prévia/ }).count()).toBe(0);
    expect(await pagina.getByLabel(/Largura do editor/).count()).toBe(0);
    expect(mock.inesperadas).toEqual([]);
  } finally { await pagina.close(); mock.liberar(); }
});
