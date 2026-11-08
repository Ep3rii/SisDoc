import { calcular, linhasDeclaracaoDof, REGRAS_PLANILHA } from '@sisdoc/calculo';
import { documentoDtcSchema, resultadoCalculoDofSchema, type ConteudoDtc, type TipoDtc } from '@sisdoc/contratos';
import { calcularDtc } from '../../apps/api/dist/calculos/calculo-dtc.js';
import { cpfSintetico } from '../dados-sinteticos';
import type { Page } from 'playwright';
import type { ConfiguracaoVisual } from './tipos';

export const pessoaId = '11111111-1111-4111-8111-111111111111';
export const vinculoId = '22222222-2222-4222-8222-222222222222';
export const documentoId = '33333333-3333-4333-8333-333333333333';
export const usuarioId = '44444444-4444-4444-8444-444444444444';
export const agora = '2026-11-08T12:00:00.000Z';
export const csrf = 'a'.repeat(43);
export const nomes = (config: ConfiguracaoVisual) => config.estado === 'texto-longo'
  ? 'Servidor inteiramente fictício para auditoria visual com nome extenso e sobrenomes de oitenta caracteres ou mais'
  : 'Servidor fictício visual';
export const quantidade = (config: ConfiguracaoVisual) => config.estado === 'vazio' ? 0 : config.estado === 'lista-longa' ? 50 : 2;
export const uuid = (indice: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(indice + 1).padStart(12, '0')}`;

export function cadastro(config: ConfiguracaoVisual) {
  return {
    nome: nomes(config), cpf: cpfSintetico(), nascimento: '1960-05-04', nomeMae: 'Mãe fictícia',
    nomePai: null, pisPasep: null, rgNumero: null, rgOrgao: null, rgExpedicao: null,
    tituloEleitor: null, endereco: 'Endereço exclusivamente fictício', matricula: '15-1',
    regimeJuridico: 'ESTATUTARIO', cargo: 'Cargo fictício', classe: null, nivel: null, referencia: 'UNICA',
    setor: 'Setor fictício', orgaoCodigo: null, orgao: 'Órgão fictício', admissao: '2020-01-01', desligamento: null,
  };
}

export function dof(config: ConfiguracaoVisual) {
  const entrada = { pessoaId, vinculoId, inicio: '2020-01-01', fim: '2021-12-31', confirmacaoDados: true,
    anos: [2020, 2021].map((ano) => ({ ano, abrangencia: 'ano_civil' as const,
      faltas: 1, ts: 2, pf: 3, ip: 4, outros: 0, pb: 0, pv: 0, licencaPremio: 0 })) };
  const calculo = calcular({ tipo: 'DOF', posse: '2020-01-01', dataReferencia: '2026-11-08',
    regras: REGRAS_PLANILHA, periodos: [{ inicio: entrada.inicio, fim: entrada.fim, anos: entrada.anos }] });
  if (!calculo.sucesso) throw new Error('Fixture de cálculo inválida');
  const periodo = calculo.periodos[0];
  const resultado = resultadoCalculoDofSchema.parse({
    admissaoConsiderada: '2020-01-01', regra: { codigo: calculo.regras.codigo, versao: calculo.regras.versao, classificacao: calculo.regras.classificacao },
    periodo: { inicioInformado: periodo.inicioInformado, inicioEfetivo: periodo.inicioEfetivo, fim: periodo.fim, linhas: periodo.linhas },
    totais: calculo.totais, declaracao: linhasDeclaracaoDof(calculo.totais, calculo.regras), avisos: calculo.avisos,
  });
  return { id: documentoId, pessoaId, vinculoId, nome: nomes(config), matricula: '15-1', admissao: '2020-01-01',
    revisao: 1, criadoEm: agora, atualizadoEm: agora, status: 'rascunho', entrada, resultado,
    inicioAjustadoConfirmado: false, blocos: [], processo: '1234/2026', mascarasProcesso: ['####/####'], encaminhamento: null };
}

export function dtc(config: ConfiguracaoVisual, tipo: TipoDtc, conferida: boolean) {
  const conteudo: ConteudoDtc = {
    periodos: [{ inicio: '2020-01-01', fim: '2021-12-31',
      anos: [2020, 2021].map((ano) => ({ ano, abrangencia: 'ano_civil',
        faltas: 1, ts: 2, pf: 3, ip: 4, outros: 0, pb: 0, pv: 0, licencaPremio: 0 })),
      cargo: tipo === 'DTC_INSS' ? 'Cargo fictício' : null, categoria: tipo === 'DTC_INSS' ? 'efetivo' : null }],
    cargos: tipo === 'DTC_COMISSIONADO' ? [{ cargo: 'Cargo fictício', decretoNomeacao: 'Decreto fictício',
      publicacaoNomeacao: 'DOM fictício', dataEntradaExercicio: '2020-01-01', decretoExoneracao: null,
      publicacaoExoneracao: null, dataEncerramento: null }] : [],
    inss: tipo === 'DTC_INSS' ? { licencas: { possui: false, descricao: null },
      documentacao: { nomeacao: true, ctps: false, folha: true, frequencia: true, outros: null },
      observacao: 'Observação exclusivamente fictícia' } : null,
    processo: '1234/2026', confirmarInicioAjustado: false,
  };
  const calculo = calcularDtc(tipo, conteudo, '2020-01-01', '2026-11-08');
  if ('erro' in calculo) throw new Error(calculo.erro);
  return documentoDtcSchema.parse({ id: documentoId, tipo, pessoaId, vinculoId, nome: nomes(config), matricula: '15-1',
    admissao: '2020-01-01', status: conferida ? 'conferido' : 'rascunho', revisao: 1, criadoEm: agora, atualizadoEm: agora,
    autorNome: 'Autor fictício', conferidoPorNome: conferida ? 'Conferente fictício' : null,
    conferidoEm: conferida ? agora : null, conteudo, resultado: calculo.resultado, mascarasProcesso: ['####/####'], pendencias: [] });
}

export function fonte(config: ConfiguracaoVisual) {
  return { documentoId, revisao: 1, consultadoEm: agora, provaFonte: 'b'.repeat(64), nome: nomes(config), matricula: '15-1',
    cpf: cpfSintetico(), nascimento: '1960-05-04', nomeMae: 'Mãe fictícia', regimeJuridico: 'ESTATUTARIO',
    cargo: 'Cargo fictício', nivel: null, avisoNivel: 'Referência sem hífen; confira o nível.', referencia: 'UNICA',
    orgao: 'Órgão fictício', admissao: '2020-01-01', removidoNaFonte: false };
}

export type OpcoesFixture = { alvo?: RegExp; tipo?: TipoDtc; conferida?: boolean; trocaSenha?: boolean };

export async function simular(page: Page, config: ConfiguracaoVisual, opcoes: OpcoesFixture = {}) {
  const inesperadas: string[] = [];
  const liberar: Array<() => void> = [];
  const count = quantidade(config);
  const lista = (item: (i: number) => unknown, total = count) => Array.from({ length: total }, (_, i) => item(i));
  const quantidadeBusca = config.estado === 'vazio' && opcoes.alvo && !opcoes.alvo.test('servidores') ? 2 : count;
  const quantidadeVinculos = config.estado === 'vazio' && opcoes.alvo && !opcoes.alvo.test(`servidores/${pessoaId}/ficha`) ? 2 : count;
  const longo = config.estado === 'lista-longa';
  const situacao = { configurada: false, ultimaSincronizacaoEm: null, horasDesdeUltima: null,
    limiteHoras: 24, avisoAtraso: false, disjuntorAberto: false };
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname.replace('/api/v1/', '');
    if (opcoes.alvo?.test(p) && (config.estado === 'carregando' || config.estado === 'erro')) {
      if (config.estado === 'carregando') await new Promise<void>((resolve) => liberar.push(resolve));
      if (page.isClosed()) return;
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({
        detail: 'Falha fictícia ao carregar dados. Tente novamente ou contate o administrador.' }) });
    }
    let dados: unknown;
    if (p === 'auth/me') {
      if (config.perfil === 'sem-login') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"Sessão ausente"}' });
      dados = { usuario: { id: usuarioId, matricula: 'VISUAL-FICTICIO', nome: nomes(config),
        papel: config.perfil, trocaSenhaObrigatoria: opcoes.trocaSenha ?? false }, csrf };
    } else if (p === 'auth/login') {
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"Credenciais inválidas. Confira matrícula e senha e tente novamente."}' });
    } else if (p === 'sincronizacao/situacao') dados = situacao;
    else if (p === 'notificacoes/declaracoes') dados = { encaminhados: 2, retornos: 1 };
    else if (p === 'servidores') dados = { itens: lista((i) => ({ pessoaId, vinculoId: i ? uuid(i) : vinculoId,
      nome: nomes(config), cpf: cpfSintetico(), matricula: i ? `15-${i + 1}` : '15-1',
      orgao: 'Órgão fictício', sistemaOrigem: 'fixture', removidoNaFonte: false }), quantidadeBusca), proximoCursor: null };
    else if (p === `servidores/${pessoaId}/ficha` || p === `servidores/${pessoaId}`) dados = {
      pessoa: { id: pessoaId, nome: nomes(config), cpf: cpfSintetico() },
      vinculos: lista((i) => ({ id: i ? uuid(i) : vinculoId, matricula: `15-${i + 1}`, sistemaOrigem: 'fixture',
        matriculaAnteriorId: null, regimeJuridico: 'ESTATUTARIO', cargo: 'Cargo fictício', classe: null, nivel: null,
        referencia: 'UNICA', setor: 'Setor fictício', orgao: 'Órgão fictício', admissao: '2020-01-01',
        desligamento: null, removidoNaFonte: false }), quantidadeVinculos), proximoCursor: null,
      ...(p.endsWith('ficha') ? { totalVinculos: quantidadeVinculos, totalHistoricoFuncional: count } : {}),
    };
    else if (p === `servidores/${pessoaId}/documentos`) dados = { itens: lista((i) => ({
      id: uuid(i), vinculoId, tipo: 'DOF', matricula: '15-1', situacao: 'rascunho', numero: null, emissaoId: null, atualizadoEm: agora,
    })), proximoCursor: null };
    else if (p.endsWith('/referencias')) dados = { pessoaId, vinculoId, revisaoPessoa: '1', revisaoVinculo: '1',
      removidoNaFonte: false, cadastro: cadastro(config), pessoa: { Nome: nomes(config), admissao: '2020-01-01' },
      registros: lista((i) => ({ id: uuid(i), campos: { descricao: 'Evento fictício', inicio: '2020-01-01', fim: '2021-12-31',
        mes_inicio: '2020-01-01', mes_fim: '2021-12-31', removido_na_fonte_em: null } })), proximoCursor: null };
    else if (p.endsWith('/sugestoes')) dados = { itens: [], proximoCursor: null };
    else if (p.endsWith('/eventos')) dados = { itens: lista((i) => ({ id: uuid(i), tipo: 'Férias', dataEvento: '2020-01-01',
      atoTipo: 'Portaria', atoNumero: '123', dataPublicacao: '2020-01-02', fonte: 'fixture', removidoNaFonte: false })), proximoCursor: null };
    else if (p.endsWith('/historico')) {
      const financeiro = url.searchParams.get('grupo') === 'financeiro';
      dados = { itens: lista((i) => ({ id: uuid(i), pessoaId, vinculoId, revisao: 1, atualizadoEm: agora, loteId: null, linhaOrigem: null,
        registro: { grupo: financeiro ? 'financeiro' : 'funcional', tipo: financeiro ? 'lancamento' : 'ferias',
          situacao: financeiro ? 'pago' : 'gozado', inicio: financeiro ? null : '2020-01-01', fim: financeiro ? null : '2020-01-30',
          aquisitivoInicio: financeiro ? null : '2019-01-01', aquisitivoFim: financeiro ? null : '2019-12-31',
          diasInformados: financeiro ? null : 30, especieLicenca: null, ato: null,
          descricao: nomes(config), efeitoTempo: 'nao_informado', efeitoRemuneracao: 'nao_informado',
          competencia: financeiro ? '2020-01' : null, competenciaOrigem: null, pagamento: financeiro ? '2020-01-31' : null,
          rubrica: financeiro ? '001 — Provento fictício' : null, natureza: financeiro ? 'provento' : null,
          valor: financeiro ? '1000.00' : null, folha: financeiro ? 'normal' : null,
          origem: 'fixture', idOrigem: null, eventoId: null, relacionadoId: null } })),
        proximoCursor: longo ? uuid(51) : null,
        totais: { registros: count + (longo ? 1 : 0), proventosPagos: financeiro ? `${count * 1000}.00` : '0.00',
          descontosPagos: '0.00', proventosEstornados: '0.00', descontosEstornados: '0.00' } };
    }
    else if (p === 'documentos/lista') {
      const aba = url.searchParams.get('aba') ?? 'rascunhos';
      const grupo = url.searchParams.get('grupo');
      const tipo = grupo === 'DTC' ? opcoes.tipo ?? 'DTC_IPAM' : 'DOF';
      dados = { itens: grupo === 'DTC' && aba === 'encaminhadas' ? [] : lista((i) => ({ id: i ? uuid(i) : documentoId, pessoaId, vinculoId, tipo,
        nome: nomes(config), matricula: `15-${i + 1}`, autorNome: 'Autor fictício', situacao: aba, revisao: 1, atualizadoEm: agora,
        somenteLeitura: aba === 'encaminhadas' && config.perfil === 'coordenador',
        conferenciaDof: tipo === 'DOF' && aba === 'conferidas' ? { id: i ? uuid(i) : documentoId,
          pessoaId, vinculoId, nome: nomes(config), matricula: '15-1', revisao: 1, atualizadoEm: agora,
          autorNome: 'Autor fictício', conferidoEm: agora, conferidoPorNome: 'Conferente fictício', fonteSelecionadaAlterada: false } : null })),
        contagens: { rascunhos: count, encaminhadas: grupo === 'DTC' ? 0 : count, devolvidas: count, conferidas: count },
        total: grupo === 'DTC' && aba === 'encaminhadas' ? 0 : count + (longo ? 1 : 0),
        totalPaginas: grupo === 'DTC' && aba === 'encaminhadas' ? 0 : longo ? 2 : count ? 1 : 0, pagina: 1 };
    } else if (p === `documentos/${documentoId}`) dados = dof(config);
    else if (p.endsWith('/dados-previa')) dados = fonte(config);
    else if (p.endsWith('/dados-previa-conferida')) dados = { documentoId, revisao: 1, status: 'conferido', nome: nomes(config),
      matricula: '15-1', resultado: dof(config).resultado, blocos: [], processo: '1234/2026', fonte: fonte(config), fonteSelecionadaAlterada: false };
    else if (p.endsWith('/ultima-devolucao')) dados = { documentoId, revisao: 1, devolucao: null };
    else if (p === 'documentos/coordenadores') dados = { itens: [{ id: uuid(60), nome: 'Coordenador fictício', matricula: 'COORD-FICTICIO' }], proximoCursor: null };
    else if (p.endsWith('/preconferencia')) dados = { documentoId, revisao: 1, verificadoEm: agora, status: 'nao_conferido',
      conferenciaDisponivel: true, fontePreviaValidada: true, provaRelatorio: 'c'.repeat(64), bloqueios: [], avisos: [] };
    else if (p.startsWith('dtc/') && p.endsWith('/previa')) {
      const { nivel: _nivel, avisoNivel: _aviso, ...comum } = fonte(config);
      dados = { documento: dtc(config, opcoes.tipo ?? 'DTC_IPAM', opcoes.conferida ?? false),
        fonte: { ...comum, nomePai: null, rg: null, rgOrgao: null, rgExpedicao: null, pisPasep: null,
          tituloEleitor: null, endereco: null, periodosIpam: [] }, fonteSelecionadaAlterada: false };
    }
    else if (p === 'admin/usuarios') dados = { itens: lista((i) => ({ id: uuid(i), matricula: `VISUAL-${i}`,
      nome: nomes(config), email: null, papel: i ? 'analista' : 'admin', ativo: i % 2 === 0, trocaSenhaObrigatoria: true })),
      proximoCursor: longo ? uuid(51) : null };
    else if (p === 'admin/auditoria') dados = { itens: lista((i) => ({ id: uuid(i), em: agora, acao: 'consulta_ficticia',
      entidade: 'servidor', entidadeId: pessoaId, usuarioId })), proximoCursor: longo ? agora : null };
    else if (p === 'admin/sincronizacoes') dados = { situacao, falhasConsecutivas: 0, disjuntorAbertoAte: null,
      itens: lista((i) => ({ id: uuid(i), origem: 'fixture', tipo: 'completa', status: i % 2 ? 'falhou' : 'concluido',
        iniciadoEm: agora, concluidoEm: agora, lidos: 51, inseridos: 0, atualizados: 0, removidos: 0, totalErros: 0, erros: [] })), proximoCursor: null };
    else if (p === 'admin/importacoes/conferencia') dados = { origens: [], totais: { pessoas: 0, vinculos: 0 } };
    else if (p === 'admin/importacoes') dados = { itens: lista((i) => ({ id: uuid(i), tipo: 'dados_funcionais', origem: 'fixture',
      canal: 'tela', status: i % 2 ? 'falhou' : 'concluido', contagens: { lidos: 51, inseridos: 0 },
      usuario: nomes(config), iniciadoEm: agora, concluidoEm: agora, desfeitoEm: null })), proximoCursor: null };
    else if (p === 'admin/importacoes/legado') dados = lista((i) => ({ id: uuid(i), origem: 'fixture',
      cabecalhos: ['NOME', 'MATRICULA', 'CPF'], linhas: 51, importadoEm: agora }));
    else if (p === 'historico') dados = { grupo: url.searchParams.get('tipo') ?? 'DOF', escopo: url.searchParams.get('escopo') ?? 'proprio',
      itens: lista((i) => ({ emissaoId: uuid(i), documentoId, tipo: 'DOF', numero: `DOF/2026/${i + 1}`,
        emitidoEm: agora, emitidoPorNome: 'Emitente fictício', status: i % 2 ? 'cancelado' : 'emitido',
        canceladoEm: i % 2 ? agora : null, pdf: { status: i % 2 ? 'falhou' : 'concluido', tentativas: 1,
          erro: i % 2 ? 'Erro fictício. Tente novamente.' : null, disponivel: i % 2 === 0 },
        nome: nomes(config), matricula: '15-1', revisao: 1, podeCopiar: config.perfil !== 'admin',
        podeCancelar: config.perfil !== 'analista', podeBaixar: true, podeExcluir: config.perfil === 'admin' })) };
    else {
      inesperadas.push(`${req.method()} ${p}`);
      return route.fulfill({ status: 501, contentType: 'application/json',
        body: JSON.stringify({ detail: `Rota não simulada: ${req.method()} ${p}` }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dados) });
  });
  return { inesperadas, liberar: () => liberar.forEach((fn) => fn()) };
}
