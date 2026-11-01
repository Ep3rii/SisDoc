import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import type { IncomingHttpHeaders } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  dadosFontePreviaDofSchema,
  historicoEmissoesSchema,
  preconferenciaDofSchema,
  previaConferidaDofSchema,
  rascunhoDofSchema,
  respostaSessaoSchema,
  resultadoConferenciaDofSchema,
  resultadoCopiaEmitidoSchema,
  resultadoExclusaoDocumentoSchema,
  situacaoEmissaoSchema,
  snapshotEmissaoDofSchema,
  type Configuracao,
  type SituacaoEmissao,
} from '@sisdoc/contratos';
import { renderizarEmissaoDof } from '@sisdoc/templates';
import EmbeddedPostgres from 'embedded-postgres';
import forge from 'node-forge';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAplicacao } from '../apps/api/dist/aplicacao.js';
import { carregarConfiguracao } from '../apps/api/dist/configuracao.js';
import { ArmazenamentoPdf } from '../apps/api/dist/documentos/armazenamento-pdf.js';
import { ProcessadorPdfEmissao } from '../apps/api/dist/documentos/processador-pdf-emissao.js';
import { MENSAGEM_SEM_APROVACAO } from '../apps/api/dist/documentos/emissoes.js';
import { WorkerPdfEmissao } from '../apps/api/dist/documentos/worker-pdf-emissao.js';
import { SEQUENCIA_MIGRACOES } from '../apps/api/dist/migracoes/sequencia.js';
import { ProtetorDados } from '../apps/api/dist/seguranca/protecao-dados.js';
import { gerarHashSenha } from '../apps/api/dist/seguranca/senhas.js';
import { consultarModeloVigente, registrarAprovacaoModelo } from '../apps/api/dist/setup/aprovacao-modelo.js';
import { instalar, type OpcoesInstalacao } from '../apps/api/dist/setup/instalador.js';
import { migrar } from '../apps/api/dist/setup/migrar.js';
import { cpfSintetico } from './dados-sinteticos.js';

const senhaMigrador = 'MigracaoEmissaoFicticia!12345';
const senhaAplicativo = 'AplicativoEmissaoFicticio!12345';
const senhaAdmin = 'AdministradorEmissaoFicticio!12345';
const senhaUsuarios = 'UsuarioEmissaoFicticio!12345';
const nomeTls = 'sisdoc.local';

type Sessao = { cookie: string; csrf: string };
type Resposta = { status: number | undefined; corpo: string; bruto: Buffer; headers: IncomingHttpHeaders };

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
  const nomeCa = [{ name: 'commonName', value: 'CA temporaria de testes de emissao' }];
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

