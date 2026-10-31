import path from 'node:path';
import { calcular, linhasDeclaracaoDof, REGRAS_PLANILHA } from '@sisdoc/calculo';
import {
  atualizarRascunhoDofSchema,
  atualizarBlocosDofSchema,
  atualizarProcessoDofSchema,
  encaminharRascunhoDofSchema,
  processoCorrespondeMascara,
  criarRascunhoDofSchema,
  recolherRascunhoDofSchema,
  resultadoCalculoDofSchema,
  solicitarCalculoDofSchema,
  type RascunhoDof,
  type ResultadoCalculoDof,
  type SolicitarCalculoDof,
} from '@sisdoc/contratos';
import { renderizarPreviaDof, verificarVariaveisDof } from '@sisdoc/templates';
import { chromium, type Browser, type Page, type Route } from 'playwright';
import { preview, type PreviewServer } from 'vite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const pessoaId = '11111111-1111-4111-8111-111111111111';
const vinculoId = '22222222-2222-4222-8222-222222222222';
const usuarioId = '33333333-3333-4333-8333-333333333333';
const documentoId = '44444444-4444-4444-8444-444444444444';
const coordenadorId = '55555555-5555-4555-8555-555555555555';
const csrf = 'a'.repeat(43);
const nome = 'Pessoa Ficticia';
const matricula = 'FICTICIA-1';

type PapelTeste = 'analista' | 'coordenador' | 'secretario_adjunto' | 'admin';
type Simulacao = {
  papel: PapelTeste;
  admissao: string | null;
  rascunho: RascunhoDof | null;
  conflito: boolean;
  falhaRede: boolean;
  falhaListagem: boolean;
  extras: number;
  erros: string[];
  escritas: number;
  anosConfirmados: number[];
  previas: number;
  adiarPreconferencia: boolean;
  liberarPreconferencia: (() => void) | null;
};

function resultadoSintetico(entrada: SolicitarCalculoDof, admissao: string): ResultadoCalculoDof {
  const resultado = calcular({
    tipo: 'DOF', posse: admissao, dataReferencia: '2026-01-01', regras: REGRAS_PLANILHA,
    periodos: [{
      inicio: entrada.inicio, fim: entrada.fim, anos: entrada.anos,
      ...(entrada.acumuladoAnterior ? { acumuladoAnterior: entrada.acumuladoAnterior } : {}),
    }],
  });
  if (!resultado.sucesso) throw new Error('A fixture de cálculo é inválida.');
  const periodo = resultado.periodos[0];
  return resultadoCalculoDofSchema.parse({
    admissaoConsiderada: admissao,
    regra: {
      codigo: resultado.regras.codigo, versao: resultado.regras.versao,
      classificacao: resultado.regras.classificacao,
    },
    periodo: {
      inicioInformado: periodo.inicioInformado, inicioEfetivo: periodo.inicioEfetivo,
      fim: periodo.fim, linhas: periodo.linhas,
    },
    totais: resultado.totais,
    declaracao: linhasDeclaracaoDof(resultado.totais, resultado.regras),
    avisos: resultado.avisos,
  });
}

function resumo(rascunho: RascunhoDof) {
  return {
    id: rascunho.id, pessoaId: rascunho.pessoaId, vinculoId: rascunho.vinculoId,
    nome: rascunho.nome, matricula: rascunho.matricula,
    revisao: rascunho.revisao, atualizadoEm: rascunho.atualizadoEm,
  };
}

async function responder(rota: Route, status: number, corpo: unknown) {
  await rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
}

