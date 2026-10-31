import path from 'node:path';
import { calcular, linhasDeclaracaoDof, REGRAS_PLANILHA } from '@sisdoc/calculo';
import {
  atualizarRascunhoDofSchema,
  criarRascunhoDofSchema,
  resultadoCalculoDofSchema,
  solicitarCalculoDofSchema,
  type RascunhoDof,
  type ResultadoCalculoDof,
  type SolicitarCalculoDof,
} from '@sisdoc/contratos';
import { chromium, type Browser, type Page, type Route } from 'playwright';
import { preview, type PreviewServer } from 'vite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const pessoaId = '11111111-1111-4111-8111-111111111111';
const vinculoId = '22222222-2222-4222-8222-222222222222';
const usuarioId = '33333333-3333-4333-8333-333333333333';
const documentoId = '44444444-4444-4444-8444-444444444444';
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
    conflito: false, falhaRede: false, falhaListagem: false, extras: 0, erros: [], escritas: 0, anosConfirmados: [],
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
            id: usuarioId, matricula: 'OPERADOR-FICTICIO', nome: 'Operador Ficticio',
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
        };
        estado.escritas += 1;
        return responder(rota, 201, estado.rascunho);
      }
      if (caminho === `/api/v1/documentos/${documentoId}` && metodo === 'GET' && estado.rascunho) {
        return responder(rota, 200, { ...estado.rascunho, admissao: estado.admissao });
      }
      if (caminho === `/api/v1/documentos/${documentoId}` && metodo === 'PATCH' && estado.rascunho) {
        if (estado.falhaRede) return rota.abort('failed');
        const dados = atualizarRascunhoDofSchema.parse(requisicao.postDataJSON());
        if (estado.conflito || dados.revisao !== estado.rascunho.revisao) {
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
    pagina.once('dialog', (dialogo) => void dialogo.dismiss());
    await pagina.getByRole('button', { name: 'Meus rascunhos', exact: true }).click();
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
