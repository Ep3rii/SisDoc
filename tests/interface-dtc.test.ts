import path from 'node:path';
import { documentoDtcSchema, ROTULOS_DTC, OBSERVACAO_PADRAO_INSS, type ConteudoDtc, type TipoDtc } from '@sisdoc/contratos';
import { chromium, type Browser, type Page } from 'playwright';
import { preview, type PreviewServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calcularDtc } from '../apps/api/dist/calculos/calculo-dtc.js';
import { anosDoPeriodo } from '../apps/web/src/dtc/anos-dtc.js';
import { cpfSintetico } from './dados-sinteticos.js';
import { CSP_APLICACAO } from '../apps/api/dist/aplicacao.js';

const pessoaId = '11111111-1111-4111-8111-111111111111';
const vinculoId = '22222222-2222-4222-8222-222222222222';
const documentoId = '33333333-3333-4333-8333-333333333333';
const usuarioId = '44444444-4444-4444-8444-444444444444';
const nome = 'Pessoa DTC fictícia';
const matricula = 'DTC-FICTICIA';
const csrf = 'a'.repeat(43);

function conteudoSintetico(tipo: TipoDtc): ConteudoDtc {
  return {
    periodos: [{
      inicio: '2020-01-01', fim: '2021-12-31',
      anos: [2020, 2021].map((ano) => ({
        ano, abrangencia: 'ano_civil', faltas: 1, ts: 2, pf: 3, ip: 4, outros: 5, pb: 10, pv: 20, licencaPremio: 30,
      })),
      cargo: tipo === 'DTC_INSS' ? 'Cargo fictício' : null,
      categoria: tipo === 'DTC_INSS' ? 'efetivo' : null,
    }],
    cargos: tipo === 'DTC_COMISSIONADO' ? [{
      cargo: 'Cargo fictício', decretoNomeacao: 'Decreto fictício', publicacaoNomeacao: 'DOM fictício',
      dataEntradaExercicio: '2020-01-01', decretoExoneracao: null, publicacaoExoneracao: null, dataEncerramento: null,
    }] : [],
    inss: tipo === 'DTC_INSS' ? {
      licencas: { possui: false, descricao: null },
      documentacao: { nomeacao: true, ctps: false, folha: true, frequencia: true, outros: null },
      observacao: OBSERVACAO_PADRAO_INSS,
    } : null,
    processo: '1234/2026', confirmarInicioAjustado: false,
  };
}

function documentoSintetico(tipo: TipoDtc, conteudo: ConteudoDtc, revisao = 1) {
  const calculo = calcularDtc(tipo, conteudo, '2020-01-01', '2026-10-31');
  if ('erro' in calculo) throw new Error(calculo.erro);
  return documentoDtcSchema.parse({
    id: documentoId, tipo, pessoaId, vinculoId, nome: conteudo.ajustesCadastro?.nome ?? nome, matricula, admissao: '2020-01-01',
    status: 'rascunho', revisao, criadoEm: '2026-10-31T12:00:00.000Z', atualizadoEm: '2026-10-31T12:00:00.000Z',
    autorNome: 'Autor fictício', conferidoPorNome: null, conferidoEm: null,
    conteudo, resultado: calculo.resultado, mascarasProcesso: ['####/####'], pendencias: [],
  });
}