async function simularApi(pagina: Page): Promise<Simulacao> {
  const estado: Simulacao = {
    papel: 'analista', admissao: '1980-01-01', rascunho: null,
    conflito: false, falhaRede: false, falhaListagem: false, extras: 0, erros: [], escritas: 0, anosConfirmados: [], previas: 0,
    adiarPreconferencia: false, liberarPreconferencia: null,
  };
  await pagina.route('**/api/v1/**', async (rota) => {
    try {
      const requisicao = rota.request();
      const endereco = new URL(requisicao.url());
      const metodo = requisicao.method();
      const caminho = endereco.pathname;
      if (caminho === '/api/v1/auth/me') {
        return responder(rota, 200, {
          usuario: {
            id: estado.papel === 'coordenador' ? coordenadorId : usuarioId,
            matricula: 'OPERADOR-FICTICIO', nome: 'Operador Ficticio',
            papel: estado.papel, trocaSenhaObrigatoria: false,
          },
          csrf,
        });
      }
      if (caminho === '/api/v1/admin/usuarios') {
        return responder(rota, 200, { itens: [], proximoCursor: null });
      }
      if (caminho === '/api/v1/servidores') {
        return responder(rota, 200, {
          itens: [{ pessoaId, vinculoId, nome, matricula, orgao: 'Órgão fictício', sistemaOrigem: 'fixture', removidoNaFonte: false }],
          proximoCursor: null,
        });
      }
      if (caminho === `/api/v1/servidores/${pessoaId}`) {
        return responder(rota, 200, {
          pessoa: { id: pessoaId, nome, cpfMascarado: '***.***.123-**' },
          vinculos: [{
            id: vinculoId, matricula, sistemaOrigem: 'fixture', matriculaAnteriorId: null,
            regimeJuridico: 'ESTATUTARIO', cargo: 'Cargo fictício', classe: null, nivel: null,
            referencia: 'UNICA', setor: null, orgao: 'Órgão fictício', admissao: estado.admissao,
            desligamento: null, removidoNaFonte: false,
          }],
          proximoCursor: null,
        });
      }
      if (metodo !== 'GET' && requisicao.headers()['x-csrf-token'] !== csrf) {
        return responder(rota, 403, { detail: 'CSRF inválido na fixture.' });
      }
      if (caminho === '/api/v1/calculos' && metodo === 'POST') {
        if (!estado.admissao) return responder(rota, 400, { detail: 'Admissão ausente na fixture.' });
        return responder(rota, 200, resultadoSintetico(solicitarCalculoDofSchema.parse(requisicao.postDataJSON()), estado.admissao));
      }
      if (caminho.startsWith('/api/v1/documentos') && !['analista', 'coordenador'].includes(estado.papel)) {
        return responder(rota, 403, { detail: 'Perfil sem permissão para rascunhos.' });
      }
      if (caminho === '/api/v1/documentos/coordenadores' && metodo === 'GET') {
        return responder(rota, 200, {
          itens: [{ id: coordenadorId, nome: 'Coordenador Ficticio', matricula: 'COORD-FICTICIO' }],
          proximoCursor: null,
        });
      }
      if (caminho === '/api/v1/documentos/encaminhados' && metodo === 'GET') {
        if (estado.papel !== 'coordenador') return responder(rota, 403, { detail: 'Perfil sem permissão.' });
        const encaminhamento = estado.rascunho?.encaminhamento;
        const itens = estado.rascunho && encaminhamento?.destinatarioId === coordenadorId
          ? [{ ...resumo(estado.rascunho), autorNome: 'Analista Ficticio', encaminhadoEm: encaminhamento.encaminhadoEm }]
          : [];
        return responder(rota, 200, { itens, proximoCursor: null });
      }
      if (caminho === '/api/v1/documentos' && metodo === 'GET') {
        if (estado.falhaListagem) return responder(rota, 503, { detail: 'Falha sintética de listagem.' });
        const extras = Array.from({ length: estado.extras }, (_, indice) => ({
          id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(indice + 1).padStart(12, '0')}`,
          pessoaId, vinculoId, nome: `Pessoa fictícia ${indice + 1}`, matricula,
          revisao: 1, atualizadoEm: '2026-01-01T12:00:00.000Z',
        }));
        const itens = [...(estado.rascunho ? [resumo(estado.rascunho)] : []), ...extras]
          .sort((a, b) => a.id.localeCompare(b.id));
        const cursor = endereco.searchParams.get('cursor');
        const seguintes = itens.filter((item) => !cursor || item.id > cursor);
        const paginaAtual = seguintes.slice(0, 25);
        return responder(rota, 200, {
          itens: paginaAtual, proximoCursor: seguintes.length > 25 ? paginaAtual[24].id : null,
        });
      }
      if (caminho === '/api/v1/documentos' && metodo === 'POST') {
        const dados = criarRascunhoDofSchema.parse(requisicao.postDataJSON());
        if (!estado.admissao || estado.admissao !== dados.admissaoEsperada) {
          return responder(rota, 409, { detail: 'A admissão do vínculo mudou.' });
        }
        const agora = new Date().toISOString();
        estado.rascunho = {
          id: documentoId, pessoaId, vinculoId, nome, matricula, admissao: estado.admissao,
          revisao: 1, criadoEm: agora, atualizadoEm: agora, status: 'rascunho',
          entrada: dados.calculo, resultado: resultadoSintetico(dados.calculo, estado.admissao),
          blocos: [], processo: null, mascarasProcesso: ['####/####'], encaminhamento: null,
        };
        estado.escritas += 1;
        return responder(rota, 201, estado.rascunho);
      }
      if (caminho === `/api/v1/documentos/${documentoId}` && metodo === 'GET' && estado.rascunho) {
        return responder(rota, 200, { ...estado.rascunho, admissao: estado.admissao });
      }
      if (caminho === `/api/v1/documentos/${documentoId}/previa` && metodo === 'GET' && estado.rascunho) {
        estado.previas += 1;
        return rota.fulfill({
          status: 200, contentType: 'text/html; charset=utf-8',
          headers: { 'X-Sisdoc-Revisao': String(estado.rascunho.revisao) },
          body: renderizarPreviaDof(estado.rascunho),
        });
      }
      if (caminho === `/api/v1/documentos/${documentoId}/preconferencia` && metodo === 'GET' && estado.rascunho) {
        const variaveis = verificarVariaveisDof(estado.rascunho);
        const resposta = {
          documentoId, revisao: estado.rascunho.revisao, verificadoEm: new Date().toISOString(),
          status: 'nao_conferido', conferenciaDisponivel: false,
          bloqueios: [
            { codigo: 'conferencia_indisponivel', mensagem: 'A transição para conferido ainda não foi implementada.' },
            { codigo: 'aprovacao_modelo_nao_verificada', mensagem: 'A aprovação do modelo ainda não foi verificada.' },
            ...(!estado.rascunho.processo ? [{ codigo: 'processo_ausente', mensagem: 'Informe o número do processo.' }] : []),
            ...(variaveis.indisponiveis.length ? [{ codigo: 'variaveis_ausentes', mensagem: 'Há variáveis indisponíveis.' }] : []),
            ...(variaveis.malformadas ? [{ codigo: 'variaveis_malformadas', mensagem: 'Há expressões malformadas.' }] : []),
          ],
          avisos: [{ codigo: 'regra_provisoria', mensagem: 'A regra é provisória.' }],
        };
        if (estado.adiarPreconferencia) {
          await new Promise<void>((resolve) => { estado.liberarPreconferencia = resolve; });
        }
        return responder(rota, 200, resposta);
      }
      if (caminho === `/api/v1/documentos/${documentoId}/encaminhar` && metodo === 'POST' && estado.rascunho) {
        if (estado.falhaRede) return rota.abort('failed');
        const dados = encaminharRascunhoDofSchema.parse(requisicao.postDataJSON());
        if (estado.conflito || dados.revisao !== estado.rascunho.revisao || estado.rascunho.encaminhamento) {
          return responder(rota, 409, { detail: 'O rascunho foi alterado; reabra-o antes de continuar.' });
        }
        if (dados.destinatarioId !== coordenadorId) {
          return responder(rota, 400, { detail: 'Selecione um coordenador ativo.' });
        }
        estado.rascunho = {
          ...estado.rascunho, revisao: estado.rascunho.revisao + 1, atualizadoEm: new Date().toISOString(),
          encaminhamento: {
            destinatarioId: coordenadorId, destinatarioNome: 'Coordenador Ficticio',
            destinatarioDisponivel: true, encaminhadoEm: new Date().toISOString(),
          },
        };
        estado.escritas += 1;
        return responder(rota, 201, estado.rascunho);
      }
      if (caminho === `/api/v1/documentos/${documentoId}/recolher` && metodo === 'POST' && estado.rascunho) {
        if (estado.falhaRede) return rota.abort('failed');
        const dados = recolherRascunhoDofSchema.parse(requisicao.postDataJSON());
        if (estado.conflito || dados.revisao !== estado.rascunho.revisao || !estado.rascunho.encaminhamento) {
          return responder(rota, 409, { detail: 'O rascunho foi alterado; reabra-o antes de continuar.' });
        }
        estado.rascunho = {
          ...estado.rascunho, revisao: estado.rascunho.revisao + 1,
          atualizadoEm: new Date().toISOString(), encaminhamento: null,
        };
        estado.escritas += 1;
        return responder(rota, 201, estado.rascunho);
      }
      if (caminho === `/api/v1/documentos/${documentoId}/blocos` && metodo === 'PATCH' && estado.rascunho) {
        if (estado.falhaRede) return rota.abort('failed');
        const dados = atualizarBlocosDofSchema.parse(requisicao.postDataJSON());
        if (estado.conflito || dados.revisao !== estado.rascunho.revisao || estado.rascunho.encaminhamento) {
          return responder(rota, 409, { detail: 'O rascunho foi alterado; reabra-o antes de continuar.' });
        }
        estado.rascunho = {
          ...estado.rascunho, revisao: estado.rascunho.revisao + 1,
          atualizadoEm: new Date().toISOString(), blocos: dados.blocos,
        };
        estado.escritas += 1;
        return responder(rota, 200, estado.rascunho);
      }
      if (caminho === `/api/v1/documentos/${documentoId}/processo` && metodo === 'PATCH' && estado.rascunho) {
        if (estado.falhaRede) return rota.abort('failed');
        const dados = atualizarProcessoDofSchema.parse(requisicao.postDataJSON());
        if (estado.conflito || dados.revisao !== estado.rascunho.revisao || estado.rascunho.encaminhamento) {
          return responder(rota, 409, { detail: 'O rascunho foi alterado; reabra-o antes de continuar.' });
        }
        const processoNovo = dados.processo;
        if (processoNovo !== null
            && !estado.rascunho.mascarasProcesso.some((mascara) => processoCorrespondeMascara(processoNovo, mascara))) {
          return responder(rota, 400, { detail: 'O número do processo não corresponde às máscaras configuradas.' });
        }
        estado.rascunho = {
          ...estado.rascunho, revisao: estado.rascunho.revisao + 1,
          atualizadoEm: new Date().toISOString(), processo: dados.processo,
        };
        estado.escritas += 1;
        return responder(rota, 200, estado.rascunho);
      }
      if (caminho === `/api/v1/documentos/${documentoId}` && metodo === 'PATCH' && estado.rascunho) {
        if (estado.falhaRede) return rota.abort('failed');
        const dados = atualizarRascunhoDofSchema.parse(requisicao.postDataJSON());
        if (estado.conflito || dados.revisao !== estado.rascunho.revisao || estado.rascunho.encaminhamento) {
          return responder(rota, 409, { detail: 'O rascunho foi alterado; reabra-o antes de continuar.' });
        }
        if (!estado.admissao || estado.admissao !== dados.admissaoEsperada) {
          return responder(rota, 409, { detail: 'A admissão do vínculo mudou.' });
        }
        const anosAtuais = new Set(dados.calculo.anos.map((ano) => ano.ano));
        const removidos = estado.rascunho.entrada.anos.map((ano) => ano.ano)
          .filter((ano) => !anosAtuais.has(ano)).sort((a, b) => a - b);
        const confirmados = [...(dados.anosRemovidosConfirmados ?? [])].sort((a, b) => a - b);
        if (removidos.length !== confirmados.length || removidos.some((ano, indice) => ano !== confirmados[indice])) {
          return responder(rota, 400, { detail: 'Confirme explicitamente todos os anos removidos do rascunho.' });
        }
        estado.anosConfirmados = confirmados;
        estado.rascunho = {
          ...estado.rascunho, admissao: estado.admissao, revisao: estado.rascunho.revisao + 1,
          atualizadoEm: new Date().toISOString(), entrada: dados.calculo,
          resultado: resultadoSintetico(dados.calculo, estado.admissao),
        };
        estado.escritas += 1;
        return responder(rota, 200, estado.rascunho);
      }
      estado.erros.push(`Rota sintética não prevista: ${metodo} ${caminho}`);
      return responder(rota, 500, { detail: 'Rota sintética não prevista.' });
    } catch (erro) {
      estado.erros.push(erro instanceof Error ? erro.message : 'Erro inesperado na fixture.');
      return responder(rota, 500, { detail: 'Falha na fixture de teste.' });
    }
  });
  return estado;
}

async function iniciarCalculo(pagina: Page) {
  await pagina.getByLabel('Termo de busca').fill('Pessoa');
  await pagina.getByRole('button', { name: 'Buscar', exact: true }).click();
  await pagina.getByRole('button', { name: /Ver vínculos/ }).click();
  await pagina.getByRole('button', { name: /Calcular DOF da matrícula/ }).click();
  await pagina.getByLabel('Fim do período').fill('2024-12-31');
  await pagina.getByRole('button', { name: 'Preparar tabela anual' }).click();
  await pagina.getByText('45 ano(s) no intervalo efetivo.', { exact: false }).waitFor();
}

async function calcularTabela(pagina: Page) {
  await pagina.getByRole('checkbox', { name: /Confirmei todos os anos/ }).check();
  await pagina.getByRole('button', { name: 'Calcular DOF', exact: true }).click();
  await pagina.getByRole('heading', { name: 'Resultado provisório' }).waitFor();
}

async function abrirRascunho(pagina: Page) {
  await pagina.getByRole('button', { name: 'Meus rascunhos', exact: true }).click();
  await pagina.getByRole('button', { name: /Abrir rascunho de Pessoa Ficticia/ }).click();
  await pagina.getByRole('heading', { name: 'Resultado salvo' }).waitFor();
}

describe('interface de rascunhos com API sintética', () => {
  let servidor: PreviewServer;
  let navegador: Browser;
  let pagina: Page;
  let estado: Simulacao;
  let endereco: string;

  beforeAll(async () => {
    servidor = await preview({
      configFile: false, root: path.join(process.cwd(), 'apps', 'web'), logLevel: 'silent',
      preview: { host: '127.0.0.1', port: 0, strictPort: true },
    });
    const porta = servidor.httpServer.address();
    if (!porta || typeof porta === 'string') throw new Error('Prévia de teste não iniciou em loopback.');
    endereco = `http://127.0.0.1:${porta.port}/`;
    navegador = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    if (navegador) await navegador.close();
    if (servidor) {
      await new Promise<void>((resolve, rejeitar) => {
        servidor.httpServer.close((erro) => erro ? rejeitar(erro) : resolve());
      });
    }
  });

  beforeEach(async () => {
    pagina = await navegador.newPage({ viewport: { width: 1366, height: 768 } });
    estado = await simularApi(pagina);
  });

  afterEach(async () => {
    estado.liberarPreconferencia?.();
    await pagina.close({ runBeforeUnload: false });
    expect(estado.erros).toEqual([]);
  });

  it('salva, reabre e revisa 45 anos; preserva edições diante de conflito e falha de comunicação', async () => {
    await pagina.goto(endereco);
    await iniciarCalculo(pagina);
    await pagina.getByLabel('Faltas em 1980').fill('1');
    await pagina.getByRole('button', { name: 'Próximos anos' }).click();
    await pagina.getByRole('button', { name: 'Próximos anos' }).click();
    await pagina.getByLabel('PV em 2024').fill('4');
    await calcularTabela(pagina);
    expect(await pagina.locator('section[aria-labelledby="resultado-dof-titulo"] tbody tr').count()).toBe(45);
    await pagina.getByLabel('Motivo dos lançamentos ou da alteração').fill('Conferência fictícia');
    await pagina.getByRole('button', { name: 'Salvar rascunho' }).click();
    await pagina.getByText('Rascunho salvo na revisão 1.', { exact: false }).waitFor();
    expect(await pagina.getByLabel('Motivo dos lançamentos ou da alteração').inputValue()).toBe('');
    expect(estado.escritas).toBe(1);

    await abrirRascunho(pagina);
    expect(await pagina.getByLabel('Faltas em 1980').inputValue()).toBe('1');
    await pagina.getByRole('button', { name: 'Próximos anos' }).click();
    await pagina.getByRole('button', { name: 'Próximos anos' }).click();
    expect(await pagina.getByLabel('PV em 2024').inputValue()).toBe('4');
    await pagina.getByRole('button', { name: 'Anos anteriores' }).click();
    await pagina.getByRole('button', { name: 'Anos anteriores' }).click();
    await pagina.getByLabel('Faltas em 1980').fill('2');
    expect(await pagina.getByRole('checkbox', { name: /Confirmei todos os anos/ }).isChecked()).toBe(false);
    await calcularTabela(pagina);
    await pagina.getByLabel('Motivo dos lançamentos ou da alteração').fill('Correção fictícia');
    await pagina.getByRole('button', { name: 'Salvar alterações' }).click();
    await pagina.getByText('Rascunho salvo na revisão 2.', { exact: false }).waitFor();
    expect(estado.escritas).toBe(2);
    expect(await pagina.getByText('Há alterações não salvas.').count()).toBe(0);

    await pagina.getByLabel('Faltas em 1980').fill('3');
    await calcularTabela(pagina);
    await pagina.getByLabel('Motivo dos lançamentos ou da alteração').fill('Tentativa fictícia');
    estado.conflito = true;
    await pagina.getByRole('button', { name: 'Salvar alterações' }).click();
    await pagina.getByRole('alert').getByText(/O rascunho foi alterado/).waitFor();
    expect(await pagina.getByLabel('Faltas em 1980').inputValue()).toBe('3');
    let avisoSaida = '';
    pagina.once('dialog', (dialogo) => { avisoSaida = dialogo.message(); void dialogo.dismiss(); });
    await pagina.getByRole('button', { name: 'Meus rascunhos', exact: true }).click();
    expect(avisoSaida).toContain('gravação estiver em andamento');
    expect(await pagina.getByLabel('Faltas em 1980').inputValue()).toBe('3');
    pagina.once('dialog', (dialogo) => void dialogo.accept());
    await pagina.getByRole('button', { name: 'Meus rascunhos', exact: true }).click();
    await pagina.getByRole('button', { name: /Abrir rascunho de Pessoa Ficticia/ }).click();
    expect(await pagina.getByLabel('Faltas em 1980').inputValue()).toBe('2');

    estado.conflito = false;
    estado.falhaRede = true;
    await pagina.getByLabel('Faltas em 1980').fill('4');
    await calcularTabela(pagina);
    await pagina.getByLabel('Motivo dos lançamentos ou da alteração').fill('Falha fictícia');
    await pagina.getByRole('button', { name: 'Salvar alterações' }).click();
    await pagina.getByRole('alert').getByText(/Não foi possível confirmar a gravação/).waitFor();
    expect(await pagina.getByLabel('Faltas em 1980').inputValue()).toBe('4');
    expect(estado.escritas).toBe(2);
    expect(await pagina.evaluate(() => {
      const evento = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(evento);
      return evento.defaultPrevented;
    })).toBe(true);

    await pagina.setViewportSize({ width: 375, height: 812 });
    const medidas = await pagina.evaluate(() => ({
      tela: document.documentElement.clientWidth, conteudo: document.documentElement.scrollWidth,
      local: localStorage.length, sessao: sessionStorage.length,
    }));
    expect(medidas.conteudo).toBeLessThanOrEqual(medidas.tela);
    expect(medidas.local).toBe(0);
    expect(medidas.sessao).toBe(0);
  });

  it('mostra divergência de admissão e mantém resultado legível se a fonte ficar sem data', async () => {
    await pagina.goto(endereco);
    await iniciarCalculo(pagina);
    await calcularTabela(pagina);
    await pagina.getByLabel('Motivo dos lançamentos ou da alteração').fill('Conferência fictícia');
    await pagina.getByRole('button', { name: 'Salvar rascunho' }).click();
    await pagina.getByText('Rascunho salvo na revisão 1.', { exact: false }).waitFor();

    estado.admissao = '1981-01-01';
    await abrirRascunho(pagina);
    await pagina.getByRole('alert').getByText(/admissão considerada no resultado salvo/).waitFor();
    expect(await pagina.getByRole('button', { name: 'Salvar alterações' }).count()).toBe(0);
    await pagina.getByRole('button', { name: 'Preparar tabela anual' }).click();
    await pagina.getByText('44 ano(s) no intervalo efetivo.', { exact: false }).waitFor();
    estado.admissao = null;
    pagina.once('dialog', (dialogo) => void dialogo.accept());
    await pagina.getByRole('button', { name: 'Meus rascunhos', exact: true }).click();
    await pagina.getByRole('button', { name: /Abrir rascunho de Pessoa Ficticia/ }).click();
    await pagina.getByText('A edição está indisponível até a correção na fonte.', { exact: false }).waitFor();
    expect(await pagina.getByLabel('Início do período').isDisabled()).toBe(true);
    expect(await pagina.getByRole('heading', { name: 'Resultado salvo' }).isVisible()).toBe(true);
  });

  it('exige confirmação específica antes de remover anos de um rascunho', async () => {
    await pagina.goto(endereco);
    await iniciarCalculo(pagina);
    await calcularTabela(pagina);
    await pagina.getByLabel('Motivo dos lançamentos ou da alteração').fill('Conferência fictícia');
    await pagina.getByRole('button', { name: 'Salvar rascunho' }).click();
    await pagina.getByText('Rascunho salvo na revisão 1.', { exact: false }).waitFor();
    await abrirRascunho(pagina);
    await pagina.getByLabel('Fim do período').fill('2023-12-31');
    await pagina.getByRole('button', { name: 'Preparar tabela anual' }).click();
    await calcularTabela(pagina);
    await pagina.getByText('Salvar removerá 1 ano(s) do rascunho anterior:', { exact: false }).waitFor();
    await pagina.getByLabel('Motivo dos lançamentos ou da alteração').fill('Período reduzido');
    await pagina.getByRole('button', { name: 'Salvar alterações' }).click();
    expect(estado.escritas).toBe(1);
    await pagina.getByRole('checkbox', { name: 'Confirmo a remoção desses anos do rascunho.' }).check();
    await pagina.getByRole('button', { name: 'Salvar alterações' }).click();
    await pagina.getByText('Rascunho salvo na revisão 2.', { exact: false }).waitFor();
    expect(estado.anosConfirmados).toEqual([2024]);
    expect(estado.rascunho?.entrada.anos).toHaveLength(44);
  });

  it('edita blocos com prévia isolada e atualizada, preservando alterações e conflitos', async () => {
    await pagina.goto(endereco);
    await iniciarCalculo(pagina);
    await calcularTabela(pagina);
    await pagina.getByLabel('Motivo dos lançamentos ou da alteração').fill('Cálculo fictício');
    await pagina.getByRole('button', { name: 'Salvar rascunho' }).click();
    await pagina.getByText('Rascunho salvo na revisão 1.', { exact: false }).waitFor();

    await pagina.getByRole('button', { name: 'Adicionar bloco' }).click();
    const textoInicial = '<script>window.top.intrusao=1</script> {{nome}} {{cargo}}';
    await pagina.getByLabel('Texto do bloco 1').fill(textoInicial);
    expect(await pagina.getByLabel('Fim do período').isDisabled()).toBe(true);
    expect(await pagina.getByText('Há alterações não salvas.').isVisible()).toBe(true);
    await pagina.getByRole('button', { name: 'Abrir prévia' }).click();
    expect(estado.previas).toBe(1);
    const quadro = pagina.frameLocator('iframe[title="Prévia provisória da DOF"]');
    await quadro.getByText('Variável não disponível: cargo').waitFor();
    expect(await pagina.locator('iframe[title="Prévia provisória da DOF"]').getAttribute('sandbox')).toBe('');
    expect(await quadro.locator('script').count()).toBe(0);
    expect(await quadro.getByText('Pessoa Ficticia', { exact: false }).count()).toBeGreaterThan(0);
    expect(await pagina.evaluate(() => Reflect.has(window, 'intrusao'))).toBe(false);

    const duracoes: number[] = [];
    for (let indice = 0; indice < 5; indice += 1) {
      const inicio = await pagina.evaluate(() => performance.now());
      await pagina.getByLabel('Texto do bloco 1').fill(`${'X'.repeat(7900)} MARCADOR-PREVIA-${indice}`);
      await quadro.getByText(`MARCADOR-PREVIA-${indice}`, { exact: false }).waitFor();
      duracoes.push(await pagina.evaluate(() => performance.now()) - inicio);
    }
    const maiorDuracao = Math.max(...duracoes);
    expect(maiorDuracao).toBeLessThan(1000);
    process.stdout.write(`Prévia sintética de 45 anos: maior tempo edição-exibição ${maiorDuracao.toFixed(1)} ms.\n`);

    await pagina.getByLabel('Tipo de bloco').selectOption('progressao');
    await pagina.getByRole('button', { name: 'Adicionar bloco' }).click();
    await pagina.getByLabel('Texto do bloco 2').fill('Segundo bloco fictício');
    await pagina.getByRole('button', { name: 'Subir bloco 2' }).click();
    expect(await pagina.getByLabel('Texto do bloco 1').inputValue()).toBe('Segundo bloco fictício');
    await pagina.getByRole('checkbox', { name: 'Ativar bloco 2' }).uncheck();
    await quadro.getByText('Segundo bloco fictício').waitFor();
    expect(await quadro.getByText('MARCADOR-PREVIA-4', { exact: false }).count()).toBe(0);
    await pagina.getByLabel('Motivo da alteração dos blocos').fill('Edição fictícia de blocos');
    await pagina.getByRole('button', { name: 'Salvar blocos' }).click();
    await pagina.getByText('Blocos salvos na revisão 2.', { exact: false }).waitFor();
    expect(estado.rascunho?.blocos.map((bloco) => [bloco.codigo, bloco.ativo])).toEqual([
      ['progressao', true], ['contratacao', false],
    ]);
    expect(await pagina.getByLabel('Fim do período').isDisabled()).toBe(false);
    expect(await pagina.getByText('Há alterações não salvas.').count()).toBe(0);

    await pagina.getByLabel('Texto do bloco 1').fill('Alteração que deve ser preservada');
    await pagina.getByLabel('Motivo da alteração dos blocos').fill('Tentativa fictícia');
    estado.conflito = true;
    await pagina.getByRole('button', { name: 'Salvar blocos' }).click();
    await pagina.getByRole('alert').getByText(/O rascunho foi alterado/).waitFor();
    expect(await pagina.getByLabel('Texto do bloco 1').inputValue()).toBe('Alteração que deve ser preservada');
    estado.conflito = false;
    estado.falhaRede = true;
    await pagina.getByRole('button', { name: 'Salvar blocos' }).click();
    await pagina.getByRole('alert').getByText(/Não foi possível confirmar a gravação/).waitFor();
    expect(await pagina.getByLabel('Texto do bloco 1').inputValue()).toBe('Alteração que deve ser preservada');
    expect(await pagina.evaluate(() => {
      const evento = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(evento);
      return evento.defaultPrevented;
    })).toBe(true);
    estado.falhaRede = false;
    await pagina.getByRole('button', { name: 'Salvar blocos' }).click();
    await pagina.getByText('Blocos salvos na revisão 3.', { exact: false }).waitFor();
    await abrirRascunho(pagina);
    expect(await pagina.getByLabel('Texto do bloco 1').inputValue()).toBe('Alteração que deve ser preservada');
    expect(await pagina.getByRole('checkbox', { name: 'Ativar bloco 2' }).isChecked()).toBe(false);

    await pagina.setViewportSize({ width: 375, height: 812 });
    const medidas = await pagina.evaluate(() => ({
      tela: document.documentElement.clientWidth, conteudo: document.documentElement.scrollWidth,
      local: localStorage.length, sessao: sessionStorage.length,
    }));
    expect(medidas.conteudo).toBeLessThanOrEqual(medidas.tela);
    expect(medidas.local).toBe(0);
    expect(medidas.sessao).toBe(0);
  });

  it('mantém a prévia abaixo de um segundo no limite técnico de blocos', async () => {
    await pagina.goto(endereco);
    await iniciarCalculo(pagina);
    await calcularTabela(pagina);
    await pagina.getByLabel('Motivo dos lançamentos ou da alteração').fill('Cálculo fictício');
    await pagina.getByRole('button', { name: 'Salvar rascunho' }).click();
    await pagina.getByText('Rascunho salvo na revisão 1.', { exact: false }).waitFor();
    if (!estado.rascunho) throw new Error('Rascunho sintético ausente.');
    estado.rascunho = {
      ...estado.rascunho,
      blocos: Array.from({ length: 200 }, (_, indice) => ({
        id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(indice + 1).padStart(12, '0')}`,
        codigo: 'complementares', ativo: true, texto: `BLOCO-${indice + 1}-`.padEnd(100, 'x'),
      })),
    };
    await abrirRascunho(pagina);
    await pagina.getByRole('button', { name: 'Abrir prévia' }).click();
    const quadro = pagina.frameLocator('iframe[title="Prévia provisória da DOF"]');
    await quadro.getByText('BLOCO-200-', { exact: false }).waitFor();
    expect(await quadro.locator('tbody tr').count()).toBe(45);
    const duracoes: number[] = [];
    for (let indice = 0; indice < 5; indice += 1) {
      const inicio = await pagina.evaluate(() => performance.now());
      await pagina.getByLabel('Texto do bloco 200').fill(`LIMITE-${indice}-`.padEnd(100, 'x'));
      await quadro.getByText(`LIMITE-${indice}-`, { exact: false }).waitFor();
      duracoes.push(await pagina.evaluate(() => performance.now()) - inicio);
    }
    const maiorDuracao = Math.max(...duracoes);
    expect(maiorDuracao).toBeLessThan(1000);
    process.stdout.write(
      `Prévia sintética no limite (45 anos, 200 blocos, 20.000 caracteres): ${maiorDuracao.toFixed(1)} ms.\n`,
    );
  });

  it('mantém a prévia abaixo de um segundo com muitos delimitadores malformados', async () => {
    await pagina.goto(endereco);
    await iniciarCalculo(pagina);
    await calcularTabela(pagina);
    await pagina.getByLabel('Motivo dos lançamentos ou da alteração').fill('Cálculo fictício');
    await pagina.getByRole('button', { name: 'Salvar rascunho' }).click();
    await pagina.getByText('Rascunho salvo na revisão 1.', { exact: false }).waitFor();
    if (!estado.rascunho) throw new Error('Rascunho sintético ausente.');
    estado.rascunho = {
      ...estado.rascunho,
      blocos: Array.from({ length: 200 }, (_, indice) => ({
        id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(indice + 1).padStart(12, '0')}`,
        codigo: 'complementares', ativo: true, texto: `${'}}X'.repeat(33)}Z`,
      })),
    };
    await abrirRascunho(pagina);
    await pagina.getByRole('button', { name: 'Abrir prévia' }).click();
    const quadro = pagina.frameLocator('iframe[title="Prévia provisória da DOF"]');
    await quadro.getByText('Há expressões de variáveis malformadas nos blocos ativos.').waitFor();
    expect(await quadro.locator('mark').count()).toBe(6600);
    const duracoes: number[] = [];
    for (let indice = 0; indice < 5; indice += 1) {
      const inicio = await pagina.evaluate(() => performance.now());
      await pagina.getByLabel('Texto do bloco 200').fill(`MARCADOR-MALFORMADO-${indice}`.padEnd(100, '}'));
      await quadro.getByText(`MARCADOR-MALFORMADO-${indice}`, { exact: false }).waitFor();
      duracoes.push(await pagina.evaluate(() => performance.now()) - inicio);
    }
    const maiorDuracao = Math.max(...duracoes);
    expect(maiorDuracao).toBeLessThan(1000);
    process.stdout.write(
      `Prévia sintética com delimitadores malformados (45 anos, 200 blocos, 20.000 caracteres): ${maiorDuracao.toFixed(1)} ms.\n`,
    );
  });

  it('valida e salva o processo somente com máscara configurada, preservando alterações pendentes', async () => {
    await pagina.goto(endereco);
    await iniciarCalculo(pagina);
    await calcularTabela(pagina);
    await pagina.getByLabel('Motivo dos lançamentos ou da alteração').fill('Cálculo fictício');
    await pagina.getByRole('button', { name: 'Salvar rascunho' }).click();
    await pagina.getByText('Rascunho salvo na revisão 1.', { exact: false }).waitFor();
    await pagina.getByLabel('Número do processo').fill('12345678');
    await pagina.getByLabel('Motivo da alteração do processo').fill('Processo fictício');
    expect(await pagina.getByRole('button', { name: 'Adicionar bloco' }).isDisabled()).toBe(true);
    await pagina.getByRole('button', { name: 'Salvar processo' }).click();
    await pagina.getByRole('alert').getByText(/Confira o número do processo/).waitFor();
    expect(estado.escritas).toBe(1);
    await pagina.getByLabel('Número do processo').fill('1234/5678');
    await pagina.getByRole('button', { name: 'Salvar processo' }).click();
    await pagina.getByText('Processo salvo na revisão 2.', { exact: false }).waitFor();
    expect(estado.rascunho?.processo).toBe('1234/5678');
    expect(await pagina.getByRole('button', { name: 'Adicionar bloco' }).isDisabled()).toBe(false);
    await pagina.getByRole('button', { name: 'Adicionar bloco' }).click();
    await pagina.getByLabel('Texto do bloco 1').fill('Referência {{processo}}');
    await pagina.getByRole('button', { name: 'Abrir prévia' }).click();
    await pagina.frameLocator('iframe[title="Prévia provisória da DOF"]')
      .getByText('Referência 1234/5678').waitFor();
    await pagina.getByLabel('Motivo da alteração dos blocos').fill('Referência fictícia');
    await pagina.getByRole('button', { name: 'Salvar blocos' }).click();
    await pagina.getByText('Blocos salvos na revisão 3.', { exact: false }).waitFor();

    await pagina.getByLabel('Número do processo').fill('9999/9999');
    await pagina.getByLabel('Motivo da alteração do processo').fill('Correção fictícia');
    estado.conflito = true;
    await pagina.getByRole('button', { name: 'Salvar processo' }).click();
    await pagina.getByRole('alert').getByText(/O rascunho foi alterado/).waitFor();
    expect(await pagina.getByLabel('Número do processo').inputValue()).toBe('9999/9999');
    estado.conflito = false;
    estado.falhaRede = true;
    await pagina.getByRole('button', { name: 'Salvar processo' }).click();
    await pagina.getByRole('alert').getByText(/Não foi possível confirmar a gravação/).waitFor();
    expect(await pagina.getByLabel('Número do processo').inputValue()).toBe('9999/9999');
    estado.falhaRede = false;
    await pagina.getByRole('button', { name: 'Salvar processo' }).click();
    await pagina.getByText('Processo salvo na revisão 4.', { exact: false }).waitFor();
    if (!estado.rascunho) throw new Error('Rascunho sintético ausente.');
    estado.rascunho = { ...estado.rascunho, mascarasProcesso: [] };
    await abrirRascunho(pagina);
    await pagina.getByText('Nenhuma máscara de processo está configurada.', { exact: false }).waitFor();
    expect(await pagina.getByLabel('Número do processo').inputValue()).toBe('9999/9999');
    expect(await pagina.getByLabel('Número do processo').isDisabled()).toBe(true);
    await pagina.getByRole('checkbox', { name: 'Confirmo a remoção do número de processo.' }).check();
    await pagina.getByLabel('Motivo da alteração do processo').fill('Remoção fictícia');
    await pagina.getByRole('button', { name: 'Salvar processo' }).click();
    await pagina.getByText('Processo salvo na revisão 5.', { exact: false }).waitFor();
    expect(estado.rascunho?.processo).toBeNull();
  });

  it('encaminha apenas rascunho salvo, mostra consulta ao destinatário e recolhe com motivo', async () => {
    await pagina.goto(endereco);
    await iniciarCalculo(pagina);
    await calcularTabela(pagina);
    await pagina.getByLabel('Motivo dos lançamentos ou da alteração').fill('Dados fictícios conferidos');
    await pagina.getByRole('button', { name: 'Salvar rascunho' }).click();
    await pagina.getByText('Rascunho salvo na revisão 1.', { exact: false }).waitFor();

    await pagina.getByRole('button', { name: 'Adicionar bloco' }).click();
    expect(await pagina.getByRole('button', { name: 'Escolher coordenador' }).isDisabled()).toBe(true);
    await pagina.getByRole('button', { name: 'Remover bloco novo 1' }).click();
    await pagina.getByRole('button', { name: 'Escolher coordenador' }).click();
    await pagina.getByLabel('Coordenador destinatário').selectOption(coordenadorId);
    estado.falhaRede = true;
    await pagina.getByRole('button', { name: 'Encaminhar rascunho' }).click();
    await pagina.getByRole('alert').getByText(/Não foi possível confirmar a operação/).waitFor();
    expect(estado.rascunho?.encaminhamento).toBeNull();
    estado.falhaRede = false;
    await pagina.getByRole('button', { name: 'Encaminhar rascunho' }).click();
    await pagina.getByText('Rascunho encaminhado na revisão 2.', { exact: false }).waitFor();
    expect(await pagina.getByLabel('Faltas em 1980').isDisabled()).toBe(true);
    expect(await pagina.getByLabel('Número do processo').isDisabled()).toBe(true);
    expect(await pagina.getByRole('button', { name: 'Adicionar bloco' }).isDisabled()).toBe(true);
    expect(estado.rascunho?.encaminhamento?.destinatarioId).toBe(coordenadorId);
    await pagina.getByRole('button', { name: 'Abrir prévia' }).click();
    await pagina.frameLocator('iframe[title="Prévia provisória da DOF"]').getByText(/PRÉVIA PROVISÓRIA/).waitFor();
    await pagina.getByRole('button', { name: 'Verificar pendências para conferência' }).click();
    await pagina.getByText('Rascunho não conferido — revisão 2,', { exact: false }).waitFor();
    expect(await pagina.getByText('A transição para conferido ainda não foi implementada.').count()).toBe(1);

    estado.papel = 'coordenador';
    await pagina.reload();
    await pagina.getByRole('button', { name: 'Encaminhados a mim' }).click();
    await pagina.getByText('Analista Ficticio', { exact: true }).waitFor();
    await pagina.getByRole('button', { name: /Abrir rascunho de Pessoa Ficticia/ }).click();
    await pagina.getByText('Rascunho encaminhado — revisão 2.', { exact: false }).waitFor();
    expect(await pagina.getByLabel('Faltas em 1980').isDisabled()).toBe(true);
    expect(await pagina.getByLabel('Número do processo').isDisabled()).toBe(true);
    expect(await pagina.getByRole('button', { name: 'Recolher encaminhamento' }).count()).toBe(0);
    await pagina.getByRole('button', { name: 'Abrir prévia' }).click();
    await pagina.frameLocator('iframe[title="Prévia provisória da DOF"]').getByText(/PRÉVIA PROVISÓRIA/).waitFor();

    await pagina.getByRole('button', { name: 'Verificar pendências para conferência' }).click();
    await pagina.getByText('Rascunho não conferido — revisão 2,', { exact: false }).waitFor();
    estado.papel = 'analista';
    await pagina.reload();
    await abrirRascunho(pagina);
    await pagina.getByLabel('Motivo do recolhimento').fill('Correção fictícia necessária');
    expect(await pagina.getByText('Há alterações não salvas.').count()).toBe(1);
    estado.falhaRede = true;
    await pagina.getByRole('button', { name: 'Recolher encaminhamento' }).click();
    await pagina.getByRole('alert').getByText(/Não foi possível confirmar a operação/).waitFor();
    expect(await pagina.getByLabel('Motivo do recolhimento').inputValue()).toBe('Correção fictícia necessária');
    estado.falhaRede = false;
    await pagina.getByRole('button', { name: 'Recolher encaminhamento' }).click();
    await pagina.getByText('Encaminhamento recolhido na revisão 3.', { exact: false }).waitFor();
    expect(estado.rascunho?.encaminhamento).toBeNull();
    expect(await pagina.getByLabel('Faltas em 1980').isEnabled()).toBe(true);
    expect(await pagina.getByText('Há alterações não salvas.').count()).toBe(0);
  });

  it('mostra bloqueios preliminares e invalida o resultado diante de edições locais', async () => {
    await pagina.goto(endereco);
    await iniciarCalculo(pagina);
    await calcularTabela(pagina);
    await pagina.getByLabel('Motivo dos lançamentos ou da alteração').fill('Dados fictícios');
    await pagina.getByRole('button', { name: 'Salvar rascunho' }).click();
    await pagina.getByRole('button', { name: 'Verificar pendências para conferência' }).click();
    await pagina.getByText('Rascunho não conferido — revisão 1,', { exact: false }).waitFor();
    await pagina.getByText('Informe o número do processo.').waitFor();
    expect(await pagina.getByText('A aprovação do modelo ainda não foi verificada.').count()).toBe(1);
    expect(await pagina.getByRole('button', { name: 'Conferir', exact: true }).count()).toBe(0);

    await pagina.getByLabel('Número do processo').fill('1234/5678');
    expect(await pagina.getByRole('button', { name: 'Verificar pendências para conferência' }).isDisabled()).toBe(true);
    expect(await pagina.getByText('Rascunho não conferido — revisão 1,', { exact: false }).count()).toBe(0);
    await pagina.getByLabel('Número do processo').clear();
    await pagina.getByRole('button', { name: 'Adicionar bloco' }).click();
    await pagina.getByLabel('Texto do bloco 1').fill('Teste {{nome}} {{inexistente}} {{malformada');
    await pagina.getByLabel('Motivo da alteração dos blocos').fill('Teste de variáveis');
    await pagina.getByRole('button', { name: 'Salvar blocos' }).click();
    await pagina.getByText('Blocos salvos na revisão 2.', { exact: false }).waitFor();
    await pagina.getByRole('button', { name: 'Abrir prévia' }).click();
    await pagina.frameLocator('iframe[title="Prévia provisória da DOF"]').getByText(/Expressão malformada/).first().waitFor();
    await pagina.getByRole('button', { name: 'Verificar pendências para conferência' }).click();
    await pagina.getByText('Rascunho não conferido — revisão 2,', { exact: false }).waitFor();
    await pagina.getByText('Há variáveis indisponíveis.').waitFor();
    await pagina.getByText('Há expressões malformadas.').waitFor();

    estado.adiarPreconferencia = true;
    await pagina.getByRole('button', { name: 'Verificar pendências para conferência' }).click();
    await expect.poll(() => estado.liberarPreconferencia !== null).toBe(true);
    await pagina.getByLabel('Número do processo').fill('1234/5678');
    await pagina.getByLabel('Motivo da alteração do processo').fill('Processo fictício');
    await pagina.getByRole('button', { name: 'Salvar processo' }).click();
    await pagina.getByText('Processo salvo na revisão 3.', { exact: false }).waitFor();
    estado.liberarPreconferencia?.();
    await pagina.getByRole('alert').getByText(/O rascunho mudou durante a verificação/).waitFor();
    expect(await pagina.getByText('Rascunho não conferido — revisão 2,', { exact: false }).count()).toBe(0);
  });

  it('restringe controles por perfil e apresenta falha de listagem com retentativa e paginação', async () => {
    estado.papel = 'secretario_adjunto';
    await pagina.goto(endereco);
    await pagina.getByText('Operador Ficticio').waitFor();
    expect(await pagina.getByRole('button', { name: 'Meus rascunhos', exact: true }).count()).toBe(0);
    await iniciarCalculo(pagina);
    await calcularTabela(pagina);
    expect(await pagina.getByRole('button', { name: 'Salvar rascunho' }).count()).toBe(0);
    pagina.once('dialog', (dialogo) => void dialogo.accept());
    estado.papel = 'admin';
    await pagina.reload();
    await pagina.getByRole('heading', { name: 'Administração de usuários' }).waitFor();
    expect(await pagina.getByRole('button', { name: 'Buscar servidores' }).count()).toBe(0);
    expect(await pagina.getByRole('button', { name: 'Meus rascunhos', exact: true }).count()).toBe(0);

    estado.papel = 'coordenador';
    await pagina.reload();
    estado.falhaListagem = true;
    await pagina.getByRole('button', { name: 'Meus rascunhos', exact: true }).click();
    await pagina.getByRole('alert').getByText('Falha sintética de listagem.').waitFor();
    estado.falhaListagem = false;
    estado.extras = 26;
    await pagina.getByRole('button', { name: 'Tentar carregar rascunhos novamente' }).click();
    await pagina.getByRole('button', { name: 'Próxima página de rascunhos' }).waitFor();
    expect(await pagina.locator('tbody tr').count()).toBe(25);
    await pagina.getByRole('button', { name: 'Próxima página de rascunhos' }).click();
    await pagina.getByText('Pessoa fictícia 26', { exact: true }).waitFor();
    expect(await pagina.locator('tbody tr').count()).toBe(1);
    await pagina.getByRole('button', { name: 'Primeira página de rascunhos' }).click();
    await pagina.getByText('Pessoa fictícia 1', { exact: true }).waitFor();
  });
});
