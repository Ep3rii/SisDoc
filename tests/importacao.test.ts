import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  conferenciaImportacaoSchema, paginaLotesImportacaoSchema, relatorioImportacaoSchema, respostaSessaoSchema,
  type Configuracao, type RelatorioImportacao, type TipoImportacao,
  referenciaServidorSchema,
} from '@sisdoc/contratos';
import EmbeddedPostgres from 'embedded-postgres';
import forge from 'node-forge';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAplicacao } from '../apps/api/dist/aplicacao.js';
import { carregarConfiguracao } from '../apps/api/dist/configuracao.js';
import { analisarLinhas, COLUNAS } from '../apps/api/dist/importacao/formatos.js';
import { conferenciaGeral, conferirArquivo, desfazerLote, ErroImportacao, hashArquivo, importarLinhas } from '../apps/api/dist/importacao/importador.js';
import { lerLegado, lerMapeamento } from '../apps/api/dist/importacao/legado.js';
import { escreverCsv, escreverXlsx, ErroPlanilha, lerPlanilha } from '../apps/api/dist/importacao/planilhas.js';
import { ProtetorDados } from '../apps/api/dist/seguranca/protecao-dados.js';
import { gerarHashSenha } from '../apps/api/dist/seguranca/senhas.js';
import { instalar } from '../apps/api/dist/setup/instalador.js';
import { cpfSintetico } from './dados-sinteticos.js';

const senhaMigrador = 'MigracaoImportFicticia!12345';
const senhaAplicativo = 'AplicativoImportFicticio!12345';
const senhaSuperusuario = 'SuperusuarioImportFicticio!12345';
const senhaUsuarios = 'UsuarioImportFicticio!12345';
const nomeTls = 'sisdoc.local';

type Sessao = { cookie: string; csrf: string };
type Linha = Record<string, string>;

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
  const nomeCa = [{ name: 'commonName', value: 'CA temporaria de testes de importacao' }];
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

function planilha(tipo: TipoImportacao, linhas: Linha[], colunas: readonly string[] = COLUNAS[tipo]): string[][] {
  return [[...colunas], ...linhas.map((linha) => colunas.map((coluna) => linha[coluna] ?? ''))];
}

function funcional(indiceCpf: number, matricula: string, extra: Linha = {}): Linha {
  return {
    MATRICULA: matricula, NOME: `PESSOA FICTICIA ${indiceCpf}`, CPF: cpfSintetico(indiceCpf), NASCIMENTO: '15/03/1970',
    MAE: `MAE FICTICIA ${indiceCpf}`, ADMISSAO: '01/02/2000', REGIMEJUR: 'ESTATUTARIO', CARGO: 'PROFESSOR', REFERENCIA: 'A-01',
    SETOR: 'SETOR FICTICIO', ORGAO: 'ORGAO FICTICIO', ENDERECO: 'RUA FICTICIA, 1', ...extra,
  };
}

