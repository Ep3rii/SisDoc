import { renderizarEmissaoDof, renderizarEmissaoDtc, renderizarPreviaDof, renderizarDocumentoDtc } from '@sisdoc/templates';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { htmlParaPdf } from '../apps/api/dist/documentos/pdf-emissao-dof.js';
import { renderizarEmissaoDofV1 } from '../packages/templates/src/emissao-dof-v1';
import { renderizarEmissaoDtcV1 } from '../packages/templates/src/emissao-dtc-v1';
import { snapshotDofModelo, snapshotDtcModelo } from './modelos-sinteticos';

describe('modelos oficiais versionados com dados fictícios', () => {
  let navegador: Browser;
  beforeAll(async () => { navegador = await chromium.launch({ headless: true }); });
  afterAll(async () => { if (navegador) await navegador.close(); });

  it('preserva renderer antigo DOF e recusa versões desconhecidas', () => {
    const snapshot = snapshotDofModelo();
    const antiga = { ...snapshot, template: { ...snapshot.template, versao: 'emissao-dof-1' } };
    expect(renderizarEmissaoDof(antiga)).toBe(renderizarEmissaoDofV1(antiga));
    expect(() => renderizarEmissaoDof({ ...snapshot, template: { ...snapshot.template, versao: 'desconhecida' } }))
      .toThrow('Versão de template DOF não suportada');
  });

  it.each(['DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS'] as const)('preserva renderer antigo %s', (tipo) => {
    const snapshot = snapshotDtcModelo(tipo);
    const versao = { DTC_IPAM: 'emissao-dtc-ipam-1', DTC_COMISSIONADO: 'emissao-dtc-comissionado-1', DTC_INSS: 'emissao-dtc-inss-provisorio-1' }[tipo];
    const antiga = { ...snapshot, template: { ...snapshot.template, versao } };
    expect(renderizarEmissaoDtc(antiga)).toBe(renderizarEmissaoDtcV1(antiga));
    expect(() => renderizarEmissaoDtc({ ...snapshot, template: { ...snapshot.template, versao: 'desconhecida' } }))
      .toThrow('Versão de template DTC não suportada');
  });

  it('usa mesmo formulário DOF na prévia, sinaliza variáveis e não simula número oficial', () => {
    const snapshot = snapshotDofModelo();
    const html = renderizarPreviaDof({
      ...snapshot, numeroFormatado: undefined, dataEmissao: undefined,
      blocos: [{ ...snapshot.blocos[0], texto: '{{ausente}} {{' }],
    });
    expect(html).toContain('PRÉVIA PROVISÓRIA — SEM VALIDADE OFICIAL');
    expect(html).toContain('SEM NÚMERO (PRÉVIA)');
    expect(html).toContain('Variáveis não disponíveis');
    expect(html).toContain('Expressão malformada');
    expect(html).toContain('DESCRIÇÃO DAS OCORRÊNCIAS FUNCIONAIS');
    expect(() => renderizarEmissaoDof({ ...snapshot, blocos: [{ ...snapshot.blocos[0], texto: '{{ausente}}' }] }))
      .toThrow('variável indisponível');
  });

  it.each(['DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS'] as const)('prévia %s não possui número nem data de emissão', (tipo) => {
    const snapshot = snapshotDtcModelo(tipo);
    const html = renderizarDocumentoDtc({ ...snapshot, classificacao: 'previa', numeroFormatado: null, dataEmissao: null, rodape: null });
    expect(html).toContain('PRÉVIA — SEM VALIDADE OFICIAL');
    expect(html).toContain('SEM NÚMERO (PRÉVIA)');
    expect(html).not.toContain('N° 1P/2026');
    expect(html).toContain('____/____/______');
  });

  it.each(['DOF', 'DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS'] as const)(
    'renderiza %s com brasão local, escape HTML e folhas A4 sem cortes',
    async (tipo) => {
      const html = tipo === 'DOF' ? renderizarEmissaoDof(snapshotDofModelo())
        : renderizarEmissaoDtc(snapshotDtcModelo(tipo));
      const pagina = await navegador.newPage({ javaScriptEnabled: false });
      try {
        await pagina.setContent(html);
        expect(await pagina.locator('script').count()).toBe(0);
        expect(await pagina.locator('img[src="x"]').count()).toBe(0);
        expect(await pagina.locator('.brasao').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
        expect(await pagina.locator('.pagina-modelo').count()).toBe(tipo === 'DTC_INSS' ? 3 : 2);
        if (tipo === 'DOF') {
          expect(await pagina.locator('.frequencia tbody tr').count()).toBe(46);
          await pagina.emulateMedia({ media: 'print' });
          await pagina.setViewportSize({ width: 718, height: 1123 });
          const extravasamentos = await pagina.locator('.frequencia th').evaluateAll((celulas) =>
            celulas.flatMap((celula) => {
              const limites = celula.getBoundingClientRect();
              const texto = document.createRange();
              texto.selectNodeContents(celula);
              return [...texto.getClientRects()].some((linha) =>
                linha.left < limites.left - 1 || linha.right > limites.right + 1
              ) ? [celula.textContent] : [];
            })
          );
          expect(extravasamentos).toEqual([]);
        }
        if (tipo === 'DTC_INSS') {
          expect(await pagina.locator('.inss-periodos tbody tr').count()).toBe(4);
          expect(await pagina.locator('.categorias').first().innerText()).toContain('(X) Serviço Prestado');
          expect(await pagina.locator('.categorias').nth(1).innerText()).not.toContain('(X)');
          expect(html).not.toContain('TEXTOS OFICIAIS DO INSS PENDENTES');
        }
      } finally {
        await pagina.close();
      }
      const pdf = await htmlParaPdf(navegador, html);
      const tarefa = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true });
      const documento = await tarefa.promise;
      try {
        expect(documento.numPages).toBe(tipo === 'DTC_INSS' ? 3 : 2);
        let texto = '';
        for (let indice = 1; indice <= documento.numPages; indice += 1) {
          const folha = await documento.getPage(indice);
          const tamanho = folha.getViewport({ scale: 1 });
          expect(Math.abs(tamanho.width - 595.28)).toBeLessThan(1);
          expect(Math.abs(tamanho.height - 841.89)).toBeLessThan(1);
          const conteudo = await folha.getTextContent();
          for (const item of conteudo.items) {
            if (!('str' in item) || !item.str.trim()) continue;
            texto += item.str + ' ';
            expect(item.transform[4]).toBeGreaterThanOrEqual(24);
            expect(item.transform[4] + item.width).toBeLessThanOrEqual(tamanho.width - 24);
            expect(item.transform[5]).toBeGreaterThanOrEqual(15);
            expect(item.transform[5] + item.height).toBeLessThanOrEqual(tamanho.height);
          }
        }
        expect(texto).toContain('N° 1P/2026');
        expect(texto).not.toContain('SEM VALIDADE OFICIAL');
        expect(texto).toContain(tipo === 'DOF' ? 'DESCRIÇÃO DAS OCORRÊNCIAS FUNCIONAIS' : 'DADOS PESSOAIS');
        if (tipo === 'DTC_INSS') expect(texto).toContain('ASSINATURA E RESPONSABILIDADE PELAS INFORMAÇÕES');
      } finally {
        await tarefa.destroy();
      }
    },
  );
});
