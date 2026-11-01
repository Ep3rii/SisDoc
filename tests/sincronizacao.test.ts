import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import type { IncomingHttpHeaders } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  configuracaoSincronizacaoSchema,
  documentoDtcSchema,
  paginaApiSincronizacaoSchema,
  paginaBuscaServidoresSchema,
  paginaSincronizacoesSchema,
  previaDtcSchema,
  respostaSessaoSchema,
  resultadoTransicaoDtcSchema,
  servidorApiSincronizacaoSchema,
  situacaoSincronizacaoSchema,
  type Configuracao,
  type ConfiguracaoSincronizacao,
  type LoteSincronizacao,
} from '@sisdoc/contratos';
import { ModulesContainer } from '@nestjs/core';
import EmbeddedPostgres from 'embedded-postgres';
import forge from 'node-forge';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAplicacao } from '../apps/api/dist/aplicacao.js';
import { carregarConfiguracao } from '../apps/api/dist/configuracao.js';
import { ProtetorDados } from '../apps/api/dist/seguranca/protecao-dados.js';
import { gerarHashSenha } from '../apps/api/dist/seguranca/senhas.js';
import { registrarAprovacaoModelo } from '../apps/api/dist/setup/aprovacao-modelo.js';
import { instalar, type OpcoesInstalacao } from '../apps/api/dist/setup/instalador.js';
import { ClienteApiSincronizacao, ErroApiExterna } from '../apps/api/dist/sincronizacao/cliente-api.js';
import type { SincronizacaoService } from '../apps/api/dist/sincronizacao/sincronizacao.js';
import {
  cpfFicticioSimulado,
  iniciarApiSimulada,
  servidorFicticio,
  type ApiSimulada,
} from '../tools/api-simulada/servidor.js';

const senhaMigrador = 'MigracaoSincFicticia!12345';
const senhaAplicativo = 'AplicativoSincFicticio!12345';
const senhaAdmin = 'AdministradorSincFicticio!12345';
const senhaUsuarios = 'UsuarioSincFicticio!12345';
const nomeTls = 'sisdoc.local';
const tokenFicticio = 'TokenFicticioDeTeste-0123456789';
const raizRepositorio = path.resolve(__dirname, '..');

type Sessao = { cookie: string; csrf: string };
type Resposta = { status: number | undefined; corpo: string; headers: IncomingHttpHeaders };
type Aplicacao = Awaited<ReturnType<typeof criarAplicacao>>;

async function portaLivre(): Promise<number> {
  const servidor = net.createServer();
  await new Promise<void>((resolve, reject) => servidor.once('error', reject).listen(0, '127.0.0.1', resolve));
  const endereco = servidor.address();
  if (!endereco || typeof endereco === 'string') throw new Error('Porta temporária indisponível.');
  await new Promise<void>((resolve, reject) => servidor.close((erro) => erro ? reject(erro) : resolve()));
  return endereco.port;
}

function certificadosFicticios(): { ca: string; certificado: string; chave: string } {
  const chavesCa = forge.pki.rsa.generateKeyPair(2048);
  const ca = forge.pki.createCertificate();
  ca.publicKey = chavesCa.publicKey;
  ca.serialNumber = '01';
  ca.validity.notBefore = new Date(Date.now() - 60000);
  ca.validity.notAfter = new Date(Date.now() + 86400000);
  const nomeCa = [{ name: 'commonName', value: 'CA temporaria de testes de sincronizacao' }];
  ca.setSubject(nomeCa);
  ca.setIssuer(nomeCa);
  ca.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  ca.sign(chavesCa.privateKey, forge.md.sha256.create());
  const chavesServidor = forge.pki.rsa.generateKeyPair(2048);
  const certificado = forge.pki.createCertificate();
  certificado.publicKey = chavesServidor.publicKey;
  certificado.serialNumber = '02';
  certificado.validity.notBefore = new Date(Date.now() - 60000);
  certificado.validity.notAfter = new Date(Date.now() + 86400000);
  certificado.setSubject([{ name: 'commonName', value: nomeTls }]);
  certificado.setIssuer(nomeCa);
  certificado.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: nomeTls }] },
  ]);
  certificado.sign(chavesCa.privateKey, forge.md.sha256.create());
  return {
    ca: forge.pki.certificateToPem(ca),
    certificado: forge.pki.certificateToPem(certificado),
    chave: forge.pki.privateKeyToPem(chavesServidor.privateKey),
  };
}

// O teste importa o dist por outro carregador de módulos; a classe é localizada pelo nome no contêiner do Nest.
function servicoSincronizacao(app: Aplicacao): SincronizacaoService {
  for (const modulo of app.get(ModulesContainer).values()) {
    for (const provedor of modulo.providers.values()) {
      const instancia: unknown = provedor.instance;
      if (instancia instanceof Object && instancia.constructor.name === 'SincronizacaoService') return instancia as SincronizacaoService;
    }
  }
  throw new Error('Serviço de sincronização ausente na aplicação.');
}

// Item inválido de propósito: CPF com dígito verificador errado e nenhum vínculo; nunca pode aparecer em erros.
const CPF_INVALIDO = `${cpfFicticioSimulado(700009001).slice(0, 10)}${(Number(cpfFicticioSimulado(700009001)[10]) + 1) % 10}`;
const NOME_INVALIDO = 'Pessoa Invalida Sigilosa Ficticia';

function itemInvalido(): Record<string, unknown> {
  return {
    ...servidorFicticio(9001), cpf: CPF_INVALIDO, nome: NOME_INVALIDO, vinculos: [],
  };
}

const ANOS_DTC = Array.from({ length: 5 }, (_, posicao) => ({
  ano: 1980 + posicao, abrangencia: 'intervalo_declarado',
  faltas: 0, ts: 0, pf: 0, ip: 0, outros: 0, pb: 0, pv: 0, licencaPremio: 0,
}));

