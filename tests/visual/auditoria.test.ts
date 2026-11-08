import fs from 'node:fs/promises';
import path from 'node:path';
import axe from 'axe-core';
import { chromium, type Browser } from 'playwright';
import { preview, type PreviewServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CSP_APLICACAO } from '../../apps/api/dist/aplicacao.js';
import { cenarios } from './cenarios';
import { simular } from './fixtures';
import type { ConfiguracaoVisual } from './tipos';

declare global { interface Window { axe: typeof axe } }

const raiz = path.join(process.cwd(), 'tests', 'visual');
const viewports = [
  { width: 1920, height: 1080 }, { width: 1366, height: 768 },
  { width: 1280, height: 720 }, { width: 1024, height: 768 },
];
type Registro = { tela: string; perfil: string; estado: string; viewport: string; zoom: number;
  captura: string; axe: string; problemas: string[]; erro?: string };
const registros: Registro[] = [];
let navegador: Browser;
let servidor: PreviewServer;
let endereco: string;
const fase = process.env.SISDOC_VISUAL_PHASE ?? 'verificacao';
let baseline: Registro[] = [];
const escapeHtml = (texto: string) => texto.replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

describe('Auditoria visual com API inteiramente fictícia', () => {
  beforeAll(async () => {
    await fs.mkdir(path.join(raiz, 'resultados'), { recursive: true });
    if (fase !== 'baseline') {
      try {
        const dados: { registros: Registro[] } = JSON.parse(await fs.readFile(path.join(raiz, 'baseline.json'), 'utf8'));
        baseline = dados.registros;
      } catch (erro) {
        throw new Error('Baseline visual ausente ou inválida. Execute primeiro com SISDOC_VISUAL_PHASE=baseline.', { cause: erro });
      }
    }
    servidor = await preview({ configFile: false, root: path.join(process.cwd(), 'apps', 'web'), logLevel: 'silent',
      preview: { host: '127.0.0.1', port: 0, strictPort: true, headers: { 'Content-Security-Policy': CSP_APLICACAO } } });
    const porta = servidor.httpServer.address();
    if (!porta || typeof porta === 'string') throw new Error('Preview fictício não iniciou');
    endereco = `http://127.0.0.1:${porta.port}/`;
    navegador = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    if (navegador) await navegador.close();
    if (servidor) await new Promise<void>((resolve, reject) => servidor.httpServer.close((erro) => erro ? reject(erro) : resolve()));
    const arquivoResumo = path.join(raiz, 'resultados', 'resumo.json');
    const telasExecutadas = new Set(registros.map((r) => r.tela));
    if (telasExecutadas.size < cenarios.length) {
      try {
        const anterior: { registros: Registro[] } = JSON.parse(await fs.readFile(arquivoResumo, 'utf8'));
        registros.push(...anterior.registros.filter((r) => !telasExecutadas.has(r.tela)));
      } catch (erro) {
        if (!(erro instanceof Error && 'code' in erro && erro.code === 'ENOENT')) throw erro;
      }
    }
    registros.sort((a, b) => `${a.tela}${a.perfil}${a.viewport}${a.estado}${a.zoom}`.localeCompare(`${b.tela}${b.perfil}${b.viewport}${b.estado}${b.zoom}`));
    await fs.writeFile(arquivoResumo, JSON.stringify({ fase, navegador: 'Chromium',
      telasExecutadas: [...telasExecutadas], temaEscuro: 'não suportado', total: registros.length, registros }, null, 2));
    if (fase === 'baseline') await fs.copyFile(path.join(raiz, 'resultados', 'resumo.json'), path.join(raiz, 'baseline.json'));
    const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>QA visual SisDoc</title>
      <style>body{font:16px system-ui;margin:24px;color:#172b3a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbcbd5;padding:8px;text-align:left}input{font:inherit;padding:8px;width:40%}a{color:#074568}</style>
      <h1>QA visual SisDoc — ${escapeHtml(fase)}</h1><p>${registros.length} combinações; dados exclusivamente fictícios. Axe não substitui inspeção humana.</p>
      <label>Filtrar <input oninput="for(const r of document.querySelectorAll('tbody tr'))r.hidden=!r.textContent.toLowerCase().includes(this.value.toLowerCase())"></label>
      <table><thead><tr><th>Tela</th><th>Configuração</th><th>Evidência</th><th>Ocorrências</th></tr></thead><tbody>${registros.map((r) =>
        `<tr><td>${escapeHtml(r.tela)}</td><td>${escapeHtml(`${r.perfil} · ${r.viewport} · ${r.estado} · ${r.zoom}%`)}</td><td><a href="${r.captura}">Captura</a> · <a href="${r.axe}">Axe/medidas</a></td><td>${escapeHtml(r.erro ?? r.problemas.join(', ')) || 'Nenhuma ocorrência automatizada'}</td></tr>`).join('')}</tbody></table></html>`;
    await fs.writeFile(path.join(raiz, 'relatorio.html'), html);
  });

  for (const cenario of cenarios) {
    it.concurrent(cenario.id, async () => {
      const configs: ConfiguracaoVisual[] = cenario.perfis.flatMap((perfil) =>
        viewports.flatMap((viewport) => cenario.estados.map((estado) => ({ perfil, viewport, estado, zoom: 100 }))));
      // Zoom priorizado nas seis telas mais usadas, em dados e 1366x768.
      if (cenario.zoom) for (const perfil of cenario.perfis) for (const zoom of [125, 150]) {
        configs.push({ perfil, estado: 'dados', viewport: viewports[1], zoom });
      }
      const falhas: string[] = [];
      for (const config of configs) {
        const viewport = `${config.viewport.width}x${config.viewport.height}`;
        const nome = `${config.perfil}-${viewport}-${config.estado}${config.zoom === 100 ? '' : `-zoom${config.zoom}`}`;
        const pasta = path.join(raiz, 'screenshots', cenario.id);
        await fs.mkdir(pasta, { recursive: true });
        const registro: Registro = { tela: cenario.id, perfil: config.perfil, estado: config.estado, viewport, zoom: config.zoom,
          captura: `screenshots/${cenario.id}/${nome}.png`, axe: `resultados/${cenario.id}-${nome}.json`, problemas: [] };
        // Emulação de zoom de desktop: mesma resolução física, viewport CSS menor.
        const escalaZoom = config.zoom / 100;
        const context = await navegador.newContext({ viewport: {
          width: Math.round(config.viewport.width / escalaZoom), height: Math.round(config.viewport.height / escalaZoom),
        }, deviceScaleFactor: escalaZoom, serviceWorkers: 'block' });
        const page = await context.newPage();
        page.setDefaultTimeout(6000);
        const erros: string[] = [];
        page.on('pageerror', (erro) => erros.push(erro.message));
        // Toda rede de API é interceptada; nenhuma rota ausente pode cair na instalação real.
        const mock = await simular(page, config, cenario);
        let evidencias: Record<string, unknown> = {};
        try {
          await page.goto(`${endereco}${cenario.rota}`);
          await cenario.preparar(page, config);
          if (config.estado !== 'carregando' && config.estado !== 'erro') await page.waitForFunction(() =>
            ![...document.querySelectorAll('[role="status"]')].some((el) =>
              el.getClientRects().length && /^(Carregando|Buscando|Verificando sessão)/.test(el.textContent ?? '')));
          expect(await page.getByText('O servidor retornou dados inválidos. Contate o administrador.', { exact: true }).count()).toBe(0);
          if (config.estado !== 'erro') expect(await page.locator('.conteudo > p[role="alert"]').count()).toBe(0);
          if (fase !== 'baseline' && cenario.id === 'importacao-historico' && config.estado === 'erro') {
            expect(await page.getByRole('status').filter({ hasText: 'Carregando lotes' }).count()).toBe(0);
          }
          await page.screenshot({ path: path.join(pasta, `${nome}.png`), animations: 'disabled' });
          await page.evaluate(axe.source);
          const acessibilidade = await page.evaluate(async () => window.axe.run(document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
          }));
          const medidas = await page.evaluate(() => {
            const luminancia = (cor: string) => {
              const rgb = cor.match(/[\d.]+/g)?.slice(0, 3).map(Number);
              if (!rgb || rgb.length !== 3) throw new Error(`Cor inesperada: ${cor}`);
              const canais = rgb.map((valor) => { const s = valor / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
              return canais[0] * 0.2126 + canais[1] * 0.7152 + canais[2] * 0.0722;
            };
            const contrasteDesabilitados = [...document.querySelectorAll<HTMLButtonElement>('button:disabled')]
              .filter((el) => el.getClientRects().length).map((el) => {
                const estilo = getComputedStyle(el);
                let fundo = estilo.backgroundColor;
                let ancestral = el.parentElement;
                while (fundo === 'rgba(0, 0, 0, 0)' && ancestral) {
                  fundo = getComputedStyle(ancestral).backgroundColor;
                  ancestral = ancestral.parentElement;
                }
                const frente = luminancia(estilo.color), tras = luminancia(fundo);
                return { texto: el.textContent?.trim(), razao: (Math.max(frente, tras) + 0.05) / (Math.min(frente, tras) + 0.05) };
              });
            const pequenos = new Set<string>();
            for (const el of document.querySelectorAll<HTMLElement>('body *')) {
              if (!el.getClientRects().length || el.closest('iframe,.sr-only') || !Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) continue;
              const style = getComputedStyle(el);
              if (Number.parseFloat(style.fontSize) < 13) pequenos.add(`${el.tagName.toLowerCase()}.${el.className}:${style.fontSize}`);
            }
            return { largura: innerWidth, scrollWidth: document.documentElement.scrollWidth,
              fontesPequenas: [...pequenos].sort(), foco: document.activeElement?.tagName,
              alturaPrevia: document.querySelector('.janela-previa')?.getBoundingClientRect().height ?? null,
              contrasteDesabilitados,
              primarios: [...document.querySelectorAll('main button:not(.secundario):not(.perigo)')]
                .filter((el) => el.getClientRects().length && !el.closest('[role="tablist"],nav')).length };
          });
          const focosEncobertos: string[] = [];
          if (config.estado === 'dados' && config.viewport.width === 1366 && config.zoom === 100) {
            for (let i = 0; i < 30; i++) {
              await page.keyboard.press('Tab');
              await page.evaluate(() => new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
              const problema = await page.evaluate(() => {
                const el = document.activeElement;
                const barra = document.querySelector('.barra-totais');
                if (!(el instanceof HTMLElement) || !barra || barra.contains(el) || !el.closest('main')) return null;
                const rect = el.getBoundingClientRect();
                const limite = barra.getBoundingClientRect().top;
                return rect.bottom > limite && rect.top < innerHeight
                  ? `${el.tagName}:${el.getAttribute('name') ?? el.textContent?.slice(0, 50)} · top=${rect.top} bottom=${rect.bottom} limite=${limite}` : null;
              });
              if (problema && !focosEncobertos.includes(problema)) focosEncobertos.push(problema);
            }
          }
          registro.problemas = [...acessibilidade.violations.map((v) => `axe:${v.id}`),
            ...(medidas.scrollWidth > medidas.largura + 1 ? ['layout:overflow-horizontal'] : []),
            ...(medidas.fontesPequenas.length ? ['conteudo:fonte-menor-13px'] : []),
            ...(medidas.alturaPrevia !== null && medidas.alturaPrevia < 240 ? ['preview:altura-insuficiente'] : []),
            ...(medidas.contrasteDesabilitados.some((item) => item.razao < 4.5) ? ['contraste:botao-desabilitado'] : []),
            ...(focosEncobertos.length ? ['teclado:foco-encoberto'] : [])];
          evidencias = {
            config, tela: cenario.id, axe: acessibilidade.violations, incompletos: acessibilidade.incomplete,
            medidas, focosEncobertos, erros, rotasInesperadas: mock.inesperadas };
          await fs.writeFile(path.join(raiz, registro.axe), JSON.stringify(evidencias, null, 2));
          if (fase !== 'baseline') {
            const antes = baseline.find((r) => r.tela === registro.tela && r.perfil === registro.perfil
              && r.estado === registro.estado && r.viewport === registro.viewport && r.zoom === registro.zoom);
            if (antes && !antes.erro) expect(registro.problemas.filter((p) => !antes.problemas.includes(p)),
              `Regressão em ${cenario.id} ${nome}`).toEqual([]);
            expect(registro.problemas, `Critérios críticos em ${cenario.id} ${nome}`)
              .not.toContain('teclado:foco-encoberto');
            expect(registro.problemas, `Altura da prévia em ${cenario.id} ${nome}`)
              .not.toContain('preview:altura-insuficiente');
            expect(acessibilidade.violations, `Axe em ${cenario.id} ${nome}`).toEqual([]);
            expect(medidas.fontesPequenas, `Fontes de interface em ${cenario.id} ${nome}`).toEqual([]);
            expect(registro.problemas).not.toContain('layout:overflow-horizontal');
            expect(registro.problemas).not.toContain('contraste:botao-desabilitado');
          }
          expect(mock.inesperadas).toEqual([]);
          expect(erros).toEqual([]);
        } catch (erro) {
          registro.erro = erro instanceof Error ? erro.message : String(erro);
          falhas.push(`${nome}: ${registro.erro}`);
          await fs.writeFile(path.join(raiz, registro.axe), JSON.stringify({ ...evidencias, config, erro: registro.erro,
            erros, rotasInesperadas: mock.inesperadas }, null, 2));
          if (!page.isClosed()) await page.screenshot({ path: path.join(pasta, `${nome}.png`), animations: 'disabled' });
        } finally {
          await context.close();
          mock.liberar();
          registros.push(registro);
        }
      }
      expect(falhas, falhas.join('\n')).toEqual([]);
    }, 1800000);
  }
});