describe('Editor DTC', () => {
  let navegador: Browser;
  let servidor: PreviewServer;
  let endereco: string;

  beforeAll(async () => {
    servidor = await preview({
      configFile: false, root: path.join(process.cwd(), 'apps', 'web'), logLevel: 'silent',
      preview: { host: '127.0.0.1', port: 0, strictPort: true, headers: { 'Content-Security-Policy': CSP_APLICACAO } },
    });
    const porta = servidor.httpServer.address();
    if (!porta || typeof porta === 'string') throw new Error('Prévia isolada não iniciou.');
    endereco = `http://127.0.0.1:${porta.port}/`;
    navegador = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    if (navegador) await navegador.close();
    if (servidor) await new Promise<void>((resolve, reject) =>
      servidor.httpServer.close((erro) => erro ? reject(erro) : resolve()));
  });

  it('regenera anos sem zerar lançamentos e conserva anos parciais', () => {
    const anteriores = conteudoSintetico('DTC_IPAM').periodos[0].anos;
    expect(anosDoPeriodo('2020-02-01', '2022-12-31', anteriores)).toEqual([
      { ...anteriores[0], abrangencia: 'intervalo_declarado' }, anteriores[1],
      { ano: 2022, abrangencia: 'ano_civil', faltas: 0, ts: 0, pf: 0, ip: 0, outros: 0, pb: 0, pv: 0, licencaPremio: 0 },
    ]);
  });

  it.each(['DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS'] as const)(
    'admin edita %s existente, preserva valores ao mudar datas e salva incorporações',
    async (tipo) => {
      const pagina: Page = await navegador.newPage();
      let documento = documentoSintetico(tipo, conteudoSintetico(tipo));
      let enviado: Record<string, unknown> | null = null;
      const erros: string[] = [];
      pagina.on('pageerror', (erro) => erros.push(erro.message));
      await pagina.route('**/api/v1/**', async (rota) => {
        const url = new URL(rota.request().url());
        let resposta: unknown;
        if (url.pathname === '/api/v1/auth/me') {
          resposta = { usuario: { id: usuarioId, matricula: 'ADMIN-FICTICIO', nome: 'Admin fictício',
            papel: 'admin', trocaSenhaObrigatoria: false }, csrf };
        } else if (url.pathname === '/api/v1/admin/usuarios') {
          resposta = { itens: [], proximoCursor: null };
        } else if (url.pathname === '/api/v1/notificacoes/declaracoes') {
          resposta = { encaminhados: 0, retornos: 0 };
        } else if (url.pathname === '/api/v1/sincronizacao/situacao') {
          resposta = { configurada: false, ultimaSincronizacaoEm: null, horasDesdeUltima: null,
            limiteHoras: 24, avisoAtraso: false, disjuntorAberto: false };
        } else if (url.pathname === '/api/v1/servidores') {
          resposta = { itens: [{ pessoaId, vinculoId, nome, matricula, cpf: cpfSintetico(920000011),
            orgao: 'Órgão fictício', sistemaOrigem: 'fixture', removidoNaFonte: false }], proximoCursor: null };
        } else if (url.pathname === `/api/v1/servidores/${pessoaId}`) {
          resposta = { pessoa: { id: pessoaId, nome, cpf: cpfSintetico(920000011) }, vinculos: [], proximoCursor: null };
        } else if (url.pathname === `/api/v1/servidores/${pessoaId}/referencias`) {
          resposta = {
            pessoaId, vinculoId, revisaoPessoa: '1', revisaoVinculo: '1', removidoNaFonte: false,
            cadastro: {
              nome, cpf: cpfSintetico(920000011), nascimento: null, nomeMae: null, nomePai: null,
              pisPasep: null, rgNumero: null, rgOrgao: null, rgExpedicao: null, tituloEleitor: null, endereco: null,
              matricula, regimeJuridico: null, cargo: null, classe: null, nivel: null, referencia: null,
              setor: null, orgaoCodigo: null, orgao: null, admissao: '2020-01-01', desligamento: null,
            },
            pessoa: { Nome: nome }, registros: [], proximoCursor: null,
          };
        } else if (url.pathname === '/api/v1/dtc') {
          const { id, tipo, nome, matricula, status, revisao, atualizadoEm, autorNome } = documento;
          resposta = { itens: [{ id, tipo, nome, matricula, status, revisao, atualizadoEm, autorNome }] };
        } else if (url.pathname === `/api/v1/dtc/${documentoId}/previa`) {
          resposta = { documento, fonte: {
            documentoId, revisao: documento.revisao, provaFonte: 'b'.repeat(64), consultadoEm: '2026-10-31T12:00:00.000Z',
            nome, matricula, cpf: cpfSintetico(920000011), nascimento: null, nomeMae: null, nomePai: null,
            rg: null, rgOrgao: null, rgExpedicao: null, pisPasep: null, tituloEleitor: null, endereco: null,
            regimeJuridico: null, cargo: null, referencia: null, orgao: null, admissao: '2020-01-01',
            periodosIpam: [], removidoNaFonte: false,
          }, fonteSelecionadaAlterada: null };
        } else if (url.pathname === `/api/v1/dtc/${documentoId}` && rota.request().method() === 'PATCH') {
          enviado = rota.request().postDataJSON() as Record<string, unknown>;
          const { revisao, motivo: _motivo, ...conteudo } = enviado;
          documento = documentoSintetico(tipo, conteudo as ConteudoDtc, Number(revisao) + 1);
          resposta = documento;
        } else {
          erros.push(`${rota.request().method()} ${url.pathname}`);
          return rota.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"Rota inesperada"}' });
        }
        return rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resposta) });
      });
      try {
        await pagina.goto(endereco);
        await pagina.getByRole('button', { name: new RegExp(`^${ROTULOS_DTC[tipo]}`) }).click();
        expect(await pagina.getByRole('button', { name: `Nova ${ROTULOS_DTC[tipo]}` }).count()).toBe(0);
        await pagina.getByRole('searchbox', { name: 'Filtrar lista carregada' }).fill('inexistente');
        expect(await pagina.getByRole('button', { name: `Abrir ${nome}` }).count()).toBe(0);
        await pagina.getByRole('button', { name: 'Limpar filtro', exact: true }).click();
        expect(await pagina.locator('.exclusao-documento.zona-perigo').count()).toBe(1);
        await pagina.getByRole('button', { name: `Abrir ${nome}` }).click();
        const quadro = pagina.frameLocator(`iframe[title="Prévia da ${ROTULOS_DTC[tipo]}"]`);
        await quadro.locator('body').waitFor();
        expect(await quadro.locator('body').evaluate((elemento) => getComputedStyle(elemento).fontFamily))
          .toBe('Arial, sans-serif');
        expect(await quadro.locator('body').evaluate((elemento) => {
          const estilo = document.createElement('style');
          estilo.textContent = 'body{font-family:monospace!important}';
          document.head.append(estilo);
          const script = document.createElement('script');
          script.textContent = 'document.body.dataset.executou = "sim"';
          document.body.append(script);
          return { fonte: getComputedStyle(elemento).fontFamily, executou: elemento.dataset.executou ?? null };
        })).toEqual({ fonte: 'Arial, sans-serif', executou: null });
        await pagina.getByRole('button', { name: 'Editar rascunho' }).click();
        await pagina.getByRole('heading', { name: new RegExp(`${ROTULOS_DTC[tipo]} —`) }).waitFor();
        await pagina.getByRole('tab', { name: 'Conferência', exact: true }).click();
        expect(await pagina.getByLabel('Motivo da alteração').isVisible()).toBe(false);
        await pagina.getByRole('tab', { name: 'Identificação', exact: true }).click();
        await quadro.locator('body').waitFor();
        await pagina.getByLabel('Nome completo', { exact: true }).fill('Nome ajustado na DTC fictícia');
        await quadro.getByText('Nome ajustado na DTC fictícia', { exact: true }).waitFor();
        await pagina.getByRole('tab', { name: 'Conferência', exact: true }).click();
        expect(await pagina.getByLabel('Motivo da alteração').isVisible()).toBe(true);
        await pagina.getByRole('tab', { name: 'Identificação', exact: true }).click();
        expect(enviado).toBeNull();
        await pagina.getByRole('tab', { name: 'Períodos', exact: true }).click();
        await pagina.getByText('1º período — datas, deduções e incorporações', { exact: true }).click();
        expect(await pagina.getByLabel('PB em 2020', { exact: true }).isVisible()).toBe(false);
        await pagina.getByText('1º período — datas, deduções e incorporações', { exact: true }).click();
        await pagina.getByLabel('PB em 2020', { exact: true }).fill('40');
        await pagina.getByLabel('PV em 2020', { exact: true }).fill('50');
        await pagina.getByLabel('Licença-prêmio em 2020', { exact: true }).fill('60');
        expect(await pagina.getByText('Prévia de edição não salva', { exact: false }).isVisible()).toBe(true);
        await pagina.getByLabel('Fim', { exact: true }).fill('2022-12-31');
        expect(await pagina.getByLabel('PB em 2020', { exact: true }).inputValue()).toBe('40');
        expect(await pagina.getByLabel('PV em 2020', { exact: true }).inputValue()).toBe('50');
        expect(await pagina.getByLabel('Licença-prêmio em 2020', { exact: true }).inputValue()).toBe('60');
        expect(await pagina.getByLabel('PB em 2021', { exact: true }).inputValue()).toBe('10');
        expect(await pagina.getByLabel('PB em 2022', { exact: true }).inputValue()).toBe('0');
        await pagina.getByRole('tab', { name: 'Identificação', exact: true }).click();
        expect(await pagina.getByLabel('Nome completo', { exact: true }).inputValue()).toBe('Nome ajustado na DTC fictícia');
        await pagina.getByRole('tab', { name: 'Conferência', exact: true }).click();
        await pagina.getByLabel('Motivo da alteração').fill('Conferência fictícia das incorporações');
        await pagina.getByRole('button', { name: 'Salvar rascunho' }).click();
        await pagina.getByRole('button', { name: 'Editar rascunho' }).waitFor();
        expect(enviado).toMatchObject({ revisao: 1, ajustesCadastro: { nome: 'Nome ajustado na DTC fictícia' }, periodos: [{ anos: [
          { ano: 2020, faltas: 1, ts: 2, pf: 3, ip: 4, outros: 5, pb: 40, pv: 50, licencaPremio: 60 },
          { ano: 2021, pb: 10, pv: 20, licencaPremio: 30 }, { ano: 2022, pb: 0, pv: 0, licencaPremio: 0 },
        ] }] });
        expect(documento.resultado.totais).toMatchObject({ pb: 50, pv: 70, licencaPremio: 90 });
        await pagina.getByRole('button', { name: 'Editar rascunho' }).click();
        const nomeSalvo = await pagina.getByLabel('Nome completo', { exact: true }).inputValue();
        expect(nomeSalvo).toBe('Nome ajustado na DTC fictícia');
        await pagina.getByLabel('Nome completo', { exact: true }).fill('Nome temporário na DTC fictícia');
        await pagina.getByRole('tab', { name: 'Conferência', exact: true }).click();
        expect(await pagina.getByLabel('Motivo da alteração').isVisible()).toBe(true);
        await pagina.getByRole('tab', { name: 'Identificação', exact: true }).click();
        await pagina.getByLabel('Nome completo', { exact: true }).fill(nomeSalvo);
        await pagina.getByRole('tab', { name: 'Conferência', exact: true }).click();
        expect(await pagina.getByLabel('Motivo da alteração').isVisible()).toBe(false);
        await pagina.getByRole('tab', { name: 'Períodos', exact: true }).click();
        expect(await pagina.getByLabel('PB em 2020', { exact: true }).inputValue()).toBe('40');
        expect(erros).toEqual([]);
      } finally {
        await pagina.close({ runBeforeUnload: false });
      }
    },
  );

  it('emite DTCs em lote somente com fonte validada e revisão individual, preservando a chave no retry', async () => {
    const pagina = await navegador.newPage();
    const ids = [
      documentoId,
      '77777777-7777-4777-8777-777777777777',
      '88888888-8888-4888-8888-888888888888',
    ];
    const documentos = ids.map((id, indice) => ({
      ...documentoSintetico('DTC_IPAM', conteudoSintetico('DTC_IPAM')),
      id,
      nome: `Pessoa DTC fictícia ${indice + 1}`,
      matricula: `DTC-FICTICIA-${indice + 1}`,
      status: 'conferido' as const,
      conferidoPorNome: 'Coordenador fictício',
      conferidoEm: '2026-10-31T12:00:00.000Z',
    }));
    const fontePorDocumento = new Map(ids.map((id, indice) => [id, indice === 2 ? null : false]));
    const tentativas = new Map<string, number>();
    const chamadas: Array<{ id: string; chave: string; corpo: Record<string, unknown> }> = [];
    const erros: string[] = [];
    pagina.on('pageerror', (erro) => erros.push(erro.message));
    pagina.on('dialog', (dialogo) => dialogo.accept());
    await pagina.route('**/api/v1/**', async (rota) => {
      const requisicao = rota.request();
      const url = new URL(requisicao.url());
      let resposta: unknown;
      if (url.pathname === '/api/v1/auth/me') {
        resposta = { usuario: { id: usuarioId, matricula: 'COORD-FICTICIO', nome: 'Coordenador fictício',
          papel: 'coordenador', trocaSenhaObrigatoria: false }, csrf };
      } else if (url.pathname === '/api/v1/notificacoes/declaracoes') {
        resposta = { encaminhados: 0, retornos: 0 };
      } else if (url.pathname === '/api/v1/sincronizacao/situacao') {
        resposta = { configurada: false, ultimaSincronizacaoEm: null, horasDesdeUltima: null,
          limiteHoras: 24, avisoAtraso: false, disjuntorAberto: false };
      } else if (url.pathname === '/api/v1/servidores') {
        resposta = { itens: [], proximoCursor: null };
      } else if (url.pathname === '/api/v1/dtc') {
        resposta = { itens: documentos.map(({ id, tipo, nome, matricula, status, revisao, atualizadoEm, autorNome }) =>
          ({ id, tipo, nome, matricula, status, revisao, atualizadoEm, autorNome })) };
      } else {
        const previa = /^\/api\/v1\/dtc\/([^/]+)\/previa$/.exec(url.pathname);
        const emissao = /^\/api\/v1\/dtc\/([^/]+)\/emitir$/.exec(url.pathname);
        if (previa) {
          const documento = documentos.find((item) => item.id === previa[1]);
          if (!documento) return rota.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"Documento não encontrado"}' });
          resposta = {
            documento,
            fonte: {
              documentoId: documento.id, revisao: documento.revisao, provaFonte: 'b'.repeat(64),
              consultadoEm: '2026-10-31T12:00:00.000Z', nome: documento.nome, matricula: documento.matricula,
              cpf: cpfSintetico(920000011), nascimento: null, nomeMae: null, nomePai: null, rg: null,
              rgOrgao: null, rgExpedicao: null, pisPasep: null, tituloEleitor: null, endereco: null,
              regimeJuridico: null, cargo: null, referencia: null, orgao: null, admissao: '2020-01-01',
              periodosIpam: [], removidoNaFonte: false,
            },
            fonteSelecionadaAlterada: fontePorDocumento.get(documento.id),
          };
        } else if (emissao) {
          const documento = documentos.find((item) => item.id === emissao[1]);
          if (!documento) return rota.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"Documento não encontrado"}' });
          const numeroTentativa = (tentativas.get(documento.id) ?? 0) + 1;
          tentativas.set(documento.id, numeroTentativa);
          chamadas.push({
            id: documento.id,
            chave: requisicao.headers()['idempotency-key'] ?? '',
            corpo: requisicao.postDataJSON() as Record<string, unknown>,
          });
          if (documento.id === ids[1] && numeroTentativa === 1) {
            return rota.fulfill({ status: 409, contentType: 'application/json', body: '{"detail":"Falha temporária simulada"}' });
          }
          resposta = {
            emissaoId: '99999999-9999-4999-8999-999999999999',
            documentoId: documento.id, tipo: documento.tipo, numero: `N° ${numeroTentativa}/2026`,
            emitidoEm: '2026-10-31T12:00:00.000Z', emitidoPorNome: 'Coordenador fictício',
            status: 'emitido', canceladoEm: null,
            pdf: { status: 'pendente', tentativas: 0, erro: null, disponivel: false },
          };
        } else {
          erros.push(`${requisicao.method()} ${url.pathname}`);
          return rota.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"Rota inesperada"}' });
        }
      }
      return rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resposta) });
    });

    try {
      await pagina.goto(endereco);
      await pagina.getByRole('button', { name: /^DTC IPAM/ }).click();
      await pagina.getByLabel('Situação').selectOption('conferido');
      await pagina.locator('.emissao-lote > summary').click();
      await pagina.getByRole('checkbox', { name: /Pessoa DTC fictícia 1/ }).check();
      await pagina.getByRole('checkbox', { name: /Pessoa DTC fictícia 2/ }).check();
      await pagina.getByRole('checkbox', { name: /Pessoa DTC fictícia 3/ }).check();
      await pagina.getByRole('alert').getByText(/não pôde ser validada/).waitFor();

      const grupos = pagina.locator('.emissao-lote .grupo-formulario');
      await grupos.nth(0).getByText('Revisar prévia individual').click();
      await grupos.nth(1).getByText('Revisar prévia individual').click();
      await grupos.nth(0).getByRole('checkbox', { name: /Revisei esta prévia/ }).check();
      await grupos.nth(1).getByRole('checkbox', { name: /Revisei esta prévia/ }).check();
      expect(await grupos.nth(2).getByRole('checkbox', { name: /Revisei esta prévia/ }).count()).toBe(0);
      const emitirTres = pagina.getByRole('button', { name: /Emitir 3 documento/ });
      expect(await emitirTres.isDisabled()).toBe(true);
      await pagina.getByRole('checkbox', { name: /Pessoa DTC fictícia 3/ }).uncheck();

      await pagina.getByRole('button', { name: /Emitir 2 documento/ }).click();
      await pagina.getByRole('alert').getByText('Falha temporária simulada').waitFor();
      expect(chamadas).toHaveLength(2);
      expect(chamadas.map((chamada) => chamada.corpo)).toEqual([
        { revisao: 1, provaFonte: 'b'.repeat(64) },
        { revisao: 1, provaFonte: 'b'.repeat(64) },
      ]);
      expect(chamadas.every((chamada) => /^[A-Za-z0-9._:-]{16,200}$/.test(chamada.chave))).toBe(true);

      await pagina.getByRole('button', { name: /Emitir 1 documento/ }).click();
      await pagina.getByText('N° 2/2026', { exact: false }).waitFor();
      expect(chamadas).toHaveLength(3);
      expect(chamadas[1].id).toBe(chamadas[2].id);
      expect(chamadas[1].chave).toBe(chamadas[2].chave);
      expect(erros).toEqual([]);
    } finally {
      await pagina.close({ runBeforeUnload: false });
    }
  });
});