describe('Importação de planilhas e base legada', () => {
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
  const usuarios = new Map<string, { id: string; sessao: Sessao }>();

  function banco(): Client {
    if (!migrador) throw new Error('Conexão de migração indisponível.');
    return migrador;
  }

  function admin(): string {
    const usuario = usuarios.get('admin');
    if (!usuario) throw new Error('Administrador sintético ausente.');
    return usuario.id;
  }

  async function importar(
    tipo: TipoImportacao, linhas: string[][], origem = 'planilha-teste', gravar = true, conteudo?: Buffer,
  ): Promise<RelatorioImportacao> {
    if (!poolAplicativo) throw new Error('Pool indisponível.');
    const cliente = await poolAplicativo.connect();
    try {
      return await importarLinhas(cliente, protetor, linhas, {
        tipo, origem, canal: 'cli', usuarioId: admin(), gravar,
        hashArquivo: hashArquivo(conteudo ?? Buffer.from(JSON.stringify(linhas))),
      });
    } finally {
      cliente.release();
    }
  }

  async function contar(tabela: string, origem = 'planilha-teste'): Promise<number> {
    return (await banco().query(`SELECT count(*)::int AS total FROM nucleo.${tabela} WHERE sistema_origem = $1`, [origem])).rows[0].total;
  }

  async function requisitar(opcoes: {
    metodo: 'GET' | 'POST'; rota: string; corpo?: Buffer; tipoConteudo?: string; sessao?: Sessao;
  }): Promise<{ status: number | undefined; corpo: string; binario: Buffer; cookie?: string }> {
    return new Promise((resolve, reject) => {
      const pedido = https.request({
        host: '127.0.0.1', port: portaHttps, servername: nomeTls, path: `/api/v1/${opcoes.rota}`, method: opcoes.metodo,
        ca: caPem, rejectUnauthorized: true, agent: false, timeout: 60000,
        headers: {
          Origin: `https://${nomeTls}:${portaHttps}`,
          ...(opcoes.corpo ? { 'Content-Type': opcoes.tipoConteudo ?? 'application/octet-stream', 'Content-Length': opcoes.corpo.length } : {}),
          ...(opcoes.sessao ? { Cookie: opcoes.sessao.cookie, 'X-CSRF-Token': opcoes.sessao.csrf } : {}),
        },
      }, (resposta) => {
        const partes: Buffer[] = [];
        resposta.on('data', (parte: Buffer) => partes.push(parte));
        resposta.on('end', () => resolve({
          status: resposta.statusCode, corpo: Buffer.concat(partes).toString('utf8'), binario: Buffer.concat(partes),
          cookie: resposta.headers['set-cookie']?.[0]?.split(';')[0],
        }));
        resposta.on('error', reject);
      });
      pedido.once('timeout', () => pedido.destroy(new Error(`Tempo HTTPS esgotado em ${opcoes.rota}.`)));
      pedido.once('error', reject);
      pedido.end(opcoes.corpo);
    });
  }

  async function criarUsuario(chave: string, papel: string): Promise<void> {
    const id = randomUUID();
    const matricula = `IMP-${chave.toUpperCase()}`;
    await banco().query(`
      INSERT INTO seguranca.usuario (id, matricula, nome, senha_hash, papel, troca_senha_obrigatoria)
      VALUES ($1, $2, $3, $4, $5, false)
    `, [id, matricula, `Operador sintético ${chave}`, await gerarHashSenha(senhaUsuarios), papel]);
    const login = await requisitar({
      metodo: 'POST', rota: 'auth/login', tipoConteudo: 'application/json',
      corpo: Buffer.from(JSON.stringify({ matricula, senha: senhaUsuarios })),
    });
    expect(login.status, login.corpo).toBe(200);
    if (!login.cookie) throw new Error('Cookie sintético ausente.');
    usuarios.set(chave, { id, sessao: { cookie: login.cookie, csrf: respostaSessaoSchema.parse(JSON.parse(login.corpo)).csrf } });
  }

  beforeAll(async () => {
    if (process.platform !== 'win32' || !process.env.PUBLIC) {
      throw new Error('Esta verificação de instalação requer Windows e uma pasta pública local.');
    }
    const temporarios = process.env.SISDOC_TEST_TEMP ?? os.tmpdir();
    if (!path.isAbsolute(temporarios) || /[^\x00-\x7f]/.test(temporarios)) {
      throw new Error('Defina SISDOC_TEST_TEMP com um diretório local absoluto ASCII ou com caminho curto 8.3 existente.');
    }
    temporario = await mkdtemp(path.join(temporarios, 'sisdoc-importacao-'));
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
      password: senhaSuperusuario,
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
    await administradorBanco.query('CREATE DATABASE sisdoc_importacao OWNER sisdoc_migrador');
    await instalar({
      raiz,
      porta: portaHttps,
      banco: {
        porta: portaBanco, nome: 'sisdoc_importacao', migrador: 'sisdoc_migrador', senhaMigrador,
        usuario: 'sisdoc_aplicativo', senha: senhaAplicativo,
      },
      tls: { certificado, chave, ca, nome: nomeTls },
      sidServico: 'S-1-5-19',
      listaSenhas,
      processos: { mascaras: ['####/####'] },
      administrador: { matricula: 'ADMIN-IMPORT-FICTICIO', nome: 'Operador Fictício', senha: 'AdministradorImportFicticio!12345' },
    });
    config = await carregarConfiguracao(path.join(raiz, 'config', 'aplicacao.json'));
    protetor = new ProtetorDados(config.chaves);
    migrador = new Client({
      host: '127.0.0.1', port: portaBanco, database: 'sisdoc_importacao', user: 'sisdoc_migrador', password: senhaMigrador,
    });
    await migrador.connect();
    poolAplicativo = new Pool({
      host: config.banco.host, port: config.banco.porta, database: config.banco.nome,
      user: config.banco.usuario, password: config.banco.senha, max: 10, connectionTimeoutMillis: 5000,
    });
    app = await criarAplicacao(config, poolAplicativo);
    await app.listen(portaHttps, '127.0.0.1');
    await criarUsuario('admin', 'admin');
  }, 240_000);

  afterAll(async () => {
    if (app) await app.close();
    if (poolAplicativo && !poolAplicativo.ended) await poolAplicativo.end();
    if (migrador) await migrador.end();
    if (administradorBanco) await administradorBanco.end();
    if (iniciado && postgres) await postgres.stop();
    if (raiz && path.basename(raiz).startsWith('SisDocVerificacao-')) {
      await rm(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
    if (temporario && path.basename(temporario).startsWith('sisdoc-importacao-')) {
      await rm(temporario, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  it('lê CSV e XLSX equivalentes, com BOM, delimitadores e ADMISSAO duplicada', async () => {
    const linhas = planilha('dados_funcionais', [funcional(910000001, 'A-1'), funcional(910000002, 'A-2', { NOME: 'JOSÉ ÇÃO "ASPAS"; VÍRGULA, X' })]);
    expect(lerPlanilha(escreverCsv(linhas)).linhas).toEqual(linhas);
    expect(lerPlanilha(escreverXlsx(linhas)).linhas).toEqual(linhas);
    const virgula = Buffer.from(`\uFEFFMATRICULA,NOME\r\n"1,0",ANA\r\n`, 'utf8');
    expect(lerPlanilha(virgula).linhas).toEqual([['MATRICULA', 'NOME'], ['1,0', 'ANA']]);
    expect(() => lerPlanilha(Buffer.from([0x4d, 0x41, 0xff, 0xfe, 0x0a]))).toThrow(ErroPlanilha);
    expect(() => lerPlanilha(Buffer.from('PK\u0003\u0004quebrado'))).toThrow(ErroPlanilha);
    const duplicada = [['MATRICULA', 'NOME', 'CPF', 'ADMISSAO', 'ADMISSAO'], ['B-1', 'ANA', cpfSintetico(910000003), '01/01/2000', '05/05/1995']];
    const analise = analisarLinhas('dados_funcionais', duplicada);
    expect(analise.avisos.join(' ')).toContain('EXPEDICAO');
    expect(analise.analise.tipo === 'dados_funcionais' && analise.analise.pessoas[0].campos.expedicao).toBe('1995-05-05');
  });

  it('valida sem gravar, grava, repete de forma idempotente e consolida por CPF', async () => {
    const cpfComum = 910000010;
    const linhas = planilha('dados_funcionais', [
      funcional(cpfComum, 'C-1'),
      funcional(cpfComum, 'C-2', { MAE: '', CARGO: 'DIRETOR' }),
      funcional(910000011, 'C-3', { REFERENCIA: 'SEMHIFEN' }),
      funcional(910000012, 'C-1'),
      { ...funcional(910000013, 'C-5'), CPF: '12345678900' },
      funcional(910000014, '', {}),
      funcional(910000015, 'C-6', { NASCIMENTO: '31/02/1970' }),
    ]);
    const validacao = await importar('dados_funcionais', linhas, 'planilha-teste', false);
    expect(validacao.modo).toBe('validacao');
    expect(validacao.loteId).toBeNull();
    expect(validacao.contagens).toMatchObject({ lidos: 7, quarentena: 1, duplicados: 1 });
    expect(validacao.contagens.inseridos).toBeGreaterThan(0);
    expect(await contar('vinculo')).toBe(0);
    expect((await banco().query('SELECT count(*)::int AS total FROM nucleo.importacao_lote')).rows[0].total).toBe(0);
    for (const ocorrencia of validacao.ocorrencias) {
      expect(ocorrencia.referencia).not.toMatch(/\d{11}/);
      expect(ocorrencia.referencia).not.toContain('C-1');
    }
    const tipos = new Set(validacao.ocorrencias.map((item) => item.tipo));
    for (const tipo of ['quarentena', 'duplicada', 'rejeitada', 'anomalia']) expect(tipos).toContain(tipo);

    const gravado = await importar('dados_funcionais', linhas);
    expect(gravado.modo).toBe('gravacao');
    expect(gravado.loteId).not.toBeNull();
    expect(await contar('vinculo')).toBe(4);
    const pessoas = await banco().query(`
      SELECT p.id, count(v.id)::int AS vinculos FROM nucleo.pessoa p JOIN nucleo.vinculo v ON v.pessoa_id = p.id
      WHERE p.cpf_hash = $1 GROUP BY p.id
    `, [protetor.hashCpf(cpfSintetico(cpfComum))]);
    expect(pessoas.rows).toEqual([expect.objectContaining({ vinculos: 2 })]);
    const nascimento = await banco().query(`
      SELECT p.nascimento FROM nucleo.pessoa p WHERE p.cpf_hash = $1
    `, [protetor.hashCpf(cpfSintetico(910000015))]);
    expect(nascimento.rows[0].nascimento).toBeNull();

    const repetido = await importar('dados_funcionais', linhas);
    expect(repetido.loteExistente).toBe(gravado.loteId);
    const revisoes = await banco().query("SELECT sum(revisao_fonte)::int AS soma FROM nucleo.vinculo WHERE sistema_origem = 'planilha-teste'");
    const outroArquivo = await importar('dados_funcionais', [...linhas, []], 'planilha-teste', true, Buffer.from('outro-conteudo'));
    expect(outroArquivo.loteExistente).toBeNull();
    expect(outroArquivo.contagens.inseridos).toBe(0);
    expect(outroArquivo.contagens.atualizados).toBe(0);
    const depois = await banco().query("SELECT sum(revisao_fonte)::int AS soma FROM nucleo.vinculo WHERE sistema_origem = 'planilha-teste'");
    expect(depois.rows[0].soma).toBe(revisoes.rows[0].soma);
    const lotes = await banco().query("SELECT status, canal, tipo FROM nucleo.importacao_lote ORDER BY iniciado_em");
    expect(lotes.rows.map((lote) => lote.status)).toEqual(['concluido', 'concluido']);
    const auditoria = await banco().query("SELECT count(*)::int AS total FROM seguranca.auditoria WHERE acao = 'importacao_concluida'");
    expect(auditoria.rows[0].total).toBe(2);
  });

  it('atualiza apenas campos alterados sem apagar dados com célula vazia e permite desfazer em ordem LIFO', async () => {
    const original = planilha('dados_funcionais', [funcional(910000020, 'D-1'), funcional(910000021, 'D-2')]);
    const primeiro = await importar('dados_funcionais', original, 'origem-rollback');
    const alterado = planilha('dados_funcionais', [
      funcional(910000020, 'D-1', { CARGO: 'COORDENADOR', SETOR: '' }),
      funcional(910000021, 'D-2'),
      funcional(910000022, 'D-3'),
    ]);
    const segundo = await importar('dados_funcionais', alterado, 'origem-rollback');
    expect(segundo.contagens.atualizados).toBeGreaterThan(0);
    const vinculo = await banco().query("SELECT cargo, setor, revisao_fonte FROM nucleo.vinculo WHERE sistema_origem = 'origem-rollback' AND matricula = 'D-1'");
    expect(vinculo.rows[0]).toMatchObject({ cargo: 'COORDENADOR', setor: 'SETOR FICTICIO' });
    await expect(desfazerLote(banco(), primeiro.loteId as string)).rejects.toBeInstanceOf(ErroImportacao);
    const desfeito = await desfazerLote(banco(), segundo.loteId as string);
    expect(desfeito.removidos).toBeGreaterThan(0);
    expect(desfeito.restaurados).toBeGreaterThan(0);
    const restaurado = await banco().query("SELECT cargo FROM nucleo.vinculo WHERE sistema_origem = 'origem-rollback' AND matricula = 'D-1'");
    expect(restaurado.rows[0].cargo).toBe('PROFESSOR');
    expect(await contar('vinculo', 'origem-rollback')).toBe(2);
    await expect(desfazerLote(banco(), segundo.loteId as string)).rejects.toThrow(/desfeito/);

    const pessoa = await banco().query('SELECT id FROM nucleo.pessoa WHERE cpf_hash = $1', [protetor.hashCpf(cpfSintetico(910000020))]);
    await banco().query(`
      INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, pessoa_id) VALUES ($1, 'servidor_consultado', 'pessoa', $2)
    `, [admin(), pessoa.rows[0].id]);
    await expect(desfazerLote(banco(), primeiro.loteId as string)).rejects.toThrow(/dependem/);
    const situacao = await banco().query('SELECT status FROM nucleo.importacao_lote WHERE id = $1', [primeiro.loteId]);
    expect(situacao.rows[0].status).toBe('concluido');
  });

  it('importa afastamentos, incorporações, períodos IPAM e eventos com idempotência', async () => {
    await importar('dados_funcionais', planilha('dados_funcionais', [funcional(910000030, 'E-1'), funcional(910000031, 'E-2')]), 'origem-tipos');
    const afastamentos = planilha('afastamentos', [
      { MATRICULA: 'E-1', ANO: '2020', FALTAS: '2', TS: '10' },
      { MATRICULA: 'E-1', ANO: '2020', FALTAS: '3' },
      { MATRICULA: 'E-9', ANO: '2020', FALTAS: '1' },
      { MATRICULA: 'E-2', ANO: '2021', IP: '400' },
    ]);
    const relatorioAfastamentos = await importar('afastamentos', afastamentos, 'origem-tipos');
    expect(relatorioAfastamentos.contagens.inseridos).toBe(2);
    expect(relatorioAfastamentos.contagens.duplicados).toBe(1);
    expect(relatorioAfastamentos.ocorrencias.some((item) => /matrícula não encontrada/i.test(item.motivo))).toBe(true);
    const intervalo = planilha('afastamentos', [{ MATRICULA: 'E-2', TIPO: 'PF', DT_INICIO: '2019-01-01', DT_FIM: '2019-01-31' }],
      ['MATRICULA', 'TIPO', 'DT_INICIO', 'DT_FIM']);
    expect((await importar('afastamentos', intervalo, 'origem-tipos')).contagens.inseridos).toBe(1);
    const incorporacoes = planilha('incorporacoes', [
      { MATRICULA: 'E-1', TIPO: 'PB', DT_INICIO: '01/01/2010', DT_FIM: '31/12/2014' },
      { MATRICULA: 'E-1', TIPO: 'XX', DT_INICIO: '01/01/2010', DT_FIM: '31/12/2014' },
    ]);
    expect((await importar('incorporacoes', incorporacoes, 'origem-tipos')).contagens).toMatchObject({ inseridos: 1, rejeitados: 1 });
    const periodos = planilha('periodos_ipam', [
      { CPF: cpfSintetico(910000030), MES_INICIO: '02/2000', MES_FIM: '12/2010' },
      { CPF: cpfSintetico(910000099), MES_INICIO: '02/2000', MES_FIM: '12/2010' },
    ]);
    const relatorioPeriodos = await importar('periodos_ipam', periodos, 'origem-tipos');
    expect(relatorioPeriodos.contagens.inseridos).toBe(1);
    const eventos = planilha('eventos_funcionais', [
      { MATRICULA: 'E-1', TIPO: 'Nomeação', DATA: '01/02/2000', ATO_NUMERO: 'PORTARIA 1', DATA_PUBLICACAO: '20/01/2000' },
      { MATRICULA: 'E-2', TIPO: 'Licença especial', DATA: '01/02/2001' },
    ]);
    const relatorioEventos = await importar('eventos_funcionais', eventos, 'origem-tipos');
    expect(relatorioEventos.contagens.inseridos).toBe(2);
    expect(relatorioEventos.contagens.anomalias).toBe(1);
    const repetido = await importar('eventos_funcionais', eventos, 'origem-tipos', true, Buffer.from('eventos-de-novo'));
    expect(repetido.contagens).toMatchObject({ inseridos: 0, atualizados: 0 });
    expect(repetido.contagens.inalterados).toBe(2);
    const geral = await conferenciaGeral(banco());
    expect(geral.origens.find((origem) => origem.origem === 'origem-tipos')).toMatchObject({
      vinculos: 2, afastamentos: 3, incorporacoes: 1, periodosIpam: 1, eventos: 2,
    });
    const conferencia = await conferirArquivo(banco(), protetor, 'dados_funcionais', 'origem-tipos',
      planilha('dados_funcionais', [funcional(910000030, 'E-1'), funcional(910000031, 'E-2', { CARGO: 'OUTRO' }), funcional(910000032, 'E-3')]), 10);
    expect(conferencia).toMatchObject({ noArquivo: 3, noBanco: 2, ausentes: 1 });
    const difere = conferencia.amostra.find((item) => item.campos.CARGO === 'difere');
    expect(difere?.referencia).not.toMatch(/\d{11}/);
  });

  it('expõe as rotas apenas ao administrador e processa o upload bruto', async () => {
    await criarUsuario('analista', 'analista');
    const linhas = planilha('dados_funcionais', [funcional(910000040, 'F-1')]);
    const xlsx = escreverXlsx(linhas);
    const sessaoAdmin = usuarios.get('admin')?.sessao as Sessao;
    const analista = usuarios.get('analista')?.sessao as Sessao;
    const rota = 'admin/importacoes?tipo=dados_funcionais&origem=Tela-Teste&modo=validar';
    expect((await requisitar({ metodo: 'POST', rota, corpo: xlsx })).status).toBe(401);
    expect((await requisitar({ metodo: 'POST', rota, corpo: xlsx, sessao: analista })).status).toBe(403);
    expect((await requisitar({ metodo: 'GET', rota: 'admin/importacoes', sessao: analista })).status).toBe(403);
    expect((await requisitar({ metodo: 'POST', rota, corpo: xlsx, sessao: sessaoAdmin, tipoConteudo: 'text/plain' })).status).toBe(415);
    expect((await requisitar({ metodo: 'POST', rota: 'admin/importacoes?tipo=x&origem=a', corpo: xlsx, sessao: sessaoAdmin })).status).toBe(400);
    const validar = await requisitar({ metodo: 'POST', rota, corpo: xlsx, sessao: sessaoAdmin });
    expect(validar.status, validar.corpo).toBe(200);
    const relatorio = relatorioImportacaoSchema.parse(JSON.parse(validar.corpo));
    expect(relatorio).toMatchObject({ modo: 'validacao', origem: 'tela-teste', loteId: null });
    expect(await contar('vinculo', 'tela-teste')).toBe(0);
    const gravar = await requisitar({ metodo: 'POST', rota: rota.replace('validar', 'gravar'), corpo: xlsx, sessao: sessaoAdmin });
    expect(gravar.status, gravar.corpo).toBe(200);
    expect(relatorioImportacaoSchema.parse(JSON.parse(gravar.corpo)).modo).toBe('gravacao');
    expect(await contar('vinculo', 'tela-teste')).toBe(1);
    const invalido = await requisitar({ metodo: 'POST', rota, corpo: Buffer.from('PK\u0003\u0004xx'), sessao: sessaoAdmin });
    expect(invalido.status).toBe(422);
    const lista = await requisitar({ metodo: 'GET', rota: 'admin/importacoes?limite=2', sessao: sessaoAdmin });
    expect(lista.status, lista.corpo).toBe(200);
    const pagina = paginaLotesImportacaoSchema.parse(JSON.parse(lista.corpo));
    expect(pagina.itens[0]).toMatchObject({ canal: 'tela', origem: 'tela-teste', status: 'concluido' });
    expect(pagina.proximoCursor).not.toBeNull();
    const seguinte = await requisitar({ metodo: 'GET', rota: `admin/importacoes?limite=2&cursor=${encodeURIComponent(pagina.proximoCursor as string)}`, sessao: sessaoAdmin });
    const paginaSeguinte = paginaLotesImportacaoSchema.parse(JSON.parse(seguinte.corpo));
    expect(paginaSeguinte.itens.map((item) => item.id)).not.toContain(pagina.itens[0].id);
    const conferencia = await requisitar({ metodo: 'GET', rota: 'admin/importacoes/conferencia', sessao: sessaoAdmin });
    expect(conferencia.status).toBe(200);
    expect(conferenciaImportacaoSchema.parse(JSON.parse(conferencia.corpo)).origens.map((item) => item.origem)).toContain('tela-teste');
  });

  it('lê a base legada por mapeamento e falha com mensagem clara se faltar coluna', async () => {
    if (!administradorBanco) throw new Error('Administrador indisponível.');
    await administradorBanco.query('CREATE DATABASE legado_ficticio');
    const legado = new Client({ host: '127.0.0.1', port: portaBanco, database: 'legado_ficticio', user: 'postgres', password: senhaSuperusuario });
    await legado.connect();
    try {
      await legado.query(`
        CREATE SCHEMA rh;
        CREATE TABLE rh.servidor (matr text, nome_completo text, cpf text, dt_adm date, regime text);
        CREATE TABLE rh.ficha (matr text, ano int, faltas int);
      `);
      await legado.query(`INSERT INTO rh.servidor VALUES ('L-1', 'PESSOA LEGADA', $1, '2001-03-04', 'ESTATUTARIO'), ('L-2', 'OUTRA LEGADA', $2, NULL, NULL)`,
        [cpfSintetico(910000050), cpfSintetico(910000051)]);
      await legado.query("INSERT INTO rh.ficha VALUES ('L-1', 2005, 4)");
    } finally {
      await legado.end();
    }
    process.env.SISDOC_TESTE_SENHA_LEGADO = senhaSuperusuario;
    const mapa = {
      origem: 'legado-teste',
      conexao: { host: '127.0.0.1', porta: portaBanco, banco: 'legado_ficticio', usuario: 'postgres', senhaVariavel: 'SISDOC_TESTE_SENHA_LEGADO' },
      consultas: {
        dados_funcionais: { tabela: 'rh.servidor', colunas: { MATRICULA: 'matr', NOME: 'nome_completo', CPF: 'cpf', ADMISSAO: 'dt_adm', REGIMEJUR: 'regime' } },
        afastamentos: { tabela: 'rh.ficha', colunas: { MATRICULA: 'matr', ANO: 'ano', FALTAS: 'faltas_inexistente' } },
      },
    };
    const arquivoMapa = path.join(temporario, 'mapa.json');
    await writeFile(arquivoMapa, JSON.stringify(mapa));
    await expect(lerLegado(await lerMapeamento(arquivoMapa))).rejects.toThrow(/faltas_inexistente/);
    mapa.consultas.afastamentos.colunas.FALTAS = 'faltas';
    await writeFile(arquivoMapa, JSON.stringify(mapa));
    const conjuntos = await lerLegado(await lerMapeamento(arquivoMapa));
    expect(conjuntos.map((conjunto) => conjunto.tipo)).toEqual(['dados_funcionais', 'afastamentos']);
    for (const conjunto of conjuntos) {
      if (!poolAplicativo) throw new Error('Pool indisponível.');
      const cliente = await poolAplicativo.connect();
      try {
        const relatorio = await importarLinhas(cliente, protetor, conjunto.linhas, {
          tipo: conjunto.tipo, origem: 'legado-teste', canal: 'legado', usuarioId: admin(), gravar: true, hashArquivo: conjunto.hash,
        });
        expect(relatorio.contagens.rejeitados).toBe(0);
      } finally {
        cliente.release();
      }
    }
    const admissao = await banco().query("SELECT to_char(admissao, 'YYYY-MM-DD') AS admissao FROM nucleo.vinculo WHERE sistema_origem = 'legado-teste' AND matricula = 'L-1'");
    expect(admissao.rows[0].admissao).toBe('2001-03-04');
    expect(await contar('afastamento', 'legado-teste')).toBe(1);
    await writeFile(arquivoMapa, JSON.stringify({ ...mapa, consultas: { dados_funcionais: { tabela: 'rh.servidor', colunas: { INVENTADA: 'matr' } } } }));
    await expect(lerMapeamento(arquivoMapa)).rejects.toThrow(/INVENTADA/);
    delete process.env.SISDOC_TESTE_SENHA_LEGADO;
  });

  it('importa 20 mil vínculos em tempo aceitável e reprocessa sem alterações', async () => {
    const linhas = planilha('dados_funcionais', Array.from({ length: 20_000 }, (_, indice) => funcional(911000000 + indice, `V-${indice}`)));
    const inicio = performance.now();
    const primeiro = await importar('dados_funcionais', linhas, 'volume');
    const duracao = performance.now() - inicio;
    expect(primeiro.contagens.validos).toBe(20_000);
    expect(await contar('vinculo', 'volume')).toBe(20_000);
    expect(duracao).toBeLessThan(120_000);
    const segundo = await importar('dados_funcionais', linhas, 'volume', true, Buffer.from('volume-de-novo'));
    expect(segundo.contagens).toMatchObject({ inseridos: 0, atualizados: 0 });
  }, 300_000);

  it('exporta os cinco tipos em CSV/XLSX reimportáveis, sem dar exportação ao analista', async () => {
    const sessaoAdmin = usuarios.get('admin')?.sessao;
    const analista = usuarios.get('analista')?.sessao;
    if (!sessaoAdmin || !analista) throw new Error('Sessões ausentes.');
    const exportar = (tipo: TipoImportacao, formato: 'csv' | 'xlsx', afastamentos = 'anual', sessao = sessaoAdmin) =>
      requisitar({ metodo: 'POST', rota: 'admin/importacoes/exportar', sessao,
        tipoConteudo: 'application/json', corpo: Buffer.from(JSON.stringify({ tipo, origem: 'origem-tipos', formato, afastamentos })) });
    expect((await exportar('dados_funcionais', 'csv', 'anual', analista)).status).toBe(403);
    expect((await requisitar({ metodo: 'POST', rota: 'admin/importacoes/exportar',
      corpo: Buffer.from('{}'), tipoConteudo: 'application/json' })).status).toBe(401);
    for (const formato of ['csv', 'xlsx'] as const) {
      for (const tipo of ['dados_funcionais', 'afastamentos', 'incorporacoes', 'periodos_ipam', 'eventos_funcionais'] as const) {
        const resposta = await exportar(tipo, formato);
        expect(resposta.status, resposta.corpo).toBe(200);
        const linhas = lerPlanilha(resposta.binario).linhas;
        expect(linhas.length).toBeGreaterThan(1);
        expect(analisarLinhas(tipo, linhas).validos).toBe(linhas.length - 1);
        const reimportado = await importar(tipo, linhas, 'origem-tipos', false);
        expect(reimportado.contagens).toMatchObject({ inseridos: 0, atualizados: 0 });
        if (tipo === 'dados_funcionais') expect(linhas.some((linha) => linha.includes(cpfSintetico(910000030)))).toBe(true);
      }
      const intervalos = await exportar('afastamentos', formato, 'intervalo');
      expect(intervalos.status, intervalos.corpo).toBe(200);
      const linhas = lerPlanilha(intervalos.binario).linhas;
      expect(linhas[0]).toEqual(['MATRICULA', 'TIPO', 'DT_INICIO', 'DT_FIM']);
      expect(analisarLinhas('afastamentos', linhas).validos).toBe(1);
    }
    const auditados = await banco().query("SELECT count(*)::int AS total FROM seguranca.auditoria WHERE acao = 'dados_exportados'");
    expect(auditados.rows[0].total).toBe(12);
    const perigosos = planilha('dados_funcionais', [funcional(910000080, 'X-1', { NOME: '=1+1' })]);
    await importar('dados_funcionais', perigosos, 'formula-teste');
    const formula = (formato: string) => requisitar({ metodo: 'POST', rota: 'admin/importacoes/exportar', sessao: sessaoAdmin,
      tipoConteudo: 'application/json', corpo: Buffer.from(JSON.stringify({ tipo: 'dados_funcionais', origem: 'formula-teste', formato })) });
    expect((await formula('csv')).status).toBe(422);
    const seguro = await formula('xlsx');
    expect(seguro.status).toBe(200);
    expect(lerPlanilha(seguro.binario).linhas[1]).toContain('=1+1');
    await banco().query("UPDATE nucleo.incorporacao SET convencao = 'exclusivo' WHERE sistema_origem = 'origem-tipos'");
    try {
      const exclusiva = await exportar('incorporacoes', 'xlsx');
      expect(exclusiva.status).toBe(422);
      expect(exclusiva.corpo).toContain('inclusivos');
    } finally {
      await banco().query("UPDATE nucleo.incorporacao SET convencao = 'inclusivo' WHERE sistema_origem = 'origem-tipos'");
    }
  });

  it('mostra referências pessoais completas ao Cadastro e administrador com paginação e auditoria', async () => {
    const linha = (await banco().query<{ pessoa_id: string; id: string }>(
      "SELECT pessoa_id, id FROM nucleo.vinculo WHERE sistema_origem = 'origem-tipos' AND matricula = 'E-1'")).rows[0];
    for (const papel of ['analista', 'admin']) {
      const sessao = usuarios.get(papel)?.sessao;
      if (!sessao) throw new Error('Sessão ausente.');
      const rota = `servidores/${linha.pessoa_id}/referencias?vinculoId=${linha.id}&tipo=afastamentos&limite=1`;
      const primeira = await requisitar({ metodo: 'GET', rota, sessao });
      expect(primeira.status, primeira.corpo).toBe(200);
      const dados = referenciaServidorSchema.parse(JSON.parse(primeira.corpo));
      expect(dados.pessoa.CPF).toBe(cpfSintetico(910000030));
      expect(dados.pessoa.Mãe).toBe('MAE FICTICIA 910000030');
      expect(dados.registros).toHaveLength(1);
      expect(dados.proximoCursor).not.toBeNull();
      const seguinte = await requisitar({ metodo: 'GET', rota: `${rota}&cursor=${dados.proximoCursor}`, sessao });
      expect(referenciaServidorSchema.parse(JSON.parse(seguinte.corpo)).registros[0].id).not.toBe(dados.registros[0].id);
    }
    const anonimo = await requisitar({ metodo: 'GET', rota: `servidores/${linha.pessoa_id}/referencias?vinculoId=${linha.id}` });
    expect(anonimo.status).toBe(401);
    const trocado = await requisitar({ metodo: 'GET',
      rota: `servidores/${randomUUID()}/referencias?vinculoId=${linha.id}`, sessao: usuarios.get('admin')?.sessao });
    expect(trocado.status).toBe(404);
    expect((await banco().query("SELECT count(*)::int AS total FROM seguranca.auditoria WHERE acao = 'referencias_consultadas'")).rows[0].total).toBe(4);
  });

  it('atende 64 usuários simultâneos por perfil e mistos sobre 20 mil vínculos via HTTPS', async () => {
    const senhaHash = await gerarHashSenha(senhaUsuarios);
    const grupos = new Map<string, Sessao[]>();
    for (const papel of ['analista', 'coordenador', 'secretario_adjunto', 'admin']) {
      const sessoes: Sessao[] = [];
      for (let indice = 0; indice < 64; indice += 1) {
        const matricula = `CARGA-${papel}-${indice}`;
        await banco().query(`INSERT INTO seguranca.usuario (id, matricula, nome, senha_hash, papel, troca_senha_obrigatoria)
          VALUES ($1, $2, 'Usuário de carga fictício', $3, $4, false)`, [randomUUID(), matricula, senhaHash, papel]);
        const login = await requisitar({ metodo: 'POST', rota: 'auth/login', tipoConteudo: 'application/json',
          corpo: Buffer.from(JSON.stringify({ matricula, senha: senhaUsuarios })) });
        expect(login.status, login.corpo).toBe(200);
        if (!login.cookie) throw new Error('Sessão de carga ausente.');
        sessoes.push({ cookie: login.cookie, csrf: respostaSessaoSchema.parse(JSON.parse(login.corpo)).csrf });
      }
      grupos.set(papel, sessoes);
    }
    const mistos = [...grupos.values()].flatMap((sessoes) => sessoes.slice(0, 16));
    grupos.set('mistos', mistos);
    const vinculo = (await banco().query<{ pessoa_id: string; id: string }>(
      "SELECT pessoa_id, id FROM nucleo.vinculo WHERE sistema_origem = 'volume' ORDER BY id LIMIT 1")).rows[0];
    for (const [perfil, sessoes] of grupos) {
      expect(new Set(sessoes.map((s) => s.cookie)).size).toBe(64);
      const tempos: number[] = [];
      for (const rota of [
        'auth/me', 'servidores?q=PESSOA&tipo=nome&limite=50',
        `servidores/${vinculo.pessoa_id}/referencias?vinculoId=${vinculo.id}`,
      ]) {
        await Promise.all(sessoes.map(async (sessao) => {
          const inicio = performance.now();
          const resposta = await requisitar({ metodo: 'GET', rota, sessao });
          tempos.push(performance.now() - inicio);
          expect(resposta.status, `${perfil}: ${rota}: ${resposta.corpo}`).toBe(200);
        }));
      }
      tempos.sort((a, b) => a - b);
      const p95 = tempos[Math.ceil(tempos.length * .95) - 1];
      const maximo = tempos[tempos.length - 1];
      console.log(`Carga HTTPS: perfil=${perfil}, usuários=64, requisições=${tempos.length}, erros=0, p95=${p95.toFixed(1)} ms, máximo=${maximo.toFixed(1)} ms.`);
      expect(p95).toBeLessThan(5000);
      expect(maximo).toBeLessThan(10000);
      expect(poolAplicativo?.waitingCount).toBe(0);
    }
  }, 300_000);
});