describe('Sincronização com a API externa (simulada)', () => {
  let temporario = '';
  let raiz = '';
  let postgres: EmbeddedPostgres | undefined;
  let iniciado = false;
  let administradorBanco: Client | undefined;
  let migrador: Client | undefined;
  const pools: Pool[] = [];
  const aplicacoes: Aplicacao[] = [];
  let config: Configuracao;
  let protetor: ProtetorDados;
  let portaBanco = 0;
  let portaPadrao = 0;
  let portaSinc = 0;
  let caPem = '';
  let opcoes: OpcoesInstalacao;
  let arquivoToken = '';
  let api: ApiSimulada;
  let appSinc: Aplicacao;
  let servico: SincronizacaoService;
  const esperas: number[] = [];
  const usuarios = new Map<string, { id: string; sessao: Sessao }>();
  const lotes = new Map<string, LoteSincronizacao>();
  const agendadaAnterior = process.env.SISDOC_SINCRONIZACAO_AGENDADA;
  const workerAnterior = process.env.SISDOC_WORKER_PDF;

  function banco(): Client {
    if (!migrador) throw new Error('Conexão de migração indisponível.');
    return migrador;
  }

  function sessao(chave: string): Sessao {
    const usuario = usuarios.get(chave);
    if (!usuario) throw new Error(`Usuário sintético ${chave} ausente.`);
    return usuario.sessao;
  }

  async function requisitar(opcoesPedido: {
    metodo: 'GET' | 'POST'; rota: string; corpo?: unknown; sessao?: Sessao; chave?: string; porta?: number;
  }): Promise<Resposta> {
    const porta = opcoesPedido.porta ?? portaSinc;
    const conteudo = opcoesPedido.corpo === undefined ? undefined : JSON.stringify(opcoesPedido.corpo);
    return new Promise((resolve, reject) => {
      const pedido = https.request({
        host: '127.0.0.1',
        port: porta,
        servername: nomeTls,
        path: `/api/v1/${opcoesPedido.rota}`,
        method: opcoesPedido.metodo,
        ca: caPem,
        rejectUnauthorized: true,
        agent: false,
        timeout: 30000,
        headers: {
          Origin: `https://${nomeTls}:${porta}`,
          ...(conteudo === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(opcoesPedido.sessao ? { Cookie: opcoesPedido.sessao.cookie, 'X-CSRF-Token': opcoesPedido.sessao.csrf } : {}),
          ...(opcoesPedido.chave === undefined ? {} : { 'Idempotency-Key': opcoesPedido.chave }),
        },
      }, (resposta) => {
        const partes: Buffer[] = [];
        resposta.on('data', (parte: Buffer) => partes.push(parte));
        resposta.on('end', () => {
          resolve({ status: resposta.statusCode, corpo: Buffer.concat(partes).toString('utf8'), headers: resposta.headers });
        });
        resposta.on('error', reject);
      });
      pedido.once('timeout', () => pedido.destroy(new Error(`Tempo HTTPS esgotado em ${opcoesPedido.metodo} ${opcoesPedido.rota}.`)));
      pedido.once('error', reject);
      pedido.end(conteudo);
    });
  }

  async function criarUsuario(chave: string, papel: string): Promise<void> {
    const id = randomUUID();
    const matricula = `SINC-${chave.toUpperCase()}`;
    await banco().query(`
      INSERT INTO seguranca.usuario (id, matricula, nome, senha_hash, papel, troca_senha_obrigatoria)
      VALUES ($1, $2, $3, $4, $5, false)
    `, [id, matricula, `Operador sintético ${chave}`, await gerarHashSenha(senhaUsuarios), papel]);
    const login = await requisitar({ metodo: 'POST', rota: 'auth/login', corpo: { matricula, senha: senhaUsuarios } });
    expect(login.status, login.corpo).toBe(200);
    const cookie = login.headers['set-cookie']?.[0].split(';')[0];
    if (!cookie) throw new Error('Cookie sintético ausente.');
    usuarios.set(chave, { id, sessao: { cookie, csrf: respostaSessaoSchema.parse(JSON.parse(login.corpo)).csrf } });
  }

  async function subirAplicacao(
    porta: number, sincronizacao: ConfiguracaoSincronizacao | undefined,
  ): Promise<Aplicacao> {
    const pool = new Pool({
      host: config.banco.host, port: config.banco.porta, database: config.banco.nome,
      user: config.banco.usuario, password: config.banco.senha, max: 10,
    });
    pools.push(pool);
    const app = await criarAplicacao({ ...config, porta, ...(sincronizacao ? { sincronizacao } : {}) }, pool);
    await app.listen(porta, '127.0.0.1');
    aplicacoes.push(app);
    return app;
  }

  function configuracaoSinc(url: string, extra: Record<string, unknown> = {}): ConfiguracaoSincronizacao {
    return configuracaoSincronizacaoSchema.parse({
      origem: 'api-teste', url, credencialArquivo: arquivoToken, timeoutMs: 500, limitePagina: 2,
      esperaRepeticaoMs: 10, ...extra,
    });
  }

  async function iniciar(tipo: 'completa' | 'incremental', porta = portaSinc): Promise<Resposta> {
    return requisitar({ metodo: 'POST', rota: 'admin/sincronizacoes', sessao: sessao('admin'), corpo: { tipo }, porta });
  }

  async function executar(tipo: 'completa' | 'incremental'): Promise<LoteSincronizacao> {
    const resposta = await iniciar(tipo);
    expect(resposta.status, resposta.corpo).toBe(202);
    const inicial = JSON.parse(resposta.corpo) as LoteSincronizacao;
    await servico.aguardarExecucao();
    return loteAtual(inicial.id);
  }

  async function listar(porta = portaSinc) {
    const resposta = await requisitar({ metodo: 'GET', rota: 'admin/sincronizacoes?limite=50', sessao: sessao('admin'), porta });
    expect(resposta.status, resposta.corpo).toBe(200);
    return { pagina: paginaSincronizacoesSchema.parse(JSON.parse(resposta.corpo)), bruto: resposta.corpo };
  }

  async function loteAtual(id: string): Promise<LoteSincronizacao> {
    const { pagina } = await listar();
    const lote = pagina.itens.find((item) => item.id === id);
    if (!lote) throw new Error('Lote de sincronização ausente na listagem.');
    return lote;
  }

  async function situacao(quem = 'analista', porta = portaSinc) {
    const resposta = await requisitar({ metodo: 'GET', rota: 'sincronizacao/situacao', sessao: sessao(quem), porta });
    expect(resposta.status, resposta.corpo).toBe(200);
    return situacaoSincronizacaoSchema.parse(JSON.parse(resposta.corpo));
  }

  async function revisoes(): Promise<string> {
    const resultado = await banco().query<{ linha: string }>(`
      SELECT string_agg(x.linha, '|' ORDER BY x.linha) AS linha FROM (
        SELECT 'p:' || p.id || ':' || p.revisao_fonte || ':' || o.sincronizado_em AS linha
        FROM nucleo.pessoa p JOIN nucleo.pessoa_origem o ON o.pessoa_id = p.id WHERE o.sistema_origem = 'api-teste'
        UNION ALL
        SELECT 'v:' || v.id || ':' || v.revisao_fonte || ':' || v.sincronizado_em FROM nucleo.vinculo v
        WHERE v.sistema_origem = 'api-teste'
      ) x
    `);
    return resultado.rows[0].linha;
  }

  async function estado() {
    const resultado = await banco().query<{ falhas_consecutivas: number; disjuntor_aberto_em: Date | null }>(
      "SELECT falhas_consecutivas, disjuntor_aberto_em FROM nucleo.sincronizacao_estado WHERE origem = 'api-teste'",
    );
    return resultado.rows[0];
  }

  function semDadosPessoais(texto: string): void {
    expect(texto).not.toContain(CPF_INVALIDO);
    expect(texto).not.toContain(NOME_INVALIDO);
    expect(texto).not.toContain('Sigilosa');
    for (let indice = 1; indice <= 6; indice += 1) {
      const cpf = cpfFicticioSimulado(700000000 + indice);
      expect(texto).not.toContain(cpf);
      expect(texto).not.toContain(`Servidor Ficticio API ${String(indice).padStart(4, '0')}`);
    }
    expect(texto).not.toContain(tokenFicticio);
  }

  beforeAll(async () => {
    if (process.platform !== 'win32' || !process.env.PUBLIC) {
      throw new Error('Esta verificação de instalação requer Windows e uma pasta pública local.');
    }
    const temporarios = process.env.SISDOC_TEST_TEMP ?? os.tmpdir();
    if (!path.isAbsolute(temporarios) || /[^\x00-\x7f]/.test(temporarios)) {
      throw new Error('Defina SISDOC_TEST_TEMP com um diretório local absoluto ASCII ou com caminho curto 8.3 existente.');
    }
    process.env.SISDOC_SINCRONIZACAO_AGENDADA = 'desligado';
    process.env.SISDOC_WORKER_PDF = 'desligado';
    temporario = await mkdtemp(path.join(temporarios, 'sisdoc-sinc-'));
    raiz = path.join(await realpath(process.env.PUBLIC), `SisDocVerificacao-${randomUUID()}`);
    portaBanco = await portaLivre();
    portaPadrao = await portaLivre();
    portaSinc = await portaLivre();
    const materiais = certificadosFicticios();
    caPem = materiais.ca;
    const certificado = path.join(temporario, 'servidor.crt');
    const chave = path.join(temporario, 'servidor.key');
    const ca = path.join(temporario, 'ca.crt');
    const listaSenhas = path.join(temporario, 'senhas.txt');
    arquivoToken = path.join(temporario, 'token-api.txt');
    await Promise.all([
      writeFile(certificado, materiais.certificado),
      writeFile(chave, materiais.chave),
      writeFile(ca, materiais.ca),
      writeFile(listaSenhas, 'SenhaComumFicticia!12345\n'),
      writeFile(arquivoToken, `${tokenFicticio}\n`),
    ]);
    postgres = new EmbeddedPostgres({
      databaseDir: path.join(temporario, 'postgres'),
      user: 'postgres',
      password: 'SuperusuarioSincFicticio!12345',
      port: portaBanco,
      persistent: true,
      authMethod: 'scram-sha-256',
      initdbFlags: ['--encoding=UTF8'],
      postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
      onLog: () => {},
    });
    await postgres.initialise();
    await postgres.start();
    iniciado = true;
    administradorBanco = postgres.getPgClient();
    await administradorBanco.connect();
    await administradorBanco.query(`CREATE ROLE sisdoc_migrador LOGIN PASSWORD '${senhaMigrador}'`);
    await administradorBanco.query(`CREATE ROLE sisdoc_aplicativo LOGIN PASSWORD '${senhaAplicativo}'`);
    await administradorBanco.query('CREATE DATABASE sisdoc_sinc OWNER sisdoc_migrador');
    opcoes = {
      raiz,
      porta: portaPadrao,
      banco: {
        porta: portaBanco, nome: 'sisdoc_sinc', migrador: 'sisdoc_migrador', senhaMigrador,
        usuario: 'sisdoc_aplicativo', senha: senhaAplicativo,
      },
      tls: { certificado, chave, ca, nome: nomeTls },
      sidServico: 'S-1-5-19',
      listaSenhas,
      processos: { mascaras: ['####/####'] },
      administrador: { matricula: 'ADMIN-SINC-FICTICIO', nome: 'Operador Fictício', senha: senhaAdmin },
    };
    await instalar(opcoes);
    config = await carregarConfiguracao(path.join(raiz, 'config', 'aplicacao.json'));
    protetor = new ProtetorDados(config.chaves);
    migrador = new Client({
      host: '127.0.0.1', port: portaBanco, database: 'sisdoc_sinc', user: 'sisdoc_migrador', password: senhaMigrador,
    });
    await migrador.connect();

    api = await iniciarApiSimulada({
      token: tokenFicticio,
      itens: [1, 2, 3, 4, 5].map((indice) => servidorFicticio(indice)).concat([itemInvalido()]),
    });
    appSinc = await subirAplicacao(portaSinc, configuracaoSinc(api.url));
    servico = servicoSincronizacao(appSinc);
    servico.opcoesCliente = {
      esperar: async (ms) => {
        esperas.push(ms);
      },
    };
    await subirAplicacao(portaPadrao, undefined);
    for (const [chave, papel] of [
      ['analista', 'analista'], ['coordenador', 'coordenador'], ['secretario', 'secretario_adjunto'], ['admin', 'admin'],
    ] as const) {
      await criarUsuario(chave, papel);
    }
  });

  afterAll(async () => {
    if (agendadaAnterior === undefined) delete process.env.SISDOC_SINCRONIZACAO_AGENDADA;
    else process.env.SISDOC_SINCRONIZACAO_AGENDADA = agendadaAnterior;
    if (workerAnterior === undefined) delete process.env.SISDOC_WORKER_PDF;
    else process.env.SISDOC_WORKER_PDF = workerAnterior;
    for (const app of aplicacoes) await app.close();
    for (const pool of pools) if (!pool.ended) await pool.end();
    if (api) await api.encerrar();
    if (migrador) await migrador.end();
    if (administradorBanco) await administradorBanco.end();
    if (iniciado && postgres) await postgres.stop();
    if (raiz && path.basename(raiz).startsWith('SisDocVerificacao-')) {
      await rm(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
    if (temporario && path.basename(temporario).startsWith('sisdoc-sinc-')) {
      await rm(temporario, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  it('valida o exemplo fictício do contrato e a configuração da credencial', async () => {
    const exemplo = paginaApiSincronizacaoSchema.parse(JSON.parse(
      await readFile(path.join(raizRepositorio, 'referencias', 'api-simulada', 'pagina-exemplo.json'), 'utf8'),
    ));
    expect(servidorApiSincronizacaoSchema.safeParse(exemplo.itens[0]).success).toBe(true);
    expect(servidorApiSincronizacaoSchema.safeParse(exemplo.itens[1]).success).toBe(true);
    expect(servidorApiSincronizacaoSchema.safeParse(exemplo.itens[2]).success).toBe(false);
    expect(servidorApiSincronizacaoSchema.safeParse(servidorFicticio(7)).success).toBe(true);
    expect(servidorApiSincronizacaoSchema.safeParse(itemInvalido()).success).toBe(false);
    expect(configuracaoSincronizacaoSchema.safeParse({ origem: 'x', url: 'ftp://127.0.0.1/a' }).success).toBe(false);
    expect(configuracaoSincronizacaoSchema.safeParse({ origem: 'x', url: 'https://u:s@127.0.0.1/a' }).success).toBe(false);
    expect(configuracaoSincronizacaoSchema.safeParse({ origem: 'x', url: 'https://127.0.0.1/a', limitePagina: 51 }).success)
      .toBe(false);
    const padrao = configuracaoSincronizacaoSchema.parse({ origem: 'x', url: 'https://127.0.0.1/a' });
    expect(padrao).toMatchObject({ avisoHoras: 24, timeoutMs: 10000, limitePagina: 50 });

    const base = JSON.parse(await readFile(path.join(raiz, 'config', 'aplicacao.json'), 'utf8')) as Record<string, unknown>;
    const arquivo = path.join(temporario, 'config-sincronizacao.json');
    const carregar = async (credencialArquivo: string) => {
      await writeFile(arquivo, JSON.stringify({
        ...base, sincronizacao: { origem: 'api-teste', url: 'https://api.exemplo.invalid/servidores', credencialArquivo },
      }));
      return carregarConfiguracao(arquivo);
    };
    await expect(carregar('token-api.txt')).rejects.toThrow('caminho absoluto');
    await expect(carregar(path.join(raizRepositorio, 'package.json'))).rejects.toThrow('fora do repositório');
    await expect(carregar(path.join(temporario, 'inexistente.txt'))).rejects.toThrow('credencial');
    const valida = await carregar(arquivoToken);
    expect(valida.sincronizacao).toMatchObject({ origem: 'api-teste', avisoHoras: 24, timeoutMs: 10000, limitePagina: 50 });
  });

  it('cliente HTTP respeita 429, repete falhas temporárias, aplica timeout e sanitiza erros', async () => {
    const simulada = await iniciarApiSimulada({ token: tokenFicticio, itens: [servidorFicticio(1)] });
    const registro: number[] = [];
    const cliente = (extra: Record<string, unknown> = {}, credencial = tokenFicticio) => new ClienteApiSincronizacao(
      configuracaoSincronizacaoSchema.parse({
        origem: 'unidade', url: simulada.url, credencialArquivo: arquivoToken, timeoutMs: 200, esperaRepeticaoMs: 10,
        ...extra,
      }),
      { esperar: async (ms) => { registro.push(ms); }, lerCredencial: async () => credencial },
    );
    try {
      const pagina = await cliente().buscarPagina({ alteradoDesde: '2020-01-01T00:00:00.000Z' });
      expect(pagina.itens).toHaveLength(1);
      expect(simulada.requisicoes.at(-1)).toMatchObject({ limite: 50, autorizado: true, alteradoDesde: '2020-01-01T00:00:00.000Z' });

      simulada.filaFalhas.push({ tipo: 'status', status: 429, retryAfter: '2' });
      registro.length = 0;
      await cliente().buscarPagina();
      expect(registro).toEqual([2000]);

      simulada.filaFalhas.push({ tipo: 'status', status: 429, retryAfter: '120' });
      await expect(cliente().buscarPagina()).rejects.toThrow('pausa maior');

      const antes = simulada.requisicoes.length;
      registro.length = 0;
      simulada.filaFalhas.push(...Array.from({ length: 4 }, () => ({ tipo: 'status' as const, status: 500 })));
      const falha500 = await cliente().buscarPagina().catch((erro: unknown) => erro);
      expect(falha500).toBeInstanceOf(ErroApiExterna);
      expect((falha500 as Error).message).not.toContain('falha simulada');
      expect(simulada.requisicoes.length - antes).toBe(4);
      expect(registro).toEqual([10, 20, 40]);

      simulada.filaFalhas.push({ tipo: 'reset' }, { tipo: 'status', status: 503 });
      expect((await cliente().buscarPagina()).itens).toHaveLength(1);

      const antesTimeout = simulada.requisicoes.length;
      simulada.filaFalhas.push(...Array.from({ length: 4 }, () => ({ tipo: 'travar' as const })));
      const inicio = Date.now();
      await expect(cliente().buscarPagina()).rejects.toThrow('tempo limite');
      expect(simulada.requisicoes.length - antesTimeout).toBe(4);
      expect(Date.now() - inicio).toBeGreaterThanOrEqual(700);

      const antesJson = simulada.requisicoes.length;
      simulada.filaFalhas.push({ tipo: 'json_invalido' });
      await expect(cliente().buscarPagina()).rejects.toThrow('JSON válido');
      expect(simulada.requisicoes.length - antesJson).toBe(1);

      const antes401 = simulada.requisicoes.length;
      const recusada = await cliente({}, 'TokenErradoFicticio-999').buscarPagina().catch((erro: unknown) => erro);
      expect((recusada as Error).message).toContain('credencial');
      expect((recusada as Error).message).not.toContain('TokenErrado');
      expect(simulada.requisicoes.length - antes401).toBe(1);
      await expect(cliente({}, 'curto').buscarPagina()).rejects.toThrow('token válido');

      simulada.inserir(servidorFicticio(2));
      simulada.inserir(servidorFicticio(3));
      const primeira = await cliente({ limitePagina: 2 }).buscarPagina();
      expect(primeira.itens).toHaveLength(2);
      expect(primeira.proximo_cursor).not.toBeNull();
      const segunda = await cliente({ limitePagina: 2 }).buscarPagina({ cursor: primeira.proximo_cursor });
      expect(segunda.itens).toHaveLength(1);
      expect(segunda.proximo_cursor).toBeNull();
    } finally {
      await simulada.encerrar();
    }
  });

  it('sem configuração: situação informa e o início é recusado com mensagem clara; permissões por papel', async () => {
    for (const quem of ['analista', 'coordenador', 'secretario', 'admin']) {
      expect(await situacao(quem, portaPadrao)).toMatchObject({ configurada: false, avisoAtraso: false, ultimaSincronizacaoEm: null });
      expect((await situacao(quem)).configurada).toBe(true);
    }
    const recusa = await iniciar('completa', portaPadrao);
    expect(recusa.status, recusa.corpo).toBe(409);
    expect(JSON.parse(recusa.corpo).detail).toContain('não está configurada');
    for (const quem of ['analista', 'coordenador', 'secretario']) {
      for (const porta of [portaPadrao, portaSinc]) {
        const inicio = await requisitar({
          metodo: 'POST', rota: 'admin/sincronizacoes', sessao: sessao(quem), corpo: { tipo: 'completa' }, porta,
        });
        expect(inicio.status).toBe(403);
        expect((await requisitar({ metodo: 'GET', rota: 'admin/sincronizacoes', sessao: sessao(quem), porta })).status).toBe(403);
      }
    }
    expect((await requisitar({ metodo: 'GET', rota: 'sincronizacao/situacao' })).status).toBe(401);
    expect((await requisitar({ metodo: 'GET', rota: 'admin/sincronizacoes' })).status).toBe(401);
    const tipoInvalido = await requisitar({
      metodo: 'POST', rota: 'admin/sincronizacoes', sessao: sessao('admin'), corpo: { tipo: 'servidor' },
    });
    expect(tipoInvalido.status).toBe(400);
    const incrementalPrimeiro = await iniciar('incremental');
    expect(incrementalPrimeiro.status).toBe(409);
    expect(JSON.parse(incrementalPrimeiro.corpo).detail).toContain('sincronização completa antes');
    const antes = await situacao();
    expect(antes).toMatchObject({ configurada: true, ultimaSincronizacaoEm: null, avisoAtraso: true, disjuntorAberto: false });
    const total = await banco().query("SELECT count(*)::int AS total FROM nucleo.sincronizacao_lote WHERE origem = 'api-teste'");
    expect(total.rows[0].total).toBe(0);
  });

  it('carga completa pagina, cifra o staging, registra erros sanitizados e não aborta os itens válidos', async () => {
    const lote = await executar('completa');
    lotes.set('completa', lote);
    expect(lote).toMatchObject({ status: 'concluido', tipo: 'completa', lidos: 6, inseridos: 5, atualizados: 0, removidos: 0 });
    expect(lote.totalErros).toBe(1);
    expect(lote.erros[0]).toMatchObject({ posicao: 6 });
    expect(lote.erros[0].referencia).toMatch(/^[0-9a-f]{16}$/);
    expect(lote.erros[0].motivo).toContain('Dados inválidos');
    const pedidos = api.requisicoes.filter((pedido) => pedido.autorizado);
    expect(pedidos).toHaveLength(3);
    expect(pedidos.every((pedido) => pedido.limite === 2 && pedido.alteradoDesde === null)).toBe(true);

    const pessoas = await banco().query<{ total: number }>(
      "SELECT count(*)::int AS total FROM nucleo.pessoa_origem WHERE sistema_origem = 'api-teste'",
    );
    expect(pessoas.rows[0].total).toBe(5);
    const vinculo = await banco().query<{ matricula: string; admissao: string; hash: boolean }>(`
      SELECT matricula, admissao::text AS admissao, hash_conteudo IS NOT NULL AS hash FROM nucleo.vinculo
      WHERE sistema_origem = 'api-teste' AND id_origem = 'VIN-0001-1'
    `);
    expect(vinculo.rows[0]).toEqual({ matricula: 'API-0001-1', admissao: '1979-01-01', hash: true });
    const cpf = cpfFicticioSimulado(700000001);
    const pessoa = await banco().query<{ id: string; cpf_cifrado: Buffer; cpf_hash: Buffer; nome_mae_cifrado: Buffer }>(`
      SELECT p.id, p.cpf_cifrado, p.cpf_hash, p.nome_mae_cifrado FROM nucleo.pessoa p
      JOIN nucleo.pessoa_origem o ON o.pessoa_id = p.id WHERE o.sistema_origem = 'api-teste' AND o.id_origem = 'SRV-0001'
    `);
    const linha = pessoa.rows[0];
    expect(linha.cpf_cifrado.includes(Buffer.from(cpf))).toBe(false);
    expect(protetor.decifrar(linha.cpf_cifrado, {
      schema: 'nucleo', tabela: 'pessoa', registroId: linha.id, campo: 'cpf_cifrado',
    }).toString('utf8')).toBe(cpf);
    expect(linha.cpf_hash.equals(protetor.hashCpf(cpf))).toBe(true);
    expect(protetor.decifrar(linha.nome_mae_cifrado, {
      schema: 'nucleo', tabela: 'pessoa', registroId: linha.id, campo: 'nome_mae_cifrado',
    }).toString('utf8')).toBe('Mae Ficticia API 0001');

    const staging = await banco().query<{ id: string; id_origem: string; payload_cifrado: Buffer; processado: boolean }>(`
      SELECT id, id_origem, payload_cifrado, processado_em IS NOT NULL AS processado FROM nucleo.staging_api WHERE lote_id = $1
    `, [lote.id]);
    expect(staging.rows).toHaveLength(6);
    expect(staging.rows.every((item) => item.processado)).toBe(true);
    for (const item of staging.rows) {
      const bruto = item.payload_cifrado.toString('latin1');
      expect(bruto).not.toContain('Ficticio');
      expect(bruto).not.toContain('Sigilosa');
      const claro = JSON.parse(protetor.decifrar(item.payload_cifrado, {
        schema: 'nucleo', tabela: 'staging_api', registroId: item.id, campo: 'payload_cifrado',
      }).toString('utf8')) as { id: string };
      expect(claro.id).toBe(item.id_origem);
    }

    const busca = await requisitar({
      metodo: 'GET', rota: `servidores?q=${encodeURIComponent(cpf)}&tipo=cpf`, sessao: sessao('analista'),
    });
    expect(busca.status, busca.corpo).toBe(200);
    expect(paginaBuscaServidoresSchema.parse(JSON.parse(busca.corpo)).itens[0]).toMatchObject({
      nome: 'Servidor Ficticio API 0001', matricula: 'API-0001-1', sistemaOrigem: 'api-teste', removidoNaFonte: false,
    });
    expect(await situacao()).toMatchObject({ configurada: true, avisoAtraso: false, disjuntorAberto: false });
    expect((await situacao()).ultimaSincronizacaoEm).not.toBeNull();

    const { bruto } = await listar();
    semDadosPessoais(bruto);
    const erros = await banco().query<{ texto: string }>(
      "SELECT string_agg(erros_sanitizados::text, '') AS texto FROM nucleo.sincronizacao_lote",
    );
    semDadosPessoais(erros.rows[0].texto);
    const auditoria = await banco().query<{ acao: string; usuario: string | null; detalhes: string }>(`
      SELECT acao, usuario_id::text AS usuario, detalhes::text AS detalhes FROM seguranca.auditoria
      WHERE entidade = 'sincronizacao_lote' AND entidade_id = $1 ORDER BY id
    `, [lote.id]);
    expect(auditoria.rows.map((item) => item.acao)).toEqual(['sincronizacao_iniciada', 'sincronizacao_concluida']);
    expect(auditoria.rows[0].usuario).toBe(usuarios.get('admin')?.id);
    semDadosPessoais(auditoria.rows.map((item) => item.detalhes).join(''));
  });

  it('repetir a carga completa não altera nada (idempotência por hash de conteúdo)', async () => {
    const antes = await revisoes();
    const lote = await executar('completa');
    expect(lote).toMatchObject({ status: 'concluido', lidos: 6, inseridos: 0, atualizados: 0, removidos: 0, totalErros: 1 });
    expect(await revisoes()).toBe(antes);
    const pessoas = await banco().query<{ total: number }>('SELECT count(*)::int AS total FROM nucleo.pessoa');
    expect(pessoas.rows[0].total).toBe(5);
  });

  it('incremental envia alterado_desde, respeita 429 e aplica só o que mudou', async () => {
    const antes = await banco().query<{ id_origem: string; revisao: number }>(`
      SELECT o.id_origem, p.revisao_fonte::int AS revisao FROM nucleo.pessoa p
      JOIN nucleo.pessoa_origem o ON o.pessoa_id = p.id WHERE o.sistema_origem = 'api-teste' ORDER BY o.id_origem
    `);
    await new Promise((resolve) => setTimeout(resolve, 20));
    api.alterar('SRV-0002', { nome: 'Servidor Ficticio API 0002 Alterado' });
    api.filaFalhas.push({ tipo: 'status', status: 429, retryAfter: '1' });
    esperas.length = 0;
    const quantidade = api.requisicoes.length;
    const lote = await executar('incremental');
    expect(lote).toMatchObject({ status: 'concluido', tipo: 'incremental', lidos: 1, inseridos: 0, atualizados: 1, removidos: 0 });
    expect(esperas).toEqual([1000]);
    const novos = api.requisicoes.slice(quantidade);
    expect(novos.length).toBe(2);
    expect(novos.every((pedido) => pedido.alteradoDesde !== null)).toBe(true);
    const depois = await banco().query<{ id_origem: string; revisao: number; nome: string }>(`
      SELECT o.id_origem, p.revisao_fonte::int AS revisao, p.nome FROM nucleo.pessoa p
      JOIN nucleo.pessoa_origem o ON o.pessoa_id = p.id WHERE o.sistema_origem = 'api-teste' ORDER BY o.id_origem
    `);
    for (const [indice, linha] of depois.rows.entries()) {
      if (linha.id_origem === 'SRV-0002') {
        expect(linha.revisao).toBeGreaterThan(antes.rows[indice].revisao);
        expect(linha.nome).toBe('Servidor Ficticio API 0002 Alterado');
      } else {
        expect(linha.revisao).toBe(antes.rows[indice].revisao);
      }
    }
    const repetido = await executar('incremental');
    expect(repetido).toMatchObject({ status: 'concluido', atualizados: 0, inseridos: 0 });
  });

  it('timeout com repetições falha o lote sem bloquear e impede execução concorrente', async () => {
    const quantidade = api.requisicoes.length;
    api.regraFalha = () => ({ tipo: 'travar' });
    try {
      const resposta = await iniciar('completa');
      expect(resposta.status, resposta.corpo).toBe(202);
      const concorrente = await iniciar('completa');
      expect(concorrente.status).toBe(409);
      expect(JSON.parse(concorrente.corpo).detail).toContain('em andamento');
      expect((await situacao()).configurada).toBe(true);
      await servico.aguardarExecucao();
      const lote = await loteAtual((JSON.parse(resposta.corpo) as LoteSincronizacao).id);
      expect(lote.status).toBe('falhou');
      expect(lote.erros.at(-1)?.motivo).toContain('tempo limite');
      expect(api.requisicoes.length - quantidade).toBe(4);
      expect((await estado()).falhas_consecutivas).toBe(1);
    } finally {
      api.regraFalha = null;
    }
  });

  it('remoção lógica só ocorre após reconciliação completa; página falha não prova remoção e o lote é retomado', async () => {
    api.remover('SRV-0003');
    api.regraFalha = (pedido) => pedido.cursor ? { tipo: 'status', status: 500 } : null;
    const falha = await executar('completa');
    expect(falha.status).toBe('falhou');
    expect(falha.removidos).toBe(0);
    expect(falha.erros.at(-1)?.motivo).toContain('falha temporária');
    const intacta = await banco().query<{ pessoa: Date | null; vinculo: Date | null }>(`
      SELECT o.removido_na_fonte_em AS pessoa, v.removido_na_fonte_em AS vinculo FROM nucleo.pessoa_origem o
      JOIN nucleo.vinculo v ON v.pessoa_id = o.pessoa_id
      WHERE o.sistema_origem = 'api-teste' AND o.id_origem = 'SRV-0003'
    `);
    expect(intacta.rows[0]).toEqual({ pessoa: null, vinculo: null });
    expect((await estado()).falhas_consecutivas).toBe(2);

    api.regraFalha = null;
    const quantidade = api.requisicoes.length;
    const retomada = await executar('completa');
    expect(retomada.id).toBe(falha.id);
    expect(retomada).toMatchObject({ status: 'concluido', removidos: 2, inseridos: 0, atualizados: 0 });
    expect(api.requisicoes[quantidade].cursor).not.toBeNull();
    const removida = await banco().query<{ pessoa: Date | null; vinculo: Date | null; revisao: number }>(`
      SELECT o.removido_na_fonte_em AS pessoa, v.removido_na_fonte_em AS vinculo, p.revisao_fonte AS revisao
      FROM nucleo.pessoa_origem o JOIN nucleo.vinculo v ON v.pessoa_id = o.pessoa_id JOIN nucleo.pessoa p ON p.id = o.pessoa_id
      WHERE o.sistema_origem = 'api-teste' AND o.id_origem = 'SRV-0003'
    `);
    expect(removida.rows[0].pessoa).not.toBeNull();
    expect(removida.rows[0].vinculo).not.toBeNull();
    const ativos = await banco().query<{ total: number }>(`
      SELECT count(*)::int AS total FROM nucleo.vinculo WHERE sistema_origem = 'api-teste' AND removido_na_fonte_em IS NULL
    `);
    expect(ativos.rows[0].total).toBe(4);
    expect((await banco().query('SELECT count(*)::int AS total FROM nucleo.pessoa')).rows[0].total).toBe(5);
    expect((await estado()).falhas_consecutivas).toBe(0);
    const auditoria = await banco().query<{ detalhes: { retomada: boolean } }>(`
      SELECT detalhes FROM seguranca.auditoria WHERE acao = 'sincronizacao_iniciada' AND entidade_id = $1 ORDER BY id
    `, [falha.id]);
    expect(auditoria.rows.map((item) => item.detalhes.retomada)).toEqual([false, true]);

    // O servidor volta na fonte: a remoção lógica é desfeita sem duplicar dados.
    api.inserir(servidorFicticio(3));
    const volta = await executar('completa');
    expect(volta).toMatchObject({ status: 'concluido', removidos: 0, inseridos: 0 });
    const restaurada = await banco().query<{ pessoa: Date | null; vinculo: Date | null }>(`
      SELECT o.removido_na_fonte_em AS pessoa, v.removido_na_fonte_em AS vinculo FROM nucleo.pessoa_origem o
      JOIN nucleo.vinculo v ON v.pessoa_id = o.pessoa_id WHERE o.sistema_origem = 'api-teste' AND o.id_origem = 'SRV-0003'
    `);
    expect(restaurada.rows[0]).toEqual({ pessoa: null, vinculo: null });
  });

  it('staging só é expurgado após 30 dias e apenas de lotes concluídos', async () => {
    const primeiro = lotes.get('completa');
    if (!primeiro) throw new Error('Lote inicial ausente.');
    const aplicativo = pools[0];
    await expect(aplicativo.query('DELETE FROM nucleo.staging_api WHERE lote_id = $1', [primeiro.id]))
      .rejects.toThrow('não pode ser expurgado');
    await expect(aplicativo.query("UPDATE nucleo.staging_api SET id_origem = 'x' WHERE lote_id = $1", [primeiro.id]))
      .rejects.toThrow();
    expect(await servico.expurgarStaging()).toBe(0);
    await banco().query(`
      UPDATE nucleo.staging_api SET recebido_em = now() - interval '31 days' WHERE lote_id = $1
    `, [primeiro.id]);
    const falho = await banco().query<{ id: string }>(`
      INSERT INTO nucleo.sincronizacao_lote (origem, tipo, status, iniciado_em, concluido_em)
      VALUES ('outra-origem-ficticia', 'completa', 'falhou', now() - interval '40 days', now() - interval '40 days')
      RETURNING id
    `);
    await banco().query(`
      INSERT INTO nucleo.staging_api (lote_id, id_origem, payload_cifrado, recebido_em, processado_em)
      VALUES ($1, 'SRV-FALHO', '\\x01'::bytea, now() - interval '40 days', now() - interval '40 days')
    `, [falho.rows[0].id]);
    expect(await servico.expurgarStaging()).toBe(6);
    const restantes = await banco().query<{ lote_id: string }>('SELECT DISTINCT lote_id::text FROM nucleo.staging_api');
    expect(restantes.rows.map((linha) => linha.lote_id)).not.toContain(primeiro.id);
    expect(restantes.rows.map((linha) => linha.lote_id)).toContain(falho.rows[0].id);
    expect((await banco().query('SELECT count(*)::int AS total FROM nucleo.pessoa')).rows[0].total).toBe(5);
  });

  it('disjuntor abre após 5 falhas consecutivas, recusa com mensagem acionável e libera após a pausa', async () => {
    api.regraFalha = () => ({ tipo: 'status', status: 503 });
    try {
      for (let tentativa = 1; tentativa <= 5; tentativa += 1) {
        const lote = await executar('completa');
        expect(lote.status).toBe('falhou');
        expect((await estado()).falhas_consecutivas).toBe(tentativa);
      }
      expect((await estado()).disjuntor_aberto_em).not.toBeNull();
      expect((await situacao('secretario')).disjuntorAberto).toBe(true);
      const quantidade = api.requisicoes.length;
      const recusa = await iniciar('completa');
      expect(recusa.status).toBe(409);
      const detalhe = JSON.parse(recusa.corpo).detail as string;
      expect(detalhe).toContain('suspensa após 5 falhas consecutivas');
      expect(detalhe).toContain('nova tentativa liberada');
      expect(api.requisicoes.length).toBe(quantidade);
      const { pagina } = await listar();
      expect(pagina.falhasConsecutivas).toBe(5);
      expect(pagina.disjuntorAbertoAte).not.toBeNull();
      const recusas = await banco().query<{ total: number }>(
        "SELECT count(*)::int AS total FROM seguranca.auditoria WHERE acao = 'sincronizacao_recusada'",
      );
      expect(recusas.rows[0].total).toBe(1);

      // Meia-abertura: após a pausa, uma tentativa é liberada; se falhar, o disjuntor reabre.
      await banco().query(`
        UPDATE nucleo.sincronizacao_estado SET disjuntor_aberto_em = now() - interval '16 minutes' WHERE origem = 'api-teste'
      `);
      expect((await executar('completa')).status).toBe('falhou');
      expect((await iniciar('completa')).status).toBe(409);
      await banco().query(`
        UPDATE nucleo.sincronizacao_estado SET disjuntor_aberto_em = now() - interval '16 minutes' WHERE origem = 'api-teste'
      `);
    } finally {
      api.regraFalha = null;
    }
    const sucesso = await executar('completa');
    expect(sucesso.status).toBe('concluido');
    expect(await estado()).toEqual({ falhas_consecutivas: 0, disjuntor_aberto_em: null });
    expect((await situacao()).disjuntorAberto).toBe(false);
  });

  it('API bloqueada não impede emissão: busca, cálculo, DTC, conferência e emissão seguem funcionando', async () => {
    const portaApp = await portaLivre();
    // Porta liberada e sem processo escutando: a conexão é recusada como numa API fora do ar.
    const portaFechada = await portaLivre();
    const appBloqueado = await subirAplicacao(portaApp, configuracaoSinc(
      `http://127.0.0.1:${portaFechada}/servidores`, { origem: 'api-bloqueada', avisoHoras: 1 },
    ));
    const servicoBloqueado = servicoSincronizacao(appBloqueado);
    servicoBloqueado.opcoesCliente = { esperar: async () => undefined };
    const inicio = await iniciar('completa', portaApp);
    expect(inicio.status, inicio.corpo).toBe(202);
    await servicoBloqueado.aguardarExecucao();
    const { pagina } = await listar(portaApp);
    const lote = pagina.itens.find((item) => item.origem === 'api-bloqueada');
    expect(lote?.status).toBe('falhou');
    expect(lote?.erros.at(-1)?.motivo).toContain('Não foi possível conectar');
    const aviso = await situacao('analista', portaApp);
    expect(aviso).toMatchObject({ configurada: true, ultimaSincronizacaoEm: null, avisoAtraso: true });

    const busca = await requisitar({
      metodo: 'GET', rota: `servidores?q=${encodeURIComponent('Servidor Ficticio API 0004')}&tipo=nome`,
      sessao: sessao('analista'), porta: portaApp,
    });
    expect(busca.status, busca.corpo).toBe(200);
    const encontrado = paginaBuscaServidoresSchema.parse(JSON.parse(busca.corpo)).itens
      .find((item) => item.matricula === 'API-0004-1');
    if (!encontrado) throw new Error('Servidor sincronizado não encontrado na busca.');
    const fonte = { pessoaId: encontrado.pessoaId, vinculoId: encontrado.vinculoId };

    const calculo = await requisitar({
      metodo: 'POST', rota: 'calculos', sessao: sessao('analista'), porta: portaApp,
      corpo: {
        ...fonte, inicio: '1979-01-01', fim: '1984-12-31', confirmacaoDados: true,
        anos: [{ ...ANOS_DTC[0], ano: 1979 }, ...ANOS_DTC],
      },
    });
    expect(calculo.status, calculo.corpo).toBe(200);

    const criado = await requisitar({
      metodo: 'POST', rota: 'dtc', sessao: sessao('analista'), porta: portaApp,
      corpo: {
        tipo: 'DTC_IPAM', ...fonte, confirmacaoDados: true,
        periodos: [{ inicio: '1980-01-01', fim: '1984-12-31', anos: ANOS_DTC, categoria: null, cargo: null }],
        cargos: [], inss: null, processo: '1234/5678', confirmarInicioAjustado: false,
      },
    });
    expect(criado.status, criado.corpo).toBe(201);
    const documento = documentoDtcSchema.parse(JSON.parse(criado.corpo));
    const lerPrevia = async () => {
      const resposta = await requisitar({
        metodo: 'GET', rota: `dtc/${documento.id}/previa`, sessao: sessao('coordenador'), porta: portaApp,
      });
      expect(resposta.status, resposta.corpo).toBe(200);
      return previaDtcSchema.parse(JSON.parse(resposta.corpo));
    };
    const previa = await lerPrevia();
    const conferido = await requisitar({
      metodo: 'POST', rota: `dtc/${documento.id}/conferir`, sessao: sessao('coordenador'), porta: portaApp,
      corpo: { revisao: previa.documento.revisao, provaFonte: previa.fonte.provaFonte, confirmar: true },
    });
    expect(conferido.status, conferido.corpo).toBe(200);
    expect(resultadoTransicaoDtcSchema.parse(JSON.parse(conferido.corpo)).status).toBe('conferido');
    await registrarAprovacaoModelo(banco(), {
      tipo: 'DTC_IPAM', aprovadoPor: 'Responsável fictício', referenciaDecisao: 'Decisão fictícia DTC IPAM',
    });
    const conferida = await lerPrevia();
    const emitido = await requisitar({
      metodo: 'POST', rota: `dtc/${documento.id}/emitir`, sessao: sessao('coordenador'), porta: portaApp, chave: randomUUID(),
      corpo: { revisao: conferida.documento.revisao, provaFonte: conferida.fonte.provaFonte },
    });
    expect(emitido.status, emitido.corpo).toBe(200);
    expect(JSON.parse(emitido.corpo)).toMatchObject({ status: 'emitido', tipo: 'DTC_IPAM' });
  });
});