describe('emissão da DOF em recursos descartáveis', () => {
  let temporario = '';
  let raiz = '';
  let postgres: EmbeddedPostgres | undefined;
  let iniciado = false;
  let administradorBanco: Client | undefined;
  let migrador: Client | undefined;
  let poolAplicativo: Pool | undefined;
  let app: Awaited<ReturnType<typeof criarAplicacao>> | undefined;
  let config: Configuracao;
  let protetor: ProtetorDados;
  let portaBanco = 0;
  let portaHttps = 0;
  let caPem = '';
  let opcoes: OpcoesInstalacao;
  let worker: WorkerPdfEmissao;
  let contadorCpf = 0;
  const usuarios = new Map<string, { id: string; matricula: string; papel: string; sessao: Sessao }>();
  const emissoes: SituacaoEmissao[] = [];
  const emissoesPendentes: Array<{ documentoId: string; revisao: number; provaFonte: string }> = [];
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

  function idUsuario(chave: string): string {
    const usuario = usuarios.get(chave);
    if (!usuario) throw new Error(`Usuário sintético ${chave} ausente.`);
    return usuario.id;
  }

  async function requisitar(opcoesPedido: {
    metodo: 'GET' | 'POST' | 'PATCH'; rota: string; corpo?: unknown; sessao?: Sessao; cookie?: string;
    provaFonte?: string; chave?: string;
  }): Promise<Resposta> {
    const conteudo = opcoesPedido.corpo === undefined ? undefined : JSON.stringify(opcoesPedido.corpo);
    const cookie = opcoesPedido.sessao?.cookie ?? opcoesPedido.cookie;
    return new Promise((resolve, reject) => {
      const pedido = https.request({
        host: '127.0.0.1',
        port: portaHttps,
        servername: nomeTls,
        path: `/api/v1/${opcoesPedido.rota}`,
        method: opcoesPedido.metodo,
        ca: caPem,
        rejectUnauthorized: true,
        agent: false,
        timeout: 20000,
        headers: {
          Origin: `https://${nomeTls}:${portaHttps}`,
          ...(conteudo === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(opcoesPedido.sessao ? { 'X-CSRF-Token': opcoesPedido.sessao.csrf } : {}),
          ...(opcoesPedido.provaFonte === undefined ? {} : { 'X-Sisdoc-Fonte-Dof': opcoesPedido.provaFonte }),
          ...(opcoesPedido.chave === undefined ? {} : { 'Idempotency-Key': opcoesPedido.chave }),
        },
      }, (resposta) => {
        const partes: Buffer[] = [];
        resposta.on('data', (parte: Buffer) => partes.push(parte));
        resposta.on('end', () => {
          const bruto = Buffer.concat(partes);
          resolve({ status: resposta.statusCode, corpo: bruto.toString('utf8'), bruto, headers: resposta.headers });
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
    const matricula = `EMISSAO-${chave.toUpperCase()}`;
    await banco().query(`
      INSERT INTO seguranca.usuario (id, matricula, nome, senha_hash, papel, troca_senha_obrigatoria)
      VALUES ($1, $2, $3, $4, $5, false)
    `, [id, matricula, `Operador sintético ${chave}`, await gerarHashSenha(senhaUsuarios), papel]);
    const login = await requisitar({ metodo: 'POST', rota: 'auth/login', corpo: { matricula, senha: senhaUsuarios } });
    expect(login.status, login.corpo).toBe(200);
    const cookie = login.headers['set-cookie']?.[0].split(';')[0];
    if (!cookie) throw new Error('Cookie sintético ausente.');
    usuarios.set(chave, { id, matricula, papel, sessao: { cookie, csrf: respostaSessaoSchema.parse(JSON.parse(login.corpo)).csrf } });
  }

  async function criarFonte(nome: string): Promise<{ pessoaId: string; vinculoId: string }> {
    const pessoaId = randomUUID();
    const vinculoId = randomUUID();
    contadorCpf += 1;
    const cpf = cpfSintetico(910000000 + contadorCpf);
    const matricula = `EMISSAO-FICTICIA-${contadorCpf}`;
    await banco().query(`
      INSERT INTO nucleo.pessoa (id, cpf_cifrado, cpf_hash, nome, nome_busca, nascimento, nome_mae_cifrado)
      VALUES ($1, $2, $3, $4, lower($4), '1958-03-02', $5)
    `, [pessoaId, protetor.cifrar(Buffer.from(cpf, 'ascii'), {
      schema: 'nucleo', tabela: 'pessoa', registroId: pessoaId, campo: 'cpf_cifrado',
    }), protetor.hashCpf(cpf), nome, protetor.cifrar(Buffer.from('Filiação fictícia', 'utf8'), {
      schema: 'nucleo', tabela: 'pessoa', registroId: pessoaId, campo: 'nome_mae_cifrado',
    })]);
    await banco().query(`
      INSERT INTO nucleo.vinculo
        (id, pessoa_id, matricula, matricula_norm, sistema_origem, id_origem, admissao, cargo, referencia, regime_juridico, orgao_nome)
      VALUES ($1, $2, $3, $3, 'fonte-emissao-sintetica', $4, '1980-01-01', 'Cargo fictício', 'PNS-A',
        'Regime fictício', 'Órgão fictício')
    `, [vinculoId, pessoaId, matricula, randomUUID()]);
    return { pessoaId, vinculoId };
  }

  // Cria, completa e encaminha a DOF ao coordenador, que a confere; devolve a prova atual para emitir.
  async function prepararConferida(nome = 'Pessoa Emissão Fictícia', autor = 'analista', coordenador = 'coordenador'): Promise<{
    documentoId: string; revisao: number; provaFonte: string;
  }> {
    const { pessoaId, vinculoId } = await criarFonte(nome);
    const calculo = {
      pessoaId, vinculoId, inicio: coordenador === 'admin' ? '1979-01-01' : '1980-01-01', fim: '2024-12-31', confirmacaoDados: true,
      anos: Array.from({ length: 45 }, (_, indice) => ({
        ano: 1980 + indice, abrangencia: 'intervalo_declarado',
        faltas: indice === 3 ? 2 : 0, ts: 0, pf: 0, ip: 0, outros: 0, pb: 0, pv: 0, licencaPremio: 0,
      })),
    };
    const criado = await requisitar({
      metodo: 'POST', rota: 'documentos', sessao: sessao(autor),
      corpo: { calculo, admissaoEsperada: '1980-01-01', motivo: 'Cálculo sintético de 45 anos' },
    });
    expect(criado.status, criado.corpo).toBe(201);
    let rascunho = rascunhoDofSchema.parse(JSON.parse(criado.corpo));
    if (coordenador === 'admin') {
      const confirmado = await requisitar({
        metodo: 'POST', rota: `documentos/${rascunho.id}/confirmar-inicio`, sessao: sessao('admin'),
        corpo: { revisao: rascunho.revisao, confirmar: true },
      });
      expect(confirmado.status, confirmado.corpo).toBe(201);
      rascunho = rascunhoDofSchema.parse(JSON.parse(confirmado.corpo));
      expect(rascunho.inicioAjustadoConfirmado).toBe(true);
    }
    const processo = await requisitar({
      metodo: 'PATCH', rota: `documentos/${rascunho.id}/processo`, sessao: sessao(coordenador === 'admin' ? 'admin' : autor),
      corpo: { revisao: rascunho.revisao, processo: '1234/5678', motivo: 'Processo fictício' },
    });
    expect(processo.status, processo.corpo).toBe(200);
    let revisao = rascunhoDofSchema.parse(JSON.parse(processo.corpo)).revisao;
    if (autor !== coordenador && coordenador !== 'admin') {
      const encaminhado = await requisitar({
        metodo: 'POST', rota: `documentos/${rascunho.id}/encaminhar`, sessao: sessao(autor),
        corpo: { revisao, destinatarioId: idUsuario(coordenador) },
      });
      expect(encaminhado.status, encaminhado.corpo).toBe(201);
      revisao = rascunhoDofSchema.parse(JSON.parse(encaminhado.corpo)).revisao;
    }
    const previa = await requisitar({ metodo: 'GET', rota: `documentos/${rascunho.id}/dados-previa`, sessao: sessao(coordenador) });
    expect(previa.status, previa.corpo).toBe(200);
    const fonte = dadosFontePreviaDofSchema.parse(JSON.parse(previa.corpo));
    const relatorio = await requisitar({
      metodo: 'GET', rota: `documentos/${rascunho.id}/preconferencia`, sessao: sessao(coordenador), provaFonte: fonte.provaFonte,
    });
    expect(relatorio.status, relatorio.corpo).toBe(200);
    const pre = preconferenciaDofSchema.parse(JSON.parse(relatorio.corpo));
    expect(pre.bloqueios).toEqual([]);
    const conferido = await requisitar({
      metodo: 'POST', rota: `documentos/${rascunho.id}/conferir`, sessao: sessao(coordenador),
      corpo: { revisao, provaFonte: fonte.provaFonte, provaRelatorio: pre.provaRelatorio, confirmar: true },
    });
    expect(conferido.status, conferido.corpo).toBe(201);
    const resultado = resultadoConferenciaDofSchema.parse(JSON.parse(conferido.corpo));
    const previaConferida = await requisitar({
      metodo: 'GET', rota: `documentos/${rascunho.id}/dados-previa-conferida`, sessao: sessao(coordenador),
    });
    expect(previaConferida.status, previaConferida.corpo).toBe(200);
    const dados = previaConferidaDofSchema.parse(JSON.parse(previaConferida.corpo));
    expect(dados.revisao).toBe(resultado.revisao);
    return { documentoId: rascunho.id, revisao: dados.revisao, provaFonte: dados.fonte.provaFonte };
  }

  function emitir(alvo: { documentoId: string; revisao: number; provaFonte: string }, chave: string, quem = 'coordenador') {
    return requisitar({
      metodo: 'POST', rota: `documentos/${alvo.documentoId}/emitir`, sessao: sessao(quem), chave,
      corpo: { revisao: alvo.revisao, provaFonte: alvo.provaFonte },
    });
  }

  async function auditorias(acao: string, entidadeId: string): Promise<number> {
    const consulta = await banco().query<{ total: string }>(
      'SELECT count(*)::text AS total FROM seguranca.auditoria WHERE acao = $1 AND entidade_id = $2',
      [acao, entidadeId],
    );
    return Number(consulta.rows[0].total);
  }

  beforeAll(async () => {
    if (process.platform !== 'win32' || !process.env.PUBLIC) {
      throw new Error('Esta verificação de instalação requer Windows e uma pasta pública local.');
    }
    const temporarios = process.env.SISDOC_TEST_TEMP ?? os.tmpdir();
    if (!path.isAbsolute(temporarios) || /[^\x00-\x7f]/.test(temporarios)) {
      throw new Error('Defina SISDOC_TEST_TEMP com um diretório local absoluto ASCII ou com caminho curto 8.3 existente.');
    }
    temporario = await mkdtemp(path.join(temporarios, 'sisdoc-emissao-'));
    raiz = path.join(await realpath(process.env.PUBLIC), `SisDocVerificacao-${randomUUID()}`);
    portaBanco = await portaLivre();
    portaHttps = await portaLivre();
    const materiais = certificadosFicticios();
    caPem = materiais.ca;
    const certificado = path.join(temporario, 'servidor.crt');
    const chave = path.join(temporario, 'servidor.key');
    const ca = path.join(temporario, 'ca.crt');
    const listaSenhas = path.join(temporario, 'senhas.txt');
    await Promise.all([
      writeFile(certificado, materiais.certificado),
      writeFile(chave, materiais.chave),
      writeFile(ca, materiais.ca),
      writeFile(listaSenhas, 'SenhaComumFicticia!12345\n'),
    ]);
    postgres = new EmbeddedPostgres({
      databaseDir: path.join(temporario, 'postgres'),
      user: 'postgres',
      password: 'SuperusuarioEmissaoFicticio!12345',
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
    await administradorBanco.query('CREATE DATABASE sisdoc_emissao OWNER sisdoc_migrador');
    await administradorBanco.query('CREATE DATABASE sisdoc_migrar OWNER sisdoc_migrador');
    opcoes = {
      raiz,
      porta: portaHttps,
      banco: {
        porta: portaBanco, nome: 'sisdoc_emissao', migrador: 'sisdoc_migrador', senhaMigrador,
        usuario: 'sisdoc_aplicativo', senha: senhaAplicativo,
      },
      tls: { certificado, chave, ca, nome: nomeTls },
      sidServico: 'S-1-5-19',
      listaSenhas,
      processos: { mascaras: ['####/####'] },
      administrador: { matricula: 'ADMIN-EMISSAO-FICTICIO', nome: 'Operador Fictício', senha: senhaAdmin },
    };
    await instalar(opcoes);
    config = await carregarConfiguracao(path.join(raiz, 'config', 'aplicacao.json'));
    expect(config.pdf?.diretorio.toLowerCase()).toBe(path.join(raiz, 'pdf').toLowerCase());
    protetor = new ProtetorDados(config.chaves);
    migrador = new Client({
      host: '127.0.0.1', port: portaBanco, database: 'sisdoc_emissao', user: 'sisdoc_migrador', password: senhaMigrador,
    });
    await migrador.connect();
    poolAplicativo = new Pool({
      host: config.banco.host, port: config.banco.porta, database: config.banco.nome,
      user: config.banco.usuario, password: config.banco.senha, max: 10,
    });
    // O worker periódico fica desligado para que os testes conduzam os ciclos de forma determinística.
    process.env.SISDOC_WORKER_PDF = 'desligado';
    app = await criarAplicacao(config, poolAplicativo);
    await app.listen(portaHttps, '127.0.0.1');
    worker = new WorkerPdfEmissao(poolAplicativo, config);
    for (const [chave, papel] of [
      ['analista', 'analista'], ['analista2', 'analista'], ['coordenador', 'coordenador'], ['coordenador2', 'coordenador'],
      ['secretario', 'secretario_adjunto'], ['admin', 'admin'],
    ] as const) {
      await criarUsuario(chave, papel);
    }
  });

  afterAll(async () => {
    if (workerAnterior === undefined) delete process.env.SISDOC_WORKER_PDF;
    else process.env.SISDOC_WORKER_PDF = workerAnterior;
    if (worker) await worker.onModuleDestroy();
    if (app) await app.close();
    if (poolAplicativo && !poolAplicativo.ended) await poolAplicativo.end();
    if (migrador) await migrador.end();
    if (administradorBanco) await administradorBanco.end();
    if (iniciado && postgres) await postgres.stop();
    if (raiz && path.basename(raiz).startsWith('SisDocVerificacao-')) {
      await rm(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
    if (temporario && path.basename(temporario).startsWith('sisdoc-emissao-')) {
      await rm(temporario, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  it('bloqueia a emissão sem aprovação formal e não permite gravar a aprovação pelo aplicativo', async () => {
    const alvo = await prepararConferida();
    const antes = await banco().query('SELECT count(*)::int AS total FROM documentos.emissao');
    const bloqueada = await emitir(alvo, randomUUID());
    expect(bloqueada.status, bloqueada.corpo).toBe(409);
    expect(JSON.parse(bloqueada.corpo).detail).toBe(MENSAGEM_SEM_APROVACAO);
    const adminBloqueada = await emitir(alvo, randomUUID(), 'admin');
    expect(adminBloqueada.status, adminBloqueada.corpo).toBe(409);
    expect(JSON.parse(adminBloqueada.corpo).detail).toBe(MENSAGEM_SEM_APROVACAO);
    expect(MENSAGEM_SEM_APROVACAO).toContain('npm run aprovar-modelo');
    const comFlag = await requisitar({
      metodo: 'POST', rota: `documentos/${alvo.documentoId}/emitir`, sessao: sessao('coordenador'), chave: randomUUID(),
      corpo: { revisao: alvo.revisao, provaFonte: alvo.provaFonte, oficial: true },
    });
    expect(comFlag.status).toBe(400);
    const depois = await banco().query('SELECT count(*)::int AS total FROM documentos.emissao');
    expect(depois.rows).toEqual(antes.rows);
    expect((await banco().query('SELECT count(*)::int AS total FROM documentos.numeracao')).rows[0].total).toBe(0);
    expect((await banco().query('SELECT status FROM documentos.documento WHERE id = $1', [alvo.documentoId])).rows[0].status)
      .toBe('conferido');
    expect(await auditorias('emissao_dof_bloqueada_sem_aprovacao', alvo.documentoId)).toBe(2);

    const aplicativo = new Client({
      host: '127.0.0.1', port: portaBanco, database: 'sisdoc_emissao', user: 'sisdoc_aplicativo', password: senhaAplicativo,
    });
    await aplicativo.connect();
    try {
      const modelo = await consultarModeloVigente(banco());
      expect(modelo.aprovacaoExistente).toBeNull();
      await expect(aplicativo.query(`
        INSERT INTO documentos.aprovacao_modelo
          (id, tipo, regra_versao_id, template_versao_id, aprovado_por, referencia_decisao)
        VALUES ($1, 'DOF', $2, $3, 'Invasor', 'Sem decisão')
      `, [randomUUID(), modelo.regra.id, modelo.template.id])).rejects.toMatchObject({ code: '42501' });
      const privilegios = await aplicativo.query<{ atualizar: boolean; apagar: boolean }>(`
        SELECT has_table_privilege(current_user, 'documentos.aprovacao_modelo', 'UPDATE') AS atualizar,
          has_table_privilege(current_user, 'documentos.aprovacao_modelo', 'DELETE') AS apagar
      `);
      expect(privilegios.rows[0]).toEqual({ atualizar: false, apagar: false });
    } finally {
      await aplicativo.end();
    }
    emissoesPendentes.push(alvo);
  });

  it('emite DOF com mais de 41 anos após aprovação sintética, de forma idempotente, até o PDF', async () => {
    const aprovacao = await registrarAprovacaoModelo(banco(), {
      tipo: 'DOF', aprovadoPor: 'Aprovador fictício de testes', referenciaDecisao: 'docs/decisoes/022 (sintética)',
    });
    expect(aprovacao.modelo.template.versao).toBe('emissao-dof-1');
    await expect(registrarAprovacaoModelo(banco(), {
      tipo: 'DOF', aprovadoPor: 'Outro aprovador', referenciaDecisao: 'Repetida',
    })).rejects.toThrow();
    expect(await auditorias('modelo_aprovado', aprovacao.id)).toBe(1);
    await expect(banco().query('UPDATE documentos.aprovacao_modelo SET aprovado_por = $1 WHERE id = $2', ['Outro', aprovacao.id]))
      .rejects.toMatchObject({ code: '55000' });

    const alvo = emissoesPendentes.shift();
    if (!alvo) throw new Error('DOF conferida sintética ausente.');
    for (const quem of ['analista', 'secretario']) {
      expect((await emitir(alvo, randomUUID(), quem)).status).toBe(403);
    }
    expect((await emitir(alvo, randomUUID(), 'coordenador2')).status).toBe(404);
    const semChave = await requisitar({
      metodo: 'POST', rota: `documentos/${alvo.documentoId}/emitir`, sessao: sessao('coordenador'),
      corpo: { revisao: alvo.revisao, provaFonte: alvo.provaFonte },
    });
    expect(semChave.status).toBe(400);
    expect(JSON.parse(semChave.corpo).detail).toContain('Idempotency-Key');
    expect((await emitir({ ...alvo, revisao: alvo.revisao - 1 }, randomUUID())).status).toBe(409);
    expect((await emitir({ ...alvo, provaFonte: 'a'.repeat(64) }, randomUUID())).status).toBe(409);
    expect((await banco().query('SELECT count(*)::int AS total FROM documentos.emissao')).rows[0].total).toBe(0);

    const chave = randomUUID();
    const [primeira, repetida] = await Promise.all([emitir(alvo, chave), emitir(alvo, chave)]);
    expect(primeira.status, primeira.corpo).toBe(200);
    expect(repetida.status, repetida.corpo).toBe(200);
    const emitida = situacaoEmissaoSchema.parse(JSON.parse(primeira.corpo));
    expect(situacaoEmissaoSchema.parse(JSON.parse(repetida.corpo)).emissaoId).toBe(emitida.emissaoId);
    const ano = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(new Date());
    expect(emitida).toMatchObject({ documentoId: alvo.documentoId, tipo: 'DOF', numero: `N° 1P/${ano}`, status: 'emitido' });
    expect(emitida.pdf.disponivel).toBe(false);
    const terceira = await emitir(alvo, chave);
    expect(situacaoEmissaoSchema.parse(JSON.parse(terceira.corpo)).emissaoId).toBe(emitida.emissaoId);
    expect((await banco().query('SELECT count(*)::int AS total FROM documentos.emissao')).rows[0].total).toBe(1);
    expect((await banco().query('SELECT count(*)::int AS total FROM documentos.job_pdf j JOIN documentos.emissao e ON e.id = j.emissao_id WHERE e.documento_id = $1', [alvo.documentoId])).rows[0].total).toBe(1);
    expect(await auditorias('dof_emitida', emitida.emissaoId) + await auditorias('dof_emitida', alvo.documentoId)).toBe(1);
    const outra = await prepararConferida();
    const reuso = await emitir(outra, chave);
    expect(reuso.status, reuso.corpo).toBe(409);
    expect(JSON.parse(reuso.corpo).detail).toContain('chave de idempotência');
    emissoesPendentes.push(outra);

    const linha = await banco().query<{ status: string; snapshot_cifrado: Buffer }>(`
      SELECT d.status, e.snapshot_cifrado FROM documentos.documento d JOIN documentos.emissao e ON e.documento_id = d.id
      WHERE d.id = $1
    `, [alvo.documentoId]);
    expect(linha.rows[0].status).toBe('emitido');
    const textoCifrado = linha.rows[0].snapshot_cifrado.toString('latin1');
    expect(textoCifrado).not.toContain('Pessoa Emissão Fictícia');
    expect(textoCifrado).not.toContain('1234/5678');
    const snapshot = snapshotEmissaoDofSchema.parse(JSON.parse(protetor.decifrar(linha.rows[0].snapshot_cifrado, {
      schema: 'documentos', tabela: 'emissao', registroId: emitida.emissaoId, campo: 'snapshot_cifrado',
    }).toString('utf8')));
    expect(snapshot).toMatchObject({
      classificacao: 'emissao', documentoId: alvo.documentoId, emissaoId: emitida.emissaoId, numero: 1,
      numeroFormatado: emitida.numero, processo: '1234/5678', nome: 'Pessoa Emissão Fictícia',
      aprovacao: { id: aprovacao.id, aprovadoPor: 'Aprovador fictício de testes' },
      template: { versao: 'emissao-dof-1' },
    });
    expect(snapshot.resultado.periodo.linhas).toHaveLength(45);
    expect(snapshot.resultado.totais.efetivoExercicio).toBeGreaterThan(41 * 365);
    expect(snapshot.assinaturas.emitente.id).toBe(idUsuario('coordenador'));
    expect(snapshot.assinaturas.autor.id).toBe(idUsuario('analista'));
    const html = renderizarEmissaoDof(snapshot);
    expect(html).toContain('DECLARO');
    expect(html).toContain('São Luís - MA');
    expect(html).toContain('SEMAD');
    expect(html).toContain('Coordenador(a) de Análise de Processos');
    expect(html).toContain('Secretário(a) Adjunto(a)');
    expect(html).not.toContain('PRÉVIA');
    await expect(banco().query('UPDATE documentos.documento SET status = $2 WHERE id = $1', [alvo.documentoId, 'conferido']))
      .rejects.toBeDefined();

    const indisponivel = await requisitar({ metodo: 'GET', rota: `emissoes/${emitida.emissaoId}/pdf`, sessao: sessao('analista') });
    expect(indisponivel.status).toBe(409);
    await worker.ciclo();
    const situacao = await requisitar({ metodo: 'GET', rota: `emissoes/${emitida.emissaoId}`, sessao: sessao('analista') });
    expect(situacao.status, situacao.corpo).toBe(200);
    const concluida = situacaoEmissaoSchema.parse(JSON.parse(situacao.corpo));
    expect(concluida.pdf).toMatchObject({ status: 'concluido', disponivel: true, tentativas: 1, erro: null });
    expect(await readdir(path.join(raiz, 'pdf'))).not.toHaveLength(0);

    const baixado = await requisitar({ metodo: 'GET', rota: `emissoes/${emitida.emissaoId}/pdf`, sessao: sessao('analista') });
    expect(baixado.status, baixado.corpo).toBe(200);
    expect(baixado.headers['content-type']).toBe('application/pdf');
    expect(baixado.headers['content-disposition']).toBe(`attachment; filename="PESSOA_EMISSAO_FICTICIA_DOF_${snapshot.dataEmissao}.pdf"`);
    expect(baixado.bruto.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(await auditorias('pdf_baixado', emitida.emissaoId)).toBe(1);
    expect((await requisitar({ metodo: 'GET', rota: `emissoes/${emitida.emissaoId}/pdf`, sessao: sessao('secretario') })).status)
      .toBe(200);
    expect((await requisitar({ metodo: 'GET', rota: `emissoes/${emitida.emissaoId}/pdf`, sessao: sessao('coordenador2') })).status)
      .toBe(200);
    for (const quem of ['analista2']) {
      expect((await requisitar({ metodo: 'GET', rota: `emissoes/${emitida.emissaoId}/pdf`, sessao: sessao(quem) })).status).toBe(404);
    }
    expect((await requisitar({ metodo: 'GET', rota: `emissoes/${emitida.emissaoId}/pdf` })).status).toBe(401);
    expect((await requisitar({ metodo: 'GET', rota: `emissoes/${emitida.emissaoId}/pdf`, sessao: sessao('admin') })).status).toBe(200);
    expect(await auditorias('pdf_baixado', emitida.emissaoId)).toBe(4);
    expect(await auditorias('pdf_nao_encontrado', emitida.emissaoId)).toBe(1);
    emissoes.push(concluida);
  });

  it('numera emissões concorrentes em sequência, sem lacunas nem repetição', async () => {
    const alvos = [...emissoesPendentes.splice(0), await prepararConferida(), await prepararConferida(),
      await prepararConferida('Outra Pessoa Fictícia'), await prepararConferida()];
    const respostas = await Promise.all(alvos.map((alvo) => emitir(alvo, randomUUID())));
    for (const resposta of respostas) expect(resposta.status, resposta.corpo).toBe(200);
    const situacoes = respostas.map((resposta) => situacaoEmissaoSchema.parse(JSON.parse(resposta.corpo)));
    const numeros = situacoes.map((item) => Number(/^N° (\d+)P\/\d{4}$/.exec(item.numero)?.[1])).sort((a, b) => a - b);
    expect(numeros).toEqual([2, 3, 4, 5, 6]);
    const numeracao = await banco().query<{ ultimo_numero: string }>(
      "SELECT ultimo_numero::text FROM documentos.numeracao WHERE tipo = 'DOF'",
    );
    expect(numeracao.rows).toEqual([{ ultimo_numero: '6' }]);
    emissoes.push(...situacoes);
  });

  it('reprocessa o PDF que falhou com o mesmo número e nomeia colisões do mesmo dia', async () => {
    const alvo = emissoes[1];
    const falho = new ProcessadorPdfEmissao(poolAplicativo as Pool, protetor, new ArmazenamentoPdf(config.pdf?.diretorio ?? ''), {
      DOF: async () => { throw new Error('Falha sintética de renderização.'); },
    }, 30000);
    const pendentes = await banco().query<{ emissao_id: string }>(`
      SELECT j.emissao_id FROM documentos.job_pdf j JOIN documentos.emissao_aprovacao a ON a.emissao_id = j.emissao_id
      WHERE j.status = 'pendente' ORDER BY j.criado_em, j.id
    `);
    expect(pendentes.rows).toHaveLength(5);
    const resultado = await falho.processarUm();
    expect(resultado.estado).toBe('falhou');
    const emissaoFalha = resultado.estado === 'falhou' ? resultado.emissaoId : '';
    const consultaFalha = await requisitar({ metodo: 'GET', rota: `emissoes/${emissaoFalha}`, sessao: sessao('coordenador') });
    const falha = situacaoEmissaoSchema.parse(JSON.parse(consultaFalha.corpo));
    expect(falha.pdf).toMatchObject({ status: 'falhou', tentativas: 1, disponivel: false });
    expect(falha.pdf.erro).toContain('mesmo número');
    await delay(2200);
    await worker.ciclo();
    const refeita = situacaoEmissaoSchema.parse(JSON.parse((await requisitar({
      metodo: 'GET', rota: `emissoes/${emissaoFalha}`, sessao: sessao('coordenador'),
    })).corpo));
    expect(refeita.numero).toBe(falha.numero);
    expect(refeita.pdf).toMatchObject({ status: 'concluido', tentativas: 2, disponivel: true });
    const restantes = await banco().query("SELECT count(*)::int AS total FROM documentos.job_pdf WHERE status <> 'concluido'");
    expect(restantes.rows[0].total).toBe(0);
    expect(alvo).toBeDefined();

    const nomes = new Set<string>();
    for (const item of emissoes) {
      const baixado = await requisitar({ metodo: 'GET', rota: `emissoes/${item.emissaoId}/pdf`, sessao: sessao('coordenador') });
      expect(baixado.status, baixado.corpo).toBe(200);
      const nome = /filename="([^"]+)"/.exec(String(baixado.headers['content-disposition']))?.[1];
      if (!nome) throw new Error('Nome de PDF ausente.');
      nomes.add(nome);
    }
    expect(nomes.size, [...nomes].join(', ')).toBe(6);
    const data = [...nomes][0].slice(-14, -4);
    expect([...nomes].sort()).toEqual([
      `OUTRA_PESSOA_FICTICIA_DOF_${data}.pdf`,
      `PESSOA_EMISSAO_FICTICIA_DOF_${data}.pdf`,
      `PESSOA_EMISSAO_FICTICIA_DOF_${data}_2.pdf`,
      `PESSOA_EMISSAO_FICTICIA_DOF_${data}_3.pdf`,
      `PESSOA_EMISSAO_FICTICIA_DOF_${data}_4.pdf`,
      `PESSOA_EMISSAO_FICTICIA_DOF_${data}_5.pdf`,
    ].sort());
  });

  it('inicia o worker com a aplicação e gera o PDF sem intervenção', async () => {
    delete process.env.SISDOC_WORKER_PDF;
    const automatico = new WorkerPdfEmissao(poolAplicativo as Pool, config);
    try {
      automatico.onApplicationBootstrap();
      const alvo = await prepararConferida('Pessoa Automática Fictícia');
      const resposta = await emitir(alvo, randomUUID());
      expect(resposta.status, resposta.corpo).toBe(200);
      const emitida = situacaoEmissaoSchema.parse(JSON.parse(resposta.corpo));
      const limite = Date.now() + 60000;
      let atual = emitida;
      while (!atual.pdf.disponivel && Date.now() < limite) {
        await delay(500);
        atual = situacaoEmissaoSchema.parse(JSON.parse((await requisitar({
          metodo: 'GET', rota: `emissoes/${emitida.emissaoId}`, sessao: sessao('coordenador'),
        })).corpo));
      }
      expect(atual.pdf.status).toBe('concluido');
      expect(atual.numero).toMatch(/^N° 7P\/\d{4}$/);
      emissoes.push(atual);
    } finally {
      await automatico.onModuleDestroy();
      process.env.SISDOC_WORKER_PDF = 'desligado';
    }
  });

  it('lista o histórico por perfil, completo para o administrador', async () => {
    const historico = async (quem: string, escopo: string, tipo = 'DOF') => requisitar({
      metodo: 'GET', rota: `historico?tipo=${tipo}&escopo=${escopo}`, sessao: sessao(quem),
    });
    const proprio = historicoEmissoesSchema.parse(JSON.parse((await historico('analista', 'proprio')).corpo));
    expect(proprio.itens).toHaveLength(5);
    const ordenados = [...proprio.itens].sort((a, b) => b.emitidoEm.localeCompare(a.emitidoEm));
    expect(proprio.itens.map((item) => item.emissaoId)).toEqual(ordenados.map((item) => item.emissaoId));
    expect(proprio.itens.every((item) => item.nome !== null && item.podeCopiar && !item.podeCancelar && item.podeBaixar)).toBe(true);
    expect(historicoEmissoesSchema.parse(JSON.parse((await historico('analista2', 'proprio')).corpo)).itens).toHaveLength(0);
    expect((await historico('analista', 'todos')).status).toBe(400);
    expect(historicoEmissoesSchema.parse(JSON.parse((await historico('coordenador', 'proprio')).corpo)).itens).toHaveLength(5);
    const geral = historicoEmissoesSchema.parse(JSON.parse((await historico('coordenador2', 'todos')).corpo));
    expect(geral.itens).toHaveLength(7);
    expect(geral.itens.every((item) => item.nome !== null && item.podeCopiar && !item.podeCancelar)).toBe(true);
    const secretario = historicoEmissoesSchema.parse(JSON.parse((await historico('secretario', 'todos')).corpo));
    expect(secretario.itens.every((item) => item.nome !== null && item.podeCancelar && !item.podeCopiar && item.podeBaixar))
      .toBe(true);
    const admin = historicoEmissoesSchema.parse(JSON.parse((await historico('admin', 'todos')).corpo));
    expect(admin.itens).toHaveLength(7);
    expect(admin.itens.every((item) => item.nome !== null && item.matricula !== null && item.podeBaixar
      && !item.podeCopiar && item.podeCancelar && item.podeExcluir)).toBe(true);
    expect((await historico('admin', 'proprio')).status).toBe(200);
    expect(historicoEmissoesSchema.parse(JSON.parse((await historico('analista', 'proprio', 'DTC')).corpo)).itens).toHaveLength(0);
    expect((await historico('analista', 'proprio', 'XYZ')).status).toBe(400);
    const registros = await banco().query<{ total: string }>(
      "SELECT count(*)::text AS total FROM seguranca.auditoria WHERE acao IN ('historico_consultado', 'historico_geral_consultado')",
    );
    expect(Number(registros.rows[0].total)).toBeGreaterThanOrEqual(7);
  });

  it('copia a emissão como novo rascunho sem alterar o documento emitido', async () => {
    const origem = emissoes[0];
    for (const quem of ['secretario']) {
      expect((await requisitar({
        metodo: 'POST', rota: `documentos/${origem.documentoId}/copia`, sessao: sessao(quem), corpo: { confirmar: true },
      })).status).toBe(403);
    }
    expect((await requisitar({
      metodo: 'POST', rota: `documentos/${origem.documentoId}/copia`, sessao: sessao('analista2'), corpo: { confirmar: true },
    })).status).toBe(404);
    expect((await requisitar({
      metodo: 'POST', rota: `documentos/${origem.documentoId}/copia`, sessao: sessao('analista'), corpo: {},
    })).status).toBe(400);
    const copia = await requisitar({
      metodo: 'POST', rota: `documentos/${origem.documentoId}/copia`, sessao: sessao('analista'), corpo: { confirmar: true },
    });
    expect(copia.status, copia.corpo).toBe(201);
    const resultado = resultadoCopiaEmitidoSchema.parse(JSON.parse(copia.corpo));
    expect(resultado.origemEmissaoId).toBe(origem.emissaoId);
    expect(resultado.documentoId).not.toBe(origem.documentoId);
    const aberto = await requisitar({ metodo: 'GET', rota: `documentos/${resultado.documentoId}`, sessao: sessao('analista') });
    expect(aberto.status, aberto.corpo).toBe(200);
    const rascunho = rascunhoDofSchema.parse(JSON.parse(aberto.corpo));
    expect(rascunho).toMatchObject({ status: 'rascunho', processo: '1234/5678' });
    expect(rascunho.resultado.periodo.linhas).toHaveLength(45);
    const original = await banco().query('SELECT status FROM documentos.documento WHERE id = $1', [origem.documentoId]);
    expect(original.rows[0].status).toBe('emitido');
    expect(await auditorias('rascunho_copiado_de_emissao', resultado.documentoId)).toBe(1);
    const revisaoOrigem = (await banco().query<{ revisao: number }>(
      'SELECT revisao FROM documentos.documento WHERE id = $1', [origem.documentoId],
    )).rows[0].revisao;
    const exclusaoComCopia = await requisitar({
      metodo: 'POST', rota: `admin/documentos/${origem.documentoId}/excluir`, sessao: sessao('admin'),
      corpo: {
        revisao: revisaoOrigem, motivo: 'Limpeza fictícia após conferência do arquivo',
        confirmacao: `EXCLUIR DOCUMENTO ${origem.documentoId}`,
      },
    });
    expect(exclusaoComCopia.status, exclusaoComCopia.corpo).toBe(409);
    const coordenador = await requisitar({
      metodo: 'POST', rota: `documentos/${origem.documentoId}/copia`, sessao: sessao('coordenador2'), corpo: { confirmar: true },
    });
    expect(coordenador.status, coordenador.corpo).toBe(201);
  });

  it('cancela emissão somente por secretário ou administrador, com motivo cifrado', async () => {
    const alvo = emissoes[2];
    const rota = `documentos/${alvo.documentoId}/cancelar`;
    const motivo = 'Cancelamento sintético por erro material';
    for (const quem of ['analista', 'coordenador']) {
      expect((await requisitar({ metodo: 'POST', rota, sessao: sessao(quem), corpo: { motivo, confirmar: true } })).status).toBe(403);
    }
    expect((await requisitar({ metodo: 'POST', rota, sessao: sessao('secretario'), corpo: { motivo: ' ', confirmar: true } })).status)
      .toBe(400);
    expect((await requisitar({ metodo: 'POST', rota, sessao: sessao('secretario'), corpo: { motivo } })).status).toBe(400);
    const cancelado = await requisitar({ metodo: 'POST', rota, sessao: sessao('secretario'), corpo: { motivo, confirmar: true } });
    expect(cancelado.status, cancelado.corpo).toBe(200);
    expect(situacaoEmissaoSchema.parse(JSON.parse(cancelado.corpo))).toMatchObject({
      emissaoId: alvo.emissaoId, status: 'cancelado', numero: alvo.numero,
    });
    expect((await requisitar({ metodo: 'POST', rota, sessao: sessao('admin'), corpo: { motivo, confirmar: true } })).status).toBe(409);
    const linha = await banco().query<{
      status: string; cancelado_por: string; motivo_cancelamento_cifrado: Buffer;
    }>('SELECT status, cancelado_por, motivo_cancelamento_cifrado FROM documentos.documento WHERE id = $1', [alvo.documentoId]);
    expect(linha.rows[0]).toMatchObject({ status: 'cancelado', cancelado_por: idUsuario('secretario') });
    expect(linha.rows[0].motivo_cancelamento_cifrado.toString('latin1')).not.toContain('Cancelamento');
    expect(protetor.decifrar(linha.rows[0].motivo_cancelamento_cifrado, {
      schema: 'documentos', tabela: 'documento', registroId: alvo.documentoId, campo: 'motivo_cancelamento_cifrado',
    }).toString('utf8')).toBe(motivo);
    expect(await auditorias('documento_emitido_cancelado', alvo.documentoId)).toBe(1);
    const auditoria = await banco().query<{ detalhes: unknown }>(
      "SELECT detalhes FROM seguranca.auditoria WHERE acao = 'documento_emitido_cancelado'",
    );
    expect(JSON.stringify(auditoria.rows)).not.toContain(motivo);
    await expect(banco().query("UPDATE documentos.documento SET status = 'emitido' WHERE id = $1", [alvo.documentoId]))
      .rejects.toBeDefined();
    const historico = historicoEmissoesSchema.parse(JSON.parse((await requisitar({
      metodo: 'GET', rota: 'historico?tipo=DOF&escopo=todos', sessao: sessao('secretario'),
    })).corpo));
    expect(historico.itens.find((item) => item.emissaoId === alvo.emissaoId)).toMatchObject({
      status: 'cancelado', podeCancelar: false,
    });
    const outro = emissoes[3];
    const porAdmin = await requisitar({
      metodo: 'POST', rota: `documentos/${outro.documentoId}/cancelar`, sessao: sessao('admin'), corpo: { motivo, confirmar: true },
    });
    expect(porAdmin.status, porAdmin.corpo).toBe(200);
    const numeracao = await banco().query<{ ultimo_numero: string }>(
      "SELECT ultimo_numero::text FROM documentos.numeracao WHERE tipo = 'DOF'",
    );
    expect(numeracao.rows).toEqual([{ ultimo_numero: '7' }]);
  });

  it('aplica somente migrações pendentes com npm run migrar, sem reaplicar sobre banco atualizado', async () => {
    const provisionamento = {
      host: '127.0.0.1', porta: portaBanco, nome: 'sisdoc_emissao',
      migracao: { usuario: 'sisdoc_migrador', senha: senhaMigrador },
      aplicativo: { usuario: 'sisdoc_aplicativo', senha: senhaAplicativo },
    };
    const atualizado = await migrar(provisionamento);
    expect(atualizado).toEqual({ aplicadas: [], versaoAtual: '022-destinatario-coordenador' });
    expect((await banco().query('SELECT count(*)::int AS total FROM seguranca.migracao')).rows[0].total)
      .toBe(SEQUENCIA_MIGRACOES.length + 1);

    const anterior = new Client({
      host: '127.0.0.1', port: portaBanco, database: 'sisdoc_migrar', user: 'sisdoc_migrador', password: senhaMigrador,
    });
    await anterior.connect();
    try {
      await anterior.query(`
        CREATE SCHEMA seguranca;
        CREATE TABLE seguranca.usuario (
          id uuid PRIMARY KEY,
          matricula text NOT NULL UNIQUE,
          nome text NOT NULL,
          email text,
          senha_hash text NOT NULL,
          papel text NOT NULL CHECK (papel IN ('analista', 'coordenador', 'secretario_adjunto', 'admin')),
          ativo boolean NOT NULL DEFAULT true,
          tentativas_falhas integer NOT NULL DEFAULT 0 CHECK (tentativas_falhas >= 0),
          bloqueado_ate timestamptz,
          troca_senha_obrigatoria boolean NOT NULL DEFAULT true,
          ultimo_login timestamptz,
          criado_em timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE seguranca.migracao (versao text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now());
        INSERT INTO seguranca.migracao (versao) VALUES ('000-fundacao');
        GRANT USAGE ON SCHEMA seguranca TO sisdoc_aplicativo;
        GRANT SELECT, INSERT, UPDATE ON seguranca.usuario TO sisdoc_aplicativo;
      `);
      await anterior.query('BEGIN');
      for (const migracao of SEQUENCIA_MIGRACOES.slice(0, 12)) {
        expect(await migracao.aplicar(anterior, 'sisdoc_aplicativo')).toBe(true);
      }
      await anterior.query('COMMIT');
      const semEmissao = await anterior.query("SELECT to_regclass('documentos.aprovacao_modelo') IS NULL AS ausente");
      expect(semEmissao.rows[0].ausente).toBe(true);
      const primeiraExecucao = await migrar({ ...provisionamento, nome: 'sisdoc_migrar' });
      expect(primeiraExecucao).toEqual({
        aplicadas: [
          '013-emissao', '014-dtc', '015-importacao', '016-acesso-admin', '017-documentos-admin',
          '018-edicao-cadastro', '019-planilhas-legado', '020-listagem-servidores', '021-revisao-periodos-ipam',
          '022-destinatario-coordenador',
        ],
        versaoAtual: '022-destinatario-coordenador',
      });
      const segundaExecucao = await migrar({ ...provisionamento, nome: 'sisdoc_migrar' });
      expect(segundaExecucao).toEqual({ aplicadas: [], versaoAtual: '022-destinatario-coordenador' });
      const privilegios = await anterior.query<{ inserir: boolean; aprovar: boolean }>(`
        SELECT has_column_privilege('sisdoc_aplicativo', 'documentos.emissao', 'snapshot_cifrado', 'INSERT') AS inserir,
          has_table_privilege('sisdoc_aplicativo', 'documentos.aprovacao_modelo', 'INSERT') AS aprovar
      `);
      expect(privilegios.rows[0]).toEqual({ inserir: true, aprovar: false });
      await expect(migrar({ ...provisionamento, nome: 'postgres' })).rejects.toThrow('histórico de migrações');
    } finally {
      await anterior.end();
    }
  });

  it('admin edita, confere e emite DOF de outro autor sem encaminhamento, preservando controles', async () => {
    const alvo = await prepararConferida('Pessoa Acesso Admin Fictícia', 'analista2', 'admin');
    const linha = await banco().query(`
      SELECT d.criado_por, d.conferido_por, count(e.id)::int AS encaminhamentos
      FROM documentos.documento d LEFT JOIN documentos.encaminhamento_dof e ON e.documento_id = d.id
      WHERE d.id = $1 GROUP BY d.id
    `, [alvo.documentoId]);
    expect(linha.rows[0]).toEqual({
      criado_por: idUsuario('analista2'), conferido_por: idUsuario('admin'), encaminhamentos: 0,
    });
    expect((await emitir({ ...alvo, revisao: alvo.revisao - 1 }, randomUUID(), 'admin')).status).toBe(409);
    const semCsrf = await requisitar({
      metodo: 'POST', rota: `documentos/${alvo.documentoId}/emitir`, cookie: sessao('admin').cookie, chave: randomUUID(),
      corpo: { revisao: alvo.revisao, provaFonte: alvo.provaFonte },
    });
    expect(semCsrf.status).toBe(403);
    const resposta = await emitir(alvo, randomUUID(), 'admin');
    expect(resposta.status, resposta.corpo).toBe(200);
    const emitida = situacaoEmissaoSchema.parse(JSON.parse(resposta.corpo));
    const snapshot = await banco().query<{ snapshot_cifrado: Buffer; emitido_por: string }>(
      'SELECT snapshot_cifrado, emitido_por FROM documentos.emissao WHERE id = $1', [emitida.emissaoId],
    );
    expect(snapshot.rows[0].emitido_por).toBe(idUsuario('admin'));
    const copiarComoAdmin = await requisitar({
      metodo: 'POST', rota: `documentos/${alvo.documentoId}/copia`, sessao: sessao('admin'), corpo: { confirmar: true },
    });
    expect(copiarComoAdmin.status, copiarComoAdmin.corpo).toBe(403);
    expect((await requisitar({
      metodo: 'POST', rota: 'documentos', sessao: sessao('admin'), corpo: {},
    })).status).toBe(403);
    expect((await requisitar({
      metodo: 'POST', rota: 'dtc', sessao: sessao('admin'), corpo: {},
    })).status).toBe(403);
    expect((await requisitar({
      metodo: 'POST', rota: `dtc/${alvo.documentoId}/copia`, sessao: sessao('admin'), corpo: { confirmar: true },
    })).status).toBe(403);
    const cancelada = await requisitar({
      metodo: 'POST', rota: `documentos/${alvo.documentoId}/cancelar`, sessao: sessao('admin'),
      corpo: { motivo: 'Cancelamento administrativo fictício', confirmar: true },
    });
    expect(cancelada.status, cancelada.corpo).toBe(200);
    const preservado = await banco().query<{ snapshot_cifrado: Buffer }>(
      'SELECT snapshot_cifrado FROM documentos.emissao WHERE id = $1', [emitida.emissaoId],
    );
    expect(preservado.rows[0].snapshot_cifrado).toEqual(snapshot.rows[0].snapshot_cifrado);
    expect(await auditorias('dof_emitida', alvo.documentoId)).toBe(1);
    const encaminhada = await prepararConferida('Pessoa Devolução Admin Fictícia', 'analista2');
    const devolvida = await requisitar({
      metodo: 'POST', rota: `documentos/${encaminhada.documentoId}/devolver-conferido`, sessao: sessao('admin'),
      corpo: { revisao: encaminhada.revisao, motivo: 'Devolução administrativa fictícia' },
    });
    expect(devolvida.status, devolvida.corpo).toBe(201);
    const aberta = await requisitar({
      metodo: 'GET', rota: `documentos/${encaminhada.documentoId}`, sessao: sessao('admin'),
    });
    expect(aberta.status, aberta.corpo).toBe(200);
    const rascunho = rascunhoDofSchema.parse(JSON.parse(aberta.corpo));
    expect(rascunho.encaminhamento).toBeNull();
    const reenviada = await requisitar({
      metodo: 'POST', rota: `documentos/${rascunho.id}/encaminhar`, sessao: sessao('admin'),
      corpo: { revisao: rascunho.revisao, destinatarioId: idUsuario('coordenador2') },
    });
    expect(reenviada.status, reenviada.corpo).toBe(201);
    const recolhida = await requisitar({
      metodo: 'POST', rota: `documentos/${rascunho.id}/recolher`, sessao: sessao('admin'),
      corpo: { revisao: rascunhoDofSchema.parse(JSON.parse(reenviada.corpo)).revisao, motivo: 'Recolhimento administrativo fictício' },
    });
    expect(recolhida.status, recolhida.corpo).toBe(201);
    expect(rascunhoDofSchema.parse(JSON.parse(recolhida.corpo)).encaminhamento).toBeNull();
  });

  it('não oferece admin como destinatário nem aceita envio direto, mas mantém sua consulta global', async () => {
    const alvo = await prepararConferida('Pessoa Encaminhamento Coordenador Fictícia', 'analista2');
    const devolvida = await requisitar({
      metodo: 'POST', rota: `documentos/${alvo.documentoId}/devolver-conferido`, sessao: sessao('admin'),
      corpo: { revisao: alvo.revisao, motivo: 'Reabrir para teste de destinatário fictício' },
    });
    expect(devolvida.status, devolvida.corpo).toBe(201);
    const aberta = await requisitar({ metodo: 'GET', rota: `documentos/${alvo.documentoId}`, sessao: sessao('admin') });
    const rascunho = rascunhoDofSchema.parse(JSON.parse(aberta.corpo));
    const proprioCoordenador = await prepararConferida('Pessoa Autor Coordenador Fictícia', 'coordenador2', 'coordenador2');
    const reaberta = await requisitar({
      metodo: 'POST', rota: `documentos/${proprioCoordenador.documentoId}/devolver-conferido`, sessao: sessao('admin'),
      corpo: { revisao: proprioCoordenador.revisao, motivo: 'Reabrir autoria coordenador para teste' },
    });
    expect(reaberta.status).toBe(201);
    const detalheCoordenador = await requisitar({
      metodo: 'GET', rota: `documentos/${proprioCoordenador.documentoId}`, sessao: sessao('coordenador2'),
    });
    const rascunhoCoordenador = rascunhoDofSchema.parse(JSON.parse(detalheCoordenador.corpo));
    for (const remetente of ['analista2', 'coordenador2']) {
      const lista = await requisitar({ metodo: 'GET', rota: 'documentos/coordenadores?limite=50', sessao: sessao(remetente) });
      expect(lista.status).toBe(200);
      const itens = JSON.parse(lista.corpo).itens as Array<{ id: string }>;
      expect(itens.some((item) => item.id === idUsuario('admin'))).toBe(false);
      expect(itens.some((item) => item.id === idUsuario('coordenador'))).toBe(true);
      const envio = await requisitar({
        metodo: 'POST', rota: `documentos/${remetente === 'analista2' ? rascunho.id : rascunhoCoordenador.id}/encaminhar`, sessao: sessao(remetente),
        corpo: { revisao: remetente === 'analista2' ? rascunho.revisao : rascunhoCoordenador.revisao, destinatarioId: idUsuario('admin') },
      });
      expect(envio.status, envio.corpo).toBe(400);
    }
    await expect(banco().query(`INSERT INTO documentos.encaminhamento_dof
      (id, documento_id, encaminhado_por, destinatario_id) VALUES ($1, $2, $3, $4)`,
    [randomUUID(), rascunho.id, idUsuario('analista2'), idUsuario('admin')])).rejects.toMatchObject({ code: '23514' });
    const enviada = await requisitar({
      metodo: 'POST', rota: `documentos/${rascunho.id}/encaminhar`, sessao: sessao('analista2'),
      corpo: { revisao: rascunho.revisao, destinatarioId: idUsuario('coordenador2') },
    });
    expect(enviada.status, enviada.corpo).toBe(201);
    const consulta = await requisitar({ metodo: 'GET', rota: 'documentos/encaminhados?limite=50', sessao: sessao('admin') });
    expect(consulta.status).toBe(200);
    expect(JSON.parse(consulta.corpo).itens.some((item: { id: string }) => item.id === rascunho.id)).toBe(true);
  });

  it('apaga documento e PDF após confirmação ativa, mantém auditoria e nunca reutiliza o número', async () => {
    const alvo = await prepararConferida('Pessoa Exclusão Física Fictícia', 'analista2', 'admin');
    const emitidaResposta = await emitir(alvo, randomUUID(), 'admin');
    expect(emitidaResposta.status, emitidaResposta.corpo).toBe(200);
    const emitida = situacaoEmissaoSchema.parse(JSON.parse(emitidaResposta.corpo));
    await worker.ciclo();
    const artefato = await banco().query<{ id: string; caminho_relativo: string; numero: string }>(`
      SELECT a.id, a.caminho_relativo, e.numero::text AS numero FROM documentos.artefato_pdf a
      JOIN documentos.emissao e ON e.id = a.emissao_id WHERE e.documento_id = $1
    `, [alvo.documentoId]);
    expect(artefato.rows).toHaveLength(1);
    const arquivosAntes = await readdir(path.join(raiz, 'pdf'));
    expect(arquivosAntes).toContain(artefato.rows[0].caminho_relativo);
    const motivo = 'Exclusão administrativa sintética solicitada para teste';
    const rota = `admin/documentos/${alvo.documentoId}/excluir`;
    const corpo = { revisao: alvo.revisao, motivo, confirmacao: `EXCLUIR DOCUMENTO ${alvo.documentoId}` };
    expect((await requisitar({ metodo: 'POST', rota, sessao: sessao('analista'), corpo })).status).toBe(403);
    expect((await requisitar({
      metodo: 'POST', rota, sessao: sessao('admin'), corpo: { ...corpo, revisao: alvo.revisao - 1 },
    })).status).toBe(409);
    expect((await requisitar({
      metodo: 'POST', rota, sessao: sessao('admin'), corpo: { ...corpo, confirmacao: 'EXCLUIR' },
    })).status).toBe(400);
    const excluida = await requisitar({ metodo: 'POST', rota, sessao: sessao('admin'), corpo });
    expect(excluida.status, excluida.corpo).toBe(200);
    expect(resultadoExclusaoDocumentoSchema.parse(JSON.parse(excluida.corpo))).toMatchObject({
      estado: 'concluido', numero: emitida.numero,
    });
    expect((await banco().query('SELECT 1 FROM documentos.documento WHERE id = $1', [alvo.documentoId])).rows).toHaveLength(0);
    expect((await banco().query('SELECT 1 FROM documentos.emissao WHERE documento_id = $1', [alvo.documentoId])).rows).toHaveLength(0);
    expect(await readdir(path.join(raiz, 'pdf'))).not.toContain(artefato.rows[0].caminho_relativo);
    const auditoria = await banco().query<{ detalhes: { motivo: string; numero: string; revisao: number } }>(`
      SELECT detalhes FROM seguranca.auditoria
      WHERE acao = 'documento_excluido_fisicamente' AND entidade_id = $1
    `, [alvo.documentoId]);
    expect(auditoria.rows).toHaveLength(1);
    expect(auditoria.rows[0].detalhes).toMatchObject({ motivo, numero: emitida.numero, revisao: alvo.revisao });
    const emissaoSeguinte = await prepararConferida('Pessoa Número Seguinte Fictícia', 'analista', 'coordenador');
    const seguinte = await emitir(emissaoSeguinte, randomUUID());
    expect(seguinte.status, seguinte.corpo).toBe(200);
    const numero = (await banco().query<{ numero: string }>(
      'SELECT numero::text FROM documentos.emissao WHERE documento_id = $1', [emissaoSeguinte.documentoId],
    )).rows[0].numero;
    const anterior = (await banco().query<{ numero_formatado: string }>(
      'SELECT numero_formatado FROM documentos.exclusao_documento WHERE documento_id = $1', [alvo.documentoId],
    )).rows[0]?.numero_formatado;
    expect(anterior).toBe(emitida.numero);
    expect(Number(numero)).toBeGreaterThan(Number(artefato.rows[0].numero));
  });
});
