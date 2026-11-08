import path from 'node:path';
import os from 'node:os';
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

function listaSintetica(documentos: ReturnType<typeof documentoSintetico>[], url: URL) {
  const todos = documentos.filter((item) => !url.searchParams.get('tipo') || item.tipo === url.searchParams.get('tipo'));
  const aba = url.searchParams.get('aba') ?? 'rascunhos';
  const itens = todos.filter((item) => (item.status === 'conferido' ? 'conferidas' : 'rascunhos') === aba);
  return { itens: itens.map((item) => ({
    id: item.id, pessoaId: item.pessoaId, vinculoId: item.vinculoId, tipo: item.tipo, nome: item.nome, matricula: item.matricula,
    autorNome: item.autorNome, situacao: item.status === 'conferido' ? 'conferidas' : 'rascunhos',
    revisao: item.revisao, atualizadoEm: item.atualizadoEm, somenteLeitura: false, conferenciaDof: null,
  })), total: itens.length, totalPaginas: itens.length ? 1 : 0, pagina: 1,
  contagens: { rascunhos: todos.filter((item) => item.status === 'rascunho').length, encaminhadas: 0, devolvidas: 0,
    conferidas: todos.filter((item) => item.status === 'conferido').length } };
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

  it('unifica a busca por Enter, infere matrícula e nome e mantém a seleção da DTC no topo', async () => {
    const pagina = await navegador.newPage();
    const erros: string[] = [];
    pagina.on('pageerror', (erro) => erros.push(erro.message));
    await pagina.route('**/api/v1/**', async (rota) => {
      const url = new URL(rota.request().url());
      let resposta: unknown;
      if (url.pathname === '/api/v1/auth/me') {
        resposta = { usuario: { id: usuarioId, matricula: 'ANALISTA-FICTICIO', nome: 'Analista fictício',
          papel: 'analista', trocaSenhaObrigatoria: false }, csrf };
      } else if (url.pathname === '/api/v1/notificacoes/declaracoes') {
        resposta = { encaminhados: 0, retornos: 0 };
      } else if (url.pathname === '/api/v1/sincronizacao/situacao') {
        resposta = { configurada: false, ultimaSincronizacaoEm: null, horasDesdeUltima: null,
          limiteHoras: 24, avisoAtraso: false, disjuntorAberto: false };
      } else if (url.pathname === '/api/v1/servidores') {
        resposta = { itens: [pessoaId, '99999999-9999-4999-8999-999999999999'].map((id) => ({
          pessoaId: id, vinculoId: id === pessoaId ? vinculoId : id, nome, matricula: '15-1', cpf: cpfSintetico(920000011),
          orgao: 'Órgão fictício', sistemaOrigem: 'fixture', removidoNaFonte: false })), proximoCursor: null };
      } else if (url.pathname === '/api/v1/documentos/lista') {
        resposta = listaSintetica([], url);
      } else {
        erros.push(`${rota.request().method()} ${url.pathname}`);
        return rota.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"Rota inesperada"}' });
      }
      return rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resposta) });
    });
    try {
      await pagina.goto(endereco);
      const central = pagina.getByRole('textbox', { name: 'Buscar servidor no Início', exact: true });
      const topo = pagina.getByRole('textbox', { name: 'Termo de busca', exact: true });
      await central.waitFor();
      expect(await central.evaluate((campo) => campo === document.activeElement)).toBe(true);
      expect(await pagina.locator('select[name="tipo"]').count()).toBe(0);
      expect(await pagina.getByLabel('Filtrar lista carregada').count()).toBe(0);
      for (const [termo, tipo] of [[' 15-1 ', 'matricula'], ['123', 'matricula'], ['Pessoa fictícia', 'nome']]) {
        await central.fill(termo);
        const resposta = pagina.waitForResponse((r) => {
          const url = new URL(r.url());
          return url.pathname === '/api/v1/servidores' && url.searchParams.get('q') === termo.trim();
        });
        await central.press('Enter');
        const url = new URL((await resposta).url());
        expect(url.searchParams.get('tipo')).toBe(tipo);
        await central.waitFor();
      }
      await pagina.getByRole('button', { name: 'DTCs', exact: true }).click();
      await pagina.getByRole('button', { name: 'Nova DTC IPAM', exact: true }).waitFor();
      await pagina.getByRole('button', { name: 'Nova DTC IPAM', exact: true }).focus();
      await pagina.keyboard.press('/');
      expect(await topo.evaluate((campo) => campo === document.activeElement)).toBe(true);
      await topo.fill('Pessoa');
      await topo.press('/');
      expect(await topo.inputValue()).toBe('Pessoa/');
      await pagina.getByRole('button', { name: 'Nova DTC IPAM', exact: true }).click();
      await pagina.getByRole('heading', { name: 'Selecionar servidor', exact: true }).waitFor();
      expect(await pagina.getByRole('button', { name: 'Voltar à lista', exact: true }).count()).toBe(0);
      expect(await pagina.getByRole('textbox').count()).toBe(1);
      expect(await topo.evaluate((campo) => campo === document.activeElement)).toBe(true);
      const resposta = pagina.waitForResponse((r) => new URL(r.url()).searchParams.get('q') === '15-1');
      await topo.fill('15-1');
      await topo.press('Enter');
      expect(new URL((await resposta).url()).searchParams.get('tipo')).toBe('matricula');
      await pagina.getByRole('button', { name: /^Selecionar Pessoa/ }).first().waitFor();
      expect(await pagina.getByRole('heading', { name: 'Selecionar servidor', exact: true }).count()).toBe(1);
      await pagina.getByRole('button', { name: 'Início', exact: true }).click();
      await central.waitFor();
      expect(await central.evaluate((campo) => campo === document.activeElement)).toBe(true);
      await topo.fill('Pessoa');
      const buscaInicio = pagina.waitForResponse((r) => new URL(r.url()).searchParams.get('q') === 'Pessoa');
      await topo.press('Enter');
      await buscaInicio;
      await pagina.getByRole('heading', { name: 'Início', exact: true }).waitFor();
      expect(erros).toEqual([]);
    } finally {
      await pagina.close();
    }
  });

  it('abre a ficha em três interações, pré-seleciona DTC e mantém histórico recolhido nas três larguras', async () => {
    const pagina = await navegador.newPage();
    const erros: string[] = [];
    const leituras: string[] = [];
    let papel: 'analista' | 'admin' = 'analista';
    let paginaExtra = false;
    let ambigua = false;
    pagina.on('pageerror', (erro) => erros.push(erro.message));
    const vinculo = {
      id: vinculoId, matricula: '15-1', sistemaOrigem: 'fixture', matriculaAnteriorId: null,
      regimeJuridico: 'Estatutário', cargo: 'Cargo fictício', classe: 'A', nivel: '1', referencia: 'PNS-A',
      setor: 'Setor fictício', orgao: 'Órgão fictício', admissao: '2020-01-01', desligamento: null, removidoNaFonte: false,
    };
    const segundo = { ...vinculo, id: '66666666-6666-4666-8666-666666666666', matricula: '15-2', admissao: null };
    await pagina.route('**/api/v1/**', async (rota) => {
      const url = new URL(rota.request().url());
      leituras.push(url.pathname);
      let resposta: unknown;
      if (url.pathname === '/api/v1/auth/me') {
        resposta = { usuario: { id: usuarioId, matricula: 'ANALISTA-FICTICIO', nome: 'Analista fictício',
          papel, trocaSenhaObrigatoria: false }, csrf };
      } else if (url.pathname === '/api/v1/notificacoes/declaracoes') {
        resposta = { encaminhados: 0, retornos: 0 };
      } else if (url.pathname === '/api/v1/sincronizacao/situacao') {
        resposta = { configurada: false, ultimaSincronizacaoEm: null, horasDesdeUltima: null,
          limiteHoras: 24, avisoAtraso: false, disjuntorAberto: false };
      } else if (url.pathname === '/api/v1/servidores') {
        const segundaPagina = url.searchParams.has('cursor');
        resposta = { itens: [{ pessoaId: segundaPagina && ambigua ? segundo.id : pessoaId, vinculoId, nome,
          matricula: '15-1', cpf: cpfSintetico(920000011), orgao: 'Órgão fictício', sistemaOrigem: 'fixture', removidoNaFonte: false }],
          proximoCursor: paginaExtra && url.searchParams.has('q') && !segundaPagina ? segundo.id : null };
      } else if (url.pathname === `/api/v1/servidores/${pessoaId}/ficha`) {
        resposta = { pessoa: { id: pessoaId, nome, cpf: cpfSintetico(920000011) }, vinculos: [vinculo],
          proximoCursor: segundo.id, totalVinculos: 2, totalHistoricoFuncional: 73 };
      } else if (url.pathname === `/api/v1/servidores/${pessoaId}`) {
        resposta = { pessoa: { id: pessoaId, nome, cpf: cpfSintetico(920000011) }, vinculos: [segundo], proximoCursor: null };
      } else if (url.pathname === `/api/v1/servidores/${pessoaId}/documentos`) {
        resposta = { itens: ['rascunho', 'emitido'].map((situacao, i) => ({
          id: i ? segundo.id : documentoId, vinculoId, matricula: '15-1', tipo: 'DOF', situacao,
          atualizadoEm: '2026-10-31T12:00:00.000Z', numero: i ? 'DOF/2026/1' : null, emissaoId: i ? segundo.id : null,
        })), proximoCursor: null };
      } else if (url.pathname === `/api/v1/servidores/${pessoaId}/historico`) {
        resposta = { itens: [], proximoCursor: null, totais: { registros: 73, proventosPagos: '0.00',
          descontosPagos: '0.00', proventosEstornados: '0.00', descontosEstornados: '0.00' } };
      } else if (url.pathname === `/api/v1/servidores/${pessoaId}/referencias`) {
        resposta = {
          pessoaId, vinculoId, revisaoPessoa: '1', revisaoVinculo: '1', removidoNaFonte: false,
          cadastro: {
            nome, cpf: cpfSintetico(920000011), nascimento: null, nomeMae: null, nomePai: null,
            pisPasep: null, rgNumero: null, rgOrgao: null, rgExpedicao: null, tituloEleitor: null, endereco: null,
            matricula: '15-1', regimeJuridico: null, cargo: null, classe: null, nivel: null, referencia: null,
            setor: null, orgaoCodigo: null, orgao: null, admissao: '2020-01-01', desligamento: null,
          },
          pessoa: { nome }, registros: [], proximoCursor: null,
        };
      } else {
        erros.push(`${rota.request().method()} ${url.pathname}`);
        return rota.fulfill({ status: 404, body: '{"detail":"Rota inesperada"}', contentType: 'application/json' });
      }
      return rota.fulfill({ status: 200, body: JSON.stringify(resposta), contentType: 'application/json' });
    });
    try {
      for (const largura of [1366, 768, 390]) {
        await pagina.setViewportSize({ width: largura, height: 900 });
        await pagina.goto(endereco);
        const busca = pagina.getByRole('textbox', { name: 'Buscar servidor no Início', exact: true });
        await busca.waitFor();
        expect(await busca.evaluate((campo) => campo === document.activeElement)).toBe(true);
        // As únicas três interações após o login: digitar, Enter e calcular.
        await busca.fill('15-1');
        await busca.press('Enter');
        const calcular = pagina.getByRole('button', { name: 'Calcular DOF da matrícula 15-1', exact: true });
        await calcular.waitFor();
        expect(await pagina.getByRole('button', { name: 'Calcular DOF da matrícula 15-2', exact: true }).isDisabled()).toBe(true);
        await pagina.getByRole('cell', { name: 'DOF/2026/1', exact: true }).waitFor();
        expect(await pagina.getByText('01/01/2020', { exact: false }).count()).toBeGreaterThan(0);
        expect(await pagina.getByRole('button', { name: 'Histórico funcional (73 registros)' }).getAttribute('aria-expanded')).toBe('false');
        expect(await pagina.locator('body').evaluate((el) => el.scrollWidth <= window.innerWidth)).toBe(true);
        const captura = path.join(process.env.SISDOC_TEST_TEMP ?? os.tmpdir(), `sisdoc-ficha-${largura}-${process.pid}.png`);
        await pagina.screenshot({ path: captura, fullPage: true });
        process.stdout.write(`Ficha fictícia em ${largura}px: ${captura}\n`);
        await calcular.click();
        await pagina.getByRole('heading', { name: `DOF — ${nome}`, exact: true }).waitFor();
        expect(await pagina.getByLabel('Início do período', { exact: true }).inputValue()).toBe('2020-01-01');
      }
      await pagina.setViewportSize({ width: 1366, height: 900 });
      await pagina.getByRole('button', { name: 'Início', exact: true }).click();
      const busca = pagina.getByRole('textbox', { name: 'Buscar servidor no Início', exact: true });
      await busca.fill('15-1'); await busca.press('Enter');
      await pagina.getByRole('button', { name: 'Histórico funcional (73 registros)' }).waitFor();
      expect(leituras.filter((rota) => rota.endsWith('/historico'))).toHaveLength(0);
      await pagina.getByRole('button', { name: 'Histórico funcional (73 registros)' }).click();
      await pagina.getByText('73 registros em todo o vínculo', { exact: false }).waitFor();
      for (const tipo of ['DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS'] as const) {
        if (tipo !== 'DTC_IPAM') {
          await pagina.getByRole('button', { name: 'Início', exact: true }).click();
          await busca.fill('15-1'); await busca.press('Enter');
        }
        await pagina.getByRole('button', { name: tipo === 'DTC_IPAM' ? 'Nova DTC IPAM' : ROTULOS_DTC[tipo], exact: true }).click();
        await pagina.getByRole('heading', { name: `${ROTULOS_DTC[tipo]} — ${nome}`, exact: true }).waitFor();
        expect(await pagina.getByRole('heading', { name: 'Selecionar servidor', exact: true }).count()).toBe(0);
        expect(await pagina.getByLabel('Matrícula', { exact: true }).inputValue()).toBe('15-1');
      }
      paginaExtra = true; ambigua = true;
      await pagina.getByRole('button', { name: 'Início', exact: true }).click();
      await busca.fill('15-1');
      const segundaPagina = pagina.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/servidores'
        && new URL(r.url()).searchParams.has('cursor'));
      await busca.press('Enter'); await segundaPagina;
      await pagina.getByRole('heading', { name: 'Resultados', exact: true }).waitFor();
      expect(await pagina.getByRole('heading', { name: 'Ficha do servidor' }).count()).toBe(0);
      ambigua = false;
      await pagina.getByRole('button', { name: 'Início', exact: true }).click();
      await busca.fill('15-1'); await busca.press('Enter');
      await pagina.getByRole('heading', { name: 'Ficha do servidor' }).waitFor();
      await pagina.getByRole('button', { name: 'Trocar servidor', exact: true }).click();
      await busca.waitFor();
      expect(await busca.evaluate((campo) => campo === document.activeElement)).toBe(true);
      papel = 'admin';
      await pagina.reload();
      await busca.waitFor();
      expect(await busca.evaluate((campo) => campo === document.activeElement)).toBe(true);
      await busca.fill('15-1'); await busca.press('Enter');
      await pagina.getByRole('heading', { name: 'Ficha do servidor' }).waitFor();
      expect(await pagina.getByRole('button', { name: 'Nova DTC IPAM', exact: true }).count()).toBe(0);
      expect(erros).toEqual([]);
    } finally { await pagina.close(); }
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
        } else if (url.pathname === '/api/v1/documentos/lista') {
          resposta = listaSintetica([documento], url);
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
        await pagina.getByRole('button', { name: 'DTCs', exact: true }).click();
        await pagina.getByLabel('Tipo de DTC').selectOption(tipo);
        expect(await pagina.getByRole('button', { name: `Nova ${ROTULOS_DTC[tipo]}` }).count()).toBe(0);
        expect(await pagina.getByRole('searchbox', { name: 'Filtrar lista carregada' }).count()).toBe(0);
        expect(await pagina.locator('.exclusao-documento.zona-perigo').count()).toBe(0);
        await pagina.getByRole('button', { name: `Ações de ${nome}` }).click();
        await pagina.getByRole('button', { name: 'Excluir', exact: true }).waitFor();
        await pagina.getByRole('button', { name: `Abrir ${tipo} de ${nome}` }).click();
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
      } else if (url.pathname === '/api/v1/documentos/lista') {
        resposta = listaSintetica(documentos, url);
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
      await pagina.getByRole('button', { name: 'DTCs', exact: true }).click();
      await pagina.getByRole('button', { name: /^Conferidas/ }).click();
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
