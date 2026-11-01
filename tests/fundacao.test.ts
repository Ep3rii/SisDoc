import { execFile as execFileCallback } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import type { IncomingHttpHeaders } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import * as pty from '@lydell/node-pty';
import {
  capturarDadosPdfProvisorioDof,
  dadosFontePreviaDofSchema,
  detalheServidorSchema,
  paginaAuditoriaSchema,
  paginaBuscaServidoresSchema,
  paginaEventosServidorSchema,
  paginaCoordenadoresDofSchema,
  paginaConferidosDofSchema,
  paginaEncaminhamentosDofSchema,
  paginaUsuariosSchema,
  paginaRascunhosDofSchema,
  preconferenciaDofSchema,
  previaConferidaDofSchema,
  rascunhoDofSchema,
  resultadoCalculoDofSchema,
  resultadoConferenciaDofSchema,
  resultadoDevolucaoConferidoDofSchema,
  resultadoDevolucaoDofSchema,
  respostaSessaoSchema,
  ultimaDevolucaoDofSchema,
  usuarioAdministrativoSchema,
} from '@sisdoc/contratos';
import { verify } from 'argon2';
import EmbeddedPostgres from 'embedded-postgres';
import forge from 'node-forge';
import { Client, Pool } from 'pg';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HealthController } from '../apps/api/dist/app.module.js';
import { transacao } from '../apps/api/dist/banco.js';
import { carregarConfiguracao } from '../apps/api/dist/configuracao.js';
import { ArmazenamentoPdf } from '../apps/api/dist/documentos/armazenamento-pdf.js';
import { renderizarPdfProvisorioDof } from '../apps/api/dist/documentos/pdf-provisorio-dof.js';
import { ProcessadorPdfProvisorio } from '../apps/api/dist/documentos/processador-pdf-provisorio.js';
import { aplicarAutenticacao } from '../apps/api/dist/migracoes/autenticacao.js';
import { aplicarBlocosDof } from '../apps/api/dist/migracoes/blocos-dof.js';
import { aplicarConfirmacaoInicioDof } from '../apps/api/dist/migracoes/confirmacao-inicio-dof.js';
import { aplicarDevolucaoDof } from '../apps/api/dist/migracoes/devolucao-dof.js';
import { aplicarConferenciaDof } from '../apps/api/dist/migracoes/conferencia-dof.js';
import { aplicarEncaminhamentoDof } from '../apps/api/dist/migracoes/encaminhamento-dof.js';
import { aplicarPreconferenciaDof, CHAVE_BLOQUEIO_FONTE_DOF } from '../apps/api/dist/migracoes/preconferencia-dof.js';
import { aplicarRevisaoFonteDof } from '../apps/api/dist/migracoes/revisao-fonte-dof.js';
import { aplicarProcessoDof } from '../apps/api/dist/migracoes/processo-dof.js';
import { aplicarConsulta } from '../apps/api/dist/migracoes/consulta.js';
import { aplicarRascunhoDof } from '../apps/api/dist/migracoes/rascunho-dof.js';
import { aplicarModelo } from '../apps/api/dist/migracoes/modelo.js';
import { SEQUENCIA_MIGRACOES } from '../apps/api/dist/migracoes/sequencia.js';
import { ProtetorDados } from '../apps/api/dist/seguranca/protecao-dados.js';
import { gerarHashSenha } from '../apps/api/dist/seguranca/senhas.js';
import { instalar, type OpcoesInstalacao } from '../apps/api/dist/setup/instalador.js';
import { validarDestinos } from '../scripts/isolar-testes.cjs';
import { cpfSintetico } from './dados-sinteticos.js';
import { previaDofSintetica } from './dof-sintetica.js';
import { gerarPessoasSinteticas } from '../tools/anonimizar/fixtures.js';

const senhaMigrador = 'MigracaoFicticia!12345';
const senhaAplicativo = 'AplicativoFicticio!12345';
const senhaAdmin = 'AdministradorFicticio!12345';
const senhaAdminNova = 'NovaSenhaFicticia!12345';
const senhaComum = 'SenhaComumFicticia!12345';
const nomeTls = 'sisdoc.local';
const execFile = promisify(execFileCallback);

async function verificarAcl(raiz: string): Promise<void> {
  const literal = raiz.replaceAll("'", "''");
  const script = `
    $ErrorActionPreference = 'Stop'
    function Acessos($caminho) {
      @( (Get-Acl -LiteralPath $caminho).Access | ForEach-Object {
        [PSCustomObject]@{
          Sid = $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
          Direitos = [int64]$_.FileSystemRights
          Tipo = $_.AccessControlType.ToString()
        }
      })
    }
    $config = Acessos (Join-Path '${literal}' 'config\\aplicacao.json')
    $pdf = Acessos (Join-Path '${literal}' 'pdf')
    $backup = Acessos (Join-Path '${literal}' 'backup')
    $amplos = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')
    if (@($config | Where-Object { $_.Tipo -eq 'Allow' -and $amplos -contains $_.Sid }).Count -ne 0) {
      throw 'Configuração acessível por grupos amplos.'
    }
    $proibidos = [int64]([System.Security.AccessControl.FileSystemRights]::Write -bor
      [System.Security.AccessControl.FileSystemRights]::Delete -bor
      [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
      [System.Security.AccessControl.FileSystemRights]::TakeOwnership)
    $servico = @($config | Where-Object { $_.Tipo -eq 'Allow' -and $_.Sid -eq 'S-1-5-19' })
    if ($servico.Count -eq 0 -or @($servico | Where-Object {
      ($_.Direitos -band [System.Security.AccessControl.FileSystemRights]::ReadData) -eq 0 -or
      ($_.Direitos -band $proibidos) -ne 0
    }).Count -ne 0) {
      throw 'Permissões da conta de serviço na configuração são inválidas.'
    }
    if (@($pdf | Where-Object {
      $_.Tipo -eq 'Allow' -and $_.Sid -eq 'S-1-5-19' -and
      ($_.Direitos -band [System.Security.AccessControl.FileSystemRights]::WriteData) -ne 0
    }).Count -eq 0) {
      throw 'Conta de serviço não pode gravar PDFs.'
    }
    if (@($backup | Where-Object { $_.Tipo -eq 'Allow' -and $_.Sid -eq 'S-1-5-19' }).Count -ne 0) {
      throw 'Conta de serviço possui acesso indevido a backup.'
    }
  `;
  await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
}

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
  const nomeCa = [{ name: 'commonName', value: 'CA temporaria de testes' }];
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

function ambiente(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entrada): entrada is [string, string] => typeof entrada[1] === 'string'),
  );
}

type Pergunta = { texto: string; resposta: string };

async function executarInterativo(
  comando: string,
  perguntas: Pergunta[],
  variaveis: Record<string, string> = {},
  segredos: string[] = [senhaMigrador, senhaAplicativo, senhaAdmin],
): Promise<string> {
  const terminal = pty.spawn(process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', comando], {
    name: 'xterm-color',
    cols: 240,
    rows: 50,
    cwd: process.cwd(),
    env: { ...ambiente(), ...variaveis },
  });
  return new Promise<string>((resolve, reject) => {
    let texto = '';
    let pendente = '';
    let proxima = 0;
    const sanitizar = () => segredos.reduce(
      (valor, senha) => valor.replaceAll(senha, '[segredo fictício]'), texto,
    );
    const prazo = setTimeout(() => {
      terminal.kill();
      reject(new Error(`O comando interativo excedeu o tempo na pergunta ${proxima + 1}: ${sanitizar().slice(-3000)}`));
    }, 30000);
    terminal.onData((dados) => {
      texto += dados;
      pendente += dados;
      while (proxima < perguntas.length) {
        const alvo = perguntas[proxima].texto.trimEnd();
        const indice = pendente.indexOf(alvo);
        if (indice < 0) break;
        pendente = pendente.slice(indice + alvo.length);
        terminal.write(`${perguntas[proxima].resposta}\r`);
        proxima += 1;
      }
    });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(prazo);
      if (exitCode !== 0 || proxima !== perguntas.length) {
        reject(new Error(`Comando interativo falhou (${exitCode}, pergunta ${proxima + 1}): ${sanitizar().slice(-3000)}`));
      } else {
        resolve(texto);
      }
    });
  });
}

async function requisitar(porta: number, ca: string, nome = nomeTls, rota = '/api/v1/health'): Promise<{
  status: number | undefined; corpo: string; headers: IncomingHttpHeaders;
}> {
  return new Promise((resolve, reject) => {
    const pedido = https.get({
      host: '127.0.0.1',
      port: porta,
      servername: nome,
      path: rota,
      ca,
      rejectUnauthorized: true,
      agent: false,
      timeout: 3000,
    }, (resposta) => {
      let corpo = '';
      resposta.setEncoding('utf8');
      resposta.on('data', (parte: string) => { corpo += parte; });
      resposta.once('end', () => resolve({ status: resposta.statusCode, corpo, headers: resposta.headers }));
    });
    pedido.once('timeout', () => pedido.destroy(new Error('Tempo HTTPS esgotado.')));
    pedido.once('error', reject);
  });
}

async function requisitarApi(
  porta: number,
  ca: string,
  opcoes: {
    metodo: 'GET' | 'POST' | 'PATCH'; rota: string; corpo?: unknown; cookie?: string; csrf?: string;
    origem?: string; provaFonte?: string;
  },
): Promise<{ status: number | undefined; corpo: string; headers: IncomingHttpHeaders }> {
  const conteudo = opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo);
  return new Promise((resolve, reject) => {
    const pedido = https.request({
      host: '127.0.0.1',
      port: porta,
      servername: nomeTls,
      path: opcoes.rota,
      method: opcoes.metodo,
      ca,
      rejectUnauthorized: true,
      agent: false,
      timeout: 5000,
      headers: {
        Origin: opcoes.origem ?? `https://${nomeTls}:${porta}`,
        ...(conteudo === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(opcoes.cookie ? { Cookie: opcoes.cookie } : {}),
        ...(opcoes.csrf ? { 'X-CSRF-Token': opcoes.csrf } : {}),
        ...(opcoes.provaFonte === undefined ? {} : { 'X-Sisdoc-Fonte-Dof': opcoes.provaFonte }),
      },
    }, (resposta) => {
      let corpo = '';
      resposta.setEncoding('utf8');
      resposta.on('data', (parte: string) => { corpo += parte; });
      resposta.on('end', () => resolve({ status: resposta.statusCode, corpo, headers: resposta.headers }));
      resposta.on('error', reject);
    });
    pedido.once('timeout', () => pedido.destroy(new Error(`Tempo HTTPS esgotado em ${opcoes.metodo} ${opcoes.rota.split('?')[0]}.`)));
    pedido.once('error', reject);
    pedido.end(conteudo);
  });
}

async function aguardarResposta(porta: number, ca: string): Promise<void> {
  const limite = Date.now() + 30000;
  while (Date.now() < limite) {
    try {
      if ((await requisitar(porta, ca)).status === 200) return;
    } catch {
      await delay(200);
    }
  }
  throw new Error('O serviço HTTPS não ficou disponível no prazo.');
}

async function iniciarServico(porta: number, ca: string, arquivoConfig: string): Promise<() => Promise<void>> {
  const terminal = pty.spawn(process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', 'npm start'], {
    name: 'xterm-color', cols: 200, rows: 40, cwd: process.cwd(),
    env: { ...ambiente(), SISDOC_CONFIG: arquivoConfig },
  });
  let saiu = false;
  const termino = new Promise<number>((resolve) => terminal.onExit(({ exitCode }) => {
    saiu = true;
    resolve(exitCode);
  }));
  const encerrar = async () => {
    if (!saiu) {
      terminal.write('\u0003');
      await Promise.race([termino, delay(3000)]);
      if (!saiu) terminal.kill();
      await Promise.race([termino, delay(3000)]);
    }
    if (!saiu) throw new Error('O serviço temporário não foi encerrado.');
  };
  try {
    await aguardarResposta(porta, ca);
  } catch (erro) {
    await encerrar();
    throw erro;
  }
  return encerrar;
}

async function rejeitarSql(cliente: Client, sql: string, valores: unknown[], codigo: string): Promise<void> {
  await cliente.query('SAVEPOINT teste_rejeicao');
  try {
    await expect(cliente.query(sql, valores)).rejects.toMatchObject({ code: codigo });
  } finally {
    await cliente.query('ROLLBACK TO SAVEPOINT teste_rejeicao');
    await cliente.query('RELEASE SAVEPOINT teste_rejeicao');
  }
}

async function inserirPessoaEVinculo(cliente: Client): Promise<{ pessoa: string; vinculo: string }> {
  const pessoa = randomUUID();
  const vinculo = randomUUID();
  await cliente.query(
    `INSERT INTO nucleo.pessoa (id, cpf_cifrado, cpf_hash, nome, nome_busca)
     VALUES ($1, $2, $3, 'Pessoa sintética', 'pessoa sintetica')`,
    [pessoa, randomBytes(48), randomBytes(32)],
  );
  await cliente.query(
    `INSERT INTO nucleo.vinculo (id, pessoa_id, matricula, matricula_norm, sistema_origem, id_origem)
     VALUES ($1, $2, $3, $3, 'fonte-sintetica', $4)`,
    [vinculo, pessoa, `M-${vinculo}`, randomUUID()],
  );
  return { pessoa, vinculo };
}

async function conferirSqlSintetico(cliente: Client, documentoId: string, usuarioId: string): Promise<string> {
  const conferenciaId = randomUUID();
  await cliente.query(`
    INSERT INTO documentos.conferencia_dof
      (id, documento_id, revisao_documento, revisao_pessoa, revisao_vinculo, conferido_por, avisos)
    SELECT $1, d.id, d.revisao + 1, p.revisao_fonte, v.revisao_fonte, $3, ARRAY['regra_provisoria']::text[]
    FROM documentos.documento d JOIN nucleo.pessoa p ON p.id = d.pessoa_id
    JOIN nucleo.vinculo v ON v.id = d.vinculo_id WHERE d.id = $2
  `, [conferenciaId, documentoId, usuarioId]);
  await cliente.query(`
    UPDATE documentos.documento SET status = 'conferido', conferido_por = $2,
      conferido_em = (SELECT conferido_em FROM documentos.conferencia_dof WHERE id = $3),
      atualizado_por = $2, revisao = revisao + 1 WHERE id = $1
  `, [documentoId, usuarioId, conferenciaId]);
  return conferenciaId;
}

describe('fundação em recursos descartáveis', () => {
  it('mantém a sequência de migrações alinhada ao release planilhas/legado', () => {
    expect(SEQUENCIA_MIGRACOES.at(-1)?.versao).toBe('019-planilhas-legado');
    expect(SEQUENCIA_MIGRACOES.at(-3)?.versao).toBe('017-documentos-admin');
  });

  let temporario = '';
  let raiz = '';
  let raizAlternativa = '';
  let postgres: EmbeddedPostgres | undefined;
  let iniciado = false;
  let administradorBanco: Client | undefined;
  let portaBanco = 0;
  let portaHttps = 0;
  let caPem = '';
  let opcoes: OpcoesInstalacao;
  let arquivoConfig = '';

  beforeAll(async () => {
    if (process.platform !== 'win32' || !process.env.PUBLIC) {
      throw new Error('Esta verificação de ACL e instalação requer Windows e uma pasta pública local.');
    }
    const temporarios = process.env.SISDOC_TEST_TEMP ?? os.tmpdir();
    if (!path.isAbsolute(temporarios) || /[^\x00-\x7f]/.test(temporarios)) {
      throw new Error('Defina SISDOC_TEST_TEMP com um diretório local absoluto ASCII ou com caminho curto 8.3 existente.');
    }
    temporario = await mkdtemp(path.join(temporarios, 'sisdoc-verificacao-'));
    const pastaPublica = await realpath(process.env.PUBLIC);
    raiz = path.join(pastaPublica, `SisDocVerificacao-${randomUUID()}`);
    raizAlternativa = path.join(pastaPublica, `SisDocVerificacao-${randomUUID()}`);
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
      writeFile(listaSenhas, `${senhaComum}\n`),
    ]);

    const diretorioBanco = path.join(temporario, 'postgres');
    postgres = new EmbeddedPostgres({
      databaseDir: diretorioBanco,
      user: 'postgres',
      password: 'SuperusuarioFicticio!12345',
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
    const diretorio = await administradorBanco.query<{ data_directory: string }>('SHOW data_directory');
    expect((await realpath(diretorio.rows[0].data_directory)).toLowerCase()).toBe((await realpath(diretorioBanco)).toLowerCase());
    const codificacao = await administradorBanco.query<{ server_encoding: string }>('SHOW server_encoding');
    expect(codificacao.rows[0].server_encoding).toBe('UTF8');
    await administradorBanco.query(`CREATE ROLE sisdoc_migrador LOGIN PASSWORD '${senhaMigrador}'`);
    await administradorBanco.query(`CREATE ROLE sisdoc_aplicativo LOGIN PASSWORD '${senhaAplicativo}'`);
    await administradorBanco.query('CREATE DATABASE sisdoc_verificacao OWNER sisdoc_migrador');
    await administradorBanco.query('CREATE DATABASE sisdoc_ocupado OWNER sisdoc_migrador');
    await administradorBanco.query('CREATE DATABASE sisdoc_atualizacao OWNER sisdoc_migrador');
    const ocupado = new Client({
      host: '127.0.0.1', port: portaBanco, database: 'sisdoc_ocupado',
      user: 'sisdoc_migrador', password: senhaMigrador,
    });
    await ocupado.connect();
    await ocupado.query('CREATE TABLE public.preexistente (id integer PRIMARY KEY)');
    await ocupado.query('INSERT INTO public.preexistente VALUES (1)');
    await ocupado.end();
    opcoes = {
      raiz,
      porta: portaHttps,
      banco: {
        porta: portaBanco, nome: 'sisdoc_verificacao', migrador: 'sisdoc_migrador', senhaMigrador,
        usuario: 'sisdoc_aplicativo', senha: senhaAplicativo,
      },
      tls: { certificado, chave, ca, nome: nomeTls },
      sidServico: 'S-1-5-19',
      listaSenhas,
      processos: { mascaras: ['####/####'] },
      administrador: { matricula: 'ADMIN-FICTICIO', nome: 'Operador Fictício', senha: senhaAdmin },
    };
  });

  afterAll(async () => {
    if (administradorBanco) await administradorBanco.end();
    if (iniciado && postgres) await postgres.stop();
    for (const destino of [raiz, raizAlternativa]) {
      if (destino && path.basename(destino).startsWith('SisDocVerificacao-')) {
        await rm(destino, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    }
    if (temporario && path.basename(temporario).startsWith('sisdoc-verificacao-')) {
      await rm(temporario, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  it('rejeita senhas da lista local e TLS com nome incompatível sem criar a instalação', async () => {
    await expect(instalar({
      ...opcoes, raiz: raizAlternativa,
      administrador: { ...opcoes.administrador, senha: senhaComum },
    })).rejects.toThrow('lista local de senhas comuns');
    await expect(instalar({
      ...opcoes, raiz: raizAlternativa, tls: { ...opcoes.tls, nome: 'outro.local' },
    })).rejects.toThrow('certificado não pôde ser validado');
    await expect(realpath(raizAlternativa)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('impede o executor de testes de sobrepor a instalação configurada', async () => {
    const config = path.join(temporario, 'instalacao-ficticia', 'config');
    await mkdir(config, { recursive: true });
    const arquivo = path.join(config, 'aplicacao.json');
    await writeFile(arquivo, '{}');
    expect(() => validarDestinos(process.cwd(), temporario, arquivo)).toThrow('não pode sobrepor a instalação configurada');
  });

  it('reconhece caminhos longos e 8.3 como o mesmo repositório e perfil', async () => {
    const arquivoRepositorio = realpathSync.native(path.join(process.cwd(), 'package.json'));
    await expect(carregarConfiguracao(arquivoRepositorio)).rejects.toThrow('fora do repositório');
    await expect(instalar({
      ...opcoes, raiz: path.join(temporario, 'instalacao-proibida'),
    })).rejects.toThrow('externa ao perfil pessoal');
    await expect(instalar({
      ...opcoes, raiz: raizAlternativa, tls: { ...opcoes.tls, ca: arquivoRepositorio },
    })).rejects.toThrow('fora do repositório');
  });

  it('preserva um banco não vazio e não cria a raiz', async () => {
    await expect(instalar({
      ...opcoes, raiz: raizAlternativa, banco: { ...opcoes.banco, nome: 'sisdoc_ocupado' },
    })).rejects.toThrow('banco escolhido não está vazio');
    await expect(realpath(raizAlternativa)).rejects.toMatchObject({ code: 'ENOENT' });
    const cliente = new Client({
      host: '127.0.0.1', port: portaBanco, database: 'sisdoc_ocupado',
      user: 'sisdoc_migrador', password: senhaMigrador,
    });
    await cliente.connect();
    const resultado = await cliente.query<{ total: string }>('SELECT count(*) AS total FROM public.preexistente');
    await cliente.end();
    expect(resultado.rows[0].total).toBe('1');
  });

  it('reverte a inicialização se não conseguir aplicar a ACL', async () => {
    await expect(instalar({
      ...opcoes, raiz: raizAlternativa, sidServico: 'S-1-5-999999999999999999999999999',
    })).rejects.toThrow('permissões Windows');
    await expect(realpath(raizAlternativa)).rejects.toMatchObject({ code: 'ENOENT' });
    const cliente = new Client({
      host: '127.0.0.1', port: portaBanco, database: 'sisdoc_verificacao',
      user: 'sisdoc_migrador', password: senhaMigrador,
    });
    await cliente.connect();
    const resultado = await cliente.query<{ existe: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'seguranca') AS existe",
    );
    await cliente.end();
    expect(resultado.rows[0].existe).toBe(false);
  });

  it('executa npm run setup de forma interativa, sem exibir senhas', async () => {
    const perguntas: Pergunta[] = [
      { texto: 'Caminho absoluto da nova raiz: ', resposta: raiz },
      { texto: 'Porta HTTPS em loopback: ', resposta: String(portaHttps) },
      { texto: 'Porta PostgreSQL em loopback: ', resposta: String(portaBanco) },
      { texto: 'Nome do banco vazio: ', resposta: opcoes.banco.nome },
      { texto: 'Papel proprietário de migração: ', resposta: opcoes.banco.migrador },
      { texto: 'Senha de migração: ', resposta: senhaMigrador },
      { texto: 'Papel sem privilégios do aplicativo: ', resposta: opcoes.banco.usuario },
      { texto: 'Senha do aplicativo: ', resposta: senhaAplicativo },
      { texto: 'Caminho absoluto do certificado TLS: ', resposta: opcoes.tls.certificado },
      { texto: 'Caminho absoluto da chave privada TLS: ', resposta: opcoes.tls.chave },
      { texto: 'Caminho absoluto da cadeia de CA confiável: ', resposta: opcoes.tls.ca },
      { texto: 'Nome DNS presente no certificado: ', resposta: nomeTls },
      { texto: 'SID da conta Windows de serviço sem privilégios: ', resposta: opcoes.sidServico },
      { texto: 'Caminho absoluto da lista local de senhas comuns: ', resposta: opcoes.listaSenhas },
      { texto: 'Máscaras de processo separadas por vírgula (vazio para não configurar): ', resposta: '####/####' },
      { texto: 'Matrícula do administrador inicial: ', resposta: opcoes.administrador.matricula },
      { texto: 'Nome do administrador inicial: ', resposta: opcoes.administrador.nome },
      { texto: 'Senha inicial do administrador (mínimo 12 caracteres): ', resposta: senhaAdmin },
      { texto: 'Confirme a senha inicial: ', resposta: senhaAdmin },
      { texto: 'Digite CRIAR para confirmar a inicialização do banco vazio e da nova raiz: ', resposta: 'CRIAR' },
    ];
    const saida = await executarInterativo('npm run setup', perguntas);
    expect(saida).not.toContain(senhaMigrador);
    expect(saida).not.toContain(senhaAplicativo);
    expect(saida).not.toContain(senhaAdmin);
    expect(saida).toContain('ainda não está autorizada para uso operacional');
    arquivoConfig = path.join(raiz, 'config', 'aplicacao.json');
    await verificarAcl(raiz);
    const config = await carregarConfiguracao(arquivoConfig);
    expect(config.banco.host).toBe('127.0.0.1');
    expect(config.chaves.cifra).not.toBe(config.chaves.hmac);
    expect(Buffer.from(config.chaves.cifra, 'base64')).toHaveLength(32);
    expect(Buffer.from(config.chaves.hmac, 'base64')).toHaveLength(32);
    const cliente = new Client({
      host: config.banco.host, port: config.banco.porta, database: config.banco.nome,
      user: config.banco.usuario, password: config.banco.senha,
    });
    await cliente.connect();
    const usuarios = await cliente.query<{ senha_hash: string; papel: string; troca_senha_obrigatoria: boolean }>(
      'SELECT senha_hash, papel, troca_senha_obrigatoria FROM seguranca.usuario',
    );
    expect(usuarios.rows).toHaveLength(1);
    expect(usuarios.rows[0].papel).toBe('admin');
    expect(usuarios.rows[0].troca_senha_obrigatoria).toBe(true);
    expect(await verify(usuarios.rows[0].senha_hash, senhaAdmin)).toBe(true);
    const privilegios = await cliente.query<{ pode_apagar: boolean; superusuario: boolean }>(
      `SELECT has_table_privilege(current_user, 'seguranca.usuario', 'DELETE') AS pode_apagar,
              (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superusuario`,
    );
    expect(privilegios.rows[0]).toEqual({ pode_apagar: false, superusuario: false });
    await cliente.end();
  });

  it('reverte erros e descarta a conexão quando o commit não pode ser confirmado', async () => {
    const pool = new Pool({
      host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
      user: 'sisdoc_migrador', password: senhaMigrador,
    });
    try {
      let pidRollback = 0;
      await expect(transacao(pool, async (cliente) => {
        pidRollback = (await cliente.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await cliente.query('CREATE TEMP TABLE verificacao_rollback (id integer)');
        throw new Error('Falha sintética antes do commit.');
      })).rejects.toThrow('Falha sintética antes do commit.');
      const depoisRollback = await pool.query<{ pid: number; tabela: string | null }>(
        "SELECT pg_backend_pid() AS pid, to_regclass('pg_temp.verificacao_rollback')::text AS tabela",
      );
      expect(depoisRollback.rows[0]).toEqual({ pid: pidRollback, tabela: null });
      let pidCommit = 0;
      await expect(transacao(pool, async (cliente) => {
        pidCommit = (await cliente.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await cliente.query('CREATE TEMP TABLE verificacao_pai (id integer PRIMARY KEY)');
        await cliente.query(`
          CREATE TEMP TABLE verificacao_filho (
            pai integer REFERENCES verificacao_pai(id) DEFERRABLE INITIALLY DEFERRED
          )
        `);
        await cliente.query('INSERT INTO verificacao_filho (pai) VALUES (1)');
      })).rejects.toThrow('Não foi possível confirmar a transação');
      const depoisCommit = await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      expect(depoisCommit.rows[0].pid).not.toBe(pidCommit);
    } finally {
      await pool.end();
    }
  });

  it('recusa inicialização quando falta o histórico de migrações', async () => {
    const config = await carregarConfiguracao(arquivoConfig);
    config.banco.nome = 'sisdoc_ocupado';
    const arquivoIncompleto = path.join(temporario, 'configuracao-sem-migracao.json');
    await writeFile(arquivoIncompleto, JSON.stringify(config), 'utf8');
    await expect(execFile(process.execPath, [path.join(process.cwd(), 'apps', 'api', 'dist', 'main.js')], {
      env: { ...ambiente(), SISDOC_CONFIG: arquivoIncompleto },
      timeout: 10000,
      windowsHide: true,
    })).rejects.toMatchObject({
      stderr: expect.stringContaining('não possui o histórico de migrações necessário'),
    });
  });

  it('aplica a migração versão 001 de forma transacional e idempotente sobre a fundação', async () => {
    const cliente = new Client({
      host: '127.0.0.1', port: portaBanco, database: 'sisdoc_atualizacao',
      user: 'sisdoc_migrador', password: senhaMigrador,
    });
    await cliente.connect();
    try {
      await cliente.query(`
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
        CREATE SCHEMA documentos;
        CREATE TABLE documentos.sentinela (id integer PRIMARY KEY);
        INSERT INTO documentos.sentinela VALUES (1);
      `);
      const usuario = randomUUID();
      await cliente.query(
        "INSERT INTO seguranca.usuario (id, matricula, nome, senha_hash, papel) VALUES ($1, 'TESTE', 'Usuário sintético', 'hash-fictício', 'admin')",
        [usuario],
      );
      await cliente.query('BEGIN');
      await expect(aplicarModelo(cliente, 'sisdoc_aplicativo')).rejects.toMatchObject({ code: '42P06' });
      await cliente.query('ROLLBACK');
      expect((await cliente.query('SELECT id FROM documentos.sentinela')).rows).toEqual([{ id: 1 }]);
      expect((await cliente.query<{ existe: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'nucleo') AS existe",
      )).rows[0].existe).toBe(false);
      expect((await cliente.query('SELECT versao FROM seguranca.migracao')).rows).toEqual([{ versao: '000-fundacao' }]);
      await cliente.query('DROP TABLE documentos.sentinela');
      await cliente.query('DROP SCHEMA documentos');

      await cliente.query('BEGIN');
      expect(await aplicarModelo(cliente, 'sisdoc_aplicativo')).toBe(true);
      await cliente.query('COMMIT');
      expect((await cliente.query('SELECT id FROM seguranca.usuario')).rows).toEqual([{ id: usuario }]);
      expect((await cliente.query('SELECT versao FROM seguranca.migracao ORDER BY versao')).rows).toEqual([
        { versao: '000-fundacao' }, { versao: '001-modelo' },
      ]);
      await expect(aplicarModelo(cliente, 'sisdoc_aplicativo')).rejects.toMatchObject({ code: '25P01' });
      await expect(aplicarModelo(cliente, 'papel";DROP SCHEMA seguranca')).rejects.toThrow('Papel do aplicativo inválido');
      const duplicado = randomUUID();
      await cliente.query(
        "INSERT INTO seguranca.usuario (id, matricula, nome, senha_hash, papel) VALUES ($1, 'teste', 'Outro sintético', 'hash-fictício', 'analista')",
        [duplicado],
      );
      await cliente.query('BEGIN');
      await expect(aplicarAutenticacao(cliente, 'sisdoc_aplicativo')).rejects.toMatchObject({ code: '23505' });
      await cliente.query('ROLLBACK');
      expect((await cliente.query('SELECT id FROM seguranca.usuario ORDER BY matricula')).rows).toHaveLength(2);
      expect((await cliente.query('SELECT versao FROM seguranca.migracao ORDER BY versao')).rows).toEqual([
        { versao: '000-fundacao' }, { versao: '001-modelo' },
      ]);
      await cliente.query('DELETE FROM seguranca.usuario WHERE id = $1', [duplicado]);
      await cliente.query('BEGIN');
      expect(await aplicarAutenticacao(cliente, 'sisdoc_aplicativo')).toBe(true);
      await cliente.query('COMMIT');
      await cliente.query('BEGIN');
      expect(await aplicarConsulta(cliente, 'sisdoc_aplicativo')).toBe(true);
      await cliente.query('COMMIT');
      await cliente.query('BEGIN');
      expect(await aplicarRascunhoDof(cliente, 'sisdoc_aplicativo')).toBe(true);
      await cliente.query('COMMIT');
      await cliente.query('BEGIN');
      expect(await aplicarBlocosDof(cliente, 'sisdoc_aplicativo')).toBe(true);
      await cliente.query('COMMIT');
      await cliente.query('BEGIN');
      expect(await aplicarProcessoDof(cliente, 'sisdoc_aplicativo')).toBe(true);
      await cliente.query('COMMIT');
      await cliente.query('BEGIN');
      expect(await aplicarEncaminhamentoDof(cliente, 'sisdoc_aplicativo')).toBe(true);
      await cliente.query('COMMIT');
      await cliente.query('BEGIN');
      expect(await aplicarPreconferenciaDof(cliente, 'sisdoc_aplicativo')).toBe(true);
      await cliente.query('COMMIT');
      await cliente.query('BEGIN');
      expect(await aplicarConfirmacaoInicioDof(cliente, 'sisdoc_aplicativo')).toBe(true);
      await cliente.query('COMMIT');
      await cliente.query('BEGIN');
      expect(await aplicarDevolucaoDof(cliente, 'sisdoc_aplicativo')).toBe(true);
      await cliente.query('COMMIT');
      await cliente.query('BEGIN');
      expect(await aplicarRevisaoFonteDof(cliente, 'sisdoc_aplicativo')).toBe(true);
      expect(await aplicarConferenciaDof(cliente, 'sisdoc_aplicativo')).toBe(true);
      await cliente.query('COMMIT');
      await cliente.query('BEGIN');
      expect(await aplicarModelo(cliente, 'sisdoc_aplicativo')).toBe(false);
      expect(await aplicarAutenticacao(cliente, 'sisdoc_aplicativo')).toBe(false);
      expect(await aplicarConsulta(cliente, 'sisdoc_aplicativo')).toBe(false);
      expect(await aplicarRascunhoDof(cliente, 'sisdoc_aplicativo')).toBe(false);
      expect(await aplicarBlocosDof(cliente, 'sisdoc_aplicativo')).toBe(false);
      expect(await aplicarProcessoDof(cliente, 'sisdoc_aplicativo')).toBe(false);
      expect(await aplicarEncaminhamentoDof(cliente, 'sisdoc_aplicativo')).toBe(false);
      expect(await aplicarPreconferenciaDof(cliente, 'sisdoc_aplicativo')).toBe(false);
      expect(await aplicarConfirmacaoInicioDof(cliente, 'sisdoc_aplicativo')).toBe(false);
      expect(await aplicarDevolucaoDof(cliente, 'sisdoc_aplicativo')).toBe(false);
      expect(await aplicarRevisaoFonteDof(cliente, 'sisdoc_aplicativo')).toBe(false);
      expect(await aplicarConferenciaDof(cliente, 'sisdoc_aplicativo')).toBe(false);
      await cliente.query("INSERT INTO seguranca.migracao (versao) VALUES ('999-desconhecida')");
      await expect(aplicarModelo(cliente, 'sisdoc_aplicativo')).rejects.toThrow('Histórico de migrações');
      await cliente.query('ROLLBACK');
      const concorrente = new Client({
        host: '127.0.0.1', port: portaBanco, database: 'sisdoc_atualizacao',
        user: 'sisdoc_migrador', password: senhaMigrador,
      });
      await concorrente.connect();
      try {
        await cliente.query('BEGIN');
        await cliente.query('SELECT pg_advisory_xact_lock($1, $2)', [1936286820, 1]);
        await concorrente.query('BEGIN');
        await expect(aplicarModelo(concorrente, 'sisdoc_aplicativo')).rejects.toThrow('outra migração');
      } finally {
        await concorrente.query('ROLLBACK');
        await concorrente.end();
        await cliente.query('ROLLBACK');
      }
    } finally {
      await cliente.end();
    }
  });

  it('mantém schemas privados e restringe escritas da conta do aplicativo', async () => {
    const cliente = new Client({
      host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
      user: 'sisdoc_aplicativo', password: senhaAplicativo,
    });
    await cliente.connect();
    try {
      const schemas = await cliente.query<{ nspname: string }>(
        "SELECT nspname FROM pg_namespace WHERE nspname IN ('legado', 'nucleo', 'documentos', 'seguranca') ORDER BY nspname",
      );
      expect(schemas.rows.map((linha) => linha.nspname)).toEqual(['documentos', 'legado', 'nucleo', 'seguranca']);
      const privilegios = await cliente.query<{
        alterar_usuario: boolean; inserir_pessoa: boolean; inserir_emissao: boolean;
        inserir_auditoria: boolean; alterar_auditoria: boolean; apagar_auditoria: boolean;
        publico_le_usuario: boolean; publico_usa_nucleo: boolean; alterar_matricula: boolean;
        alterar_rascunho: boolean; alterar_status: boolean; apagar_ajuste: boolean;
        alterar_bloco: boolean; apagar_bloco: boolean; alterar_versao_bloco: boolean;
        alterar_processo_cifrado: boolean; alterar_processo_texto: boolean;
        alterar_pessoa: boolean; alterar_vinculo: boolean; inserir_conferencia: boolean;
        alterar_conferencia: boolean; apagar_conferencia: boolean; truncar_conferencia: boolean;
        alterar_devolucao_conferido: boolean; apagar_devolucao_conferido: boolean;
        apagar_pessoa: boolean; apagar_vinculo: boolean;
      }>(`
        SELECT has_any_column_privilege(current_user, 'seguranca.usuario', 'UPDATE') AS alterar_usuario,
               has_table_privilege(current_user, 'nucleo.pessoa', 'INSERT') AS inserir_pessoa,
               has_table_privilege(current_user, 'documentos.emissao', 'INSERT') AS inserir_emissao,
               has_table_privilege(current_user, 'seguranca.auditoria', 'INSERT') AS inserir_auditoria,
               has_table_privilege(current_user, 'seguranca.auditoria', 'UPDATE') AS alterar_auditoria,
               has_table_privilege(current_user, 'seguranca.auditoria', 'DELETE') AS apagar_auditoria,
               has_column_privilege(current_user, 'seguranca.usuario', 'matricula', 'UPDATE') AS alterar_matricula,
               has_column_privilege(current_user, 'documentos.documento', 'entrada_cifrada', 'UPDATE') AS alterar_rascunho,
               has_column_privilege(current_user, 'documentos.documento', 'status', 'UPDATE') AS alterar_status,
               has_table_privilege(current_user, 'documentos.ajuste_campo', 'DELETE') AS apagar_ajuste,
               has_column_privilege(current_user, 'documentos.documento_bloco', 'texto_final_cifrado', 'UPDATE') AS alterar_bloco,
               has_table_privilege(current_user, 'documentos.documento_bloco', 'DELETE') AS apagar_bloco,
               has_table_privilege(current_user, 'documentos.bloco_versao', 'UPDATE') AS alterar_versao_bloco,
               has_column_privilege(current_user, 'documentos.documento', 'processo_cifrado', 'UPDATE') AS alterar_processo_cifrado,
               has_column_privilege(current_user, 'documentos.documento', 'processo_numero', 'UPDATE') AS alterar_processo_texto,
               has_any_column_privilege(current_user, 'nucleo.pessoa', 'UPDATE') AS alterar_pessoa,
               has_any_column_privilege(current_user, 'nucleo.vinculo', 'UPDATE') AS alterar_vinculo,
               has_column_privilege(current_user, 'documentos.conferencia_dof', 'revisao_pessoa', 'INSERT') AS inserir_conferencia,
               has_any_column_privilege(current_user, 'documentos.conferencia_dof', 'UPDATE') AS alterar_conferencia,
               has_table_privilege(current_user, 'documentos.conferencia_dof', 'DELETE') AS apagar_conferencia,
               has_table_privilege(current_user, 'documentos.conferencia_dof', 'TRUNCATE') AS truncar_conferencia,
               has_any_column_privilege(current_user, 'documentos.devolucao_conferido_dof', 'UPDATE') AS alterar_devolucao_conferido,
               has_table_privilege(current_user, 'documentos.devolucao_conferido_dof', 'DELETE') AS apagar_devolucao_conferido,
               has_table_privilege(current_user, 'nucleo.pessoa', 'DELETE') AS apagar_pessoa,
               has_table_privilege(current_user, 'nucleo.vinculo', 'DELETE') AS apagar_vinculo,
               EXISTS (
                 SELECT 1 FROM aclexplode((SELECT relacl FROM pg_class WHERE oid = 'seguranca.usuario'::regclass))
                 WHERE grantee = 0 AND privilege_type = 'SELECT'
               ) AS publico_le_usuario,
               EXISTS (
                 SELECT 1 FROM aclexplode((SELECT nspacl FROM pg_namespace WHERE nspname = 'nucleo'))
                 WHERE grantee = 0 AND privilege_type = 'USAGE'
               ) AS publico_usa_nucleo
      `);
      // Importação pela tela e sincronização gravam pessoa/vínculo (migração 015); DELETE continua negado.
      expect(privilegios.rows[0]).toEqual({
        alterar_usuario: true, inserir_pessoa: true, inserir_emissao: false, inserir_auditoria: true,
        alterar_auditoria: false, apagar_auditoria: false, publico_le_usuario: false, publico_usa_nucleo: false,
        alterar_matricula: false, alterar_rascunho: true, alterar_status: true, apagar_ajuste: false,
        alterar_bloco: true, apagar_bloco: false, alterar_versao_bloco: false,
        alterar_processo_cifrado: true, alterar_processo_texto: false,
        alterar_pessoa: true, alterar_vinculo: true, inserir_conferencia: true,
        alterar_conferencia: false, apagar_conferencia: false, truncar_conferencia: false,
        alterar_devolucao_conferido: false, apagar_devolucao_conferido: false,
        apagar_pessoa: false, apagar_vinculo: false,
      });
      await cliente.query('BEGIN');
      await cliente.query("INSERT INTO seguranca.auditoria (acao, entidade) VALUES ('teste', 'sintetico')");
      await cliente.query("UPDATE seguranca.usuario SET nome = 'Nome sintético atualizado'");
      await rejeitarSql(cliente, "UPDATE seguranca.usuario SET matricula = 'Alteração indevida'", [], '42501');
      await rejeitarSql(cliente, 'DELETE FROM seguranca.usuario', [], '42501');
      await rejeitarSql(cliente, 'DELETE FROM seguranca.auditoria', [], '42501');
      await rejeitarSql(cliente, 'TRUNCATE seguranca.auditoria', [], '42501');
      await cliente.query('ROLLBACK');
    } finally {
      await cliente.end();
    }
  });

  it('valida vínculos, entradas anuais e intervalos e retenção do staging', async () => {
    const cliente = new Client({
      host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
      user: 'sisdoc_migrador', password: senhaMigrador,
    });
    await cliente.connect();
    await cliente.query('BEGIN');
    try {
      const primeiro = await inserirPessoaEVinculo(cliente);
      const segundo = await inserirPessoaEVinculo(cliente);
      await rejeitarSql(cliente, `
        INSERT INTO nucleo.pessoa (id, cpf_cifrado, cpf_hash, nome, nome_busca)
        SELECT gen_random_uuid(), cpf_cifrado, cpf_hash, 'Pessoa repetida', 'pessoa repetida'
          FROM nucleo.pessoa WHERE id = $1
      `, [primeiro.pessoa], '23505');
      await rejeitarSql(cliente, `
        INSERT INTO nucleo.vinculo (pessoa_id, matricula, matricula_norm, sistema_origem, id_origem)
        SELECT pessoa_id, matricula, matricula_norm, sistema_origem, 'origem-distinta'
          FROM nucleo.vinculo WHERE id = $1
      `, [primeiro.vinculo], '23505');
      await rejeitarSql(cliente, `
        INSERT INTO nucleo.vinculo (pessoa_id, matricula, matricula_norm, sistema_origem, id_origem, matricula_anterior_id)
        VALUES ($1, 'M-nova', 'M-nova', 'fonte-sintetica', 'outra-origem', $2)
      `, [primeiro.pessoa, segundo.vinculo], '23503');
      await rejeitarSql(cliente, `
        INSERT INTO nucleo.afastamento (vinculo_id, tipo, fonte) VALUES ($1, 'falta', 'fonte')
      `, [primeiro.vinculo], '23514');
      await rejeitarSql(cliente, `
        INSERT INTO nucleo.afastamento (vinculo_id, tipo, ano_ref, fonte)
        VALUES ($1, 'falta', 2024, 'fonte')
      `, [primeiro.vinculo], '23514');
      await rejeitarSql(cliente, `
        INSERT INTO nucleo.afastamento (vinculo_id, tipo, data_inicio, data_fim, fonte)
        VALUES ($1, 'falta', '2024-02-02', '2024-02-01', 'fonte')
      `, [primeiro.vinculo], '23514');
      await rejeitarSql(cliente, `
        INSERT INTO nucleo.afastamento (vinculo_id, tipo, ano_ref, dias_ano, fonte)
        VALUES ($1, 'falta', 2024, 367, 'fonte')
      `, [primeiro.vinculo], '23514');
      await cliente.query(`
        INSERT INTO nucleo.afastamento (vinculo_id, tipo, ano_ref, dias_ano, fonte)
        VALUES ($1, 'licenca_ts', 2024, 366, 'fonte')
      `, [primeiro.vinculo]);
      await cliente.query(`
        INSERT INTO nucleo.afastamento (vinculo_id, tipo, data_inicio, data_fim, fonte)
        VALUES ($1, 'falta', '2024-02-01', '2024-02-29', 'fonte')
      `, [primeiro.vinculo]);
      await rejeitarSql(cliente, `
        INSERT INTO nucleo.incorporacao (vinculo_id, tipo, origem) VALUES ($1, 'PB', 'fonte')
      `, [primeiro.vinculo], '23514');
      await rejeitarSql(cliente, `
        INSERT INTO nucleo.incorporacao (vinculo_id, tipo, data_inicio, data_fim, origem)
        VALUES ($1, 'PB', '2024-01-01', '2024-01-31', 'fonte')
      `, [primeiro.vinculo], '23514');
      await cliente.query(`
        INSERT INTO nucleo.incorporacao (vinculo_id, tipo, data_inicio, data_fim, convencao, origem)
        VALUES ($1, 'PB', '2024-01-01', '2024-01-31', 'exclusivo', 'fonte')
      `, [primeiro.vinculo]);
      await rejeitarSql(cliente, `
        INSERT INTO nucleo.periodo_ipam (pessoa_id, mes_inicio, mes_fim, fonte)
        VALUES ($1, '2024-01-02', '2024-02-01', 'fonte')
      `, [primeiro.pessoa], '23514');

      const lote = randomUUID();
      const recente = randomUUID();
      const antigo = randomUUID();
      await cliente.query(
        "INSERT INTO nucleo.sincronizacao_lote (id, origem, tipo, status) VALUES ($1, 'fonte', 'completa', 'concluido')",
        [lote],
      );
      await cliente.query(`
        INSERT INTO nucleo.staging_api (id, lote_id, id_origem, payload_cifrado, recebido_em, processado_em)
        VALUES ($1, $2, 'recente', $3, now(), now()),
               ($4, $2, 'antigo', $3, now() - interval '31 days', NULL)
      `, [recente, lote, randomBytes(48), antigo]);
      await rejeitarSql(cliente, 'DELETE FROM nucleo.staging_api WHERE id = $1', [recente], '55000');
      await rejeitarSql(cliente, 'DELETE FROM nucleo.staging_api WHERE id = $1', [antigo], '55000');
      await cliente.query('UPDATE nucleo.staging_api SET processado_em = now() WHERE id = $1', [antigo]);
      expect((await cliente.query('DELETE FROM nucleo.staging_api WHERE id = $1', [antigo])).rowCount).toBe(1);
    } finally {
      await cliente.query('ROLLBACK');
      await cliente.end();
    }
  });

  it('persiste CPF cifrado e usa HMAC normalizado para a unicidade', async () => {
    const cliente = new Client({
      host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
      user: 'sisdoc_migrador', password: senhaMigrador,
    });
    const protetor = new ProtetorDados({
      cifra: randomBytes(32).toString('base64'), hmac: randomBytes(32).toString('base64'),
    });
    const pessoa = randomUUID();
    const cpf = cpfSintetico();
    const contexto = { schema: 'nucleo' as const, tabela: 'pessoa', registroId: pessoa, campo: 'cpf_cifrado' };
    const cifrado = protetor.cifrar(Buffer.from(cpf, 'ascii'), contexto);
    await cliente.connect();
    await cliente.query('BEGIN');
    try {
      await cliente.query(`
        INSERT INTO nucleo.pessoa (id, cpf_cifrado, cpf_hash, nome, nome_busca)
        VALUES ($1, $2, $3, 'Pessoa sintética', 'pessoa sintetica')
      `, [pessoa, cifrado, protetor.hashCpf(cpf)]);
      const resultado = await cliente.query<{ cpf_cifrado: Buffer; cpf_hash: Buffer }>(
        'SELECT cpf_cifrado, cpf_hash FROM nucleo.pessoa WHERE cpf_hash = $1', [protetor.hashCpf(cpf)],
      );
      expect(resultado.rows).toHaveLength(1);
      expect(resultado.rows[0].cpf_cifrado.includes(Buffer.from(cpf, 'ascii'))).toBe(false);
      expect(protetor.decifrar(resultado.rows[0].cpf_cifrado, contexto).toString('ascii')).toBe(cpf);
      await rejeitarSql(cliente, `
        INSERT INTO nucleo.pessoa (id, cpf_cifrado, cpf_hash, nome, nome_busca)
        VALUES ($1, $2, $3, 'Outra pessoa sintética', 'outra pessoa sintetica')
      `, [randomUUID(), randomBytes(48), protetor.hashCpf(cpf)], '23505');
    } finally {
      await cliente.query('ROLLBACK');
      await cliente.end();
    }
  });

  it('protege os estados do documento, períodos e registros imutáveis', async () => {
    const cliente = new Client({
      host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
      user: 'sisdoc_migrador', password: senhaMigrador,
    });
    await cliente.connect();
    await cliente.query('BEGIN');
    try {
      const { pessoa, vinculo } = await inserirPessoaEVinculo(cliente);
      const outra = await inserirPessoaEVinculo(cliente);
      const usuario = randomUUID();
      await cliente.query(`
        INSERT INTO seguranca.usuario (id, matricula, nome, senha_hash, papel, troca_senha_obrigatoria)
        VALUES ($1, $2, 'Coordenador sintético', 'hash-sintetico', 'coordenador', false)
      `, [usuario, `COORD-TESTE-${usuario}`]);
      const regra = randomUUID();
      const templateDof = randomUUID();
      const templateDtc = randomUUID();
      const templateComissionado = randomUUID();
      const dof = randomUUID();
      const dtc = randomUUID();
      const comissionado = randomUUID();
      const conteudo = randomBytes(48);
      await cliente.query(`
        INSERT INTO documentos.regra_versao (id, codigo, versao, configuracao, evidencia, vigente_de)
        VALUES ($1, 'regra-sintetica', '1', '{}', 'inferido', '2024-01-01');
      `, [regra]);
      await cliente.query(`
        INSERT INTO documentos.template_versao (id, tipo, versao, html, css, vigente_de)
        VALUES ($1, 'DOF', '1', '<p>Modelo sintético</p>', '', '2024-01-01'),
               ($2, 'DTC_INSS', '1', '<p>Modelo sintético</p>', '', '2024-01-01'),
               ($3, 'DTC_COMISSIONADO', '1', '<p>Modelo sintético</p>', '', '2024-01-01')
      `, [templateDof, templateDtc, templateComissionado]);
      const inserirDocumento = `
        INSERT INTO documentos.documento (
          id, tipo, pessoa_id, vinculo_id, entrada_cifrada, template_versao_id,
          regra_versao_id, criado_por, atualizado_por
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
      `;
      await rejeitarSql(cliente, inserirDocumento, [
        randomUUID(), 'DOF', pessoa, outra.vinculo, conteudo, templateDof, regra, usuario,
      ], '23503');
      await rejeitarSql(cliente, inserirDocumento, [
        randomUUID(), 'DOF', pessoa, vinculo, conteudo, templateDtc, regra, usuario,
      ], '23503');
      await cliente.query(inserirDocumento, [dof, 'DOF', pessoa, vinculo, conteudo, templateDof, regra, usuario]);
      await cliente.query(inserirDocumento, [dtc, 'DTC_INSS', pessoa, vinculo, conteudo, templateDtc, regra, usuario]);
      await cliente.query(inserirDocumento, [
        comissionado, 'DTC_COMISSIONADO', pessoa, vinculo, conteudo, templateComissionado, regra, usuario,
      ]);
      await rejeitarSql(cliente, `
        UPDATE documentos.documento SET status = 'conferido', conferido_por = $2, conferido_em = now() WHERE id = $1
      `, [dof, usuario], '23514');
      await rejeitarSql(cliente, `
        INSERT INTO documentos.documento_periodo (documento_id, ordem, inicio, fim)
        VALUES ($1, 2, '2020-01-01', '2020-12-31')
      `, [dof], '23514');
      await cliente.query(`
        INSERT INTO documentos.documento_periodo (documento_id, ordem, inicio, fim)
        VALUES ($1, 1, '2020-01-01', '2020-12-31')
      `, [dof]);
      await cliente.query(`
        INSERT INTO documentos.documento_periodo (documento_id, ordem, inicio, fim)
        VALUES ($1, 1, '2000-01-01', '2000-12-31')
      `, [dtc]);
      await rejeitarSql(cliente, `
        INSERT INTO documentos.documento_periodo (documento_id, ordem, inicio, fim)
        VALUES ($1, 2, '2000-12-31', '2001-12-31')
      `, [dtc], '23514');
      await cliente.query(`
        INSERT INTO documentos.documento_periodo (documento_id, ordem, inicio, fim)
        VALUES ($1, 2, '2001-01-01', '2001-12-31'),
               ($1, 3, '2002-01-01', '2002-12-31'),
               ($1, 4, '2003-01-01', '2003-12-31')
      `, [dtc]);
      await rejeitarSql(cliente, `
        INSERT INTO documentos.documento_periodo (documento_id, ordem, inicio, fim)
        VALUES ($1, 5, '2004-01-01', '2004-12-31')
      `, [dtc], '23514');
      await rejeitarSql(cliente, `
        INSERT INTO documentos.documento_cargo_comissionado (
          documento_id, ordem, cargo, decreto_nomeacao, publicacao_nomeacao, data_entrada_exercicio
        ) VALUES ($1, 1, 'Cargo sintético', 'Decreto', 'Publicação', '2020-01-01')
      `, [dtc], '23514');
      await rejeitarSql(cliente, `
        INSERT INTO documentos.documento_cargo_comissionado (
          documento_id, ordem, cargo, decreto_nomeacao, publicacao_nomeacao, data_entrada_exercicio, decreto_exoneracao
        ) VALUES ($1, 1, 'Cargo sintético', 'Decreto', 'Publicação', '2020-01-01', 'Exoneração')
      `, [comissionado], '23514');
      await cliente.query(`
        INSERT INTO documentos.documento_cargo_comissionado (
          documento_id, ordem, cargo, decreto_nomeacao, publicacao_nomeacao, data_entrada_exercicio
        ) VALUES ($1, 1, 'Cargo 1', 'Decreto', 'Publicação', '2020-01-01'),
                 ($1, 2, 'Cargo 2', 'Decreto', 'Publicação', '2021-01-01'),
                 ($1, 3, 'Cargo 3', 'Decreto', 'Publicação', '2022-01-01')
      `, [comissionado]);
      await rejeitarSql(cliente, `
        INSERT INTO documentos.documento_cargo_comissionado (
          documento_id, ordem, cargo, decreto_nomeacao, publicacao_nomeacao, data_entrada_exercicio
        ) VALUES ($1, 4, 'Cargo 4', 'Decreto', 'Publicação', '2023-01-01')
      `, [comissionado], '23514');
      await rejeitarSql(cliente, `
        INSERT INTO documentos.ajuste_campo (documento_id, campo, valor_novo_cifrado, motivo_cifrado, usuario_id)
        VALUES ($1, 'cargo', $2, $3, $4)
      `, [dof, conteudo, Buffer.alloc(0), usuario], '23514');
      await cliente.query(`
        INSERT INTO documentos.ajuste_campo (documento_id, campo, valor_novo_cifrado, motivo_cifrado, usuario_id)
        VALUES ($1, 'cargo', $2, $2, $3)
      `, [dof, conteudo, usuario]);
      await rejeitarSql(cliente, "UPDATE documentos.documento SET status = 'emitido' WHERE id = $1", [dof], '23514');
      await rejeitarSql(cliente, `
        UPDATE documentos.documento SET status = 'conferido', conferido_por = $2, conferido_em = now(),
          atualizado_por = $2, revisao = revisao + 1 WHERE id = $1
      `, [dof, usuario], '23514');
      const primeiraConferencia = await conferirSqlSintetico(cliente, dof, usuario);
      await rejeitarSql(cliente, 'UPDATE documentos.documento SET confirmacao_inicio_cifrada = $2 WHERE id = $1',
        [dof, conteudo], '55000');
      await rejeitarSql(cliente, `
        UPDATE documentos.documento SET status = 'rascunho', conferido_por = NULL, conferido_em = NULL,
          atualizado_por = $2, revisao = revisao + 1 WHERE id = $1
      `, [dof, usuario], '23514');
      await cliente.query(`
        INSERT INTO documentos.devolucao_conferido_dof
          (id, documento_id, conferencia_id, devolvido_por, motivo_cifrado)
        VALUES ($1, $2, $3, $4, $5)
      `, [randomUUID(), dof, primeiraConferencia, usuario, conteudo]);
      await cliente.query(`
        UPDATE documentos.documento SET status = 'rascunho', conferido_por = NULL, conferido_em = NULL,
          atualizado_por = $2, revisao = revisao + 1 WHERE id = $1
      `, [dof, usuario]);
      await cliente.query('UPDATE documentos.documento SET entrada_cifrada = $2 WHERE id = $1', [dof, conteudo]);
      await conferirSqlSintetico(cliente, dof, usuario);
      await rejeitarSql(cliente, `
        UPDATE documentos.documento SET entrada_cifrada = $2 WHERE id = $1
      `, [dof, randomBytes(48)], '55000');
      await rejeitarSql(cliente, `
        UPDATE documentos.documento_periodo SET fim = '2020-12-30' WHERE documento_id = $1
      `, [dof], '55000');
      await rejeitarSql(cliente, `
        INSERT INTO documentos.ajuste_campo (documento_id, campo, valor_novo_cifrado, motivo_cifrado, usuario_id)
        VALUES ($1, 'cargo', $2, $2, $3)
      `, [dof, conteudo, usuario], '55000');
      await rejeitarSql(cliente, "UPDATE documentos.documento SET status = 'emitido' WHERE id = $1", [dof], '23514');
      const emissao = randomUUID();
      await cliente.query(`
        INSERT INTO documentos.emissao (
          id, documento_id, tipo, ano, numero, numero_formatado, chave_idempotencia, snapshot_cifrado, emitido_por
        ) VALUES ($1, $2, 'DOF', 2024, 1, '1/2024', 'idempotencia-sintetica', $3, $4)
      `, [emissao, dof, conteudo, usuario]);
      await cliente.query("UPDATE documentos.documento SET status = 'emitido' WHERE id = $1", [dof]);
      await rejeitarSql(cliente, 'UPDATE documentos.emissao SET snapshot_cifrado = $2 WHERE id = $1', [emissao, randomBytes(48)], '55000');
      await rejeitarSql(cliente, 'DELETE FROM documentos.emissao WHERE id = $1', [emissao], '55000');
      await rejeitarSql(cliente, "UPDATE documentos.regra_versao SET versao = '2' WHERE id = $1", [regra], '55000');
      await cliente.query("INSERT INTO seguranca.auditoria (acao, entidade) VALUES ('teste', 'sintetico')");
      await rejeitarSql(cliente, "UPDATE seguranca.auditoria SET acao = 'alterada'", [], '55000');
      await rejeitarSql(cliente, 'DELETE FROM seguranca.auditoria', [], '55000');
      await rejeitarSql(cliente, 'TRUNCATE seguranca.auditoria', [], '55000');
      await cliente.query(`
        UPDATE documentos.documento SET status = 'cancelado', cancelado_por = $2, cancelado_em = now(),
          motivo_cancelamento_cifrado = $3 WHERE id = $1
      `, [dof, usuario, conteudo]);
      await rejeitarSql(cliente, "UPDATE documentos.documento SET status = 'rascunho' WHERE id = $1", [dof], '55000');
      expect((await cliente.query('SELECT snapshot_cifrado FROM documentos.emissao WHERE id = $1', [emissao])).rows[0]
        .snapshot_cifrado).toEqual(conteudo);
    } finally {
      await cliente.query('ROLLBACK');
      await cliente.end();
    }
  });

  it('impede períodos sobrepostos em transações concorrentes', async () => {
    const parametros = {
      host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
      user: 'sisdoc_migrador', password: senhaMigrador,
    };
    const preparador = new Client(parametros);
    const primeiro = new Client(parametros);
    const segundo = new Client(parametros);
    await Promise.all([preparador.connect(), primeiro.connect(), segundo.connect()]);
    try {
      const { pessoa, vinculo } = await inserirPessoaEVinculo(preparador);
      const usuario = (await preparador.query<{ id: string }>('SELECT id FROM seguranca.usuario LIMIT 1')).rows[0].id;
      const regra = randomUUID();
      const template = randomUUID();
      const documento = randomUUID();
      await preparador.query(`
        INSERT INTO documentos.regra_versao (id, codigo, versao, configuracao, evidencia, vigente_de)
        VALUES ($1, $2, '1', '{}', 'inferido', '2024-01-01')
      `, [regra, `regra-${regra}`]);
      await preparador.query(`
        INSERT INTO documentos.template_versao (id, tipo, versao, html, css, vigente_de)
        VALUES ($1, 'DTC_INSS', $2, '<p>Modelo sintético</p>', '', '2024-01-01')
      `, [template, `versao-${template}`]);
      await preparador.query(`
        INSERT INTO documentos.documento (
          id, tipo, pessoa_id, vinculo_id, entrada_cifrada, template_versao_id, regra_versao_id, criado_por, atualizado_por
        ) VALUES ($1, 'DTC_INSS', $2, $3, $4, $5, $6, $7, $7)
      `, [documento, pessoa, vinculo, randomBytes(48), template, regra, usuario]);
      await Promise.all([primeiro.query('BEGIN'), segundo.query('BEGIN')]);
      await primeiro.query(`
        INSERT INTO documentos.documento_periodo (documento_id, ordem, inicio, fim)
        VALUES ($1, 1, '2000-01-01', '2000-12-31')
      `, [documento]);
      let terminou = false;
      const concorrente = segundo.query(`
        INSERT INTO documentos.documento_periodo (documento_id, ordem, inicio, fim)
        VALUES ($1, 2, '2000-12-31', '2001-12-31')
      `, [documento]).then(
        () => { terminou = true; return undefined; },
        (erro: unknown) => { terminou = true; return erro; },
      );
      await delay(200);
      expect(terminou).toBe(false);
      await primeiro.query('COMMIT');
      expect(await concorrente).toMatchObject({ code: '23514' });
    } finally {
      await Promise.all([primeiro.query('ROLLBACK'), segundo.query('ROLLBACK')]);
      await Promise.all([preparador.end(), primeiro.end(), segundo.end()]);
    }
  });

  it('inicia npm start em HTTPS verificado, com health e página inicial', async () => {
    const encerrar = await iniciarServico(portaHttps, caPem, arquivoConfig);
    try {
      const health = await requisitar(portaHttps, caPem);
      expect(health.status).toBe(200);
      expect(JSON.parse(health.corpo)).toEqual({ status: 'ok' });
      expect(health.headers['cache-control']).toBe('no-store');
      expect(health.headers['content-security-policy']).toContain("default-src 'self'");
      expect(health.headers['strict-transport-security']).toContain('max-age=');
      const pagina = await requisitar(portaHttps, caPem, nomeTls, '/');
      expect(pagina.status).toBe(200);
      expect(pagina.corpo).toContain('<title>SisDoc</title>');
      expect((await requisitar(portaHttps, caPem, nomeTls, '/api/v1/servidores')).status).toBe(401);
      await expect(requisitar(portaHttps, caPem, 'outro.local')).rejects.toThrow();
    } finally {
      await encerrar();
    }
  });

  it('autentica por HTTPS, exige CSRF e revoga a sessão ao trocar a senha ou sair', async () => {
    const encerrar = await iniciarServico(portaHttps, caPem, arquivoConfig);
    const formatoSessao = z.object({
      csrf: z.string(),
      usuario: z.object({ id: z.uuid(), matricula: z.string(), papel: z.string(), trocaSenhaObrigatoria: z.boolean() }),
    });
    try {
      const semSessao = await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota: '/api/v1/auth/me' });
      expect(semSessao.status).toBe(401);
      expect(semSessao.headers['content-type']).toContain('application/problem+json');
      const origemInvalida = await requisitarApi(portaHttps, caPem, {
        metodo: 'POST', rota: '/api/v1/auth/login', origem: 'https://outro.local',
        corpo: { matricula: opcoes.administrador.matricula, senha: senhaAdmin },
      });
      expect(origemInvalida.status).toBe(403);
      const inexistente = await requisitarApi(portaHttps, caPem, {
        metodo: 'POST', rota: '/api/v1/auth/login', corpo: { matricula: 'INEXISTENTE-SINTETICA', senha: senhaAdmin },
      });
      const incorreta = await requisitarApi(portaHttps, caPem, {
        metodo: 'POST', rota: '/api/v1/auth/login',
        corpo: { matricula: opcoes.administrador.matricula, senha: 'SenhaErradaFicticia!12345' },
      });
      expect(inexistente.status).toBe(401);
      expect(incorreta.status).toBe(401);
      expect(inexistente.corpo).toBe(incorreta.corpo);
      const login = await requisitarApi(portaHttps, caPem, {
        metodo: 'POST', rota: '/api/v1/auth/login',
        corpo: { matricula: opcoes.administrador.matricula, senha: senhaAdmin },
      });
      expect(login.status).toBe(200);
      const dados = formatoSessao.parse(JSON.parse(login.corpo));
      expect(dados.usuario.trocaSenhaObrigatoria).toBe(true);
      expect(login.corpo).not.toContain(senhaAdmin);
      const cookieCompleto = login.headers['set-cookie']?.[0];
      if (!cookieCompleto) throw new Error('Cookie de sessão ausente.');
      expect(cookieCompleto).toContain('Path=/; HttpOnly; Secure; SameSite=Lax');
      expect(cookieCompleto).not.toContain('Domain=');
      const cookie = cookieCompleto.split(';')[0];
      const token = cookie.slice(cookie.indexOf('=') + 1);
      expect(login.corpo).not.toContain(token);
      const cliente = new Client({
        host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
        user: 'sisdoc_migrador', password: senhaMigrador,
      });
      await cliente.connect();
      try {
        const sessao = await cliente.query<{ id_hash: Buffer; duracao: number }>(
          'SELECT id_hash, extract(epoch FROM expira_em - criada_em)::integer AS duracao FROM seguranca.sessao WHERE usuario_id = $1',
          [dados.usuario.id],
        );
        expect(sessao.rows[0].id_hash).toEqual(createHash('sha256').update(Buffer.from(token, 'base64url')).digest());
        expect(sessao.rows[0].id_hash).not.toEqual(Buffer.from(token, 'base64url'));
        expect(sessao.rows[0].duracao).toBe(8 * 60 * 60);
      } finally {
        await cliente.end();
      }
      const me = await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota: '/api/v1/auth/me', cookie });
      expect(me.status).toBe(200);
      expect(formatoSessao.parse(JSON.parse(me.corpo)).csrf).toBe(dados.csrf);
      expect((await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota: '/api/v1/admin/usuarios', cookie })).status).toBe(403);
      const semCsrf = await requisitarApi(portaHttps, caPem, {
        metodo: 'POST', rota: '/api/v1/auth/trocar-senha', cookie,
        corpo: { senhaAtual: senhaAdmin, senhaNova: senhaAdminNova },
      });
      expect(semCsrf.status).toBe(403);
      const outraOrigem = await requisitarApi(portaHttps, caPem, {
        metodo: 'POST', rota: '/api/v1/auth/trocar-senha', cookie, csrf: dados.csrf, origem: 'https://outro.local',
        corpo: { senhaAtual: senhaAdmin, senhaNova: senhaAdminNova },
      });
      expect(outraOrigem.status).toBe(403);
      const senhaComumResposta = await requisitarApi(portaHttps, caPem, {
        metodo: 'POST', rota: '/api/v1/auth/trocar-senha', cookie, csrf: dados.csrf,
        corpo: { senhaAtual: senhaAdmin, senhaNova: senhaComum },
      });
      expect(senhaComumResposta.status).toBe(400);
      expect(senhaComumResposta.corpo).toContain('lista local de senhas comuns');
      const mesmaSenha = await requisitarApi(portaHttps, caPem, {
        metodo: 'POST', rota: '/api/v1/auth/trocar-senha', cookie, csrf: dados.csrf,
        corpo: { senhaAtual: senhaAdmin, senhaNova: senhaAdmin },
      });
      expect(mesmaSenha.status).toBe(400);
      const troca = await requisitarApi(portaHttps, caPem, {
        metodo: 'POST', rota: '/api/v1/auth/trocar-senha', cookie, csrf: dados.csrf,
        corpo: { senhaAtual: senhaAdmin, senhaNova: senhaAdminNova },
      });
      expect(troca.status).toBe(200);
      expect(troca.headers['set-cookie']?.[0]).toContain('Max-Age=0');
      expect((await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota: '/api/v1/auth/me', cookie })).status).toBe(401);
      const novoLogin = await requisitarApi(portaHttps, caPem, {
        metodo: 'POST', rota: '/api/v1/auth/login',
        corpo: { matricula: opcoes.administrador.matricula, senha: senhaAdminNova },
      });
      expect(novoLogin.status).toBe(200);
      const novaSessao = formatoSessao.parse(JSON.parse(novoLogin.corpo));
      expect(novaSessao.usuario.trocaSenhaObrigatoria).toBe(false);
      const novoCookie = novoLogin.headers['set-cookie']?.[0].split(';')[0];
      if (!novoCookie) throw new Error('Novo cookie ausente.');
      expect(novoCookie).not.toBe(cookie);
      const rotacao = await requisitarApi(portaHttps, caPem, {
        metodo: 'POST', rota: '/api/v1/auth/login', cookie: novoCookie,
        corpo: { matricula: opcoes.administrador.matricula, senha: senhaAdminNova },
      });
      expect(rotacao.status).toBe(200);
      const sessaoRotacionada = formatoSessao.parse(JSON.parse(rotacao.corpo));
      const cookieRotacionado = rotacao.headers['set-cookie']?.[0].split(';')[0];
      if (!cookieRotacionado) throw new Error('Cookie rotacionado ausente.');
      expect(cookieRotacionado).not.toBe(novoCookie);
      expect((await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota: '/api/v1/auth/me', cookie: novoCookie })).status).toBe(401);
      expect((await requisitarApi(portaHttps, caPem, {
        metodo: 'POST', rota: '/api/v1/auth/logout', cookie: cookieRotacionado, csrf: 'invalido',
      })).status).toBe(403);
      const logout = await requisitarApi(portaHttps, caPem, {
        metodo: 'POST', rota: '/api/v1/auth/logout', cookie: cookieRotacionado, csrf: sessaoRotacionada.csrf,
      });
      expect(logout.status).toBe(200);
      expect((await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota: '/api/v1/auth/me', cookie: cookieRotacionado })).status).toBe(401);
    } finally {
      await encerrar();
    }
  });

  it('administra usuários com perfis isolados, auditoria, expiração e proteção do último admin', async () => {
    const encerrar = await iniciarServico(portaHttps, caPem, arquivoConfig);
    const cliente = new Client({
      host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
      user: 'sisdoc_migrador', password: senhaMigrador,
    });
    await cliente.connect();
    const senhaInicial = 'SenhaInicialSintetica!12345';
    const senhaAlterada = 'SenhaAlteradaSintetica!12345';
    const senhaRedefinida = 'SenhaRedefinidaSintetica!12345';
    type SessaoTeste = { cookie: string; csrf: string; usuario: z.infer<typeof respostaSessaoSchema>['usuario'] };
    const entrar = async (matricula: string, senha: string): Promise<SessaoTeste> => {
      const resposta = await requisitarApi(portaHttps, caPem, {
        metodo: 'POST', rota: '/api/v1/auth/login', corpo: { matricula, senha },
      });
      expect(resposta.status, resposta.corpo).toBe(200);
      const dados = respostaSessaoSchema.parse(JSON.parse(resposta.corpo));
      const cookie = resposta.headers['set-cookie']?.[0].split(';')[0];
      if (!cookie) throw new Error('Cookie de sessão ausente.');
      return { cookie, ...dados };
    };
    const chamada = (sessao: SessaoTeste, metodo: 'GET' | 'POST' | 'PATCH', rota: string, corpo?: unknown) =>
      requisitarApi(portaHttps, caPem, { metodo, rota, corpo, cookie: sessao.cookie, csrf: sessao.csrf });
    const criar = async (sessao: SessaoTeste, matricula: string, papel: string) => {
      const resposta = await chamada(sessao, 'POST', '/api/v1/admin/usuarios', {
        matricula, nome: `Usuário sintético ${matricula}`, papel, senha: senhaInicial,
      });
      expect(resposta.status, resposta.corpo).toBe(201);
      expect(resposta.corpo).not.toContain(senhaInicial);
      return usuarioAdministrativoSchema.parse(JSON.parse(resposta.corpo));
    };
    const completarTroca = async (matricula: string): Promise<SessaoTeste> => {
      const primeira = await entrar(matricula, senhaInicial);
      expect(primeira.usuario.trocaSenhaObrigatoria).toBe(true);
      const troca = await chamada(primeira, 'POST', '/api/v1/auth/trocar-senha', {
        senhaAtual: senhaInicial, senhaNova: senhaAlterada,
      });
      expect(troca.status, troca.corpo).toBe(200);
      return entrar(matricula, senhaAlterada);
    };
    const hashCookie = (sessao: SessaoTeste) => createHash('sha256')
      .update(Buffer.from(sessao.cookie.slice(sessao.cookie.indexOf('=') + 1), 'base64url')).digest();
    try {
      const admin = await entrar(opcoes.administrador.matricula, senhaAdminNova);
      expect((await chamada(admin, 'GET', '/api/v1/admin/usuarios?limite=51')).status).toBe(400);
      expect((await chamada(admin, 'GET', '/api/v1/admin/usuarios?cursor=invalido')).status).toBe(400);
      expect((await chamada(admin, 'PATCH', `/api/v1/admin/usuarios/${admin.usuario.id}`, { ativo: false })).status).toBe(409);
      expect((await chamada(admin, 'PATCH', `/api/v1/admin/usuarios/${admin.usuario.id}`, { papel: 'analista' })).status).toBe(409);
      const analista = await criar(admin, 'ANALISTA-SINTETICO', 'analista');
      await criar(admin, 'COORDENADOR-SINTETICO', 'coordenador');
      await criar(admin, 'SECRETARIO-SINTETICO', 'secretario_adjunto');
      const duplicado = await chamada(admin, 'POST', '/api/v1/admin/usuarios', {
        matricula: ' analista-sintetico ', nome: 'Outro sintético', papel: 'analista', senha: senhaInicial,
      });
      expect(duplicado.status, duplicado.corpo).toBe(409);
      expect((await chamada(admin, 'POST', '/api/v1/admin/usuarios', {
        matricula: 'SENHA-COMUM', nome: 'Usuário sintético', papel: 'analista', senha: senhaComum,
      })).status).toBe(400);

      const ids = new Set<string>();
      let cursor: string | null = null;
      do {
        const consulta: string = `/api/v1/admin/usuarios?limite=2${cursor ? `&cursor=${cursor}` : ''}`;
        const resposta = await chamada(admin, 'GET', consulta);
        expect(resposta.status, resposta.corpo).toBe(200);
        const pagina = paginaUsuariosSchema.parse(JSON.parse(resposta.corpo));
        expect(pagina.itens.length).toBeLessThanOrEqual(2);
        for (const usuario of pagina.itens) {
          expect(ids.has(usuario.id)).toBe(false);
          ids.add(usuario.id);
        }
        cursor = pagina.proximoCursor;
      } while (cursor);
      expect(ids.size).toBe(4);
      expect(ids.has(analista.id)).toBe(true);

      const sessaoAnalista = await completarTroca('ANALISTA-SINTETICO');
      const sessaoCoordenador = await completarTroca('COORDENADOR-SINTETICO');
      const sessaoSecretario = await completarTroca('SECRETARIO-SINTETICO');
      for (const sessao of [sessaoAnalista, sessaoCoordenador, sessaoSecretario]) {
        expect((await chamada(sessao, 'GET', '/api/v1/admin/usuarios')).status).toBe(403);
        expect((await chamada(sessao, 'POST', '/api/v1/admin/usuarios', {
          matricula: 'NEGADO-SINTETICO', nome: 'Usuário sintético', papel: 'admin', senha: senhaInicial,
        })).status).toBe(403);
      }
      for (const sessao of [sessaoAnalista, sessaoCoordenador]) {
        expect((await chamada(sessao, 'GET', '/api/v1/admin/auditoria')).status).toBe(403);
      }
      for (const sessao of [admin, sessaoSecretario]) {
        const resposta = await chamada(sessao, 'GET', '/api/v1/admin/auditoria?limite=2');
        expect(resposta.status, resposta.corpo).toBe(200);
        const pagina = paginaAuditoriaSchema.parse(JSON.parse(resposta.corpo));
        expect(pagina.itens).toHaveLength(2);
        expect(pagina.proximoCursor).not.toBeNull();
        const seguinte = await chamada(sessao, 'GET', `/api/v1/admin/auditoria?limite=2&cursor=${pagina.proximoCursor}`);
        const proximaPagina = paginaAuditoriaSchema.parse(JSON.parse(seguinte.corpo));
        expect(proximaPagina.itens.every((evento) => !pagina.itens.some((primeiro) => primeiro.id === evento.id))).toBe(true);
      }
      const consultaAuditoria = await chamada(admin, 'GET', '/api/v1/admin/auditoria?limite=50');
      const registros = paginaAuditoriaSchema.parse(JSON.parse(consultaAuditoria.corpo));
      expect(registros.itens.some((evento) => evento.acao === 'usuario_criado' && evento.entidadeId === analista.id)).toBe(true);
      const reset = await chamada(admin, 'POST', `/api/v1/admin/usuarios/${analista.id}/redefinir-senha`, {
        senha: senhaRedefinida,
      });
      expect(reset.status, reset.corpo).toBe(200);
      expect((await chamada(sessaoAnalista, 'GET', '/api/v1/auth/me')).status).toBe(401);
      const aposReset = await entrar('ANALISTA-SINTETICO', senhaRedefinida);
      expect(aposReset.usuario.trocaSenhaObrigatoria).toBe(true);
      const atualizado = await chamada(admin, 'PATCH', `/api/v1/admin/usuarios/${analista.id}`, {
        nome: 'Analista sintético atualizado', papel: 'coordenador', email: 'sintetico@example.invalid',
      });
      expect(atualizado.status, atualizado.corpo).toBe(200);
      expect(usuarioAdministrativoSchema.parse(JSON.parse(atualizado.corpo)).papel).toBe('coordenador');
      expect((await chamada(aposReset, 'GET', '/api/v1/auth/me')).status).toBe(401);
      const aposAtualizar = await entrar('ANALISTA-SINTETICO', senhaRedefinida);
      expect(aposAtualizar.usuario.papel).toBe('coordenador');
      await cliente.query("UPDATE seguranca.sessao SET ultimo_uso = now() - interval '31 minutes' WHERE id_hash = $1", [hashCookie(aposAtualizar)]);
      expect((await chamada(aposAtualizar, 'GET', '/api/v1/auth/me')).status).toBe(401);
      const outraSessao = await entrar('ANALISTA-SINTETICO', senhaRedefinida);
      await cliente.query(`
        UPDATE seguranca.sessao SET criada_em = now() - interval '9 hours', expira_em = now() - interval '1 minute'
        WHERE id_hash = $1
      `, [hashCookie(outraSessao)]);
      expect((await chamada(outraSessao, 'GET', '/api/v1/auth/me')).status).toBe(401);

      const bloqueado = await criar(admin, 'BLOQUEIO-SINTETICO', 'analista');
      const falhas = await Promise.all(Array.from({ length: 5 }, () => requisitarApi(portaHttps, caPem, {
        metodo: 'POST', rota: '/api/v1/auth/login',
        corpo: { matricula: 'BLOQUEIO-SINTETICO', senha: 'SenhaErradaFicticia!12345' },
      })));
      expect(falhas.every((resposta) => resposta.status === 401)).toBe(true);
      const estadoBloqueio = await cliente.query<{ tentativas_falhas: number; bloqueado: boolean }>(`
        SELECT tentativas_falhas, bloqueado_ate > now() AS bloqueado FROM seguranca.usuario WHERE id = $1
      `, [bloqueado.id]);
      expect(estadoBloqueio.rows[0]).toEqual({ tentativas_falhas: 5, bloqueado: true });
      expect((await requisitarApi(portaHttps, caPem, {
        metodo: 'POST', rota: '/api/v1/auth/login', corpo: { matricula: 'BLOQUEIO-SINTETICO', senha: senhaInicial },
      })).status).toBe(401);
      await cliente.query("UPDATE seguranca.usuario SET bloqueado_ate = now() - interval '1 second' WHERE id = $1", [bloqueado.id]);
      await cliente.query(`
        UPDATE seguranca.limite_login SET bloqueado_ate = now() - interval '1 second'
        WHERE escopo = 'matricula' AND bloqueado_ate IS NOT NULL
      `);
      expect((await entrar('BLOQUEIO-SINTETICO', senhaInicial)).usuario.id).toBe(bloqueado.id);

      await cliente.query("UPDATE seguranca.limite_login SET falhas = 0, bloqueado_ate = NULL, janela_inicio = now() WHERE escopo = 'ip'");
      const falhasIp = await Promise.all(Array.from({ length: 20 }, (_, indice) => requisitarApi(portaHttps, caPem, {
        metodo: 'POST', rota: '/api/v1/auth/login',
        corpo: { matricula: `IP-INVALIDO-SINTETICO-${indice}`, senha: senhaInicial },
      })));
      expect(falhasIp.every((resposta) => resposta.status === 401)).toBe(true);
      const estadoIp = await cliente.query<{ falhas: number; bloqueado: boolean }>(
        "SELECT falhas, bloqueado_ate > now() AS bloqueado FROM seguranca.limite_login WHERE escopo = 'ip'",
      );
      expect(estadoIp.rows).toEqual([{ falhas: 20, bloqueado: true }]);
      expect((await requisitarApi(portaHttps, caPem, {
        metodo: 'POST', rota: '/api/v1/auth/login',
        corpo: { matricula: opcoes.administrador.matricula, senha: senhaAdminNova },
      })).status).toBe(401);
      await cliente.query("UPDATE seguranca.limite_login SET falhas = 0, bloqueado_ate = NULL, janela_inicio = now() WHERE escopo = 'ip'");

      const saidaCli = await executarInterativo('npm run usuario -- criar', [
        { texto: 'Matrícula do administrador: ', resposta: opcoes.administrador.matricula },
        { texto: 'Senha do administrador: ', resposta: senhaAdminNova },
        { texto: 'Matrícula do novo usuário: ', resposta: 'USUARIO-CLI-SINTETICO' },
        { texto: 'Nome do novo usuário: ', resposta: 'Usuário de linha de comando sintético' },
        { texto: 'E-mail do novo usuário (opcional): ', resposta: '' },
        { texto: 'Perfil (analista, coordenador, secretario_adjunto ou admin): ', resposta: 'analista' },
        { texto: 'Senha inicial do novo usuário: ', resposta: senhaInicial },
        { texto: 'Confirme a senha inicial: ', resposta: senhaInicial },
        { texto: 'Digite CRIAR para confirmar: ', resposta: 'CRIAR' },
      ], { SISDOC_CONFIG: arquivoConfig }, [senhaAdminNova, senhaInicial]);
      expect(saidaCli).toContain('Usuário criado.');
      expect(saidaCli).not.toContain(senhaAdminNova);
      expect(saidaCli).not.toContain(senhaInicial);
      const usuarioCli = await cliente.query<{ senha_hash: string; papel: string; troca_senha_obrigatoria: boolean }>(
        "SELECT senha_hash, papel, troca_senha_obrigatoria FROM seguranca.usuario WHERE matricula = 'USUARIO-CLI-SINTETICO'",
      );
      expect(usuarioCli.rows).toHaveLength(1);
      expect(usuarioCli.rows[0].papel).toBe('analista');
      expect(usuarioCli.rows[0].troca_senha_obrigatoria).toBe(true);
      expect(await verify(usuarioCli.rows[0].senha_hash, senhaInicial)).toBe(true);

      const semLista = await carregarConfiguracao(arquivoConfig);
      delete semLista.seguranca;
      semLista.porta = await portaLivre();
      const arquivoSemLista = path.join(temporario, 'configuracao-sem-lista.json');
      await writeFile(arquivoSemLista, JSON.stringify(semLista), 'utf8');
      const encerrarSemLista = await iniciarServico(semLista.porta, caPem, arquivoSemLista);
      try {
        const loginSemLista = await requisitarApi(semLista.porta, caPem, {
          metodo: 'POST', rota: '/api/v1/auth/login',
          corpo: { matricula: opcoes.administrador.matricula, senha: senhaAdminNova },
        });
        expect(loginSemLista.status).toBe(200);
        const dadosSemLista = respostaSessaoSchema.parse(JSON.parse(loginSemLista.corpo));
        const cookieSemLista = loginSemLista.headers['set-cookie']?.[0].split(';')[0];
        if (!cookieSemLista) throw new Error('Cookie da configuração sem lista ausente.');
        const falhaLista = await requisitarApi(semLista.porta, caPem, {
          metodo: 'POST', rota: '/api/v1/admin/usuarios', cookie: cookieSemLista, csrf: dadosSemLista.csrf,
          corpo: { matricula: 'SEM-LISTA-SINTETICO', nome: 'Usuário sintético', papel: 'analista', senha: senhaInicial },
        });
        expect(falhaLista.status).toBe(503);
        expect(falhaLista.corpo).toContain('Configure a lista local de senhas comuns');
        expect((await requisitarApi(semLista.porta, caPem, {
          metodo: 'GET', rota: '/api/v1/auth/me', cookie: cookieSemLista,
        })).status).toBe(200);
      } finally {
        await encerrarSemLista();
      }

      const credencialInvalida = await criar(admin, 'HASH-INVALIDO-SINTETICO', 'analista');
      await cliente.query("UPDATE seguranca.usuario SET senha_hash = 'hash-ficticio-invalido' WHERE id = $1", [credencialInvalida.id]);
      const erroHash = await requisitarApi(portaHttps, caPem, {
        metodo: 'POST', rota: '/api/v1/auth/login', corpo: { matricula: 'HASH-INVALIDO-SINTETICO', senha: senhaInicial },
      });
      expect(erroHash.status).toBe(503);
      expect(erroHash.corpo).toContain('Não foi possível verificar a credencial');
      await cliente.query('REVOKE SELECT ON seguranca.usuario FROM sisdoc_aplicativo');
      try {
        const falhaBanco = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: '/api/v1/auth/login',
          corpo: { matricula: opcoes.administrador.matricula, senha: senhaAdminNova },
        });
        expect(falhaBanco.status).toBe(500);
        expect(falhaBanco.corpo).not.toContain(senhaAdminNova);
      } finally {
        await cliente.query('GRANT SELECT ON seguranca.usuario TO sisdoc_aplicativo');
      }

      const adminNovo = await criar(admin, 'ADMIN-SECUNDARIO-SINTETICO', 'admin');
      const sessaoAdminNovo = await completarTroca('ADMIN-SECUNDARIO-SINTETICO');
      const respostas = await Promise.all([
        chamada(admin, 'PATCH', `/api/v1/admin/usuarios/${admin.usuario.id}`, { ativo: false }),
        chamada(sessaoAdminNovo, 'PATCH', `/api/v1/admin/usuarios/${adminNovo.id}`, { ativo: false }),
      ]);
      expect(respostas.map((resposta) => resposta.status).sort()).toEqual([200, 409]);
      const administradores = await cliente.query<{ total: string }>(
        "SELECT count(*) AS total FROM seguranca.usuario WHERE papel = 'admin' AND ativo",
      );
      expect(administradores.rows[0].total).toBe('1');
      const eventos = await cliente.query<{ acao: string; registro: unknown }>(
        'SELECT acao, row_to_json(a) AS registro FROM seguranca.auditoria a ORDER BY id',
      );
      const acoes = eventos.rows.map((evento) => evento.acao);
      for (const acao of ['login', 'logout', 'troca_senha', 'usuario_criado', 'usuario_atualizado',
        'senha_redefinida', 'acesso_negado', 'auditoria_consultada']) {
        expect(acoes).toContain(acao);
      }
      const auditoria = JSON.stringify(eventos.rows);
      for (const segredo of [senhaAdmin, senhaAdminNova, senhaInicial, senhaAlterada, senhaRedefinida, admin.cookie, admin.csrf]) {
        expect(auditoria).not.toContain(segredo);
      }
    } finally {
      await cliente.end();
      await encerrar();
    }
  });

  it('busca e abre vínculos sintéticos em menos de um segundo com autorização e auditoria', async () => {
    const config = await carregarConfiguracao(arquivoConfig);
    const protetor = new ProtetorDados(config.chaves);
    const pessoas = gerarPessoasSinteticas(17700);
    const cliente = new Client({
      host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
      user: 'sisdoc_migrador', password: senhaMigrador,
    });
    await cliente.connect();
    const senhaBusca = 'SenhaBuscaSintetica!12345';
    const hashSenha = await gerarHashSenha(senhaBusca);
    const perfis = ['analista', 'coordenador', 'secretario_adjunto', 'admin'] as const;
    try {
      await cliente.query('BEGIN');
      try {
        for (let inicio = 0; inicio < pessoas.length; inicio += 500) {
          const lote = pessoas.slice(inicio, inicio + 500);
          const linhasPessoas = lote.map((pessoa) => ({
            id: pessoa.id,
            cpf_cifrado: protetor.cifrar(Buffer.from(pessoa.cpf, 'ascii'), {
              schema: 'nucleo', tabela: 'pessoa', registroId: pessoa.id, campo: 'cpf_cifrado',
            }).toString('base64'),
            cpf_hash: protetor.hashCpf(pessoa.cpf).toString('hex'),
            nome: pessoa.nome,
            nome_busca: pessoa.nomeBusca,
          }));
          await cliente.query(`
            INSERT INTO nucleo.pessoa (id, cpf_cifrado, cpf_hash, nome, nome_busca)
            SELECT id::uuid, decode(cpf_cifrado, 'base64'), decode(cpf_hash, 'hex'), nome, nome_busca
            FROM jsonb_to_recordset($1::jsonb)
              AS p(id text, cpf_cifrado text, cpf_hash text, nome text, nome_busca text)
          `, [JSON.stringify(linhasPessoas)]);
          const linhasVinculos = lote.flatMap((pessoa) => pessoa.vinculos.map((vinculo) => ({
            ...vinculo, pessoaId: pessoa.id,
          })));
          await cliente.query(`
            INSERT INTO nucleo.vinculo (id, pessoa_id, matricula, matricula_norm, sistema_origem, id_origem,
              matricula_anterior_id, orgao_nome, regime_juridico, referencia)
            SELECT id::uuid, "pessoaId"::uuid, matricula, "matriculaNorm", "sistemaOrigem", "idOrigem",
              "matriculaAnteriorId"::uuid, orgao, regime, referencia
            FROM jsonb_to_recordset($1::jsonb) AS v(
              id text, "pessoaId" text, matricula text, "matriculaNorm" text, "sistemaOrigem" text,
              "idOrigem" text, "matriculaAnteriorId" text, orgao text, regime text, referencia text
            )
          `, [JSON.stringify(linhasVinculos)]);
        }
        for (const papel of perfis) {
          await cliente.query(`
            INSERT INTO seguranca.usuario (id, matricula, nome, senha_hash, papel, troca_senha_obrigatoria)
            VALUES ($1, $2, 'Operador de busca sintético', $3, $4, false)
          `, [randomUUID(), `BUSCA-${papel.toUpperCase()}-SINTETICA`, hashSenha, papel]);
        }
        await cliente.query(`
          INSERT INTO nucleo.evento_funcional (id, vinculo_id, tipo, data_evento, ato_tipo, ato_numero, fonte)
          VALUES ($1, $2, 'nomeacao', DATE '2001-02-03', 'decreto', 'SINTETICO-1', 'fonte sintética'),
                 ($3, $2, 'exoneracao', DATE '2002-03-04', 'decreto', 'SINTETICO-2', 'fonte sintética')
        `, [randomUUID(), pessoas[0].vinculos[0].id, randomUUID()]);
        await cliente.query('COMMIT');
      } catch (erro) {
        await cliente.query('ROLLBACK');
        throw erro;
      }
      const quantidade = await cliente.query<{ total: string }>(`
        SELECT count(*) AS total FROM nucleo.vinculo
        WHERE sistema_origem IN ('fonte-sintetica-a', 'fonte-sintetica-b')
      `);
      expect(quantidade.rows[0].total).toBe('17700');
      const primeira = pessoas[0];
      const bruto = await cliente.query<{ cpf_cifrado: Buffer; cpf_hash: Buffer }>(
        'SELECT cpf_cifrado, cpf_hash FROM nucleo.pessoa WHERE id = $1', [primeira.id],
      );
      expect(bruto.rows[0].cpf_cifrado).not.toEqual(Buffer.from(primeira.cpf, 'ascii'));
      expect(bruto.rows[0].cpf_hash).toEqual(protetor.hashCpf(primeira.cpf));
      const encerrar = await iniciarServico(portaHttps, caPem, arquivoConfig);
      try {
        const sessoes = new Map<string, { cookie: string; csrf: string }>();
        for (const papel of perfis) {
          const login = await requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: '/api/v1/auth/login',
            corpo: { matricula: `BUSCA-${papel.toUpperCase()}-SINTETICA`, senha: senhaBusca },
          });
          expect(login.status, login.corpo).toBe(200);
          const sessao = respostaSessaoSchema.parse(JSON.parse(login.corpo));
          const cookie = login.headers['set-cookie']?.[0].split(';')[0];
          if (!cookie) throw new Error('Cookie da busca sintética ausente.');
          sessoes.set(papel, { cookie, csrf: sessao.csrf });
        }
        const analista = sessoes.get('analista');
        const admin = sessoes.get('admin');
        if (!analista || !admin) throw new Error('Sessões sintéticas ausentes.');
        expect((await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota: '/api/v1/servidores?q=arvore&tipo=nome' })).status).toBe(401);
        for (const rota of ['/api/v1/servidores?q=arvore&tipo=nome', `/api/v1/servidores/${primeira.id}`,
          `/api/v1/servidores/${primeira.id}/eventos?vinculoId=${primeira.vinculos[0].id}`]) {
          expect((await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota, cookie: admin.cookie })).status).toBe(200);
        }
        const duracoes = { nome: 0, cpf: 0, matricula: 0, pagina: 0 };
        const consultar = async (q: string, tipo: 'nome' | 'cpf' | 'matricula') => {
          const inicio = performance.now();
          const resposta = await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: `/api/v1/servidores?tipo=${tipo}&q=${encodeURIComponent(q)}`, cookie: analista.cookie,
          });
          const duracao = performance.now() - inicio;
          duracoes[tipo] = Math.max(duracoes[tipo], duracao);
          expect(resposta.status, resposta.corpo).toBe(200);
          expect(duracao, `${tipo}: ${duracao.toFixed(1)} ms`).toBeLessThan(1000);
          expect(resposta.corpo).not.toContain(primeira.cpf);
          return paginaBuscaServidoresSchema.parse(JSON.parse(resposta.corpo));
        };
        for (let repeticao = 0; repeticao < 3; repeticao += 1) {
          expect((await consultar('arvore ficticia', 'nome')).itens.map((item) => item.vinculoId).sort())
            .toEqual(primeira.vinculos.map((vinculo) => vinculo.id).sort());
          expect((await consultar(primeira.cpf, 'cpf')).itens).toHaveLength(2);
          const sufixo = await consultar('1.000001-2', 'matricula');
          expect(sufixo.itens.map((item) => item.vinculoId)).toEqual([primeira.vinculos[1].id]);
        }
        const cpfMascarado = `${primeira.cpf.slice(0, 3)}.${primeira.cpf.slice(3, 6)}.${primeira.cpf.slice(6, 9)}-${primeira.cpf.slice(9)}`;
        expect((await consultar(cpfMascarado, 'cpf')).itens).toHaveLength(2);
        const duplicada = await consultar('7.777777-1', 'matricula');
        expect(new Set(duplicada.itens.map((item) => item.pessoaId)).size).toBe(2);
        expect(new Set(duplicada.itens.map((item) => item.sistemaOrigem)).size).toBe(2);
        const automatica = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: '/api/v1/servidores?q=7.777777-1', cookie: analista.cookie,
        });
        expect(paginaBuscaServidoresSchema.parse(JSON.parse(automatica.corpo)).itens).toHaveLength(2);
        for (const rota of ['/api/v1/servidores?q=ab&tipo=nome', '/api/v1/servidores?q=%00abc&tipo=nome',
          '/api/v1/servidores?q=00000000000&tipo=cpf',
          '/api/v1/servidores?q=nome&tipo=nome&limite=51', '/api/v1/servidores?q=nome&tipo=nome&limite=0',
          '/api/v1/servidores?q=nome&tipo=nome&cursor=invalido', '/api/v1/servidores?q=nome&tipo=nome&outro=1']) {
          expect((await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota, cookie: analista.cookie })).status).toBe(400);
        }
        expect((await consultar('%__', 'nome')).itens).toHaveLength(0);
        const inicioPagina = performance.now();
        const primeiraPagina = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: '/api/v1/servidores?q=sintetica&tipo=nome&limite=2', cookie: analista.cookie,
        });
        duracoes.pagina = performance.now() - inicioPagina;
        expect(duracoes.pagina, 'Nome com muitos resultados').toBeLessThan(1000);
        const pagina = paginaBuscaServidoresSchema.parse(JSON.parse(primeiraPagina.corpo));
        expect(pagina.itens).toHaveLength(2);
        expect(pagina.proximoCursor).not.toBeNull();
        const inicioSeguinte = performance.now();
        const paginaSeguinte = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `/api/v1/servidores?q=sintetica&tipo=nome&limite=2&cursor=${pagina.proximoCursor}`, cookie: analista.cookie,
        });
        duracoes.pagina = Math.max(duracoes.pagina, performance.now() - inicioSeguinte);
        expect(duracoes.pagina, 'Página seguinte com muitos resultados').toBeLessThan(1000);
        const seguinte = paginaBuscaServidoresSchema.parse(JSON.parse(paginaSeguinte.corpo));
        expect(seguinte.itens.every((item) => !pagina.itens.some((primeiro) => primeiro.vinculoId === item.vinculoId))).toBe(true);

        for (const papel of ['analista', 'coordenador', 'secretario_adjunto']) {
          const sessao = sessoes.get(papel);
          if (!sessao) throw new Error('Sessão funcional sintética ausente.');
          const detalhe = await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: `/api/v1/servidores/${primeira.id}`, cookie: sessao.cookie,
          });
          expect(detalhe.status, detalhe.corpo).toBe(200);
          expect(detalhe.corpo).not.toContain(primeira.cpf);
          const dados = detalheServidorSchema.parse(JSON.parse(detalhe.corpo));
          expect(dados.pessoa.cpfMascarado).toBe(`***.***.${primeira.cpf.slice(6, 9)}-**`);
          expect(dados.vinculos.map((vinculo) => vinculo.id).sort()).toEqual(primeira.vinculos.map((vinculo) => vinculo.id).sort());
          expect(dados.vinculos.find((vinculo) => vinculo.id === primeira.vinculos[1].id)?.matriculaAnteriorId)
            .toBe(primeira.vinculos[0].id);
          const eventos = await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: `/api/v1/servidores/${primeira.id}/eventos?vinculoId=${primeira.vinculos[0].id}`, cookie: sessao.cookie,
          });
          expect(eventos.status, eventos.corpo).toBe(200);
          expect(paginaEventosServidorSchema.parse(JSON.parse(eventos.corpo)).itens)
            .toContainEqual(expect.objectContaining({ tipo: 'nomeacao', dataEvento: '2001-02-03', atoNumero: 'SINTETICO-1' }));
        }
        const detalhePaginado = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `/api/v1/servidores/${primeira.id}?limite=1`, cookie: analista.cookie,
        });
        const detalheUm = detalheServidorSchema.parse(JSON.parse(detalhePaginado.corpo));
        expect(detalheUm.vinculos).toHaveLength(1);
        expect(detalheUm.proximoCursor).toBe(detalheUm.vinculos[0].id);
        const detalheSeguinte = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `/api/v1/servidores/${primeira.id}?limite=1&cursor=${detalheUm.proximoCursor}`, cookie: analista.cookie,
        });
        const detalheDois = detalheServidorSchema.parse(JSON.parse(detalheSeguinte.corpo));
        expect(detalheDois.vinculos).toHaveLength(1);
        expect(detalheDois.vinculos[0].id).not.toBe(detalheUm.vinculos[0].id);
        expect(detalheDois.proximoCursor).toBeNull();
        const rotaEventos = `/api/v1/servidores/${primeira.id}/eventos?vinculoId=${primeira.vinculos[0].id}`;
        const eventoPaginado = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `${rotaEventos}&limite=1`, cookie: analista.cookie,
        });
        const eventoUm = paginaEventosServidorSchema.parse(JSON.parse(eventoPaginado.corpo));
        expect(eventoUm.itens).toHaveLength(1);
        expect(eventoUm.proximoCursor).toBe(eventoUm.itens[0].id);
        const eventoSeguinte = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `${rotaEventos}&limite=1&cursor=${eventoUm.proximoCursor}`, cookie: analista.cookie,
        });
        const eventoDois = paginaEventosServidorSchema.parse(JSON.parse(eventoSeguinte.corpo));
        expect(eventoDois.itens).toHaveLength(1);
        expect(eventoDois.itens[0].id).not.toBe(eventoUm.itens[0].id);
        expect(eventoDois.proximoCursor).toBeNull();
        for (const rota of [`/api/v1/servidores/${primeira.id}?cursor=invalido`,
          `/api/v1/servidores/${primeira.id}/eventos?vinculoId=invalido`,
          '/api/v1/servidores/invalido']) {
          expect((await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota, cookie: analista.cookie })).status).toBe(400);
        }
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `/api/v1/servidores/${pessoas[1].id}/eventos?vinculoId=${primeira.vinculos[0].id}`,
          cookie: analista.cookie,
        })).status).toBe(404);
        const auditoria = await cliente.query<{ acao: string; pessoa_id: string | null; detalhes: unknown }>(`
          SELECT acao, pessoa_id, detalhes FROM seguranca.auditoria
          WHERE acao IN ('servidores_pesquisados', 'servidor_consultado', 'eventos_consultados')
        `);
        expect(auditoria.rows.some((evento) => evento.acao === 'servidores_pesquisados')).toBe(true);
        expect(auditoria.rows.some((evento) => evento.acao === 'servidor_consultado' && evento.pessoa_id === primeira.id)).toBe(true);
        expect(auditoria.rows.some((evento) => evento.acao === 'eventos_consultados' && evento.pessoa_id === primeira.id)).toBe(true);
        expect(JSON.stringify(auditoria.rows)).not.toContain(primeira.cpf);
        expect(JSON.stringify(auditoria.rows)).not.toContain('1.000001-2');
        process.stdout.write(
          `Busca sintética HTTPS, máximos em ms: nome=${duracoes.nome.toFixed(1)}, CPF=${duracoes.cpf.toFixed(1)}, ` +
          `matrícula=${duracoes.matricula.toFixed(1)}, página ampla=${duracoes.pagina.toFixed(1)}.\n`,
        );
      } finally {
        await encerrar();
      }
    } finally {
      await cliente.end();
    }
  });

  it('calcula DOF autorizada com mais de 41 anos sem alterar a fonte ou criar emissão', async () => {
    const config = await carregarConfiguracao(arquivoConfig);
    const protetor = new ProtetorDados(config.chaves);
    const cliente = new Client({
      host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
      user: 'sisdoc_migrador', password: senhaMigrador,
    });
    await cliente.connect();
    const pessoaId = randomUUID();
    const vinculoId = randomUUID();
    const semAdmissaoId = randomUUID();
    const cpf = cpfSintetico(900000001);
    const senha = 'CalculoFicticio!12345';
    const hashSenha = await gerarHashSenha(senha);
    const perfis = ['analista', 'coordenador', 'secretario_adjunto', 'admin'] as const;
    try {
      await cliente.query(`
        INSERT INTO nucleo.pessoa (id, cpf_cifrado, cpf_hash, nome, nome_busca)
        VALUES ($1, $2, $3, 'Pessoa DOF fictícia', 'pessoa dof ficticia')
      `, [pessoaId, protetor.cifrar(Buffer.from(cpf, 'ascii'), {
        schema: 'nucleo', tabela: 'pessoa', registroId: pessoaId, campo: 'cpf_cifrado',
      }), protetor.hashCpf(cpf)]);
      await cliente.query(`
        INSERT INTO nucleo.vinculo (id, pessoa_id, matricula, matricula_norm, sistema_origem, id_origem, admissao)
        VALUES ($1, $3, 'DOF-FICTICIA-1', 'DOF-FICTICIA-1', 'fonte-dof-sintetica', $4, '1980-01-01'),
               ($2, $3, 'DOF-FICTICIA-2', 'DOF-FICTICIA-2', 'fonte-dof-sintetica', $5, NULL)
      `, [vinculoId, semAdmissaoId, pessoaId, randomUUID(), randomUUID()]);
      for (const papel of perfis) {
        await cliente.query(`
          INSERT INTO seguranca.usuario (id, matricula, nome, senha_hash, papel, troca_senha_obrigatoria)
          VALUES ($1, $2, 'Operador DOF fictício', $3, $4, false)
        `, [randomUUID(), `CALCULO-${papel.toUpperCase()}-FICTICIO`, hashSenha, papel]);
      }
      const estadoAntes = await cliente.query(`
        SELECT (SELECT count(*) FROM documentos.documento) AS documentos,
               (SELECT count(*) FROM documentos.emissao) AS emissoes,
               (SELECT count(*) FROM nucleo.afastamento WHERE vinculo_id = $1) AS afastamentos,
               (SELECT count(*) FROM nucleo.incorporacao WHERE vinculo_id = $1) AS incorporacoes,
               (SELECT to_char(admissao, 'YYYY-MM-DD') FROM nucleo.vinculo WHERE id = $1) AS admissao
      `, [vinculoId]);
      const encerrar = await iniciarServico(portaHttps, caPem, arquivoConfig);
      try {
        const sessoes = new Map<string, { cookie: string; csrf: string }>();
        for (const papel of perfis) {
          const login = await requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: '/api/v1/auth/login',
            corpo: { matricula: `CALCULO-${papel.toUpperCase()}-FICTICIO`, senha },
          });
          expect(login.status, login.corpo).toBe(200);
          const sessao = respostaSessaoSchema.parse(JSON.parse(login.corpo));
          const cookie = login.headers['set-cookie']?.[0].split(';')[0];
          if (!cookie) throw new Error('Cookie de cálculo sintético ausente.');
          sessoes.set(papel, { cookie, csrf: sessao.csrf });
        }
        const anos = Array.from({ length: 45 }, (_, indice) => ({
          ano: 1980 + indice, abrangencia: 'intervalo_declarado',
          faltas: indice === 1 ? 1 : 0, ts: 0, pf: 0, ip: 0, outros: 0, pb: 0, pv: 0, licencaPremio: 0,
        }));
        const entrada = { pessoaId, vinculoId, inicio: '1980-01-01', fim: '2024-12-31', anos, confirmacaoDados: true };
        const analista = sessoes.get('analista');
        const admin = sessoes.get('admin');
        if (!analista || !admin) throw new Error('Sessões de cálculo sintético ausentes.');
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: '/api/v1/calculos', corpo: entrada,
        })).status).toBe(401);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: '/api/v1/calculos', corpo: entrada, cookie: analista.cookie,
        })).status).toBe(403);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: '/api/v1/calculos', corpo: entrada, ...admin,
        })).status).toBe(200);
        for (const papel of ['analista', 'coordenador', 'secretario_adjunto']) {
          const sessao = sessoes.get(papel);
          if (!sessao) throw new Error('Sessão funcional sintética ausente.');
          const resposta = await requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: '/api/v1/calculos', corpo: entrada, ...sessao,
          });
          expect(resposta.status, resposta.corpo).toBe(200);
          expect(resposta.corpo).not.toContain(cpf);
          const resultado = resultadoCalculoDofSchema.parse(JSON.parse(resposta.corpo));
          expect(resultado.periodo.linhas).toHaveLength(45);
          expect(resultado.periodo.linhas.at(-1)?.ano).toBe(2024);
          expect(resultado.admissaoConsiderada).toBe('1980-01-01');
          expect(resultado.totais).toMatchObject({
            diasBrutos: 16437, contribuicaoMunicipio: 16436, efetivoExercicio: 16436,
          });
          expect(resultado.regra.classificacao).toBe('provisoria');
          expect(resultado.avisos.map((aviso) => aviso.codigo)).toContain('regra_provisoria');
        }
        for (const invalida of [
          { ...entrada, confirmacaoDados: false },
          { ...entrada, posse: '1900-01-01' },
          { ...entrada, regras: { classificacao: 'oficial' } },
          { ...entrada, anos: anos.slice(1) },
          { ...entrada, anos: [{ ...anos[0], faltas: 999 }, ...anos.slice(1)] },
          { ...entrada, vinculoId: semAdmissaoId },
          { ...entrada, inicio: '2000-01-01', fim: '2000-12-31', anos: [anos[20]] },
        ]) {
          const resposta = await requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: '/api/v1/calculos', corpo: invalida, ...analista,
          });
          expect(resposta.status, resposta.corpo).toBe(400);
        }
        const naoRelacionado = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: '/api/v1/calculos', corpo: { ...entrada, pessoaId: randomUUID() }, ...analista,
        });
        expect(naoRelacionado.status).toBe(404);
        const inicioAnterior = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: '/api/v1/calculos', corpo: { ...entrada, inicio: '1979-01-01' }, ...analista,
        });
        expect(inicioAnterior.status, inicioAnterior.corpo).toBe(200);
        expect(resultadoCalculoDofSchema.parse(JSON.parse(inicioAnterior.corpo)).avisos.map((aviso) => aviso.codigo))
          .toContain('inicio_ajustado_posse');
        const comAcumulado = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: '/api/v1/calculos',
          corpo: {
            ...entrada, inicio: '2000-01-01', fim: '2000-12-31', anos: [anos[20]],
            acumuladoAnterior: { ts: 0, pf: 0, origem: 'Conferência sintética' },
          },
          ...analista,
        });
        expect(comAcumulado.status, comAcumulado.corpo).toBe(200);
        const auditoria = await cliente.query<{ detalhes: unknown }>(`
          SELECT detalhes FROM seguranca.auditoria WHERE acao = 'calculo_solicitado' AND pessoa_id = $1
        `, [pessoaId]);
        expect(auditoria.rowCount).toBeGreaterThanOrEqual(7);
        expect(JSON.stringify(auditoria.rows)).not.toContain(cpf);
        const estadoDepois = await cliente.query(`
          SELECT (SELECT count(*) FROM documentos.documento) AS documentos,
                 (SELECT count(*) FROM documentos.emissao) AS emissoes,
                 (SELECT count(*) FROM nucleo.afastamento WHERE vinculo_id = $1) AS afastamentos,
                 (SELECT count(*) FROM nucleo.incorporacao WHERE vinculo_id = $1) AS incorporacoes,
                 (SELECT to_char(admissao, 'YYYY-MM-DD') FROM nucleo.vinculo WHERE id = $1) AS admissao
        `, [vinculoId]);
        expect(estadoDepois.rows).toEqual(estadoAntes.rows);

        const motivo = 'Conferência fictícia das ocorrências por ano';
        const admissaoEsperada = '1980-01-01';
        for (const papel of ['secretario_adjunto']) {
          const sessao = sessoes.get(papel);
          if (!sessao) throw new Error('Sessão sintética ausente.');
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: '/api/v1/documentos', corpo: { calculo: entrada, motivo, admissaoEsperada }, ...sessao,
          })).status).toBe(403);
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: '/api/v1/documentos', cookie: sessao.cookie,
          })).status).toBe(403);
        }
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: '/api/v1/documentos', corpo: { calculo: entrada, admissaoEsperada, motivo: ' ' }, ...analista,
        })).status).toBe(400);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: '/api/v1/documentos',
          corpo: { calculo: entrada, motivo, admissaoEsperada: '1979-01-01' }, ...analista,
        })).status).toBe(409);
        const criacao = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: '/api/v1/documentos', corpo: { calculo: entrada, motivo, admissaoEsperada }, ...analista,
        });
        expect(criacao.status, criacao.corpo).toBe(201);
        const rascunho = rascunhoDofSchema.parse(JSON.parse(criacao.corpo));
        expect(rascunho).toMatchObject({
          pessoaId, vinculoId, status: 'rascunho', revisao: 1,
          entrada: { inicio: '1980-01-01', fim: '2024-12-31' },
        });
        expect(rascunho.resultado.periodo.linhas).toHaveLength(45);
        expect(criacao.corpo).not.toContain(cpf);
        expect(criacao.corpo).not.toContain(motivo);
        const listagem = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: '/api/v1/documentos', cookie: analista.cookie,
        });
        expect(paginaRascunhosDofSchema.parse(JSON.parse(listagem.corpo)).itens.map((item) => item.id)).toContain(rascunho.id);
        const abertura = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `/api/v1/documentos/${rascunho.id}`, cookie: analista.cookie,
        });
        expect(abertura.status, abertura.corpo).toBe(200);
        expect(rascunhoDofSchema.parse(JSON.parse(abertura.corpo)).entrada.anos).toHaveLength(45);
        const coordenador = sessoes.get('coordenador');
        if (!coordenador) throw new Error('Sessão sintética de coordenador ausente.');
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `/api/v1/documentos/${rascunho.id}`, cookie: coordenador.cookie,
        })).status).toBe(404);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: `/api/v1/documentos/${rascunho.id}`,
          corpo: { calculo: entrada, motivo, admissaoEsperada, revisao: 1 }, ...coordenador,
        })).status).toBe(404);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `/api/v1/documentos/${rascunho.id}`, cookie: admin.cookie,
        })).status).toBe(200);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: `/api/v1/documentos/${rascunho.id}`,
          corpo: { calculo: entrada, motivo, admissaoEsperada, revisao: 1 }, cookie: analista.cookie,
        })).status).toBe(403);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: `/api/v1/documentos/${rascunho.id}`,
          corpo: { calculo: entrada, motivo, admissaoEsperada, revisao: 1, status: 'emitido' }, ...analista,
        })).status).toBe(400);

        const alterada = {
          ...entrada, anos: anos.map((item, indice) => indice === 1 ? { ...item, faltas: 2 } : item),
        };
        const fonteOcupada = new Client({
          host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
          user: 'sisdoc_migrador', password: senhaMigrador,
        });
        await fonteOcupada.connect();
        try {
          await fonteOcupada.query('BEGIN');
          await fonteOcupada.query("UPDATE nucleo.vinculo SET admissao = '1981-01-01' WHERE id = $1", [vinculoId]);
          const antes = await cliente.query<{ total: string }>('SELECT count(*) AS total FROM documentos.documento');
          const criacaoOcupada = await requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: '/api/v1/documentos', corpo: { calculo: entrada, motivo, admissaoEsperada }, ...analista,
          });
          expect(criacaoOcupada.status, criacaoOcupada.corpo).toBe(409);
          expect(criacaoOcupada.corpo).toContain('fonte está sendo atualizada');
          const edicaoOcupada = await requisitarApi(portaHttps, caPem, {
            metodo: 'PATCH', rota: `/api/v1/documentos/${rascunho.id}`,
            corpo: { calculo: alterada, admissaoEsperada, motivo: 'Correção sintética', revisao: 1 }, ...analista,
          });
          expect(edicaoOcupada.status, edicaoOcupada.corpo).toBe(409);
          expect(edicaoOcupada.corpo).toContain('fonte está sendo atualizada');
          const pessoaInexistente = await requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: '/api/v1/documentos',
            corpo: { calculo: { ...entrada, pessoaId: randomUUID(), vinculoId: randomUUID() }, motivo, admissaoEsperada },
            ...analista,
          });
          expect(pessoaInexistente.status, pessoaInexistente.corpo).toBe(409);
          expect((await cliente.query<{ total: string }>('SELECT count(*) AS total FROM documentos.documento')).rows)
            .toEqual(antes.rows);
          expect((await cliente.query('SELECT revisao FROM documentos.documento WHERE id = $1', [rascunho.id])).rows[0].revisao)
            .toBe(1);
        } finally {
          await fonteOcupada.query('ROLLBACK');
          await fonteOcupada.end();
        }

        async function verificarEscritaDuranteGravacao(
          tabela: 'documentos.documento' | 'documentos.documento_periodo',
          requisitarGravacao: () => ReturnType<typeof requisitarApi>,
        ) {
          const bloqueador = new Client({
            host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
            user: 'sisdoc_migrador', password: senhaMigrador,
          });
          const escritor = new Client({
            host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
            user: 'sisdoc_migrador', password: senhaMigrador,
          });
          await bloqueador.connect();
          await escritor.connect();
          let transacaoAberta = false;
          let pedido: ReturnType<typeof requisitarApi> | undefined;
          let escrita: Promise<unknown> | undefined;
          try {
            await bloqueador.query('BEGIN');
            transacaoAberta = true;
            await bloqueador.query(`LOCK TABLE ${tabela} IN SHARE MODE`);
            pedido = requisitarGravacao();
            void pedido.catch(() => {});
            await expect.poll(async () => {
              const locks = await cliente.query<{ quantidade: number }>(`
                SELECT count(*)::integer AS quantidade FROM pg_locks
                WHERE locktype = 'advisory' AND classid = $1::oid AND objid = $2::oid
                  AND objsubid = 2 AND mode = 'ShareLock' AND granted
              `, [...CHAVE_BLOQUEIO_FONTE_DOF]);
              return locks.rows[0].quantidade;
            }, { timeout: 3000, interval: 25 }).toBeGreaterThan(0);
            let escritaConcluida = false;
            escrita = escritor.query("UPDATE nucleo.vinculo SET admissao = '1981-01-01' WHERE id = $1", [vinculoId]);
            void escrita.then(() => { escritaConcluida = true; }, () => { escritaConcluida = true; });
            await delay(200);
            expect(escritaConcluida).toBe(false);
            await bloqueador.query('COMMIT');
            transacaoAberta = false;
            const resposta = await pedido;
            await escrita;
            return resposta;
          } finally {
            if (transacaoAberta) await bloqueador.query('ROLLBACK');
            await Promise.allSettled([...(pedido ? [pedido] : []), ...(escrita ? [escrita] : [])]);
            await escritor.query("UPDATE nucleo.vinculo SET admissao = '1980-01-01' WHERE id = $1", [vinculoId]);
            await bloqueador.end();
            await escritor.end();
          }
        }
        const criacaoConcorrente = await verificarEscritaDuranteGravacao('documentos.documento', () =>
          requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: '/api/v1/documentos', corpo: { calculo: entrada, motivo, admissaoEsperada }, ...analista,
          }));
        expect(criacaoConcorrente.status, criacaoConcorrente.corpo).toBe(201);
        const extraConcorrente = rascunhoDofSchema.parse(JSON.parse(criacaoConcorrente.corpo));
        expect(extraConcorrente.resultado.admissaoConsiderada).toBe('1980-01-01');
        const edicaoConcorrente = await verificarEscritaDuranteGravacao('documentos.documento_periodo', () =>
          requisitarApi(portaHttps, caPem, {
            metodo: 'PATCH', rota: `/api/v1/documentos/${extraConcorrente.id}`,
            corpo: { calculo: alterada, admissaoEsperada, motivo: 'Correção sintética', revisao: 1 }, ...analista,
          }));
        expect(edicaoConcorrente.status, edicaoConcorrente.corpo).toBe(200);
        expect(rascunhoDofSchema.parse(JSON.parse(edicaoConcorrente.corpo))).toMatchObject({
          revisao: 2, admissao: '1980-01-01', resultado: { admissaoConsiderada: '1980-01-01' },
        });
        const auditoriaFonte = await cliente.query<{ entidade: string; pessoa_id: string | null }>(`
          SELECT entidade, pessoa_id FROM seguranca.auditoria WHERE acao = 'rascunho_fonte_ocupada'
        `);
        expect(auditoriaFonte.rows).toEqual(expect.arrayContaining([
          { entidade: 'documento', pessoa_id: pessoaId },
          { entidade: 'vinculo', pessoa_id: null },
        ]));

        const edicao = await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: `/api/v1/documentos/${rascunho.id}`,
          corpo: { calculo: alterada, admissaoEsperada, motivo: 'Correção sintética', revisao: 1 }, ...analista,
        });
        expect(edicao.status, edicao.corpo).toBe(200);
        const revisado = rascunhoDofSchema.parse(JSON.parse(edicao.corpo));
        expect(revisado.revisao).toBe(2);
        expect(revisado.resultado.totais.contribuicaoMunicipio).toBe(16435);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: `/api/v1/documentos/${rascunho.id}`,
          corpo: { calculo: entrada, motivo, admissaoEsperada, revisao: 1 }, ...analista,
        })).status).toBe(409);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: `/api/v1/documentos/${rascunho.id}`,
          corpo: { calculo: { ...alterada, vinculoId: semAdmissaoId }, motivo, admissaoEsperada, revisao: 2 }, ...analista,
        })).status).toBe(400);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: `/api/v1/documentos/${rascunho.id}`,
          corpo: { calculo: entrada, motivo, admissaoEsperada: '1979-01-01', revisao: 2 }, ...analista,
        })).status).toBe(409);
        await cliente.query("UPDATE nucleo.vinculo SET admissao = '1981-01-01' WHERE id = $1", [vinculoId]);
        try {
          const fonteAlterada = await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: `/api/v1/documentos/${rascunho.id}`, cookie: analista.cookie,
          });
          const abertoComFonteAlterada = rascunhoDofSchema.parse(JSON.parse(fonteAlterada.corpo));
          expect(abertoComFonteAlterada.admissao).toBe('1981-01-01');
          expect(abertoComFonteAlterada.resultado.admissaoConsiderada).toBe('1980-01-01');
          const conflitoAdmissao = await requisitarApi(portaHttps, caPem, {
            metodo: 'PATCH', rota: `/api/v1/documentos/${rascunho.id}`,
            corpo: { calculo: entrada, motivo, admissaoEsperada, revisao: 2 }, ...analista,
          });
          expect(conflitoAdmissao.status, conflitoAdmissao.corpo).toBe(409);
        } finally {
          await cliente.query("UPDATE nucleo.vinculo SET admissao = '1980-01-01' WHERE id = $1", [vinculoId]);
        }
        const entradaPosterior = {
          ...entrada, inicio: '2000-01-01', fim: '2000-12-31', anos: [anos[20]],
          acumuladoAnterior: { ts: 0, pf: 0, origem: 'Conferência sintética' },
        };
        const criadoPosterior = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: '/api/v1/documentos',
          corpo: { calculo: entradaPosterior, motivo, admissaoEsperada }, ...analista,
        });
        expect(criadoPosterior.status, criadoPosterior.corpo).toBe(201);
        const rascunhoPosterior = rascunhoDofSchema.parse(JSON.parse(criadoPosterior.corpo));
        await cliente.query("UPDATE nucleo.vinculo SET admissao = '1981-01-01' WHERE id = $1", [vinculoId]);
        try {
          const atualizacaoAdmissao = await requisitarApi(portaHttps, caPem, {
            metodo: 'PATCH', rota: `/api/v1/documentos/${rascunhoPosterior.id}`,
            corpo: {
              calculo: entradaPosterior, motivo: 'Revisão da admissão fictícia',
              admissaoEsperada: '1981-01-01', revisao: 1,
            },
            ...analista,
          });
          expect(atualizacaoAdmissao.status, atualizacaoAdmissao.corpo).toBe(200);
          const atualizado = rascunhoDofSchema.parse(JSON.parse(atualizacaoAdmissao.corpo));
          expect(atualizado.revisao).toBe(2);
          expect(atualizado.resultado.admissaoConsiderada).toBe('1981-01-01');
          const ajusteAdmissao = await cliente.query<{ valor_original_cifrado: Buffer; valor_novo_cifrado: Buffer }>(`
            SELECT valor_original_cifrado, valor_novo_cifrado FROM documentos.ajuste_campo
            WHERE documento_id = $1 AND campo = 'admissao_considerada'
          `, [rascunhoPosterior.id]);
          expect(ajusteAdmissao.rowCount).toBe(1);
          expect(ajusteAdmissao.rows[0].valor_original_cifrado.includes(Buffer.from('1980-01-01'))).toBe(false);
          expect(ajusteAdmissao.rows[0].valor_novo_cifrado.includes(Buffer.from('1981-01-01'))).toBe(false);
        } finally {
          await cliente.query("UPDATE nucleo.vinculo SET admissao = '1980-01-01' WHERE id = $1", [vinculoId]);
        }
        const simultaneas = await Promise.all([3, 4].map((faltas) => requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: `/api/v1/documentos/${rascunho.id}`,
          corpo: {
            calculo: { ...entrada, anos: anos.map((item, indice) => indice === 1 ? { ...item, faltas } : item) },
            motivo: 'Concorrência sintética', admissaoEsperada, revisao: 2,
          },
          ...analista,
        })));
        expect(simultaneas.map((resposta) => resposta.status).sort()).toEqual([200, 409]);
        const persistido = await cliente.query<{
          status: string; revisao: number; entrada_cifrada: Buffer; resultado_calculo_cifrado: Buffer;
        }>(`
          SELECT status, revisao, entrada_cifrada, resultado_calculo_cifrado
          FROM documentos.documento WHERE id = $1
        `, [rascunho.id]);
        expect(persistido.rows[0]).toMatchObject({ status: 'rascunho', revisao: 3 });
        expect(persistido.rows[0].entrada_cifrada.includes(Buffer.from('faltas'))).toBe(false);
        expect(persistido.rows[0].resultado_calculo_cifrado.includes(Buffer.from('contribuicaoMunicipio'))).toBe(false);
        const ajustes = await cliente.query<{ id: string; campo: string; motivo_cifrado: Buffer }>(`
          SELECT id, campo, motivo_cifrado FROM documentos.ajuste_campo WHERE documento_id = $1
        `, [rascunho.id]);
        expect(ajustes.rows.filter((item) => item.campo.startsWith('anos.'))).toHaveLength(47);
        const ajusteInicial = ajustes.rows.find((item) => item.campo === 'periodo.inicio');
        if (!ajusteInicial) throw new Error('Ajuste inicial sintético ausente.');
        expect(ajusteInicial.motivo_cifrado.includes(Buffer.from(motivo))).toBe(false);
        const motivoDecifrado = protetor.decifrar(ajusteInicial.motivo_cifrado, {
          schema: 'documentos', tabela: 'ajuste_campo', registroId: ajusteInicial.id, campo: 'motivo_cifrado',
        }).toString('utf8');
        expect(JSON.parse(motivoDecifrado)).toBe(motivo);
        expect((await cliente.query('SELECT count(*) FROM documentos.emissao')).rows[0].count)
          .toBe(estadoAntes.rows[0].emissoes);

        const ultimo = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `/api/v1/documentos/${rascunho.id}`, cookie: analista.cookie,
        });
        const antesDaReducao = rascunhoDofSchema.parse(JSON.parse(ultimo.corpo));
        const reduzida = {
          ...antesDaReducao.entrada, fim: '2023-12-31',
          anos: antesDaReducao.entrada.anos.filter((ano) => ano.ano !== 2024),
        };
        for (const confirmados of [undefined, [2023]]) {
          const semConfirmacao = await requisitarApi(portaHttps, caPem, {
            metodo: 'PATCH', rota: `/api/v1/documentos/${rascunho.id}`,
            corpo: {
              calculo: reduzida, motivo: 'Redução fictícia do intervalo', admissaoEsperada,
              revisao: 3, ...(confirmados ? { anosRemovidosConfirmados: confirmados } : {}),
            },
            ...analista,
          });
          expect(semConfirmacao.status, semConfirmacao.corpo).toBe(400);
        }
        const reducao = await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: `/api/v1/documentos/${rascunho.id}`,
          corpo: {
            calculo: reduzida, motivo: 'Redução fictícia do intervalo', admissaoEsperada,
            revisao: 3, anosRemovidosConfirmados: [2024],
          },
          ...analista,
        });
        expect(reducao.status, reducao.corpo).toBe(200);
        const rascunhoAtual = rascunhoDofSchema.parse(JSON.parse(reducao.corpo));
        expect(rascunhoAtual.revisao).toBe(4);
        expect(rascunhoAtual.entrada.anos).toHaveLength(44);
        const anoRemovido = await cliente.query<{
          id: string; valor_original_cifrado: Buffer; valor_novo_cifrado: Buffer;
        }>(`
          SELECT id, valor_original_cifrado, valor_novo_cifrado FROM documentos.ajuste_campo
          WHERE documento_id = $1 AND campo = 'anos.2024' AND valor_original_cifrado IS NOT NULL
        `, [rascunho.id]);
        expect(anoRemovido.rowCount).toBe(1);
        const registroRemovido = anoRemovido.rows[0];
        const decifrarAjuste = (campo: string, valor: Buffer): unknown => JSON.parse(protetor.decifrar(valor, {
          schema: 'documentos', tabela: 'ajuste_campo', registroId: registroRemovido.id, campo,
        }).toString('utf8'));
        expect(decifrarAjuste('valor_original_cifrado', registroRemovido.valor_original_cifrado))
          .toEqual(antesDaReducao.entrada.anos.find((ano) => ano.ano === 2024));
        expect(decifrarAjuste('valor_novo_cifrado', registroRemovido.valor_novo_cifrado)).toBeNull();
        const periodoReduzido = await cliente.query<{ fim: string }>(`
          SELECT to_char(fim, 'YYYY-MM-DD') AS fim FROM documentos.documento_periodo WHERE documento_id = $1
        `, [rascunho.id]);
        expect(periodoReduzido.rows).toEqual([{ fim: '2023-12-31' }]);
        const regraAntigaId = randomUUID();
        const versaoAntiga = `anterior-ficticia-${randomUUID()}`;
        await cliente.query(`
          INSERT INTO documentos.regra_versao (id, codigo, versao, configuracao, evidencia, vigente_de)
          SELECT $1, r.codigo, $2, r.configuracao, r.evidencia, r.vigente_de
          FROM documentos.regra_versao r
          JOIN documentos.documento d ON d.regra_versao_id = r.id WHERE d.id = $3
        `, [regraAntigaId, versaoAntiga, rascunho.id]);
        const resultadoAntigo = {
          ...rascunhoAtual.resultado,
          regra: { ...rascunhoAtual.resultado.regra, versao: versaoAntiga },
        };
        const resultadoCifrado = protetor.cifrar(Buffer.from(JSON.stringify(resultadoAntigo)), {
          schema: 'documentos', tabela: 'documento', registroId: rascunho.id, campo: 'resultado_calculo_cifrado',
        });
        await cliente.query(
          'UPDATE documentos.documento SET regra_versao_id = $1, resultado_calculo_cifrado = $2 WHERE id = $3',
          [regraAntigaId, resultadoCifrado, rascunho.id],
        );
        const aberturaAntiga = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `/api/v1/documentos/${rascunho.id}`, cookie: analista.cookie,
        });
        expect(rascunhoDofSchema.parse(JSON.parse(aberturaAntiga.corpo)).resultado.regra.versao).toBe(versaoAntiga);
        const edicaoRegraAntiga = await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: `/api/v1/documentos/${rascunho.id}`,
          corpo: { calculo: alterada, motivo, admissaoEsperada, revisao: 4 }, ...analista,
        });
        expect(edicaoRegraAntiga.status, edicaoRegraAntiga.corpo).toBe(409);
        expect(edicaoRegraAntiga.corpo).toContain('versão de regra');
        const aposBloqueio = await cliente.query<{
          revisao: number; regra_versao_id: string; resultado_calculo_cifrado: Buffer;
        }>('SELECT revisao, regra_versao_id, resultado_calculo_cifrado FROM documentos.documento WHERE id = $1', [rascunho.id]);
        expect(aposBloqueio.rows[0]).toMatchObject({
          revisao: 4, regra_versao_id: regraAntigaId, resultado_calculo_cifrado: resultadoCifrado,
        });
        const acoes = await cliente.query<{ acao: string }>(
          'SELECT acao FROM seguranca.auditoria WHERE entidade_id = $1',
          [rascunho.id],
        );
        expect(acoes.rows.map((item) => item.acao)).toEqual(expect.arrayContaining([
          'rascunho_criado', 'rascunho_aberto', 'rascunho_editado', 'rascunho_conflito',
          'rascunho_regra_incompativel', 'rascunho_admissao_alterada',
        ]));

        const criacaoBlocos = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: '/api/v1/documentos', corpo: { calculo: entrada, motivo, admissaoEsperada }, ...analista,
        });
        expect(criacaoBlocos.status, criacaoBlocos.corpo).toBe(201);
        const rascunhoBlocos = rascunhoDofSchema.parse(JSON.parse(criacaoBlocos.corpo));
        expect(rascunhoBlocos.blocos).toEqual([]);
        const rotaBlocos = `/api/v1/documentos/${rascunhoBlocos.id}/blocos`;
        const rotaPrevia = `/api/v1/documentos/${rascunhoBlocos.id}/previa`;
        const rotaDadosPrevia = `/api/v1/documentos/${rascunhoBlocos.id}/dados-previa`;
        const nomeMaePrevia = 'Mãe fictícia <script>não executar</script>';
        const cifraMaePrevia = protetor.cifrar(Buffer.from(nomeMaePrevia, 'utf8'), {
          schema: 'nucleo', tabela: 'pessoa', registroId: pessoaId, campo: 'nome_mae_cifrado',
        });
        await cliente.query("UPDATE nucleo.pessoa SET nascimento = '1960-05-04', nome_mae_cifrado = $1 WHERE id = $2",
          [cifraMaePrevia, pessoaId]);
        await cliente.query(`
          UPDATE nucleo.vinculo SET regime_juridico = 'Regime fictício', cargo = 'Cargo <b>fictício</b>',
            referencia = 'UNICA', orgao_nome = 'Órgão & fictício' WHERE id = $1
        `, [vinculoId]);
        const primeiroBloco = { id: randomUUID(), codigo: 'contratacao', ativo: true, texto: 'Texto contratual fictício' };
        const segundoBloco = {
          id: randomUUID(), codigo: 'progressao', ativo: true,
          texto: '<script>window.top.intrusao=1</script> {{nome}} {{cpf}} {{nascimento}} {{nome_mae}} '
            + '{{regime_juridico}} {{cargo}} {{referencia}} {{orgao}}',
        };
        const motivoBlocos = 'Motivo sintético dos blocos';
        const proposta = { revisao: 1, motivo: motivoBlocos, blocos: [primeiroBloco, segundoBloco] };
        expect((await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota: rotaPrevia })).status).toBe(401);
        expect((await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota: rotaDadosPrevia })).status).toBe(401);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: rotaPrevia, cookie: coordenador.cookie,
        })).status).toBe(404);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: rotaDadosPrevia, cookie: coordenador.cookie,
        })).status).toBe(404);
        for (const papel of ['secretario_adjunto']) {
          const sessao = sessoes.get(papel);
          if (!sessao) throw new Error('Sessão sintética ausente.');
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: rotaPrevia, cookie: sessao.cookie,
          })).status).toBe(403);
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: rotaDadosPrevia, cookie: sessao.cookie,
          })).status).toBe(403);
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'PATCH', rota: rotaBlocos, corpo: proposta, ...sessao,
          })).status).toBe(403);
        }
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: rotaBlocos, corpo: proposta, cookie: analista.cookie,
        })).status).toBe(403);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: rotaBlocos, corpo: proposta, ...analista, origem: 'https://origem-invalida.local',
        })).status).toBe(403);
        for (const invalido of [
          { ...proposta, motivo: ' ' },
          { ...proposta, blocos: [primeiroBloco, primeiroBloco] },
          { ...proposta, blocos: [{ ...primeiroBloco, texto: 'inválido\u0000' }] },
          { ...proposta, status: 'emitido' },
        ]) {
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'PATCH', rota: rotaBlocos, corpo: invalido, ...analista,
          })).status).toBe(400);
        }
        const blocosCriados = await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: rotaBlocos, corpo: proposta, ...analista,
        });
        expect(blocosCriados.status, blocosCriados.corpo).toBe(200);
        const comBlocos = rascunhoDofSchema.parse(JSON.parse(blocosCriados.corpo));
        expect(comBlocos.revisao).toBe(2);
        expect(comBlocos.blocos).toEqual([primeiroBloco, segundoBloco]);
        const protegidos = await cliente.query<{ id: string; texto_final_cifrado: Buffer }>(`
          SELECT id, texto_final_cifrado FROM documentos.documento_bloco WHERE documento_id = $1 ORDER BY ordem
        `, [rascunhoBlocos.id]);
        expect(protegidos.rows).toHaveLength(2);
        for (const [indice, protegido] of protegidos.rows.entries()) {
          const esperado = proposta.blocos[indice];
          expect(protegido.texto_final_cifrado.includes(Buffer.from(esperado.texto))).toBe(false);
          expect(JSON.parse(protetor.decifrar(protegido.texto_final_cifrado, {
            schema: 'documentos', tabela: 'documento_bloco', registroId: protegido.id, campo: 'texto_final_cifrado',
          }).toString('utf8'))).toBe(esperado.texto);
        }
        const ajustesBlocos = await cliente.query<{
          id: string; campo: string; valor_novo_cifrado: Buffer; motivo_cifrado: Buffer;
        }>(`
          SELECT id, campo, valor_novo_cifrado, motivo_cifrado FROM documentos.ajuste_campo
          WHERE documento_id = $1 AND campo LIKE 'blocos.%'
        `, [rascunhoBlocos.id]);
        expect(ajustesBlocos.rows).toHaveLength(2);
        for (const ajuste of ajustesBlocos.rows) {
          expect(ajuste.motivo_cifrado.includes(Buffer.from(motivoBlocos))).toBe(false);
          expect(ajuste.valor_novo_cifrado.includes(Buffer.from('texto'))).toBe(false);
          expect(JSON.parse(protetor.decifrar(ajuste.motivo_cifrado, {
            schema: 'documentos', tabela: 'ajuste_campo', registroId: ajuste.id, campo: 'motivo_cifrado',
          }).toString('utf8'))).toBe(motivoBlocos);
        }
        const reordenados = [segundoBloco, { ...primeiroBloco, ativo: false }];
        const reordenacao = await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: rotaBlocos, corpo: { revisao: 2, motivo: motivoBlocos, blocos: reordenados }, ...analista,
        });
        expect(reordenacao.status, reordenacao.corpo).toBe(200);
        expect(rascunhoDofSchema.parse(JSON.parse(reordenacao.corpo))).toMatchObject({ revisao: 3, blocos: reordenados });
        for (const invalido of [
          { revisao: 3, motivo: motivoBlocos, blocos: [segundoBloco] },
          { revisao: 3, motivo: motivoBlocos, blocos: [{ ...segundoBloco, codigo: 'complementares' }, reordenados[1]] },
        ]) {
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'PATCH', rota: rotaBlocos, corpo: invalido, ...analista,
          })).status).toBe(400);
        }
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: rotaBlocos, corpo: { ...proposta, revisao: 2 }, ...analista,
        })).status).toBe(409);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: rotaBlocos, corpo: { revisao: 3, motivo: motivoBlocos, blocos: reordenados }, ...analista,
        })).status).toBe(409);
        const lotacao = {
          revisao: 999, motivo: '界'.repeat(2000),
          blocos: Array.from({ length: 200 }, (_, indice) => ({
            id: randomUUID(), codigo: 'complementares', ativo: true,
            texto: '界'.repeat(indice === 0 || indice === 1 ? 7000 : indice === 2 ? 6000 : 0),
          })),
        };
        expect(Buffer.byteLength(JSON.stringify(lotacao), 'utf8')).toBeLessThan(100 * 1024);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: rotaBlocos, corpo: lotacao, ...analista,
        })).status).toBe(409);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: `/api/v1/documentos/${rascunhoPosterior.id}/blocos`,
          corpo: { revisao: 2, motivo: motivoBlocos, blocos: [primeiroBloco] }, ...analista,
        })).status).toBe(409);
        const inicioPrevia = performance.now();
        const previa = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: rotaPrevia, cookie: analista.cookie,
        });
        const duracaoPrevia = performance.now() - inicioPrevia;
        expect(duracaoPrevia).toBeLessThan(1000);
        process.stdout.write(`Prévia sintética HTTPS de 45 anos: abertura em ${duracaoPrevia.toFixed(1)} ms.\n`);
        expect(previa.status, previa.corpo).toBe(200);
        expect(previa.headers['content-type']).toContain('text/html');
        expect(previa.headers['content-security-policy']).toContain("default-src 'none'");
        expect(previa.headers['content-security-policy']).toContain("frame-ancestors 'self'");
        expect(previa.headers['content-security-policy']).toContain('sandbox');
        expect(previa.headers['cache-control']).toBe('no-store');
        expect(previa.headers['x-sisdoc-revisao']).toBe('3');
        expect(previa.corpo).toContain('PRÉVIA PROVISÓRIA — SEM VALIDADE OFICIAL');
        expect(previa.corpo).toContain('&lt;script&gt;window.top.intrusao=1&lt;/script&gt;');
        expect(previa.corpo).toContain('Pessoa DOF fictícia');
        expect(previa.corpo).toContain('Mãe fictícia &lt;script&gt;não executar&lt;/script&gt;');
        expect(previa.corpo).toContain('Cargo &lt;b&gt;fictício&lt;/b&gt;');
        expect(previa.corpo).toContain('Órgão &amp; fictício');
        expect(previa.corpo).toContain('04/05/1960');
        expect(previa.corpo).toContain(cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4'));
        expect(previa.corpo).toContain('Referência sem hífen; confira o nível.');
        expect(previa.corpo).not.toContain('Variável não disponível: cargo');
        expect(previa.corpo).not.toContain('<script>');
        expect(previa.corpo).not.toContain(primeiroBloco.texto);
        expect(previa.corpo.match(/<tr>/g)).toHaveLength(46);

        const dadosPrevia = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: rotaDadosPrevia, cookie: analista.cookie,
        });
        expect(dadosPrevia.status, dadosPrevia.corpo).toBe(200);
        expect(dadosPrevia.headers['cache-control']).toBe('no-store');
        expect(dadosPrevia.headers['content-type']).toContain('application/json');
        expect(dadosFontePreviaDofSchema.parse(JSON.parse(dadosPrevia.corpo))).toMatchObject({
          documentoId: rascunhoBlocos.id, revisao: 3, cpf, nascimento: '1960-05-04',
          nomeMae: nomeMaePrevia, cargo: 'Cargo <b>fictício</b>', nivel: null,
          avisoNivel: 'Referência sem hífen; confira o nível.', admissao: '1980-01-01',
        });
        const pendenciasPrevia = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `/api/v1/documentos/${rascunhoBlocos.id}/preconferencia`, cookie: analista.cookie,
        });
        expect(pendenciasPrevia.status, pendenciasPrevia.corpo).toBe(200);
        const relatorioPrevia = preconferenciaDofSchema.parse(JSON.parse(pendenciasPrevia.corpo));
        expect(relatorioPrevia.bloqueios.map((item) => item.codigo)).not.toContain('variaveis_ausentes');
        expect(relatorioPrevia.avisos.map((item) => item.codigo)).toContain('nivel_referencia');
        expect(pendenciasPrevia.corpo).not.toContain(nomeMaePrevia);
        expect(pendenciasPrevia.corpo).not.toContain(cpf);
        try {
          await cliente.query('UPDATE nucleo.pessoa SET nome_mae_cifrado = $1 WHERE id = $2', [Buffer.from('corrompido'), pessoaId]);
          for (const rota of [rotaPrevia, rotaDadosPrevia]) {
            const identidadeInvalida = await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota, cookie: analista.cookie });
            expect(identidadeInvalida.status, identidadeInvalida.corpo).toBe(409);
            expect(identidadeInvalida.corpo).toContain('identidade protegida');
            expect(identidadeInvalida.corpo).not.toContain(cpf);
            expect(identidadeInvalida.corpo).not.toContain(nomeMaePrevia);
          }
        } finally {
          await cliente.query('UPDATE nucleo.pessoa SET nome_mae_cifrado = $1 WHERE id = $2', [cifraMaePrevia, pessoaId]);
        }
        const escritorPrevia = new Client({
          host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
          user: 'sisdoc_migrador', password: senhaMigrador,
        });
        await escritorPrevia.connect();
        try {
          await escritorPrevia.query('BEGIN');
          await escritorPrevia.query('UPDATE nucleo.vinculo SET cargo = cargo WHERE id = $1', [vinculoId]);
          for (const rota of [rotaPrevia, rotaDadosPrevia]) {
            const ocupada = await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota, cookie: analista.cookie });
            expect(ocupada.status, ocupada.corpo).toBe(409);
            expect(ocupada.corpo).toContain('fonte está sendo atualizada');
          }
        } finally {
          await escritorPrevia.query('ROLLBACK');
          await escritorPrevia.end();
        }

        const concorrentes = await Promise.all(['A', 'B'].map((valor) => requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: rotaBlocos,
          corpo: {
            revisao: 3, motivo: motivoBlocos,
            blocos: [{ ...segundoBloco, texto: `Alteração concorrente ${valor}` }, reordenados[1]],
          },
          ...analista,
        })));
        expect(concorrentes.map((resposta) => resposta.status).sort()).toEqual([200, 409]);
        const abertoBlocos = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `/api/v1/documentos/${rascunhoBlocos.id}`, cookie: analista.cookie,
        });
        const aposConcorrencia = rascunhoDofSchema.parse(JSON.parse(abertoBlocos.corpo));
        expect(aposConcorrencia.revisao).toBe(4);
        expect(aposConcorrencia.blocos[0].texto).toMatch(/^Alteração concorrente [AB]$/);
        const bloqueador = new Client({
          host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
          user: 'sisdoc_migrador', password: senhaMigrador,
        });
        await bloqueador.connect();
        let confirmado = false;
        try {
          await bloqueador.query('BEGIN');
          await bloqueador.query('SELECT id FROM documentos.documento WHERE id = $1 FOR UPDATE', [rascunhoBlocos.id]);
          let leituraFinalizada = false;
          const leituraBloqueada = requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: rotaPrevia, cookie: analista.cookie,
          });
          void leituraBloqueada.then(() => { leituraFinalizada = true; }, () => { leituraFinalizada = true; });
          await delay(200);
          expect(leituraFinalizada).toBe(false);
          const textoConcorrente = 'Conteúdo sintético da revisão cinco';
          const textoProtegido = protetor.cifrar(Buffer.from(JSON.stringify(textoConcorrente)), {
            schema: 'documentos', tabela: 'documento_bloco', registroId: segundoBloco.id, campo: 'texto_final_cifrado',
          });
          await bloqueador.query('UPDATE documentos.documento_bloco SET texto_final_cifrado = $1 WHERE id = $2', [
            textoProtegido, segundoBloco.id,
          ]);
          await bloqueador.query('UPDATE documentos.documento SET revisao = 5 WHERE id = $1', [rascunhoBlocos.id]);
          await bloqueador.query("UPDATE nucleo.vinculo SET cargo = 'Cargo atualizado após espera' WHERE id = $1", [vinculoId]);
          await bloqueador.query('COMMIT');
          confirmado = true;
          const leituraCoerente = await leituraBloqueada;
          expect(leituraCoerente.status, leituraCoerente.corpo).toBe(200);
          expect(leituraCoerente.headers['x-sisdoc-revisao']).toBe('5');
          expect(leituraCoerente.corpo).toContain(textoConcorrente);
          expect(leituraCoerente.corpo).toContain('Cargo atualizado após espera');
        } finally {
          if (!confirmado) await bloqueador.query('ROLLBACK');
          await bloqueador.end();
        }
        const eventosBlocos = await cliente.query<{ acao: string; detalhes: unknown }>(`
          SELECT acao, detalhes FROM seguranca.auditoria WHERE entidade_id = $1
        `, [rascunhoBlocos.id]);
        expect(eventosBlocos.rows.map((evento) => evento.acao)).toEqual(expect.arrayContaining([
          'rascunho_blocos_editados', 'previa_dof_aberta', 'rascunho_conflito',
          'previa_identidade_invalida', 'previa_fonte_ocupada',
        ]));
        expect(JSON.stringify(eventosBlocos.rows)).not.toContain(motivoBlocos);
        expect(JSON.stringify(eventosBlocos.rows)).not.toContain(segundoBloco.texto);
        expect(JSON.stringify(eventosBlocos.rows)).not.toContain(nomeMaePrevia);
        expect(JSON.stringify(eventosBlocos.rows)).not.toContain(cpf);

        const rotaProcesso = `/api/v1/documentos/${rascunhoBlocos.id}/processo`;
        const pedidoProcesso = { revisao: 5, processo: '1234/5678', motivo: 'Processo fictício informado' };
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: rotaProcesso, corpo: pedidoProcesso, cookie: analista.cookie,
        })).status).toBe(403);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: rotaProcesso, corpo: pedidoProcesso, ...coordenador,
        })).status).toBe(404);
        for (const papel of ['secretario_adjunto']) {
          const sessao = sessoes.get(papel);
          if (!sessao) throw new Error('Sessão sintética ausente.');
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'PATCH', rota: rotaProcesso, corpo: pedidoProcesso, ...sessao,
          })).status).toBe(403);
        }
        for (const invalido of [
          { ...pedidoProcesso, processo: '12345678' },
          { ...pedidoProcesso, processo: '<script>' },
          { ...pedidoProcesso, motivo: ' ' },
          { ...pedidoProcesso, processo: '1234/5678', status: 'conferido' },
        ]) {
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'PATCH', rota: rotaProcesso, corpo: invalido, ...analista,
          })).status).toBe(400);
        }
        const salvoProcesso = await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: rotaProcesso, corpo: pedidoProcesso, ...analista,
        });
        expect(salvoProcesso.status, salvoProcesso.corpo).toBe(200);
        const documentoComProcesso = rascunhoDofSchema.parse(JSON.parse(salvoProcesso.corpo));
        expect(documentoComProcesso).toMatchObject({
          revisao: 6, processo: '1234/5678', mascarasProcesso: ['####/####'],
        });
        const protegidoProcesso = await cliente.query<{
          processo_cifrado: Buffer; processo_numero: string | null;
        }>('SELECT processo_cifrado, processo_numero FROM documentos.documento WHERE id = $1', [rascunhoBlocos.id]);
        expect(protegidoProcesso.rows[0].processo_numero).toBeNull();
        expect(protegidoProcesso.rows[0].processo_cifrado.includes(Buffer.from(pedidoProcesso.processo))).toBe(false);
        expect(JSON.parse(protetor.decifrar(protegidoProcesso.rows[0].processo_cifrado, {
          schema: 'documentos', tabela: 'documento', registroId: rascunhoBlocos.id, campo: 'processo_cifrado',
        }).toString('utf8'))).toBe(pedidoProcesso.processo);
        const ajusteProcesso = await cliente.query<{ id: string; valor_novo_cifrado: Buffer; motivo_cifrado: Buffer }>(`
          SELECT id, valor_novo_cifrado, motivo_cifrado FROM documentos.ajuste_campo
          WHERE documento_id = $1 AND campo = 'processo'
        `, [rascunhoBlocos.id]);
        expect(ajusteProcesso.rows).toHaveLength(1);
        expect(ajusteProcesso.rows[0].valor_novo_cifrado.includes(Buffer.from(pedidoProcesso.processo))).toBe(false);
        expect(ajusteProcesso.rows[0].motivo_cifrado.includes(Buffer.from(pedidoProcesso.motivo))).toBe(false);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: rotaProcesso, corpo: pedidoProcesso, ...analista,
        })).status).toBe(409);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: rotaProcesso, corpo: { ...pedidoProcesso, revisao: 6 }, ...analista,
        })).status).toBe(409);
        const previaComProcesso = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: rotaPrevia, cookie: analista.cookie,
        });
        expect(previaComProcesso.corpo).toContain(`Processo: ${pedidoProcesso.processo}.`);
        const alteracoesProcesso = await Promise.all(['1111/1111', '2222/2222'].map((processo) =>
          requisitarApi(portaHttps, caPem, {
            metodo: 'PATCH', rota: rotaProcesso, corpo: { revisao: 6, processo, motivo: pedidoProcesso.motivo }, ...analista,
          })));
        expect(alteracoesProcesso.map((resposta) => resposta.status).sort()).toEqual([200, 409]);
        const eventosProcesso = await cliente.query<{ acao: string; detalhes: unknown }>(`
          SELECT acao, detalhes FROM seguranca.auditoria WHERE entidade_id = $1 AND acao = 'rascunho_processo_editado'
        `, [rascunhoBlocos.id]);
        expect(eventosProcesso.rows).toHaveLength(2);
        expect(JSON.stringify(eventosProcesso.rows)).not.toContain(pedidoProcesso.processo);
        const portaSemMascara = await portaLivre();
        const arquivoSemMascara = path.join(temporario, 'config-sem-mascara-ficticia.json');
        await writeFile(arquivoSemMascara, JSON.stringify({ ...config, porta: portaSemMascara, processos: undefined }));
        const encerrarSemMascara = await iniciarServico(portaSemMascara, caPem, arquivoSemMascara);
        try {
          const loginSemMascara = await requisitarApi(portaSemMascara, caPem, {
            metodo: 'POST', rota: '/api/v1/auth/login',
            corpo: { matricula: 'CALCULO-ANALISTA-FICTICIO', senha },
          });
          expect(loginSemMascara.status, loginSemMascara.corpo).toBe(200);
          const sessaoSemMascara = respostaSessaoSchema.parse(JSON.parse(loginSemMascara.corpo));
          const cookieSemMascara = loginSemMascara.headers['set-cookie']?.[0].split(';')[0];
          if (!cookieSemMascara) throw new Error('Cookie da sessão sintética sem máscara ausente.');
          const semMascara = await requisitarApi(portaSemMascara, caPem, {
            metodo: 'PATCH', rota: rotaProcesso,
            corpo: { revisao: 7, processo: '3333/3333', motivo: pedidoProcesso.motivo },
            cookie: cookieSemMascara, csrf: sessaoSemMascara.csrf,
          });
          expect(semMascara.status, semMascara.corpo).toBe(503);
          expect(semMascara.corpo).toContain('Nenhuma máscara de processo foi configurada');
          const remocaoSemConfirmacao = await requisitarApi(portaSemMascara, caPem, {
            metodo: 'PATCH', rota: rotaProcesso,
            corpo: { revisao: 7, processo: null, motivo: 'Remoção fictícia' },
            cookie: cookieSemMascara, csrf: sessaoSemMascara.csrf,
          });
          expect(remocaoSemConfirmacao.status).toBe(400);
          const remocao = await requisitarApi(portaSemMascara, caPem, {
            metodo: 'PATCH', rota: rotaProcesso,
            corpo: { revisao: 7, processo: null, motivo: 'Remoção fictícia', confirmarRemocao: true },
            cookie: cookieSemMascara, csrf: sessaoSemMascara.csrf,
          });
          expect(remocao.status, remocao.corpo).toBe(200);
          expect(rascunhoDofSchema.parse(JSON.parse(remocao.corpo))).toMatchObject({
            revisao: 8, processo: null, mascarasProcesso: [],
          });
          const ultimoAjuste = await cliente.query<{
            id: string; valor_original_cifrado: Buffer; valor_novo_cifrado: Buffer;
          }>(`
            SELECT id, valor_original_cifrado, valor_novo_cifrado FROM documentos.ajuste_campo
            WHERE documento_id = $1 AND campo = 'processo' ORDER BY em DESC, id DESC LIMIT 1
          `, [rascunhoBlocos.id]);
          const ajusteRemocao = ultimoAjuste.rows[0];
          expect(JSON.parse(protetor.decifrar(ajusteRemocao.valor_novo_cifrado, {
            schema: 'documentos', tabela: 'ajuste_campo', registroId: ajusteRemocao.id, campo: 'valor_novo_cifrado',
          }).toString('utf8'))).toBeNull();
          expect(JSON.parse(protetor.decifrar(ajusteRemocao.valor_original_cifrado, {
            schema: 'documentos', tabela: 'ajuste_campo', registroId: ajusteRemocao.id, campo: 'valor_original_cifrado',
          }).toString('utf8'))).toMatch(/^(1111\/1111|2222\/2222)$/);
        } finally {
          await encerrarSemMascara();
        }
        await cliente.query('BEGIN');
        try {
          const autor = await cliente.query<{ criado_por: string }>(
            'SELECT criado_por FROM documentos.documento WHERE id = $1', [rascunhoBlocos.id],
          );
          await conferirSqlSintetico(cliente, rascunhoBlocos.id, autor.rows[0].criado_por);
          await rejeitarSql(cliente, 'UPDATE documentos.documento SET processo_cifrado = $1 WHERE id = $2',
            [Buffer.from('alteração fictícia'), rascunhoBlocos.id], '55000');
        } finally {
          await cliente.query('ROLLBACK');
        }
        expect((await cliente.query('SELECT count(*) FROM documentos.emissao')).rows[0].count)
          .toBe(estadoAntes.rows[0].emissoes);
      } finally {
        await encerrar();
      }
    } finally {
      await cliente.end();
    }
  });

  it('encaminha, recolhe ou devolve DOF com acesso e concorrência controlados', async () => {
    const config = await carregarConfiguracao(arquivoConfig);
    const protetor = new ProtetorDados(config.chaves);
    const cliente = new Client({
      host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
      user: 'sisdoc_migrador', password: senhaMigrador,
    });
    await cliente.connect();
    const pessoaId = randomUUID();
    const vinculoId = randomUUID();
    const cpf = cpfSintetico(900000002);
    const senha = 'EncaminhamentoFicticio!12345';
    const hashSenha = await gerarHashSenha(senha);
    const usuarios = [
      { chave: 'autor', papel: 'analista' },
      { chave: 'outro-analista', papel: 'analista' },
      { chave: 'primeiro-coordenador', papel: 'coordenador' },
      { chave: 'segundo-coordenador', papel: 'coordenador' },
      { chave: 'secretario', papel: 'secretario_adjunto' },
      { chave: 'administrador', papel: 'admin' },
    ].map((usuario) => ({ ...usuario, id: randomUUID(), matricula: `ENC-${usuario.chave.toUpperCase()}` }));
    try {
      await cliente.query(`
        INSERT INTO nucleo.pessoa (id, cpf_cifrado, cpf_hash, nome, nome_busca)
        VALUES ($1, $2, $3, 'Pessoa encaminhada fictícia', 'pessoa encaminhada ficticia')
      `, [pessoaId, protetor.cifrar(Buffer.from(cpf, 'ascii'), {
        schema: 'nucleo', tabela: 'pessoa', registroId: pessoaId, campo: 'cpf_cifrado',
      }), protetor.hashCpf(cpf)]);
      await cliente.query(`
        INSERT INTO nucleo.vinculo (id, pessoa_id, matricula, matricula_norm, sistema_origem, id_origem, admissao)
        VALUES ($1, $2, 'ENC-FICTICIA', 'ENC-FICTICIA', 'fonte-encaminhamento-sintetica', $3, '1980-01-01')
      `, [vinculoId, pessoaId, randomUUID()]);
      for (const usuario of usuarios) {
        await cliente.query(`
          INSERT INTO seguranca.usuario (id, matricula, nome, senha_hash, papel, troca_senha_obrigatoria)
          VALUES ($1, $2, $3, $4, $5, false)
        `, [usuario.id, usuario.matricula, `Usuário fictício ${usuario.chave}`, hashSenha, usuario.papel]);
      }
      const porChave = (chave: string) => {
        const usuario = usuarios.find((item) => item.chave === chave);
        if (!usuario) throw new Error('Usuário sintético ausente.');
        return usuario;
      };
      const encerrar = await iniciarServico(portaHttps, caPem, arquivoConfig);
      try {
        const sessoes = new Map<string, { cookie: string; csrf: string }>();
        for (const usuario of usuarios) {
          const login = await requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: '/api/v1/auth/login', corpo: { matricula: usuario.matricula, senha },
          });
          expect(login.status, login.corpo).toBe(200);
          const cookie = login.headers['set-cookie']?.[0].split(';')[0];
          if (!cookie) throw new Error('Cookie sintético de encaminhamento ausente.');
          sessoes.set(usuario.chave, { cookie, csrf: respostaSessaoSchema.parse(JSON.parse(login.corpo)).csrf });
        }
        const sessao = (chave: string) => {
          const resultado = sessoes.get(chave);
          if (!resultado) throw new Error('Sessão sintética de encaminhamento ausente.');
          return resultado;
        };
        const autor = sessao('autor');
        const primeiro = sessao('primeiro-coordenador');
        const segundo = sessao('segundo-coordenador');
        const anos = Array.from({ length: 45 }, (_, indice) => ({
          ano: 1980 + indice, abrangencia: 'intervalo_declarado',
          faltas: 0, ts: 0, pf: 0, ip: 0, outros: 0, pb: 0, pv: 0, licencaPremio: 0,
        }));
        const calculo = { pessoaId, vinculoId, inicio: '1980-01-01', fim: '2024-12-31', anos, confirmacaoDados: true };
        const criado = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: '/api/v1/documentos',
          corpo: { calculo, admissaoEsperada: '1980-01-01', motivo: 'Lançamentos fictícios' }, ...autor,
        });
        expect(criado.status, criado.corpo).toBe(201);
        const rascunho = rascunhoDofSchema.parse(JSON.parse(criado.corpo));
        expect(rascunho.encaminhamento).toBeNull();
        const bloco = {
          id: randomUUID(), codigo: 'complementares', ativo: true,
          texto: 'Bloco fictício {{nome}} {{inexistente}} {{malformada',
        };
        const blocos = await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: `/api/v1/documentos/${rascunho.id}/blocos`,
          corpo: { revisao: 1, blocos: [bloco], motivo: 'Bloco fictício' }, ...autor,
        });
        expect(blocos.status, blocos.corpo).toBe(200);
        const processo = await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: `/api/v1/documentos/${rascunho.id}/processo`,
          corpo: { revisao: 2, processo: '1234/5678', motivo: 'Processo fictício' }, ...autor,
        });
        expect(processo.status, processo.corpo).toBe(200);
        const rota = `/api/v1/documentos/${rascunho.id}`;
        const destinatarioId = porChave('primeiro-coordenador').id;
        const outroCoordenadorId = porChave('segundo-coordenador').id;
        const pedido = { revisao: 3, destinatarioId };
        const rotaPreconferencia = `${rota}/preconferencia`;
        const verificar = async (cookie = autor.cookie) => {
          const resposta = await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota: rotaPreconferencia, cookie });
          expect(resposta.status, resposta.corpo).toBe(200);
          expect(resposta.corpo).not.toContain(cpf);
          expect(resposta.corpo).not.toContain(bloco.texto);
          return preconferenciaDofSchema.parse(JSON.parse(resposta.corpo));
        };
        expect((await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota: rotaPreconferencia })).status).toBe(401);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: rotaPreconferencia, cookie: primeiro.cookie,
        })).status).toBe(404);
        for (const chave of ['secretario']) {
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: rotaPreconferencia, cookie: sessao(chave).cookie,
          })).status).toBe(403);
        }
        const relatorioInicial = await verificar();
        expect(relatorioInicial).toMatchObject({
          documentoId: rascunho.id, revisao: 3, status: 'nao_conferido', conferenciaDisponivel: true,
        });
        expect(relatorioInicial.bloqueios.map((item) => item.codigo)).toEqual(expect.arrayContaining([
          'variaveis_ausentes', 'variaveis_malformadas', 'campos_referencia_ausentes',
        ]));
        for (const codigo of [
          'cpf_indisponivel', 'cpf_invalido', 'cpf_hash_inconsistente', 'matricula_inconsistente',
          'matricula_ambigua', 'vinculo_removido', 'admissao_ausente', 'admissao_alterada',
          'periodo_inconsistente', 'regra_incompativel', 'calculo_invalido', 'calculo_divergente',
          'processo_ausente', 'mascaras_ausentes', 'processo_invalido',
        ]) expect(relatorioInicial.bloqueios.map((item) => item.codigo)).not.toContain(codigo);
        expect(relatorioInicial.avisos.map((item) => item.codigo)).toEqual(expect.arrayContaining([
          'aprovacao_modelo_nao_verificada', 'regra_provisoria', 'dados_sem_data',
        ]));

        const semProcesso = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: '/api/v1/documentos',
          corpo: { calculo, admissaoEsperada: '1980-01-01', motivo: 'Segundo rascunho fictício' }, ...autor,
        });
        expect(semProcesso.status, semProcesso.corpo).toBe(201);
        const idSemProcesso = rascunhoDofSchema.parse(JSON.parse(semProcesso.corpo)).id;
        const relatorioSemProcesso = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `/api/v1/documentos/${idSemProcesso}/preconferencia`, cookie: autor.cookie,
        });
        expect(relatorioSemProcesso.status, relatorioSemProcesso.corpo).toBe(200);
        expect(preconferenciaDofSchema.parse(JSON.parse(relatorioSemProcesso.corpo)).bloqueios.map((item) => item.codigo))
          .toContain('processo_ausente');
        const ajustado = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: '/api/v1/documentos',
          corpo: {
            calculo: { ...calculo, inicio: '1979-01-01' }, admissaoEsperada: '1980-01-01', motivo: 'Início fictício ajustado',
          },
          ...autor,
        });
        expect(ajustado.status, ajustado.corpo).toBe(201);
        const idAjustado = rascunhoDofSchema.parse(JSON.parse(ajustado.corpo)).id;
        const relatorioAjustado = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `/api/v1/documentos/${idAjustado}/preconferencia`, cookie: autor.cookie,
        });
        expect(relatorioAjustado.status, relatorioAjustado.corpo).toBe(200);
        expect(preconferenciaDofSchema.parse(JSON.parse(relatorioAjustado.corpo)).bloqueios.map((item) => item.codigo))
          .toContain('inicio_ajustado_sem_confirmacao');

        const rotaConfirmarInicio = `/api/v1/documentos/${idAjustado}/confirmar-inicio`;
        const confirmacaoInicial = { revisao: 1, confirmar: true };
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: rotaConfirmarInicio, corpo: confirmacaoInicial,
        })).status).toBe(401);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: rotaConfirmarInicio, corpo: confirmacaoInicial, cookie: autor.cookie,
        })).status).toBe(403);
        for (const chave of ['secretario']) {
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: rotaConfirmarInicio, corpo: confirmacaoInicial, ...sessao(chave),
          })).status).toBe(403);
        }
        for (const chave of ['outro-analista', 'primeiro-coordenador']) {
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: rotaConfirmarInicio, corpo: confirmacaoInicial, ...sessao(chave),
          })).status).toBe(404);
        }
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: rotaConfirmarInicio, corpo: { revisao: 1, confirmar: false }, ...autor,
        })).status).toBe(400);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${rota}/confirmar-inicio`, corpo: { revisao: 3, confirmar: true }, ...autor,
        })).status).toBe(400);
        await cliente.query("UPDATE nucleo.vinculo SET admissao = '1981-01-01' WHERE id = $1", [vinculoId]);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: rotaConfirmarInicio, corpo: confirmacaoInicial, ...autor,
        })).status).toBe(409);
        await cliente.query("UPDATE nucleo.vinculo SET admissao = '1980-01-01' WHERE id = $1", [vinculoId]);
        const escritaDuranteConfirmacao = new Client({
          host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
          user: 'sisdoc_migrador', password: senhaMigrador,
        });
        await escritaDuranteConfirmacao.connect();
        try {
          await escritaDuranteConfirmacao.query('BEGIN');
          await escritaDuranteConfirmacao.query('UPDATE nucleo.vinculo SET cargo = cargo WHERE id = $1', [vinculoId]);
          const ocupada = await requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: rotaConfirmarInicio, corpo: confirmacaoInicial, ...autor,
          });
          expect(ocupada.status, ocupada.corpo).toBe(409);
        } finally {
          await escritaDuranteConfirmacao.query('ROLLBACK');
          await escritaDuranteConfirmacao.end();
        }
        const confirmacoes = await Promise.all([1, 2].map(() => requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: rotaConfirmarInicio, corpo: confirmacaoInicial, ...autor,
        })));
        expect(confirmacoes.map((item) => item.status).sort()).toEqual([201, 409]);
        const confirmada = confirmacoes.find((item) => item.status === 201);
        if (!confirmada) throw new Error('Confirmação sintética ausente.');
        expect(rascunhoDofSchema.parse(JSON.parse(confirmada.corpo))).toMatchObject({
          revisao: 2, inicioAjustadoConfirmado: true, status: 'rascunho',
        });
        const confirmadoJson = JSON.parse(confirmada.corpo);
        expect(rascunhoDofSchema.safeParse({ ...confirmadoJson, admissao: '1981-01-01' }).success).toBe(false);
        expect(rascunhoDofSchema.safeParse({
          ...confirmadoJson, entrada: { ...confirmadoJson.entrada, inicio: '1980-01-01' },
        }).success).toBe(false);
        const confirmacaoProtegida = await cliente.query<{ confirmacao_inicio_cifrada: Buffer }>(
          'SELECT confirmacao_inicio_cifrada FROM documentos.documento WHERE id = $1', [idAjustado],
        );
        const cifraInicio = confirmacaoProtegida.rows[0].confirmacao_inicio_cifrada;
        expect(cifraInicio.includes(Buffer.from('1979-01-01'))).toBe(false);
        const confirmacaoDecifrada = JSON.parse(protetor.decifrar(cifraInicio, {
          schema: 'documentos', tabela: 'documento', registroId: idAjustado, campo: 'confirmacao_inicio_cifrada',
        }).toString('utf8'));
        expect(confirmacaoDecifrada).toMatchObject({
          inicio: '1979-01-01', admissao: '1980-01-01', confirmadoPor: porChave('autor').id,
        });
        try {
          const autorIncorreto = protetor.cifrar(Buffer.from(JSON.stringify({
            ...confirmacaoDecifrada, confirmadoPor: porChave('outro-analista').id,
          })), { schema: 'documentos', tabela: 'documento', registroId: idAjustado, campo: 'confirmacao_inicio_cifrada' });
          await cliente.query('UPDATE documentos.documento SET confirmacao_inicio_cifrada = $1 WHERE id = $2',
            [autorIncorreto, idAjustado]);
          const inconsistente = await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: `/api/v1/documentos/${idAjustado}`, cookie: autor.cookie,
          });
          expect(inconsistente.status, inconsistente.corpo).toBe(500);
          expect(inconsistente.corpo).not.toContain('1979-01-01');
        } finally {
          await cliente.query('UPDATE documentos.documento SET confirmacao_inicio_cifrada = $1 WHERE id = $2',
            [cifraInicio, idAjustado]);
        }
        const semBloqueioInicio = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `/api/v1/documentos/${idAjustado}/preconferencia`, cookie: autor.cookie,
        });
        expect(semBloqueioInicio.status, semBloqueioInicio.corpo).toBe(200);
        expect(preconferenciaDofSchema.parse(JSON.parse(semBloqueioInicio.corpo)).bloqueios.map((item) => item.codigo))
          .not.toContain('inicio_ajustado_sem_confirmacao');
        await cliente.query("UPDATE nucleo.vinculo SET admissao = '1981-01-01' WHERE id = $1", [vinculoId]);
        const fonteDivergente = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `/api/v1/documentos/${idAjustado}`, cookie: autor.cookie,
        });
        expect(rascunhoDofSchema.parse(JSON.parse(fonteDivergente.corpo)).inicioAjustadoConfirmado).toBe(false);
        await cliente.query("UPDATE nucleo.vinculo SET admissao = '1980-01-01' WHERE id = $1", [vinculoId]);
        const processoAjustado = await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: `/api/v1/documentos/${idAjustado}/processo`,
          corpo: { revisao: 2, processo: '1234/5678', motivo: 'Processo fictício' }, ...autor,
        });
        expect(processoAjustado.status, processoAjustado.corpo).toBe(200);
        expect(rascunhoDofSchema.parse(JSON.parse(processoAjustado.corpo)).inicioAjustadoConfirmado).toBe(true);
        const alterarAjustado = await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: `/api/v1/documentos/${idAjustado}`,
          corpo: {
            revisao: 3,
            calculo: { ...calculo, inicio: '1979-01-01', anos: anos.map((item, indice) => indice === 0 ? { ...item, faltas: 1 } : item) },
            admissaoEsperada: '1980-01-01',
            motivo: 'Correção sintética',
          },
          ...autor,
        });
        expect(alterarAjustado.status, alterarAjustado.corpo).toBe(200);
        expect(rascunhoDofSchema.parse(JSON.parse(alterarAjustado.corpo))).toMatchObject({
          revisao: 4, inicioAjustadoConfirmado: false,
        });
        expect((await cliente.query('SELECT confirmacao_inicio_cifrada FROM documentos.documento WHERE id = $1', [idAjustado]))
          .rows[0].confirmacao_inicio_cifrada).toBeNull();
        const aposEdicao = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `/api/v1/documentos/${idAjustado}/preconferencia`, cookie: autor.cookie,
        });
        expect(preconferenciaDofSchema.parse(JSON.parse(aposEdicao.corpo)).bloqueios.map((item) => item.codigo))
          .toContain('inicio_ajustado_sem_confirmacao');
        const reconfirmacao = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: rotaConfirmarInicio, corpo: { revisao: 4, confirmar: true }, ...autor,
        });
        expect(reconfirmacao.status, reconfirmacao.corpo).toBe(201);
        const ajustadoEncaminhado = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `/api/v1/documentos/${idAjustado}/encaminhar`,
          corpo: { revisao: 5, destinatarioId }, ...autor,
        });
        expect(ajustadoEncaminhado.status, ajustadoEncaminhado.corpo).toBe(201);
        expect(rascunhoDofSchema.parse(JSON.parse(ajustadoEncaminhado.corpo))).toMatchObject({
          revisao: 6, inicioAjustadoConfirmado: true,
        });
        const recebidoAjustado = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `/api/v1/documentos/${idAjustado}`, cookie: primeiro.cookie,
        });
        expect(rascunhoDofSchema.parse(JSON.parse(recebidoAjustado.corpo)).inicioAjustadoConfirmado).toBe(true);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: rotaConfirmarInicio, corpo: { revisao: 6, confirmar: true }, ...autor,
        })).status).toBe(409);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: rotaConfirmarInicio, corpo: { revisao: 6, confirmar: true }, ...primeiro,
        })).status).toBe(404);
        const ajustadoRecolhido = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `/api/v1/documentos/${idAjustado}/recolher`,
          corpo: { revisao: 6, motivo: 'Recolhimento fictício' }, ...autor,
        });
        expect(ajustadoRecolhido.status, ajustadoRecolhido.corpo).toBe(201);
        expect(rascunhoDofSchema.parse(JSON.parse(ajustadoRecolhido.corpo))).toMatchObject({
          revisao: 7, inicioAjustadoConfirmado: true, encaminhamento: null,
        });
        const eventosInicio = await cliente.query<{ acao: string }>(
          'SELECT acao FROM seguranca.auditoria WHERE entidade_id = $1', [idAjustado],
        );
        expect(eventosInicio.rows.map((item) => item.acao)).toEqual(expect.arrayContaining([
          'inicio_ajustado_confirmado', 'confirmacao_inicio_fonte_ocupada',
        ]));

        const cifraCpf = protetor.cifrar(Buffer.from(cpf, 'ascii'), {
          schema: 'nucleo', tabela: 'pessoa', registroId: pessoaId, campo: 'cpf_cifrado',
        });
        try {
          await cliente.query('UPDATE nucleo.pessoa SET cpf_hash = $1 WHERE id = $2', [randomBytes(32), pessoaId]);
          expect((await verificar()).bloqueios.map((item) => item.codigo)).toContain('cpf_hash_inconsistente');
          await cliente.query('UPDATE nucleo.pessoa SET cpf_hash = $1, cpf_cifrado = $2 WHERE id = $3', [
            protetor.hashCpf(cpf), protetor.cifrar(Buffer.from('00000000000', 'ascii'), {
              schema: 'nucleo', tabela: 'pessoa', registroId: pessoaId, campo: 'cpf_cifrado',
            }), pessoaId,
          ]);
          expect((await verificar()).bloqueios.map((item) => item.codigo)).toContain('cpf_invalido');
          await cliente.query('UPDATE nucleo.pessoa SET cpf_cifrado = $1 WHERE id = $2', [Buffer.from('corrompido'), pessoaId]);
          expect((await verificar()).bloqueios.map((item) => item.codigo)).toContain('cpf_indisponivel');
        } finally {
          await cliente.query('UPDATE nucleo.pessoa SET cpf_hash = $1, cpf_cifrado = $2 WHERE id = $3', [
            protetor.hashCpf(cpf), cifraCpf, pessoaId,
          ]);
        }
        const nomeMaeFicticio = 'Filiação sintética protegida';
        const contextoMae = {
          schema: 'nucleo' as const, tabela: 'pessoa', registroId: pessoaId, campo: 'nome_mae_cifrado',
        };
        const cifrarMae = (valor: Buffer) => protetor.cifrar(valor, contextoMae);
        try {
          await cliente.query('UPDATE nucleo.pessoa SET nome_mae_cifrado = $1 WHERE id = $2', [
            cifrarMae(Buffer.from(nomeMaeFicticio, 'utf8')), pessoaId,
          ]);
          const maeValida = await verificar();
          expect(maeValida.bloqueios.map((item) => item.codigo)).not.toContain('nome_mae_indisponivel');
          expect(maeValida.bloqueios.map((item) => item.codigo)).not.toContain('nome_mae_invalido');
          expect(JSON.stringify(maeValida)).not.toContain(nomeMaeFicticio);
          expect(maeValida.bloqueios.find((item) => item.codigo === 'campos_referencia_ausentes')?.mensagem)
            .not.toContain('nome da mãe');
          const casosMae = [
            { valor: Buffer.alloc(0), codigo: 'nome_mae_indisponivel' },
            { valor: protetor.cifrar(Buffer.from(nomeMaeFicticio), { ...contextoMae, registroId: randomUUID() }),
              codigo: 'nome_mae_indisponivel' },
            { valor: cifrarMae(Buffer.from([0xc3, 0x28])), codigo: 'nome_mae_invalido' },
            { valor: cifrarMae(Buffer.from('   ')), codigo: 'nome_mae_invalido' },
            { valor: cifrarMae(Buffer.from('Nome\u0000fictício')), codigo: 'nome_mae_invalido' },
            { valor: cifrarMae(Buffer.from('a'.repeat(2001))), codigo: 'nome_mae_invalido' },
          ];
          for (const caso of casosMae) {
            await cliente.query('UPDATE nucleo.pessoa SET nome_mae_cifrado = $1 WHERE id = $2', [caso.valor, pessoaId]);
            const relatorio = await verificar();
            expect(relatorio.bloqueios.map((item) => item.codigo)).toContain(caso.codigo);
            expect(relatorio.bloqueios.find((item) => item.codigo === 'campos_referencia_ausentes')?.mensagem)
              .not.toContain('nome da mãe');
            expect(JSON.stringify(relatorio)).not.toContain(nomeMaeFicticio);
          }
        } finally {
          await cliente.query('UPDATE nucleo.pessoa SET nome_mae_cifrado = NULL WHERE id = $1', [pessoaId]);
        }
        expect((await verificar()).bloqueios.find((item) => item.codigo === 'campos_referencia_ausentes')?.mensagem)
          .toContain('nome da mãe');
        await cliente.query("UPDATE nucleo.pessoa SET nascimento = '1990-01-01' WHERE id = $1", [pessoaId]);
        expect((await verificar()).bloqueios.map((item) => item.codigo)).toContain('nascimento_inconsistente');
        await cliente.query('UPDATE nucleo.pessoa SET nascimento = NULL WHERE id = $1', [pessoaId]);
        await cliente.query("UPDATE nucleo.vinculo SET matricula_norm = 'INCONSISTENTE' WHERE id = $1", [vinculoId]);
        expect((await verificar()).bloqueios.map((item) => item.codigo)).toContain('matricula_inconsistente');
        await cliente.query("UPDATE nucleo.vinculo SET matricula_norm = 'ENC-FICTICIA' WHERE id = $1", [vinculoId]);
        await cliente.query('UPDATE nucleo.vinculo SET admissao = NULL WHERE id = $1', [vinculoId]);
        expect((await verificar()).bloqueios.map((item) => item.codigo)).toContain('admissao_ausente');
        await cliente.query("UPDATE nucleo.vinculo SET admissao = '1981-01-01' WHERE id = $1", [vinculoId]);
        expect((await verificar()).bloqueios.map((item) => item.codigo)).toContain('admissao_alterada');
        await cliente.query("UPDATE nucleo.vinculo SET admissao = '1980-01-01' WHERE id = $1", [vinculoId]);
        await cliente.query("UPDATE nucleo.vinculo SET removido_na_fonte_em = now() WHERE id = $1", [vinculoId]);
        expect((await verificar()).bloqueios.map((item) => item.codigo)).toContain('vinculo_removido');
        await cliente.query('UPDATE nucleo.vinculo SET removido_na_fonte_em = NULL WHERE id = $1', [vinculoId]);
        await cliente.query("UPDATE nucleo.vinculo SET sincronizado_em = now() - interval '25 hours' WHERE id = $1", [vinculoId]);
        expect((await verificar()).avisos.map((item) => item.codigo)).toContain('dados_antigos');
        await cliente.query("UPDATE nucleo.vinculo SET sincronizado_em = now() + interval '1 hour' WHERE id = $1", [vinculoId]);
        expect((await verificar()).avisos.map((item) => item.codigo)).toContain('data_fonte_futura');
        await cliente.query('UPDATE nucleo.vinculo SET sincronizado_em = now() WHERE id = $1', [vinculoId]);
        expect((await verificar()).avisos.map((item) => item.codigo)).not.toContain('dados_antigos');
        await cliente.query("UPDATE documentos.documento_periodo SET fim = '2024-12-30' WHERE documento_id = $1", [rascunho.id]);
        expect((await verificar()).bloqueios.map((item) => item.codigo)).toContain('periodo_inconsistente');
        await cliente.query("UPDATE documentos.documento_periodo SET fim = '2024-12-31' WHERE documento_id = $1", [rascunho.id]);

        const protegido = await cliente.query<{ entrada_cifrada: Buffer; resultado_calculo_cifrado: Buffer }>(`
          SELECT entrada_cifrada, resultado_calculo_cifrado FROM documentos.documento WHERE id = $1
        `, [rascunho.id]);
        const anterior = protegido.rows[0];
        const resultadoSalvo = rascunhoDofSchema.parse(JSON.parse(processo.corpo)).resultado;
        const divergente = { ...resultadoSalvo, totais: { ...resultadoSalvo.totais, diasBrutos: resultadoSalvo.totais.diasBrutos + 1 } };
        try {
          await cliente.query('UPDATE documentos.documento SET resultado_calculo_cifrado = $1 WHERE id = $2', [
            protetor.cifrar(Buffer.from(JSON.stringify(divergente)), {
              schema: 'documentos', tabela: 'documento', registroId: rascunho.id, campo: 'resultado_calculo_cifrado',
            }), rascunho.id,
          ]);
          expect((await verificar()).bloqueios.map((item) => item.codigo)).toContain('calculo_divergente');
          await cliente.query('UPDATE documentos.documento SET resultado_calculo_cifrado = $1, entrada_cifrada = $2 WHERE id = $3', [
            anterior.resultado_calculo_cifrado, protetor.cifrar(Buffer.from(JSON.stringify({
              ...calculo, anos: anos.map((item, indice) => indice === 0 ? { ...item, faltas: 999 } : item),
            })), {
              schema: 'documentos', tabela: 'documento', registroId: rascunho.id, campo: 'entrada_cifrada',
            }), rascunho.id,
          ]);
          expect((await verificar()).bloqueios.map((item) => item.codigo)).toContain('calculo_invalido');
        } finally {
          await cliente.query('UPDATE documentos.documento SET resultado_calculo_cifrado = $1, entrada_cifrada = $2 WHERE id = $3',
            [anterior.resultado_calculo_cifrado, anterior.entrada_cifrada, rascunho.id]);
        }

        const regraAnterior = await cliente.query<{ id: string }>(`
          INSERT INTO documentos.regra_versao (codigo, versao, configuracao, evidencia, vigente_de)
          VALUES ($1, 'versao-sintetica-antiga', '{}'::jsonb, 'formula', CURRENT_DATE) RETURNING id
        `, [resultadoSalvo.regra.codigo]);
        const regraOriginal = await cliente.query<{ regra_versao_id: string }>(
          'SELECT regra_versao_id FROM documentos.documento WHERE id = $1', [rascunho.id],
        );
        try {
          const resultadoAntigo = {
            ...resultadoSalvo, regra: { ...resultadoSalvo.regra, versao: 'versao-sintetica-antiga' },
          };
          await cliente.query('UPDATE documentos.documento SET regra_versao_id = $1, resultado_calculo_cifrado = $2 WHERE id = $3', [
            regraAnterior.rows[0].id,
            protetor.cifrar(Buffer.from(JSON.stringify(resultadoAntigo)), {
              schema: 'documentos', tabela: 'documento', registroId: rascunho.id, campo: 'resultado_calculo_cifrado',
            }), rascunho.id,
          ]);
          expect((await verificar()).bloqueios.map((item) => item.codigo)).toContain('regra_incompativel');
        } finally {
          await cliente.query('UPDATE documentos.documento SET regra_versao_id = $1, resultado_calculo_cifrado = $2 WHERE id = $3', [
            regraOriginal.rows[0].regra_versao_id, anterior.resultado_calculo_cifrado, rascunho.id,
          ]);
        }

        const escritorFonte = new Client({
          host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
          user: 'sisdoc_migrador', password: senhaMigrador,
        });
        await escritorFonte.connect();
        try {
          await escritorFonte.query('BEGIN');
          await escritorFonte.query('UPDATE nucleo.vinculo SET cargo = cargo WHERE id = $1', [vinculoId]);
          const ocupada = await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: rotaPreconferencia, cookie: autor.cookie,
          });
          expect(ocupada.status, ocupada.corpo).toBe(409);
          expect(ocupada.corpo).toContain('fonte está sendo atualizada');
        } finally {
          await escritorFonte.query('ROLLBACK');
          await escritorFonte.end();
        }
        const leitorFonte = new Client({
          host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
          user: 'sisdoc_aplicativo', password: senhaAplicativo,
        });
        const inseridor = new Client({
          host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
          user: 'sisdoc_migrador', password: senhaMigrador,
        });
        await leitorFonte.connect();
        await inseridor.connect();
        const duplicado = randomUUID();
        let leitorConfirmado = false;
        try {
          await leitorFonte.query('BEGIN');
          const bloqueio = await leitorFonte.query<{ obtido: boolean }>(
            'SELECT pg_try_advisory_xact_lock_shared($1, $2) AS obtido', [...CHAVE_BLOQUEIO_FONTE_DOF],
          );
          expect(bloqueio.rows[0].obtido).toBe(true);
          let insercaoFinalizada = false;
          const insercao = inseridor.query(`
            INSERT INTO nucleo.vinculo (id, pessoa_id, matricula, matricula_norm, sistema_origem, id_origem, admissao)
            VALUES ($1, $2, 'ENC-FICTICIA', 'ENC-FICTICIA', 'outra-fonte-sintetica', $3, '1980-01-01')
          `, [duplicado, pessoaId, randomUUID()]);
          void insercao.then(() => { insercaoFinalizada = true; }, () => { insercaoFinalizada = true; });
          await delay(200);
          expect(insercaoFinalizada).toBe(false);
          await leitorFonte.query('COMMIT');
          leitorConfirmado = true;
          await insercao;
          expect((await verificar()).bloqueios.map((item) => item.codigo)).toContain('matricula_ambigua');
          await cliente.query('UPDATE nucleo.vinculo SET removido_na_fonte_em = now() WHERE id = $1', [duplicado]);
          expect((await verificar()).bloqueios.map((item) => item.codigo)).not.toContain('matricula_ambigua');
        } finally {
          if (!leitorConfirmado) await leitorFonte.query('ROLLBACK');
          await leitorFonte.end();
          await inseridor.end();
        }

        for (const caso of [
          { nome: 'sem-mascara', processos: undefined, bloqueio: 'mascaras_ausentes' },
          { nome: 'mascara-incompativel', processos: { mascaras: ['##-####'] }, bloqueio: 'processo_invalido' },
        ]) {
          const portaAlternativa = await portaLivre();
          const arquivoAlternativo = path.join(temporario, `config-preconferencia-${caso.nome}.json`);
          await writeFile(arquivoAlternativo, JSON.stringify({ ...config, porta: portaAlternativa, processos: caso.processos }));
          const encerrarAlternativo = await iniciarServico(portaAlternativa, caPem, arquivoAlternativo);
          try {
            const respostaAlternativa = await requisitarApi(portaAlternativa, caPem, {
              metodo: 'GET', rota: rotaPreconferencia, cookie: autor.cookie,
            });
            expect(respostaAlternativa.status, respostaAlternativa.corpo).toBe(200);
            expect(preconferenciaDofSchema.parse(JSON.parse(respostaAlternativa.corpo)).bloqueios.map((item) => item.codigo))
              .toContain(caso.bloqueio);
          } finally {
            await encerrarAlternativo();
          }
        }
        expect((await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota: '/api/v1/documentos/encaminhados' })).status).toBe(401);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: '/api/v1/documentos/encaminhados', cookie: autor.cookie,
        })).status).toBe(403);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${rota}/encaminhar`, corpo: pedido, cookie: autor.cookie,
        })).status).toBe(403);
        for (const chave of ['secretario']) {
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: '/api/v1/documentos/coordenadores', cookie: sessao(chave).cookie,
          })).status).toBe(403);
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: `${rota}/encaminhar`, corpo: pedido, ...sessao(chave),
          })).status).toBe(403);
        }
        const candidatos = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: '/api/v1/documentos/coordenadores?limite=50', cookie: autor.cookie,
        });
        expect(candidatos.status, candidatos.corpo).toBe(200);
        const coordenadores = paginaCoordenadoresDofSchema.parse(JSON.parse(candidatos.corpo)).itens;
        expect(coordenadores.map((item) => item.id)).toEqual(expect.arrayContaining([destinatarioId, outroCoordenadorId]));
        expect(coordenadores.map((item) => item.id)).not.toContain(porChave('outro-analista').id);
        for (const invalido of [
          { ...pedido, destinatarioId: porChave('outro-analista').id },
          { ...pedido, destinatarioId: porChave('autor').id },
          { ...pedido, destinatarioId: randomUUID() },
          { ...pedido, status: 'conferido' },
        ]) {
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: `${rota}/encaminhar`, corpo: invalido, ...autor,
          })).status).toBe(400);
        }
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${rota}/encaminhar`, corpo: pedido, ...sessao('outro-analista'),
        })).status).toBe(404);
        const enviado = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${rota}/encaminhar`, corpo: pedido, ...autor,
        });
        expect(enviado.status, enviado.corpo).toBe(201);
        expect(rascunhoDofSchema.parse(JSON.parse(enviado.corpo))).toMatchObject({
          status: 'rascunho', revisao: 4, encaminhamento: { destinatarioId, destinatarioDisponivel: true },
        });
        const recebidos = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: '/api/v1/documentos/encaminhados', cookie: primeiro.cookie,
        });
        expect(paginaEncaminhamentosDofSchema.parse(JSON.parse(recebidos.corpo)).itens.map((item) => item.id)).toContain(rascunho.id);
        const outrosRecebidos = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: '/api/v1/documentos/encaminhados', cookie: segundo.cookie,
        });
        expect(paginaEncaminhamentosDofSchema.parse(JSON.parse(outrosRecebidos.corpo)).itens.map((item) => item.id))
          .not.toContain(rascunho.id);
        const recebido = await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota, cookie: primeiro.cookie });
        expect(recebido.status, recebido.corpo).toBe(200);
        expect(rascunhoDofSchema.parse(JSON.parse(recebido.corpo)).resultado.periodo.linhas).toHaveLength(45);
        expect((await verificar(primeiro.cookie)).revisao).toBe(4);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: rotaPreconferencia, cookie: segundo.cookie,
        })).status).toBe(404);
        const previa = await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota: `${rota}/previa`, cookie: primeiro.cookie });
        expect(previa.status, previa.corpo).toBe(200);
        expect(previa.headers['x-sisdoc-revisao']).toBe('4');
        expect(previa.corpo).toContain('Bloco fictício');
        const dadosRecebidos = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `${rota}/dados-previa`, cookie: primeiro.cookie,
        });
        expect(dadosRecebidos.status, dadosRecebidos.corpo).toBe(200);
        expect(dadosFontePreviaDofSchema.parse(JSON.parse(dadosRecebidos.corpo))).toMatchObject({
          documentoId: rascunho.id, revisao: 4, cpf,
        });
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `${rota}/dados-previa`, cookie: segundo.cookie,
        })).status).toBe(404);
        expect((await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota, cookie: segundo.cookie })).status).toBe(404);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota, cookie: sessao('outro-analista').cookie,
        })).status).toBe(404);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${rota}/recolher`, corpo: { revisao: 4, motivo: 'Tentativa indevida' }, ...primeiro,
        })).status).toBe(404);
        for (const alteracao of [
          { rota, corpo: { revisao: 4, calculo, admissaoEsperada: '1980-01-01', motivo: 'Tentativa' } },
          { rota: `${rota}/blocos`, corpo: { revisao: 4, blocos: [{ ...bloco, texto: 'Alteração' }], motivo: 'Tentativa' } },
          { rota: `${rota}/processo`, corpo: { revisao: 4, processo: '4321/8765', motivo: 'Tentativa' } },
        ]) {
          expect((await requisitarApi(portaHttps, caPem, { metodo: 'PATCH', ...alteracao, ...autor })).status).toBe(409);
          expect((await requisitarApi(portaHttps, caPem, { metodo: 'PATCH', ...alteracao, ...primeiro })).status).toBe(404);
        }
        const aplicativo = new Client({
          host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
          user: 'sisdoc_aplicativo', password: senhaAplicativo,
        });
        await aplicativo.connect();
        try {
          await aplicativo.query('BEGIN');
          await rejeitarSql(aplicativo, 'UPDATE documentos.documento SET entrada_cifrada = $1 WHERE id = $2',
            [Buffer.from('alteração fictícia'), rascunho.id], '55000');
          await rejeitarSql(aplicativo, 'UPDATE documentos.documento SET processo_cifrado = $1 WHERE id = $2',
            [Buffer.from('alteração fictícia'), rascunho.id], '55000');
          await rejeitarSql(aplicativo, 'UPDATE documentos.documento SET confirmacao_inicio_cifrada = $1 WHERE id = $2',
            [Buffer.from('confirmação fictícia'), rascunho.id], '55000');
          await rejeitarSql(aplicativo, 'UPDATE documentos.documento_periodo SET fim = fim WHERE documento_id = $1',
            [rascunho.id], '55000');
          await rejeitarSql(aplicativo, 'UPDATE documentos.documento_bloco SET ativo = false WHERE id = $1',
            [bloco.id], '55000');
          await aplicativo.query('ROLLBACK');
        } finally {
          await aplicativo.end();
        }
        await cliente.query("UPDATE seguranca.usuario SET papel = 'analista' WHERE id = $1", [destinatarioId]);
        try {
          expect((await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota, cookie: primeiro.cookie })).status).toBe(404);
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: rotaPreconferencia, cookie: primeiro.cookie,
          })).status).toBe(404);
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: `${rota}/dados-previa`, cookie: primeiro.cookie,
          })).status).toBe(404);
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: '/api/v1/documentos/encaminhados', cookie: primeiro.cookie,
          })).status).toBe(403);
          const indisponivel = await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota, cookie: autor.cookie });
          expect(rascunhoDofSchema.parse(JSON.parse(indisponivel.corpo)).encaminhamento?.destinatarioDisponivel).toBe(false);
        } finally {
          await cliente.query("UPDATE seguranca.usuario SET papel = 'coordenador' WHERE id = $1", [destinatarioId]);
        }
        const motivo = 'Necessário corrigir dados fictícios';
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${rota}/recolher`, corpo: { revisao: 4, motivo: ' ' }, ...autor,
        })).status).toBe(400);
        const recolhido = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${rota}/recolher`, corpo: { revisao: 4, motivo }, ...autor,
        });
        expect(recolhido.status, recolhido.corpo).toBe(201);
        expect(rascunhoDofSchema.parse(JSON.parse(recolhido.corpo))).toMatchObject({ revisao: 5, encaminhamento: null });
        expect((await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota, cookie: primeiro.cookie })).status).toBe(404);
        const historico = await cliente.query<{ id: string; motivo_cifrado: Buffer }>(`
          SELECT id, motivo_cifrado FROM documentos.encaminhamento_dof WHERE documento_id = $1
        `, [rascunho.id]);
        expect(historico.rows).toHaveLength(1);
        expect(historico.rows[0].motivo_cifrado.includes(Buffer.from(motivo))).toBe(false);
        expect(JSON.parse(protetor.decifrar(historico.rows[0].motivo_cifrado, {
          schema: 'documentos', tabela: 'encaminhamento_dof',
          registroId: historico.rows[0].id, campo: 'motivo_cifrado',
        }).toString('utf8'))).toBe(motivo);
        await cliente.query('BEGIN');
        try {
          await rejeitarSql(cliente, 'UPDATE documentos.encaminhamento_dof SET motivo_cifrado = $1 WHERE id = $2',
            [Buffer.from('alteração fictícia'), historico.rows[0].id], '55000');
          await rejeitarSql(cliente, 'DELETE FROM documentos.encaminhamento_dof WHERE id = $1',
            [historico.rows[0].id], '55000');
          await rejeitarSql(cliente, 'TRUNCATE documentos.encaminhamento_dof', [], '55000');
        } finally {
          await cliente.query('ROLLBACK');
        }
        const usuarioOcupado = new Client({
          host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
          user: 'sisdoc_migrador', password: senhaMigrador,
        });
        await usuarioOcupado.connect();
        try {
          await usuarioOcupado.query('BEGIN');
          await usuarioOcupado.query('SELECT id FROM seguranca.usuario WHERE id = $1 FOR UPDATE', [destinatarioId]);
          const ocupado = await requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: `${rota}/encaminhar`, corpo: { revisao: 5, destinatarioId }, ...autor,
          });
          expect(ocupado.status, ocupado.corpo).toBe(409);
          expect(ocupado.corpo).toContain('destinatário está em outra operação');
        } finally {
          await usuarioOcupado.query('ROLLBACK');
          await usuarioOcupado.end();
        }
        const concorrentes = await Promise.all([destinatarioId, outroCoordenadorId].map((destino) =>
          requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: `${rota}/encaminhar`, corpo: { revisao: 5, destinatarioId: destino }, ...autor,
          })));
        expect(concorrentes.map((resposta) => resposta.status).sort()).toEqual([201, 409]);
        const vencedor = concorrentes.find((resposta) => resposta.status === 201);
        if (!vencedor) throw new Error('Encaminhamento concorrente sintético ausente.');
        const ativo = rascunhoDofSchema.parse(JSON.parse(vencedor.corpo));
        const destinatarioAtivo = ativo.encaminhamento?.destinatarioId;
        if (!destinatarioAtivo) throw new Error('Destinatário sintético ausente.');
        const receptor = destinatarioAtivo === destinatarioId ? primeiro : segundo;
        const bloqueador = new Client({
          host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
          user: 'sisdoc_migrador', password: senhaMigrador,
        });
        await bloqueador.connect();
        let confirmado = false;
        try {
          await bloqueador.query('BEGIN');
          await bloqueador.query('SELECT id FROM documentos.documento WHERE id = $1 FOR UPDATE', [rascunho.id]);
          const encaminhamentoAtivo = await bloqueador.query<{ id: string }>(`
            SELECT id FROM documentos.encaminhamento_dof WHERE documento_id = $1 AND recolhido_em IS NULL
          `, [rascunho.id]);
          const encaminhamentoId = encaminhamentoAtivo.rows[0].id;
          await bloqueador.query(`
            UPDATE documentos.encaminhamento_dof SET recolhido_por = $1, recolhido_em = now(), motivo_cifrado = $2 WHERE id = $3
          `, [porChave('autor').id, protetor.cifrar(Buffer.from(JSON.stringify('Recolhimento concorrente fictício')), {
            schema: 'documentos', tabela: 'encaminhamento_dof', registroId: encaminhamentoId, campo: 'motivo_cifrado',
          }), encaminhamentoId]);
          await bloqueador.query('UPDATE documentos.documento SET revisao = revisao + 1 WHERE id = $1', [rascunho.id]);
          let leituraFinalizada = false;
          const leitura = requisitarApi(portaHttps, caPem, { metodo: 'GET', rota, cookie: receptor.cookie });
          void leitura.then(() => { leituraFinalizada = true; }, () => { leituraFinalizada = true; });
          await delay(200);
          expect(leituraFinalizada).toBe(false);
          await bloqueador.query('COMMIT');
          confirmado = true;
          const resposta = await leitura;
          expect(resposta.status, resposta.corpo).toBe(404);
        } finally {
          if (!confirmado) await bloqueador.query('ROLLBACK');
          await bloqueador.end();
        }
        const eventos = await cliente.query<{ acao: string; detalhes: unknown }>(`
          SELECT acao, detalhes FROM seguranca.auditoria WHERE entidade_id = $1
        `, [rascunho.id]);
        expect(eventos.rows.map((evento) => evento.acao)).toEqual(expect.arrayContaining([
          'rascunho_encaminhado', 'rascunho_recolhido', 'rascunho_aberto', 'previa_dof_aberta',
          'preconferencia_verificada', 'preconferencia_fonte_ocupada',
        ]));
        expect(JSON.stringify(eventos.rows)).not.toContain(motivo);
        expect(JSON.stringify(eventos.rows)).not.toContain(cpf);
        expect((await cliente.query('SELECT count(*) FROM documentos.emissao WHERE documento_id = $1', [rascunho.id])).rows[0].count).toBe('0');

        const gravador = new Client({
          host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
          user: 'sisdoc_aplicativo', password: senhaAplicativo,
        });
        const encaminhador = new Client({
          host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
          user: 'sisdoc_migrador', password: senhaMigrador,
        });
        await gravador.connect();
        await encaminhador.connect();
        let encaminhamentoConfirmado = false;
        try {
          await encaminhador.query('BEGIN');
          await encaminhador.query('SELECT id FROM documentos.documento WHERE id = $1 FOR UPDATE', [rascunho.id]);
          await encaminhador.query(`
            INSERT INTO documentos.encaminhamento_dof (id, documento_id, encaminhado_por, destinatario_id)
            VALUES ($1, $2, $3, $4)
          `, [randomUUID(), rascunho.id, porChave('autor').id, destinatarioId]);
          let alteracaoFinalizada = false;
          const alteracao = gravador.query(`
            UPDATE documentos.documento_periodo SET fim = '2024-12-30' WHERE documento_id = $1
          `, [rascunho.id]);
          void alteracao.then(() => { alteracaoFinalizada = true; }, () => { alteracaoFinalizada = true; });
          await delay(200);
          expect(alteracaoFinalizada).toBe(false);
          await encaminhador.query('COMMIT');
          encaminhamentoConfirmado = true;
          await expect(alteracao).rejects.toMatchObject({ code: '55000' });
          expect((await cliente.query(`
            SELECT to_char(fim, 'YYYY-MM-DD') AS fim FROM documentos.documento_periodo WHERE documento_id = $1
          `, [rascunho.id])).rows[0].fim).toBe('2024-12-31');
        } finally {
          if (!encaminhamentoConfirmado) await encaminhador.query('ROLLBACK');
          await gravador.end();
          await encaminhador.end();
        }
        const abertoParaDevolucao = await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota, cookie: autor.cookie });
        const antesDeDevolver = rascunhoDofSchema.parse(JSON.parse(abertoParaDevolucao.corpo));
        expect(antesDeDevolver.encaminhamento?.destinatarioId).toBe(destinatarioId);
        const rotaUltimaDevolucao = `${rota}/ultima-devolucao`;
        const semDevolucao = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: rotaUltimaDevolucao, cookie: autor.cookie,
        });
        expect(semDevolucao.status, semDevolucao.corpo).toBe(200);
        expect(ultimaDevolucaoDofSchema.parse(JSON.parse(semDevolucao.corpo))).toEqual({
          documentoId: rascunho.id, revisao: antesDeDevolver.revisao, devolucao: null,
        });
        expect(semDevolucao.headers['cache-control']).toContain('no-store');
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: rotaUltimaDevolucao, cookie: primeiro.cookie,
        })).status).toBe(404);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: rotaUltimaDevolucao, cookie: sessao('outro-analista').cookie,
        })).status).toBe(404);
        for (const chave of ['secretario']) {
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: rotaUltimaDevolucao, cookie: sessao(chave).cookie,
          })).status).toBe(403);
        }
        const motivoDevolucao = 'Ajuste fictício: revisar a data e os lançamentos.';
        const pedidoDevolucao = { revisao: antesDeDevolver.revisao, motivo: motivoDevolucao };
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${rota}/devolver`, corpo: pedidoDevolucao, ...autor,
        })).status).toBe(403);
        for (const chave of ['secretario']) {
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: `${rota}/devolver`, corpo: pedidoDevolucao, ...sessao(chave),
          })).status).toBe(403);
        }
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${rota}/devolver`, corpo: pedidoDevolucao, ...segundo,
        })).status).toBe(404);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${rota}/devolver`, corpo: pedidoDevolucao, cookie: primeiro.cookie,
        })).status).toBe(403);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${rota}/devolver`,
          corpo: { ...pedidoDevolucao, motivo: ' ' }, ...primeiro,
        })).status).toBe(400);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${rota}/devolver`,
          corpo: { ...pedidoDevolucao, revisao: antesDeDevolver.revisao - 1 }, ...primeiro,
        })).status).toBe(409);

        const encaminhamentoParaDevolver = await cliente.query<{ id: string }>(`
          SELECT id FROM documentos.encaminhamento_dof WHERE documento_id = $1 AND recolhido_em IS NULL
        `, [rascunho.id]);
        const idEncaminhamento = encaminhamentoParaDevolver.rows[0].id;
        const tentativaSql = `
          UPDATE documentos.encaminhamento_dof
          SET recolhido_por = $1, recolhido_em = now(), motivo_cifrado = $2 WHERE id = $3
        `;
        await cliente.query('BEGIN');
        try {
          await rejeitarSql(cliente, tentativaSql, [outroCoordenadorId, Buffer.from('teste'), idEncaminhamento], '55000');
          await cliente.query("UPDATE seguranca.usuario SET papel = 'analista' WHERE id = $1", [destinatarioId]);
          await rejeitarSql(cliente, tentativaSql, [destinatarioId, Buffer.from('teste'), idEncaminhamento], '23514');
        } finally {
          await cliente.query('ROLLBACK');
        }

        const devolvido = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${rota}/devolver`, corpo: pedidoDevolucao, ...primeiro,
        });
        expect(devolvido.status, devolvido.corpo).toBe(201);
        expect(resultadoDevolucaoDofSchema.parse(JSON.parse(devolvido.corpo))).toMatchObject({
          documentoId: rascunho.id, revisao: antesDeDevolver.revisao + 1,
        });
        expect(devolvido.corpo).not.toContain(motivoDevolucao);
        expect((await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota, cookie: primeiro.cookie })).status).toBe(404);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${rota}/devolver`, corpo: pedidoDevolucao, ...primeiro,
        })).status).toBe(404);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${rota}/recolher`,
          corpo: { revisao: antesDeDevolver.revisao + 1, motivo: 'Recolhimento tardio fictício' }, ...autor,
        })).status).toBe(409);
        const consultaDevolucao = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: rotaUltimaDevolucao, cookie: autor.cookie,
        });
        expect(consultaDevolucao.status, consultaDevolucao.corpo).toBe(200);
        expect(ultimaDevolucaoDofSchema.parse(JSON.parse(consultaDevolucao.corpo))).toMatchObject({
          documentoId: rascunho.id, revisao: antesDeDevolver.revisao + 1,
          devolucao: { coordenadorNome: 'Usuário fictício primeiro-coordenador', motivo: motivoDevolucao },
        });
        const registroDevolucao = await cliente.query<{
          recolhido_por: string; motivo_cifrado: Buffer;
        }>('SELECT recolhido_por, motivo_cifrado FROM documentos.encaminhamento_dof WHERE id = $1', [idEncaminhamento]);
        expect(registroDevolucao.rows[0].recolhido_por).toBe(destinatarioId);
        expect(registroDevolucao.rows[0].motivo_cifrado.includes(Buffer.from(motivoDevolucao))).toBe(false);
        expect(JSON.parse(protetor.decifrar(registroDevolucao.rows[0].motivo_cifrado, {
          schema: 'documentos', tabela: 'encaminhamento_dof', registroId: idEncaminhamento, campo: 'motivo_cifrado',
        }).toString('utf8'))).toBe(motivoDevolucao);
        await cliente.query('BEGIN');
        try {
          await rejeitarSql(cliente, tentativaSql, [destinatarioId, Buffer.from('novo'), idEncaminhamento], '55000');
        } finally {
          await cliente.query('ROLLBACK');
        }
        const rascunhoDevolvido = await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota, cookie: autor.cookie });
        expect(rascunhoDofSchema.parse(JSON.parse(rascunhoDevolvido.corpo))).toMatchObject({
          revisao: antesDeDevolver.revisao + 1, status: 'rascunho', encaminhamento: null,
        });
        const alteradoDepois = await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: `${rota}/processo`,
          corpo: { revisao: antesDeDevolver.revisao + 1, processo: '4321/8765', motivo: 'Ajuste fictício solicitado' },
          ...autor,
        });
        expect(alteradoDepois.status, alteradoDepois.corpo).toBe(200);
        const depoisDoAjuste = rascunhoDofSchema.parse(JSON.parse(alteradoDepois.corpo));
        const reencaminhado = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${rota}/encaminhar`,
          corpo: { revisao: depoisDoAjuste.revisao, destinatarioId }, ...autor,
        });
        expect(reencaminhado.status, reencaminhado.corpo).toBe(201);
        const paraCorrida = rascunhoDofSchema.parse(JSON.parse(reencaminhado.corpo));
        const bloqueadorDevolucao = new Client({
          host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
          user: 'sisdoc_migrador', password: senhaMigrador,
        });
        await bloqueadorDevolucao.connect();
        let recolhimentoConfirmado = false;
        try {
          await bloqueadorDevolucao.query('BEGIN');
          await bloqueadorDevolucao.query('SELECT id FROM documentos.documento WHERE id = $1 FOR UPDATE', [rascunho.id]);
          const atual = await bloqueadorDevolucao.query<{ id: string }>(`
            SELECT id FROM documentos.encaminhamento_dof WHERE documento_id = $1 AND recolhido_em IS NULL
          `, [rascunho.id]);
          await bloqueadorDevolucao.query(tentativaSql, [
            porChave('autor').id,
            protetor.cifrar(Buffer.from(JSON.stringify('Recolhimento concorrente')), {
              schema: 'documentos', tabela: 'encaminhamento_dof', registroId: atual.rows[0].id, campo: 'motivo_cifrado',
            }),
            atual.rows[0].id,
          ]);
          await bloqueadorDevolucao.query('UPDATE documentos.documento SET revisao = revisao + 1 WHERE id = $1', [rascunho.id]);
          let finalizada = false;
          const devolucaoConcorrente = requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: `${rota}/devolver`,
            corpo: { revisao: paraCorrida.revisao, motivo: 'Devolução concorrente fictícia' }, ...primeiro,
          });
          void devolucaoConcorrente.then(() => { finalizada = true; }, () => { finalizada = true; });
          await delay(200);
          expect(finalizada).toBe(false);
          await bloqueadorDevolucao.query('COMMIT');
          recolhimentoConfirmado = true;
          expect((await devolucaoConcorrente).status).toBe(404);
        } finally {
          if (!recolhimentoConfirmado) await bloqueadorDevolucao.query('ROLLBACK');
          await bloqueadorDevolucao.end();
        }
        for (const defeito of ['cifra', 'texto'] as const) {
          const antes = await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota, cookie: autor.cookie });
          const atual = rascunhoDofSchema.parse(JSON.parse(antes.corpo));
          const novoEncaminhamento = await requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: `${rota}/encaminhar`, corpo: { revisao: atual.revisao, destinatarioId }, ...autor,
          });
          expect(novoEncaminhamento.status, novoEncaminhamento.corpo).toBe(201);
          await cliente.query('BEGIN');
          try {
            const registro = await cliente.query<{ id: string }>(`
              SELECT id FROM documentos.encaminhamento_dof WHERE documento_id = $1 AND recolhido_em IS NULL
            `, [rascunho.id]);
            const registroId = registro.rows[0].id;
            const conteudo = defeito === 'cifra' ? Buffer.from('cifra sintética inválida')
              : protetor.cifrar(Buffer.from(JSON.stringify(' ')), {
                schema: 'documentos', tabela: 'encaminhamento_dof', registroId, campo: 'motivo_cifrado',
              });
            await cliente.query(tentativaSql, [destinatarioId, conteudo, registroId]);
            await cliente.query('UPDATE documentos.documento SET revisao = revisao + 1 WHERE id = $1', [rascunho.id]);
            await cliente.query('COMMIT');
          } catch (erro) {
            await cliente.query('ROLLBACK');
            throw erro;
          }
          const invalida = await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: rotaUltimaDevolucao, cookie: autor.cookie,
          });
          expect(invalida.status, invalida.corpo).toBe(409);
          expect(invalida.corpo).toContain('integridade');
        }
        const eventosDevolucao = await cliente.query<{ acao: string; detalhes: unknown }>(`
          SELECT acao, detalhes FROM seguranca.auditoria WHERE entidade_id = $1
        `, [rascunho.id]);
        expect(eventosDevolucao.rows.map((evento) => evento.acao)).toEqual(expect.arrayContaining([
          'rascunho_devolvido', 'devolucao_dof_consultada', 'devolucao_motivo_invalido',
        ]));
        expect(JSON.stringify(eventosDevolucao.rows)).not.toContain(motivoDevolucao);
        expect(JSON.stringify(eventosDevolucao.rows)).not.toContain(cpf);
        expect((await cliente.query('SELECT count(*) FROM documentos.emissao WHERE documento_id = $1', [rascunho.id])).rows[0].count).toBe('0');

        const proprioCoordenador = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: '/api/v1/documentos',
          corpo: { calculo, admissaoEsperada: '1980-01-01', motivo: 'Rascunho fictício do coordenador' }, ...primeiro,
        });
        expect(proprioCoordenador.status, proprioCoordenador.corpo).toBe(201);
        const outroDocumento = rascunhoDofSchema.parse(JSON.parse(proprioCoordenador.corpo));
        const outraRota = `/api/v1/documentos/${outroDocumento.id}`;
        const enviadoOutro = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${outraRota}/encaminhar`,
          corpo: { revisao: outroDocumento.revisao, destinatarioId: outroCoordenadorId }, ...primeiro,
        });
        expect(enviadoOutro.status, enviadoOutro.corpo).toBe(201);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${outraRota}/devolver`,
          corpo: { revisao: outroDocumento.revisao + 1, motivo: 'Não sou o destinatário' }, ...primeiro,
        })).status).toBe(404);
        const segundaDevolucao = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${outraRota}/devolver`,
          corpo: { revisao: outroDocumento.revisao + 1, motivo: 'Ajuste ao autor coordenador' }, ...segundo,
        });
        expect(segundaDevolucao.status, segundaDevolucao.corpo).toBe(201);
        const motivoAoCoordenador = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `${outraRota}/ultima-devolucao`, cookie: primeiro.cookie,
        });
        expect(motivoAoCoordenador.status, motivoAoCoordenador.corpo).toBe(200);
        expect(ultimaDevolucaoDofSchema.parse(JSON.parse(motivoAoCoordenador.corpo)).devolucao?.motivo)
          .toBe('Ajuste ao autor coordenador');
      } finally {
        await encerrar();
      }
    } finally {
      await cliente.end();
    }
  });

  it('vincula a pré-conferência à revisão da fonte mostrada na prévia', async () => {
    const config = await carregarConfiguracao(arquivoConfig);
    const protetor = new ProtetorDados(config.chaves);
    const cliente = new Client({
      host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
      user: 'sisdoc_migrador', password: senhaMigrador,
    });
    await cliente.connect();
    const pessoaId = randomUUID();
    const vinculoId = randomUUID();
    const cpf = cpfSintetico(900000003);
    const senha = 'RevisaoFonteFicticia!12345';
    const senhaHash = await gerarHashSenha(senha);
    const usuarios = [
      { chave: 'autor', papel: 'analista' },
      { chave: 'destinatario', papel: 'coordenador' },
      { chave: 'outro', papel: 'coordenador' },
    ].map((usuario) => ({
      ...usuario, id: randomUUID(), matricula: `REVISAO-${usuario.chave.toUpperCase()}`,
    }));
    try {
      await cliente.query(`
        INSERT INTO nucleo.pessoa (id, cpf_cifrado, cpf_hash, nome, nome_busca, revisao_fonte)
        VALUES ($1, $2, $3, 'Pessoa de revisão fictícia', 'pessoa de revisao ficticia', 99)
      `, [pessoaId, protetor.cifrar(Buffer.from(cpf, 'ascii'), {
        schema: 'nucleo', tabela: 'pessoa', registroId: pessoaId, campo: 'cpf_cifrado',
      }), protetor.hashCpf(cpf)]);
      await cliente.query(`
        INSERT INTO nucleo.vinculo
          (id, pessoa_id, matricula, matricula_norm, sistema_origem, id_origem, admissao, referencia, revisao_fonte)
        VALUES ($1, $2, 'REVISAO-FICTICIA', 'REVISAO-FICTICIA', 'fonte-revisao-sintetica', $3, '2020-01-01', 'PNS-A', 99)
      `, [vinculoId, pessoaId, randomUUID()]);
      for (const usuario of usuarios) {
        await cliente.query(`
          INSERT INTO seguranca.usuario (id, matricula, nome, senha_hash, papel, troca_senha_obrigatoria)
          VALUES ($1, $2, $3, $4, $5, false)
        `, [usuario.id, usuario.matricula, `Usuário sintético ${usuario.chave}`, senhaHash, usuario.papel]);
      }
      const versoesIniciais = await cliente.query<{ pessoa: string; vinculo: string }>(`
        SELECT p.revisao_fonte::text AS pessoa, v.revisao_fonte::text AS vinculo
        FROM nucleo.pessoa p JOIN nucleo.vinculo v ON v.pessoa_id = p.id WHERE p.id = $1 AND v.id = $2
      `, [pessoaId, vinculoId]);
      expect(versoesIniciais.rows[0]).toEqual({ pessoa: '1', vinculo: '1' });
      const encerrar = await iniciarServico(portaHttps, caPem, arquivoConfig);
      try {
        const sessoes = new Map<string, { cookie: string; csrf: string }>();
        for (const usuario of usuarios) {
          const login = await requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: '/api/v1/auth/login', corpo: { matricula: usuario.matricula, senha },
          });
          expect(login.status, login.corpo).toBe(200);
          const cookie = login.headers['set-cookie']?.[0].split(';')[0];
          if (!cookie) throw new Error('Cookie sintético da revisão de fonte ausente.');
          sessoes.set(usuario.chave, { cookie, csrf: respostaSessaoSchema.parse(JSON.parse(login.corpo)).csrf });
        }
        const sessao = (chave: string) => {
          const resultado = sessoes.get(chave);
          if (!resultado) throw new Error('Sessão sintética da revisão de fonte ausente.');
          return resultado;
        };
        const autor = sessao('autor');
        const destinatario = sessao('destinatario');
        const destinatarioId = usuarios.find((usuario) => usuario.chave === 'destinatario')?.id;
        if (!destinatarioId) throw new Error('Destinatário sintético ausente.');
        const calculo = {
          pessoaId, vinculoId, inicio: '2020-01-01', fim: '2020-12-31', confirmacaoDados: true,
          anos: [{
            ano: 2020, abrangencia: 'intervalo_declarado',
            faltas: 0, ts: 0, pf: 0, ip: 0, outros: 0, pb: 0, pv: 0, licencaPremio: 0,
          }],
        };
        const criado = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: '/api/v1/documentos',
          corpo: { calculo, admissaoEsperada: '2020-01-01', motivo: 'Revisão sintética da fonte' }, ...autor,
        });
        expect(criado.status, criado.corpo).toBe(201);
        const rascunho = rascunhoDofSchema.parse(JSON.parse(criado.corpo));
        const rota = `/api/v1/documentos/${rascunho.id}`;
        const abrir = async (cookie = autor.cookie) => {
          const resposta = await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota: `${rota}/dados-previa`, cookie });
          expect(resposta.status, resposta.corpo).toBe(200);
          expect(resposta.headers['cache-control']).toContain('no-store');
          return dadosFontePreviaDofSchema.parse(JSON.parse(resposta.corpo));
        };
        const verificar = (provaFonte?: string, cookie = autor.cookie) => requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `${rota}/preconferencia`, cookie, provaFonte,
        });
        const previaInicial = await abrir();
        expect(previaInicial.provaFonte).toMatch(/^[0-9a-f]{64}$/);
        const semPrevia = await verificar();
        expect(semPrevia.status, semPrevia.corpo).toBe(200);
        expect(preconferenciaDofSchema.parse(JSON.parse(semPrevia.corpo)).fontePreviaValidada).toBe(false);
        const vinculada = await verificar(previaInicial.provaFonte);
        expect(vinculada.status, vinculada.corpo).toBe(200);
        expect(preconferenciaDofSchema.parse(JSON.parse(vinculada.corpo))).toMatchObject({
          fontePreviaValidada: true, status: 'nao_conferido', conferenciaDisponivel: true,
        });
        expect(vinculada.corpo).not.toContain(previaInicial.provaFonte);
        expect(vinculada.corpo).not.toContain(cpf);
        expect((await verificar('inválida')).status).toBe(400);
        const adulterada = `${previaInicial.provaFonte[0] === 'a' ? 'b' : 'a'}${previaInicial.provaFonte.slice(1)}`;
        expect((await verificar(adulterada)).status).toBe(409);
        expect((await verificar(previaInicial.provaFonte, sessao('outro').cookie)).status).toBe(404);
        const html = await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota: `${rota}/previa`, cookie: autor.cookie });
        expect(html.status, html.corpo).toBe(200);
        expect(html.corpo).not.toContain(previaInicial.provaFonte);

        const outraFonte = await inserirPessoaEVinculo(cliente);
        await cliente.query('UPDATE nucleo.pessoa SET nome = nome WHERE id = $1', [outraFonte.pessoa]);
        await cliente.query('UPDATE nucleo.vinculo SET cargo = cargo WHERE id = $1', [outraFonte.vinculo]);
        expect((await verificar(previaInicial.provaFonte)).status).toBe(200);

        await cliente.query("UPDATE nucleo.pessoa SET nome = 'Nome temporário fictício' WHERE id = $1", [pessoaId]);
        await cliente.query("UPDATE nucleo.pessoa SET nome = 'Pessoa de revisão fictícia', revisao_fonte = 1 WHERE id = $1", [pessoaId]);
        expect((await cliente.query<{ revisao: string }>(
          'SELECT revisao_fonte::text AS revisao FROM nucleo.pessoa WHERE id = $1', [pessoaId],
        )).rows[0].revisao).toBe('3');
        const pessoaMudou = await verificar(previaInicial.provaFonte);
        expect(pessoaMudou.status, pessoaMudou.corpo).toBe(409);
        expect(pessoaMudou.corpo).toContain('Feche e reabra a prévia');
        const previaPessoaAtual = await abrir();
        expect(previaPessoaAtual.nome).toBe(previaInicial.nome);
        expect(previaPessoaAtual.provaFonte).not.toBe(previaInicial.provaFonte);
        expect((await verificar(previaPessoaAtual.provaFonte)).status).toBe(200);

        await cliente.query("UPDATE nucleo.vinculo SET referencia = 'PNS-B' WHERE id = $1", [vinculoId]);
        await cliente.query("UPDATE nucleo.vinculo SET referencia = 'PNS-A', revisao_fonte = 1 WHERE id = $1", [vinculoId]);
        expect((await cliente.query<{ revisao: string }>(
          'SELECT revisao_fonte::text AS revisao FROM nucleo.vinculo WHERE id = $1', [vinculoId],
        )).rows[0].revisao).toBe('3');
        expect((await verificar(previaPessoaAtual.provaFonte)).status).toBe(409);
        const previaVinculoAtual = await abrir();
        expect(previaVinculoAtual.referencia).toBe(previaInicial.referencia);
        expect(previaVinculoAtual.provaFonte).not.toBe(previaPessoaAtual.provaFonte);

        const processo = await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: `${rota}/processo`,
          corpo: { revisao: rascunho.revisao, processo: '1122/3344', motivo: 'Processo fictício' }, ...autor,
        });
        expect(processo.status, processo.corpo).toBe(200);
        const comProcesso = rascunhoDofSchema.parse(JSON.parse(processo.corpo));
        expect((await verificar(previaVinculoAtual.provaFonte)).status).toBe(409);
        expect(preconferenciaDofSchema.parse(JSON.parse((await verificar()).corpo)).fontePreviaValidada).toBe(false);
        const previaAtual = await abrir();
        expect(previaAtual.revisao).toBe(comProcesso.revisao);

        const bloqueador = new Client({
          host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
          user: 'sisdoc_migrador', password: senhaMigrador,
        });
        await bloqueador.connect();
        let confirmado = false;
        try {
          await bloqueador.query('BEGIN');
          await bloqueador.query('UPDATE nucleo.pessoa SET nome = nome WHERE id = $1', [pessoaId]);
          const ocupada = await verificar(previaAtual.provaFonte);
          expect(ocupada.status, ocupada.corpo).toBe(409);
          expect(ocupada.corpo).toContain('sendo atualizada');
          await bloqueador.query('COMMIT');
          confirmado = true;
        } finally {
          if (!confirmado) await bloqueador.query('ROLLBACK');
          await bloqueador.end();
        }
        expect((await verificar(previaAtual.provaFonte)).status).toBe(409);
        const depoisDaEscrita = await abrir();
        expect((await verificar(depoisDaEscrita.provaFonte)).status).toBe(200);

        const segundoCriado = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: '/api/v1/documentos',
          corpo: { calculo, admissaoEsperada: '2020-01-01', motivo: 'Segundo documento fictício' }, ...autor,
        });
        expect(segundoCriado.status, segundoCriado.corpo).toBe(201);
        const segundoDocumento = rascunhoDofSchema.parse(JSON.parse(segundoCriado.corpo));
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `/api/v1/documentos/${segundoDocumento.id}/preconferencia`,
          cookie: autor.cookie, provaFonte: depoisDaEscrita.provaFonte,
        })).status).toBe(409);

        const encaminhado = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${rota}/encaminhar`,
          corpo: { revisao: comProcesso.revisao, destinatarioId }, ...autor,
        });
        expect(encaminhado.status, encaminhado.corpo).toBe(201);
        expect((await verificar(depoisDaEscrita.provaFonte, destinatario.cookie)).status).toBe(409);
        const previaDestinatario = await abrir(destinatario.cookie);
        const consultaDestinatario = await verificar(previaDestinatario.provaFonte, destinatario.cookie);
        expect(consultaDestinatario.status, consultaDestinatario.corpo).toBe(200);
        expect(preconferenciaDofSchema.parse(JSON.parse(consultaDestinatario.corpo)).fontePreviaValidada).toBe(true);

        const auditoria = await cliente.query<{ acao: string; detalhes: unknown }>(`
          SELECT acao, detalhes FROM seguranca.auditoria WHERE entidade_id = $1
        `, [rascunho.id]);
        expect(auditoria.rows.map((evento) => evento.acao)).toContain('preconferencia_fonte_alterada');
        expect(JSON.stringify(auditoria.rows)).not.toContain(cpf);
        expect(JSON.stringify(auditoria.rows)).not.toContain(previaInicial.provaFonte);
        expect((await cliente.query('SELECT count(*) FROM documentos.emissao WHERE documento_id = $1', [rascunho.id])).rows[0].count).toBe('0');
      } finally {
        await encerrar();
      }
    } finally {
      await cliente.end();
    }
  });

  it('confere e devolve DOF com fonte e relatório revalidados atomicamente', async () => {
    const config = await carregarConfiguracao(arquivoConfig);
    const protetor = new ProtetorDados(config.chaves);
    const cliente = new Client({
      host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
      user: 'sisdoc_migrador', password: senhaMigrador,
    });
    await cliente.connect();
    const pessoaId = randomUUID();
    const vinculoId = randomUUID();
    const cpf = cpfSintetico(900000004);
    const senha = 'ConferenciaFicticia!12345';
    const senhaHash = await gerarHashSenha(senha);
    const usuarios = [
      { chave: 'autor', papel: 'analista' },
      { chave: 'destinatario', papel: 'coordenador' },
      { chave: 'outro', papel: 'coordenador' },
      { chave: 'secretario', papel: 'secretario_adjunto' },
      { chave: 'administrador', papel: 'admin' },
    ].map((usuario) => ({
      ...usuario, id: randomUUID(), matricula: `CONFERENCIA-${usuario.chave.toUpperCase()}`,
    }));
    try {
      await cliente.query(`
        INSERT INTO nucleo.pessoa (id, cpf_cifrado, cpf_hash, nome, nome_busca, nascimento, nome_mae_cifrado)
        VALUES ($1, $2, $3, 'Pessoa de conferência fictícia', 'pessoa de conferencia ficticia', '1960-05-04', $4)
      `, [pessoaId, protetor.cifrar(Buffer.from(cpf, 'ascii'), {
        schema: 'nucleo', tabela: 'pessoa', registroId: pessoaId, campo: 'cpf_cifrado',
      }), protetor.hashCpf(cpf), protetor.cifrar(Buffer.from('Filiação fictícia', 'utf8'), {
        schema: 'nucleo', tabela: 'pessoa', registroId: pessoaId, campo: 'nome_mae_cifrado',
      })]);
      await cliente.query(`
        INSERT INTO nucleo.vinculo
          (id, pessoa_id, matricula, matricula_norm, sistema_origem, id_origem, admissao, cargo, referencia, regime_juridico, orgao_nome)
        VALUES ($1, $2, 'CONFERENCIA-FICTICIA', 'CONFERENCIA-FICTICIA',
          'fonte-conferencia-sintetica', $3, '1980-01-01', 'Cargo fictício', 'PNS-A', 'Regime fictício', 'Órgão fictício')
      `, [vinculoId, pessoaId, randomUUID()]);
      for (const usuario of usuarios) {
        await cliente.query(`
          INSERT INTO seguranca.usuario (id, matricula, nome, senha_hash, papel, troca_senha_obrigatoria)
          VALUES ($1, $2, $3, $4, $5, false)
        `, [usuario.id, usuario.matricula, `Operador sintético ${usuario.chave}`, senhaHash, usuario.papel]);
      }
      const encerrar = await iniciarServico(portaHttps, caPem, arquivoConfig);
      try {
        const sessoes = new Map<string, { cookie: string; csrf: string }>();
        for (const usuario of usuarios) {
          const login = await requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: '/api/v1/auth/login', corpo: { matricula: usuario.matricula, senha },
          });
          expect(login.status, login.corpo).toBe(200);
          const cookie = login.headers['set-cookie']?.[0].split(';')[0];
          if (!cookie) throw new Error('Cookie sintético de conferência ausente.');
          sessoes.set(usuario.chave, { cookie, csrf: respostaSessaoSchema.parse(JSON.parse(login.corpo)).csrf });
        }
        const sessao = (chave: string) => {
          const resultado = sessoes.get(chave);
          if (!resultado) throw new Error('Sessão sintética de conferência ausente.');
          return resultado;
        };
        const autor = sessao('autor');
        const destinatario = sessao('destinatario');
        const destinatarioId = usuarios.find((usuario) => usuario.chave === 'destinatario')?.id;
        if (!destinatarioId) throw new Error('Destinatário sintético ausente.');
        const calculo = {
          pessoaId, vinculoId, inicio: '1980-01-01', fim: '2024-12-31', confirmacaoDados: true,
          anos: Array.from({ length: 45 }, (_, indice) => ({
            ano: 1980 + indice, abrangencia: 'intervalo_declarado',
            faltas: 0, ts: 0, pf: 0, ip: 0, outros: 0, pb: 0, pv: 0, licencaPremio: 0,
          })),
        };
        const criado = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: '/api/v1/documentos',
          corpo: { calculo, admissaoEsperada: '1980-01-01', motivo: 'Cálculo sintético de 45 anos' }, ...autor,
        });
        expect(criado.status, criado.corpo).toBe(201);
        const rascunho = rascunhoDofSchema.parse(JSON.parse(criado.corpo));
        expect(rascunho.resultado.periodo.linhas).toHaveLength(45);
        const rota = `/api/v1/documentos/${rascunho.id}`;
        const abrir = async (usuario = autor) => {
          const resposta = await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota: `${rota}/dados-previa`, cookie: usuario.cookie });
          expect(resposta.status, resposta.corpo).toBe(200);
          return dadosFontePreviaDofSchema.parse(JSON.parse(resposta.corpo));
        };
        const verificar = async (prova: string, usuario = autor) => {
          const resposta = await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: `${rota}/preconferencia`, cookie: usuario.cookie, provaFonte: prova,
          });
          expect(resposta.status, resposta.corpo).toBe(200);
          return preconferenciaDofSchema.parse(JSON.parse(resposta.corpo));
        };
        const pedirConferencia = (usuario: { cookie: string; csrf: string }, revisao: number, provaFonte: string, provaRelatorio: string) =>
          requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: `${rota}/conferir`,
            corpo: { revisao, provaFonte, provaRelatorio, confirmar: true }, ...usuario,
          });
        const previaSemProcesso = await abrir();
        const bloqueada = await verificar(previaSemProcesso.provaFonte);
        expect(bloqueada.bloqueios.map((item) => item.codigo)).toContain('processo_ausente');
        if (!bloqueada.provaRelatorio) throw new Error('Prova sintética do relatório ausente.');
        expect((await pedirConferencia(autor, 1, previaSemProcesso.provaFonte, bloqueada.provaRelatorio)).status).toBe(409);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${rota}/conferir`, corpo: { revisao: 1, confirmar: true }, ...autor,
        })).status).toBe(400);

        const processo = await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: `${rota}/processo`,
          corpo: { revisao: 1, processo: '1234/5678', motivo: 'Processo fictício' }, ...autor,
        });
        expect(processo.status, processo.corpo).toBe(200);
        const comProcesso = rascunhoDofSchema.parse(JSON.parse(processo.corpo));
        const camposFonte = [
          { nome: 'data de nascimento', id: pessoaId, sql: 'UPDATE nucleo.pessoa SET nascimento = $2 WHERE id = $1',
            ausente: null, completo: '1960-05-04' },
          { nome: 'nome da mãe', id: pessoaId, sql: 'UPDATE nucleo.pessoa SET nome_mae_cifrado = $2 WHERE id = $1',
            ausente: null, completo: protetor.cifrar(Buffer.from('Filiação fictícia', 'utf8'), {
              schema: 'nucleo', tabela: 'pessoa', registroId: pessoaId, campo: 'nome_mae_cifrado',
            }) },
          { nome: 'regime jurídico', id: vinculoId, sql: 'UPDATE nucleo.vinculo SET regime_juridico = $2 WHERE id = $1',
            ausente: ' ', completo: 'Regime fictício' },
          { nome: 'cargo', id: vinculoId, sql: 'UPDATE nucleo.vinculo SET cargo = $2 WHERE id = $1',
            ausente: null, completo: 'Cargo fictício' },
          { nome: 'referência/padrão', id: vinculoId, sql: 'UPDATE nucleo.vinculo SET referencia = $2 WHERE id = $1',
            ausente: '', completo: 'PNS-A' },
          { nome: 'órgão de origem', id: vinculoId, sql: 'UPDATE nucleo.vinculo SET orgao_nome = $2 WHERE id = $1',
            ausente: null, completo: 'Órgão fictício' },
        ];
        for (const campo of camposFonte) {
          await cliente.query(campo.sql, [campo.id, campo.ausente]);
          const previaIncompleta = await abrir();
          const incompleta = await verificar(previaIncompleta.provaFonte);
          expect(incompleta.bloqueios.find((item) => item.codigo === 'campos_referencia_ausentes')?.mensagem)
            .toContain(campo.nome);
          if (!incompleta.provaRelatorio) throw new Error('Prova sintética do relatório incompleto ausente.');
          expect((await pedirConferencia(autor, comProcesso.revisao,
            previaIncompleta.provaFonte, incompleta.provaRelatorio)).status).toBe(409);
          await cliente.query(campo.sql, [campo.id, campo.completo]);
        }
        const previaAntesEnvio = await abrir();
        const relatorioAntesEnvio = await verificar(previaAntesEnvio.provaFonte);
        if (!relatorioAntesEnvio.provaRelatorio) throw new Error('Prova sintética do relatório ausente.');
        expect((await pedirConferencia(destinatario, comProcesso.revisao,
          previaAntesEnvio.provaFonte, relatorioAntesEnvio.provaRelatorio)).status).toBe(404);
        const encaminhado = await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${rota}/encaminhar`,
          corpo: { revisao: comProcesso.revisao, destinatarioId }, ...autor,
        });
        expect(encaminhado.status, encaminhado.corpo).toBe(201);
        const revisao = rascunhoDofSchema.parse(JSON.parse(encaminhado.corpo)).revisao;
        let previa = await abrir(destinatario);
        let relatorio = await verificar(previa.provaFonte, destinatario);
        expect(relatorio.bloqueios).toEqual([]);
        expect(relatorio.avisos.map((item) => item.codigo)).toEqual(expect.arrayContaining([
          'aprovacao_modelo_nao_verificada', 'regra_provisoria',
        ]));
        if (!relatorio.provaRelatorio) throw new Error('Prova sintética do relatório ausente.');
        const relatorioAutor = await verificar(previa.provaFonte, autor);
        if (!relatorioAutor.provaRelatorio) throw new Error('Prova sintética do autor ausente.');
        expect(relatorioAutor.provaRelatorio).not.toBe(relatorio.provaRelatorio);
        expect((await pedirConferencia(destinatario, revisao, previa.provaFonte, relatorioAutor.provaRelatorio)).status).toBe(409);
        expect((await pedirConferencia(destinatario, revisao - 1, previa.provaFonte, relatorio.provaRelatorio)).status).toBe(409);
        expect((await pedirConferencia(destinatario, revisao, previa.provaFonte, 'a'.repeat(64))).status).toBe(409);
        expect((await pedirConferencia(sessao('outro'), revisao, previa.provaFonte, relatorio.provaRelatorio)).status).toBe(404);
        for (const chave of ['secretario']) {
          expect((await pedirConferencia(sessao(chave), revisao, previa.provaFonte, relatorio.provaRelatorio)).status).toBe(403);
        }
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'POST', rota: `${rota}/conferir`,
          corpo: { revisao, provaFonte: previa.provaFonte, provaRelatorio: relatorio.provaRelatorio, confirmar: true },
          cookie: destinatario.cookie,
        })).status).toBe(403);

        const outraFonte = await inserirPessoaEVinculo(cliente);
        await cliente.query(`
          UPDATE nucleo.vinculo SET matricula = 'CONFERENCIA-FICTICIA', matricula_norm = 'CONFERENCIA-FICTICIA'
          WHERE id = $1
        `, [outraFonte.vinculo]);
        expect((await pedirConferencia(destinatario, revisao, previa.provaFonte, relatorio.provaRelatorio)).status).toBe(409);
        const ambigua = await verificar(previa.provaFonte, destinatario);
        expect(ambigua.bloqueios.map((item) => item.codigo)).toContain('matricula_ambigua');
        if (!ambigua.provaRelatorio) throw new Error('Prova sintética de relatório ambíguo ausente.');
        expect((await pedirConferencia(destinatario, revisao, previa.provaFonte, ambigua.provaRelatorio)).status).toBe(409);
        await cliente.query('UPDATE nucleo.vinculo SET removido_na_fonte_em = now() WHERE id = $1', [outraFonte.vinculo]);

        const bloqueador = new Client({
          host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
          user: 'sisdoc_migrador', password: senhaMigrador,
        });
        await bloqueador.connect();
        let confirmado = false;
        try {
          await bloqueador.query('BEGIN');
          await bloqueador.query('UPDATE nucleo.vinculo SET cargo = cargo WHERE id = $1', [vinculoId]);
          const ocupada = await pedirConferencia(destinatario, revisao, previa.provaFonte, relatorio.provaRelatorio);
          expect(ocupada.status, ocupada.corpo).toBe(409);
          expect(ocupada.corpo).toContain('sendo atualizada');
          await bloqueador.query('COMMIT');
          confirmado = true;
        } finally {
          if (!confirmado) await bloqueador.query('ROLLBACK');
          await bloqueador.end();
        }
        expect((await pedirConferencia(destinatario, revisao, previa.provaFonte, relatorio.provaRelatorio)).status).toBe(409);
        previa = await abrir(destinatario);
        relatorio = await verificar(previa.provaFonte, destinatario);
        const relatorioAutorAtual = await verificar(previa.provaFonte, autor);
        if (!relatorio.provaRelatorio || !relatorioAutorAtual.provaRelatorio) throw new Error('Provas sintéticas ausentes.');
        const fonteAoConferir = await cliente.query<{ pessoa: string; vinculo: string }>(`
          SELECT p.revisao_fonte::text AS pessoa, v.revisao_fonte::text AS vinculo
          FROM nucleo.pessoa p JOIN nucleo.vinculo v ON v.pessoa_id = p.id WHERE p.id = $1 AND v.id = $2
        `, [pessoaId, vinculoId]);
        const concorrentes = await Promise.all([
          pedirConferencia(autor, revisao, previa.provaFonte, relatorioAutorAtual.provaRelatorio),
          pedirConferencia(destinatario, revisao, previa.provaFonte, relatorio.provaRelatorio),
        ]);
        expect(concorrentes.map((item) => item.status).sort()).toEqual([201, 404]);
        const sucesso = concorrentes.find((item) => item.status === 201);
        if (!sucesso) throw new Error('Nenhuma conferência sintética foi registrada.');
        const conferido = resultadoConferenciaDofSchema.parse(JSON.parse(sucesso.corpo));
        expect(conferido).toMatchObject({ documentoId: rascunho.id, revisao: revisao + 1, status: 'conferido' });
        const eventos = await cliente.query<{
          id: string; avisos: string[]; revisao_pessoa: string; revisao_vinculo: string;
        }>('SELECT id, avisos, revisao_pessoa, revisao_vinculo FROM documentos.conferencia_dof WHERE documento_id = $1', [rascunho.id]);
        expect(eventos.rows).toHaveLength(1);
        expect(eventos.rows[0].avisos).toEqual(expect.arrayContaining(['aprovacao_modelo_nao_verificada', 'regra_provisoria']));
        expect(eventos.rows[0].revisao_pessoa).toBe(fonteAoConferir.rows[0].pessoa);
        expect(eventos.rows[0].revisao_vinculo).toBe(fonteAoConferir.rows[0].vinculo);
        expect((await pedirConferencia(destinatario, revisao, previa.provaFonte, relatorio.provaRelatorio)).status).toBe(404);
        await expect(cliente.query('UPDATE documentos.conferencia_dof SET avisos = $1 WHERE id = $2',
          [[], eventos.rows[0].id])).rejects.toMatchObject({ code: '55000' });
        await expect(cliente.query('DELETE FROM documentos.conferencia_dof WHERE id = $1',
          [eventos.rows[0].id])).rejects.toMatchObject({ code: '55000' });
        await expect(cliente.query('UPDATE documentos.documento SET entrada_cifrada = $2 WHERE id = $1',
          [rascunho.id, randomBytes(48)])).rejects.toMatchObject({ code: '55000' });

        const lista = async (usuario: { cookie: string }) => {
          const resposta = await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: '/api/v1/documentos/conferidos', cookie: usuario.cookie,
          });
          expect(resposta.status, resposta.corpo).toBe(200);
          return paginaConferidosDofSchema.parse(JSON.parse(resposta.corpo)).itens;
        };
        expect((await lista(autor)).some((item) => item.id === rascunho.id)).toBe(true);
        expect((await lista(destinatario)).some((item) => item.id === rascunho.id)).toBe(true);
        expect((await lista(sessao('outro'))).some((item) => item.id === rascunho.id)).toBe(false);
        for (const chave of ['secretario']) {
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: '/api/v1/documentos/conferidos', cookie: sessao(chave).cookie,
          })).status).toBe(403);
        }
        const rotaDadosPrevia = `${rota}/dados-previa-conferida`;
        const dadosAntesDaAlteracao = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: rotaDadosPrevia, cookie: destinatario.cookie,
        });
        expect(dadosAntesDaAlteracao.status, dadosAntesDaAlteracao.corpo).toBe(200);
        expect(previaConferidaDofSchema.parse(JSON.parse(dadosAntesDaAlteracao.corpo)).fonteSelecionadaAlterada).toBe(false);
        await cliente.query("UPDATE nucleo.pessoa SET nome = 'Pessoa atualizada fictícia' WHERE id = $1", [pessoaId]);
        expect((await lista(destinatario)).find((item) => item.id === rascunho.id)?.fonteSelecionadaAlterada).toBe(true);
        const previaConferida = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `${rota}/previa-conferida`, cookie: destinatario.cookie,
        });
        expect(previaConferida.status, previaConferida.corpo).toBe(200);
        expect(previaConferida.headers['content-security-policy']).toContain('sandbox');
        expect(previaConferida.headers['cache-control']).toContain('no-store');
        expect(previaConferida.corpo).not.toContain(previa.provaFonte);
        expect(previaConferida.corpo).toContain('A pessoa ou o vínculo mudou após a conferência.');
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `${rota}/previa-conferida`, cookie: sessao('outro').cookie,
        })).status).toBe(404);
        expect((await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota: rotaDadosPrevia })).status).toBe(401);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: rotaDadosPrevia, cookie: sessao('outro').cookie,
        })).status).toBe(404);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: rotaDadosPrevia, cookie: sessao('administrador').cookie,
        })).status).toBe(200);
        const dadosPrevia = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: rotaDadosPrevia, cookie: destinatario.cookie,
        });
        expect(dadosPrevia.status, dadosPrevia.corpo).toBe(200);
        expect(dadosPrevia.headers['cache-control']).toContain('no-store');
        const dadosAtuais = previaConferidaDofSchema.parse(JSON.parse(dadosPrevia.corpo));
        expect(dadosAtuais).toMatchObject({
          documentoId: rascunho.id, revisao: conferido.revisao, status: 'conferido',
          nome: 'Pessoa atualizada fictícia', fonte: { nome: 'Pessoa atualizada fictícia' }, fonteSelecionadaAlterada: true,
        });
        expect(dadosAtuais.resultado.periodo.linhas).toHaveLength(45);
        expect(previaConferidaDofSchema.safeParse({
          ...dadosAtuais, fonte: { ...dadosAtuais.fonte, documentoId: randomUUID() },
        }).success).toBe(false);
        expect(previaConferidaDofSchema.safeParse({
          ...dadosAtuais, fonte: { ...dadosAtuais.fonte, revisao: dadosAtuais.revisao + 1 },
        }).success).toBe(false);

        const motivo = 'Ajustar dado fictício <img src=x>';
        const devolver = (usuario: { cookie: string; csrf: string }, revisaoPedido: number, texto = motivo) =>
          requisitarApi(portaHttps, caPem, {
            metodo: 'POST', rota: `${rota}/devolver-conferido`,
            corpo: { revisao: revisaoPedido, motivo: texto }, ...usuario,
          });
        expect((await devolver(autor, conferido.revisao)).status).toBe(403);
        expect((await devolver(sessao('outro'), conferido.revisao)).status).toBe(404);
        expect((await devolver(destinatario, conferido.revisao, ' ')).status).toBe(400);
        expect((await devolver(destinatario, conferido.revisao - 1)).status).toBe(409);
        const devolvido = await devolver(destinatario, conferido.revisao);
        expect(devolvido.status, devolvido.corpo).toBe(201);
        expect(resultadoDevolucaoConferidoDofSchema.parse(JSON.parse(devolvido.corpo))).toMatchObject({
          documentoId: rascunho.id, revisao: conferido.revisao + 1, status: 'rascunho',
        });
        expect((await devolver(destinatario, conferido.revisao)).status).toBe(404);
        expect((await pedirConferencia(autor, revisao, previa.provaFonte, relatorioAutorAtual.provaRelatorio)).status).toBe(409);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: rotaDadosPrevia, cookie: autor.cookie,
        })).status).toBe(404);
        const ultima = await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `${rota}/ultima-devolucao`, cookie: autor.cookie,
        });
        expect(ultima.status, ultima.corpo).toBe(200);
        expect(ultimaDevolucaoDofSchema.parse(JSON.parse(ultima.corpo)).devolucao?.motivo).toBe(motivo);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: `${rota}/ultima-devolucao`, cookie: destinatario.cookie,
        })).status).toBe(404);
        const retorno = await cliente.query<{ id: string; motivo_cifrado: Buffer }>(`
          SELECT id, motivo_cifrado FROM documentos.devolucao_conferido_dof WHERE documento_id = $1
        `, [rascunho.id]);
        expect(retorno.rows).toHaveLength(1);
        expect(retorno.rows[0].motivo_cifrado.includes(Buffer.from(motivo))).toBe(false);
        expect(JSON.parse(protetor.decifrar(retorno.rows[0].motivo_cifrado, {
          schema: 'documentos', tabela: 'devolucao_conferido_dof', registroId: retorno.rows[0].id, campo: 'motivo_cifrado',
        }).toString('utf8'))).toBe(motivo);
        await expect(cliente.query('DELETE FROM documentos.devolucao_conferido_dof WHERE id = $1',
          [retorno.rows[0].id])).rejects.toMatchObject({ code: '55000' });
        await expect(cliente.query('UPDATE documentos.devolucao_conferido_dof SET motivo_cifrado = $2 WHERE id = $1',
          [retorno.rows[0].id, randomBytes(48)])).rejects.toMatchObject({ code: '55000' });
        await expect(cliente.query('TRUNCATE documentos.devolucao_conferido_dof')).rejects.toMatchObject({ code: '55000' });
        const auditoria = await cliente.query<{ acao: string; detalhes: unknown }>(`
          SELECT acao, detalhes FROM seguranca.auditoria WHERE entidade_id = $1
        `, [rascunho.id]);
        expect(auditoria.rows.map((evento) => evento.acao)).toEqual(expect.arrayContaining([
          'dof_conferida', 'dof_conferida_devolvida', 'conferencia_dof_relatorio_alterado',
          'conferencia_dof_fonte_alterada', 'conferencia_dof_fonte_ocupada', 'conferencia_dof_com_pendencias',
        ]));
        const detalhes = JSON.stringify(auditoria.rows);
        for (const dado of [cpf, motivo, previa.provaFonte, relatorio.provaRelatorio]) expect(detalhes).not.toContain(dado);
        expect((await cliente.query('SELECT count(*) FROM documentos.emissao WHERE documento_id = $1', [rascunho.id])).rows[0].count).toBe('0');
      } finally {
        await encerrar();
      }
    } finally {
      await cliente.end();
    }
  });

  it('processa jobs provisórios somente após commit e retoma a mesma emissão em banco descartável', async () => {
    const cliente = new Client({
      host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
      user: 'sisdoc_migrador', password: senhaMigrador,
    });
    await cliente.connect();
    const banco = new Pool({
      host: '127.0.0.1', port: portaBanco, database: opcoes.banco.nome,
      user: 'sisdoc_migrador', password: senhaMigrador, max: 5,
    });
    const pasta = path.join(temporario, `pdf-worker-${randomUUID()}`);
    let navegador: Browser | undefined;
    let transacaoAberta = false;
    try {
      await mkdir(pasta);
      navegador = await chromium.launch({ headless: true });
      const browser = navegador;
      const protetor = new ProtetorDados({
        cifra: randomBytes(32).toString('base64'), hmac: randomBytes(32).toString('base64'),
      });
      const armazenamento = new ArmazenamentoPdf(pasta);
      const processador = new ProcessadorPdfProvisorio(
        banco, protetor, armazenamento, (dados) => renderizarPdfProvisorioDof(browser, dados), 30000,
      );
      await expect(processador.reagendar('id-invalido')).rejects.toThrow('Identificador de job de PDF inválido');
      await expect(processador.reagendar(randomUUID())).rejects.toThrow('Job de PDF não encontrado');
      const privilegios = await cliente.query<{ job: boolean; artefato: boolean }>(`
        SELECT has_table_privilege('sisdoc_aplicativo', 'documentos.job_pdf', 'UPDATE') AS job,
          has_table_privilege('sisdoc_aplicativo', 'documentos.artefato_pdf', 'INSERT') AS artefato
      `);
      expect(privilegios.rows[0]).toEqual({ job: false, artefato: false });
      const usuario = randomUUID();
      const regra = randomUUID();
      const template = randomUUID();
      await cliente.query(`
        INSERT INTO seguranca.usuario (id, matricula, nome, senha_hash, papel, troca_senha_obrigatoria)
        VALUES ($1, $2, 'Coordenador sintético', 'hash-sintetico', 'coordenador', false)
      `, [usuario, `COORD-PDF-${usuario}`]);
      await cliente.query(`
        INSERT INTO documentos.regra_versao (id, codigo, versao, configuracao, evidencia, vigente_de)
        VALUES ($1, $2, '1', '{}', 'inferido', '2024-01-01')
      `, [regra, `regra-pdf-sintetica-${regra}`]);
      await cliente.query(`
        INSERT INTO documentos.template_versao (id, tipo, versao, html, css, vigente_de)
        VALUES ($1, 'DOF', $2, '<p>Modelo sintético</p>', '', '2024-01-01')
      `, [template, `worker-sintetico-${template}`]);

      const criarJob = async (
        numero: number, documentoDivergente = false, snapshotAdulterado = false, emitirDocumento = true,
      ) => {
        const { pessoa, vinculo } = await inserirPessoaEVinculo(cliente);
        const documento = randomUUID();
        const emissao = randomUUID();
        const job = randomUUID();
        await cliente.query(`
          INSERT INTO documentos.documento (
            id, tipo, pessoa_id, vinculo_id, entrada_cifrada, template_versao_id,
            regra_versao_id, criado_por, atualizado_por
          ) VALUES ($1, 'DOF', $2, $3, $4, $5, $6, $7, $7)
        `, [documento, pessoa, vinculo, randomBytes(48), template, regra, usuario]);
        await cliente.query(`
          INSERT INTO documentos.documento_periodo (documento_id, ordem, inicio, fim)
          VALUES ($1, 1, '1980-01-01', '2024-12-31')
        `, [documento]);
        await conferirSqlSintetico(cliente, documento, usuario);
        const previa = previaDofSintetica();
        previa.documentoId = documento;
        previa.fonte.documentoId = documento;
        const dados = capturarDadosPdfProvisorioDof(previa);
        if (documentoDivergente) dados.documentoId = randomUUID();
        const snapshot = protetor.cifrar(Buffer.from(JSON.stringify(dados), 'utf8'), {
          schema: 'documentos', tabela: 'emissao', registroId: emissao, campo: 'snapshot_cifrado',
        });
        if (snapshotAdulterado) {
          snapshot[snapshot.length - 1] = snapshot.readUInt8(snapshot.length - 1) ^ 1;
        }
        await cliente.query(`
          INSERT INTO documentos.emissao (
            id, documento_id, tipo, ano, numero, numero_formatado, chave_idempotencia, snapshot_cifrado, emitido_por
          ) VALUES ($1, $2, 'DOF', 2024, $3, $4, $5, $6, $7)
        `, [emissao, documento, numero, `TESTE-${numero}`, `PDF-SINTETICO-${emissao}`, snapshot, usuario]);
        if (emitirDocumento) {
          await cliente.query("UPDATE documentos.documento SET status = 'emitido' WHERE id = $1", [documento]);
        }
        await cliente.query(`
          INSERT INTO documentos.job_pdf (id, emissao_id, status) VALUES ($1, $2, 'pendente')
        `, [job, emissao]);
        return { documento, emissao, job, numero, snapshot };
      };
      const bancoComFalhaDeConfirmacao = (confirmar: boolean, commitAlvo = 2): Pool => {
        let commits = 0;
        return new Proxy(banco, {
          get(alvo, propriedade, receptor) {
            if (propriedade !== 'connect') return Reflect.get(alvo, propriedade, receptor);
            return async () => {
              const conexao = await alvo.connect();
              return new Proxy(conexao, {
                get(clienteReal, nome, receptorCliente) {
                  if (nome !== 'query') return Reflect.get(clienteReal, nome, receptorCliente);
                  return (...argumentos: unknown[]) => {
                    if (argumentos[0] === 'COMMIT' && ++commits === commitAlvo) {
                      return (async () => {
                        if (confirmar) await clienteReal.query('COMMIT');
                        throw new Error('Falha sintética de confirmação.');
                      })();
                    }
                    return Reflect.apply(clienteReal.query, clienteReal, argumentos);
                  };
                },
              });
            };
          },
        });
      };

      await cliente.query('BEGIN');
      transacaoAberta = true;
      const primeiro = await criarJob(50001);
      expect(await processador.processarUm()).toEqual({ estado: 'sem_trabalho' });
      await cliente.query('COMMIT');
      transacaoAberta = false;
      const concluido = await processador.processarUm();
      expect(concluido.estado).toBe('concluido');
      if (concluido.estado !== 'concluido') throw new Error('Job sintético não foi concluído.');
      expect(concluido).toMatchObject({ jobId: primeiro.job, emissaoId: primeiro.emissao });
      const dadosGravados = await cliente.query<{
        status: string; tentativas: number; caminho_relativo: string; sha256: Buffer; snapshot_cifrado: Buffer;
      }>(`
        SELECT j.status, j.tentativas, a.caminho_relativo, a.sha256, e.snapshot_cifrado
        FROM documentos.job_pdf j JOIN documentos.emissao e ON e.id = j.emissao_id
        JOIN documentos.artefato_pdf a ON a.job_id = j.id WHERE j.id = $1
      `, [primeiro.job]);
      expect(dadosGravados.rows).toHaveLength(1);
      expect(dadosGravados.rows[0]).toMatchObject({
        status: 'concluido', tentativas: 1, caminho_relativo: `${concluido.artefatoId}.pdf`,
      });
      expect(dadosGravados.rows[0].snapshot_cifrado.equals(primeiro.snapshot)).toBe(true);
      const pdf = await armazenamento.ler(concluido.artefatoId, dadosGravados.rows[0].sha256.toString('hex'));
      expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(await processador.reagendar(primeiro.job)).toEqual({
        estado: 'concluido', jobId: primeiro.job, emissaoId: primeiro.emissao,
      });
      await expect(cliente.query('UPDATE documentos.emissao SET snapshot_cifrado = $2 WHERE id = $1',
        [primeiro.emissao, randomBytes(48)])).rejects.toMatchObject({ code: '55000' });
      expect(await processador.processarUm()).toEqual({ estado: 'sem_trabalho' });

      const segundo = await criarJob(50002);
      const falhaRenderizacao = new ProcessadorPdfProvisorio(
        banco, protetor, armazenamento, async () => { throw new Error('DADO-SENSIVEL-SINTETICO'); }, 30000,
      );
      await expect(falhaRenderizacao.processarUm()).rejects.toThrow('job foi marcado como falho');
      const falho = await cliente.query<{ status: string; tentativas: number; erro_sanitizado: string }>(
        'SELECT status, tentativas, erro_sanitizado FROM documentos.job_pdf WHERE id = $1', [segundo.job],
      );
      expect(falho.rows[0]).toEqual({
        status: 'falhou', tentativas: 1, erro_sanitizado: 'Falha ao gerar ou gravar PDF provisório.',
      });
      expect(falho.rows[0].erro_sanitizado).not.toContain('DADO-SENSIVEL-SINTETICO');
      const reagendamentos = await Promise.all([
        processador.reagendar(segundo.job), processador.reagendar(segundo.job),
      ]);
      expect(reagendamentos.map((resultado) => resultado.estado).sort()).toEqual(['pendente', 'reagendado']);
      expect(reagendamentos.every((resultado) => resultado.jobId === segundo.job && resultado.emissaoId === segundo.emissao))
        .toBe(true);
      expect((await cliente.query('SELECT erro_sanitizado FROM documentos.job_pdf WHERE id = $1', [segundo.job])).rows[0].erro_sanitizado)
        .toBeNull();
      const recuperado = await processador.processarUm();
      expect(recuperado).toMatchObject({ estado: 'concluido', jobId: segundo.job, emissaoId: segundo.emissao });
      const segundaConsulta = await cliente.query<{ tentativas: number; numero: string; quantidade: string }>(`
        SELECT j.tentativas, e.numero::text AS numero,
          (SELECT count(*) FROM documentos.emissao WHERE documento_id = e.documento_id)::text AS quantidade
        FROM documentos.job_pdf j JOIN documentos.emissao e ON e.id = j.emissao_id WHERE j.id = $1
      `, [segundo.job]);
      expect(segundaConsulta.rows[0]).toEqual({ tentativas: 2, numero: String(segundo.numero), quantidade: '1' });

      const terceiro = await criarJob(50003);
      const falhaDepoisDoArquivo = new ProcessadorPdfProvisorio(banco, protetor, {
        gravar: async (id, conteudo) => {
          await armazenamento.gravar(id, conteudo);
          throw new Error('Falha sintética após publicação.');
        },
      }, async () => pdf, 30000);
      const arquivosAntes = (await readdir(pasta)).length;
      await expect(falhaDepoisDoArquivo.processarUm()).rejects.toThrow('job foi marcado como falho');
      expect((await readdir(pasta)).length).toBe(arquivosAntes + 1);
      expect((await cliente.query('SELECT count(*) FROM documentos.artefato_pdf WHERE emissao_id = $1', [terceiro.emissao])).rows[0].count).toBe('0');
      expect(await processador.reagendar(terceiro.job)).toEqual({
        estado: 'reagendado', jobId: terceiro.job, emissaoId: terceiro.emissao,
      });
      expect(await processador.processarUm()).toMatchObject({
        estado: 'concluido', jobId: terceiro.job, emissaoId: terceiro.emissao,
      });
      expect((await readdir(pasta)).length).toBe(arquivosAntes + 2);
      expect((await cliente.query('SELECT count(*) FROM documentos.emissao WHERE documento_id = $1', [terceiro.documento])).rows[0].count).toBe('1');

      const quarto = await criarJob(50004);
      let sinalizarInicio: () => void = () => {};
      let liberar: () => void = () => {};
      const iniciado = new Promise<void>((resolver) => { sinalizarInicio = resolver; });
      const liberacao = new Promise<void>((resolver) => { liberar = resolver; });
      const lento = new ProcessadorPdfProvisorio(banco, protetor, armazenamento, async () => {
        sinalizarInicio();
        await liberacao;
        return pdf;
      }, 30000);
      const pendente = lento.processarUm();
      try {
        await iniciado;
        expect(await processador.reagendar(quarto.job)).toEqual({
          estado: 'processando', jobId: quarto.job, emissaoId: quarto.emissao,
        });
        const posseAntiga = await cliente.query<{ posse: string }>('SELECT posse FROM documentos.job_pdf WHERE id = $1', [quarto.job]);
        await cliente.query(`
          UPDATE documentos.job_pdf SET posse_expira_em = clock_timestamp() - interval '1 second' WHERE id = $1
        `, [quarto.job]);
        const novaTentativa = await processador.processarUm();
        expect(novaTentativa).toMatchObject({ estado: 'concluido', jobId: quarto.job, emissaoId: quarto.emissao });
        if (novaTentativa.estado !== 'concluido') throw new Error('A retomada sintética falhou.');
        expect(novaTentativa.artefatoId).not.toBe(posseAntiga.rows[0].posse);
        liberar();
        expect(await pendente).toEqual({ estado: 'posse_perdida', jobId: quarto.job, emissaoId: quarto.emissao });
        const estadoFinal = await cliente.query<{ status: string; tentativas: number; artefatos: string; emissoes: string }>(`
          SELECT j.status, j.tentativas,
            (SELECT count(*) FROM documentos.artefato_pdf WHERE job_id = j.id)::text AS artefatos,
            (SELECT count(*) FROM documentos.emissao WHERE documento_id = e.documento_id)::text AS emissoes
          FROM documentos.job_pdf j JOIN documentos.emissao e ON e.id = j.emissao_id WHERE j.id = $1
        `, [quarto.job]);
        expect(estadoFinal.rows[0]).toEqual({ status: 'concluido', tentativas: 2, artefatos: '1', emissoes: '1' });
      } finally {
        liberar();
        await pendente;
      }

      const quinto = await criarJob(50005, true);
      await expect(processador.processarUm()).rejects.toThrow('job foi marcado como falho');
      expect((await cliente.query('SELECT count(*) FROM documentos.artefato_pdf WHERE emissao_id = $1', [quinto.emissao])).rows[0].count).toBe('0');

      const sexto = await criarJob(50006);
      const paralelos = await Promise.all([processador.processarUm(), processador.processarUm()]);
      expect(paralelos.map((resultado) => resultado.estado).sort()).toEqual(['concluido', 'sem_trabalho']);
      expect(paralelos.find((resultado) => resultado.estado === 'concluido'))
        .toMatchObject({ jobId: sexto.job, emissaoId: sexto.emissao });

      const setimo = await criarJob(50007);
      await cliente.query(`
        CREATE FUNCTION documentos.falhar_conclusao_pdf_sintetico() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.status = 'concluido' THEN
            RAISE EXCEPTION 'Falha sintética antes do commit do artefato.' USING ERRCODE = 'P0001';
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER falha_pdf_sintetica BEFORE UPDATE ON documentos.job_pdf
          FOR EACH ROW EXECUTE FUNCTION documentos.falhar_conclusao_pdf_sintetico()
      `);
      try {
        await expect(processador.processarUm()).rejects.toThrow('job foi marcado como falho');
        const revertido = await cliente.query<{ status: string; artefatos: string; emissoes: string; numero: string }>(`
          SELECT j.status, e.numero::text AS numero,
            (SELECT count(*) FROM documentos.artefato_pdf WHERE job_id = j.id)::text AS artefatos,
            (SELECT count(*) FROM documentos.emissao WHERE documento_id = e.documento_id)::text AS emissoes
          FROM documentos.job_pdf j JOIN documentos.emissao e ON e.id = j.emissao_id WHERE j.id = $1
        `, [setimo.job]);
        expect(revertido.rows[0]).toEqual({
          status: 'falhou', numero: String(setimo.numero), artefatos: '0', emissoes: '1',
        });
      } finally {
        await cliente.query('DROP TRIGGER falha_pdf_sintetica ON documentos.job_pdf');
        await cliente.query('DROP FUNCTION documentos.falhar_conclusao_pdf_sintetico()');
      }
      expect(await processador.reagendar(setimo.job)).toEqual({
        estado: 'reagendado', jobId: setimo.job, emissaoId: setimo.emissao,
      });
      expect(await processador.processarUm()).toMatchObject({
        estado: 'concluido', jobId: setimo.job, emissaoId: setimo.emissao,
      });

      const oitavo = await criarJob(50008);
      await cliente.query(`
        UPDATE documentos.job_pdf SET posse = $2, posse_expira_em = clock_timestamp() + interval '1 minute' WHERE id = $1
      `, [oitavo.job, randomUUID()]);
      await expect(processador.processarUm()).rejects.toThrow('estado de posse inconsistente');
      await expect(processador.reagendar(oitavo.job)).rejects.toThrow('estado inconsistente');
      await cliente.query(`
        UPDATE documentos.job_pdf SET status = 'falhou', posse = NULL, posse_expira_em = NULL,
          erro_sanitizado = 'Estado sintético inconsistente.' WHERE id = $1
      `, [oitavo.job]);

      const nono = await criarJob(50009);
      await cliente.query(`
        UPDATE documentos.documento SET status = 'cancelado', cancelado_por = $2, cancelado_em = clock_timestamp(),
          motivo_cancelamento_cifrado = $3, atualizado_por = $2 WHERE id = $1
      `, [nono.documento, usuario, randomBytes(48)]);
      expect(await processador.processarUm()).toMatchObject({
        estado: 'concluido', jobId: nono.job, emissaoId: nono.emissao,
      });
      expect((await cliente.query('SELECT status FROM documentos.documento WHERE id = $1', [nono.documento])).rows[0].status)
        .toBe('cancelado');

      const decimo = await criarJob(50010);
      const metadadosInvalidos = new ProcessadorPdfProvisorio(banco, protetor, {
        gravar: async () => ({ caminhoRelativo: '..\\fora.pdf', sha256: '0'.repeat(64), reutilizado: false }),
      }, async () => pdf, 30000);
      await expect(metadadosInvalidos.processarUm()).rejects.toThrow('job foi marcado como falho');
      expect((await cliente.query('SELECT count(*) FROM documentos.artefato_pdf WHERE emissao_id = $1', [decimo.emissao])).rows[0].count).toBe('0');
      const reagendamentoRevertido = new ProcessadorPdfProvisorio(
        bancoComFalhaDeConfirmacao(false, 1), protetor, armazenamento, async () => pdf, 30000,
      );
      await expect(reagendamentoRevertido.reagendar(decimo.job)).rejects.toThrow('Não foi possível confirmar a transação');
      expect((await cliente.query('SELECT status FROM documentos.job_pdf WHERE id = $1', [decimo.job])).rows[0].status).toBe('falhou');
      expect(await processador.reagendar(decimo.job)).toEqual({
        estado: 'reagendado', jobId: decimo.job, emissaoId: decimo.emissao,
      });
      expect(await processador.processarUm()).toMatchObject({
        estado: 'concluido', jobId: decimo.job, emissaoId: decimo.emissao,
      });

      const decimoPrimeiro = await criarJob(50011);
      const commitConfirmado = new ProcessadorPdfProvisorio(
        bancoComFalhaDeConfirmacao(true), protetor, armazenamento, async () => pdf, 30000,
      );
      await expect(commitConfirmado.processarUm()).rejects.toThrow('consulte o estado do job');
      const aposConfirmacaoIncerta = await cliente.query<{ status: string; artefatos: string; numero: string }>(`
        SELECT j.status, e.numero::text AS numero,
          (SELECT count(*) FROM documentos.artefato_pdf WHERE job_id = j.id)::text AS artefatos
        FROM documentos.job_pdf j JOIN documentos.emissao e ON e.id = j.emissao_id WHERE j.id = $1
      `, [decimoPrimeiro.job]);
      expect(aposConfirmacaoIncerta.rows[0]).toEqual({
        status: 'concluido', artefatos: '1', numero: String(decimoPrimeiro.numero),
      });
      expect(await processador.processarUm()).toEqual({ estado: 'sem_trabalho' });

      const decimoSegundo = await criarJob(50012);
      const commitRevertido = new ProcessadorPdfProvisorio(
        bancoComFalhaDeConfirmacao(false), protetor, armazenamento, async () => pdf, 30000,
      );
      await expect(commitRevertido.processarUm()).rejects.toThrow('job foi marcado como falho');
      const aposReversaoIncerta = await cliente.query<{ status: string; artefatos: string; numero: string }>(`
        SELECT j.status, e.numero::text AS numero,
          (SELECT count(*) FROM documentos.artefato_pdf WHERE job_id = j.id)::text AS artefatos
        FROM documentos.job_pdf j JOIN documentos.emissao e ON e.id = j.emissao_id WHERE j.id = $1
      `, [decimoSegundo.job]);
      expect(aposReversaoIncerta.rows[0]).toEqual({
        status: 'falhou', artefatos: '0', numero: String(decimoSegundo.numero),
      });
      const reagendamentoConfirmado = new ProcessadorPdfProvisorio(
        bancoComFalhaDeConfirmacao(true, 1), protetor, armazenamento, async () => pdf, 30000,
      );
      await expect(reagendamentoConfirmado.reagendar(decimoSegundo.job))
        .rejects.toThrow('Não foi possível confirmar a transação');
      expect(await processador.reagendar(decimoSegundo.job)).toEqual({
        estado: 'pendente', jobId: decimoSegundo.job, emissaoId: decimoSegundo.emissao,
      });
      expect(await processador.processarUm()).toMatchObject({
        estado: 'concluido', jobId: decimoSegundo.job, emissaoId: decimoSegundo.emissao,
      });

      const decimoTerceiro = await criarJob(50013, false, true);
      let renderizacoesAdulteradas = 0;
      const snapshotInvalido = new ProcessadorPdfProvisorio(banco, protetor, armazenamento, async () => {
        renderizacoesAdulteradas += 1;
        return pdf;
      }, 30000);
      await expect(snapshotInvalido.processarUm()).rejects.toThrow('job foi marcado como falho');
      expect(renderizacoesAdulteradas).toBe(0);
      expect((await cliente.query('SELECT count(*) FROM documentos.artefato_pdf WHERE emissao_id = $1', [decimoTerceiro.emissao])).rows[0].count).toBe('0');

      const decimoQuarto = await criarJob(50014);
      const posseConfirmada = new ProcessadorPdfProvisorio(
        bancoComFalhaDeConfirmacao(true, 1), protetor, armazenamento, async () => pdf, 30000,
      );
      await expect(posseConfirmada.processarUm()).rejects.toThrow('Não foi possível confirmar a transação');
      const reivindicacaoConfirmada = await cliente.query<{ status: string; tentativas: number }>(
        'SELECT status, tentativas FROM documentos.job_pdf WHERE id = $1', [decimoQuarto.job],
      );
      expect(reivindicacaoConfirmada.rows[0]).toEqual({ status: 'processando', tentativas: 1 });
      expect(await processador.processarUm()).toEqual({ estado: 'sem_trabalho' });
      await cliente.query(`
        UPDATE documentos.job_pdf SET posse_expira_em = clock_timestamp() - interval '1 second' WHERE id = $1
      `, [decimoQuarto.job]);
      expect(await processador.processarUm()).toMatchObject({
        estado: 'concluido', jobId: decimoQuarto.job, emissaoId: decimoQuarto.emissao,
      });

      const decimoQuinto = await criarJob(50015);
      const posseRevertida = new ProcessadorPdfProvisorio(
        bancoComFalhaDeConfirmacao(false, 1), protetor, armazenamento, async () => pdf, 30000,
      );
      await expect(posseRevertida.processarUm()).rejects.toThrow('Não foi possível confirmar a transação');
      const reivindicacaoRevertida = await cliente.query<{ status: string; tentativas: number }>(
        'SELECT status, tentativas FROM documentos.job_pdf WHERE id = $1', [decimoQuinto.job],
      );
      expect(reivindicacaoRevertida.rows[0]).toEqual({ status: 'pendente', tentativas: 0 });
      expect(await processador.processarUm()).toMatchObject({
        estado: 'concluido', jobId: decimoQuinto.job, emissaoId: decimoQuinto.emissao,
      });

      const decimoSexto = await criarJob(50016);
      await cliente.query("UPDATE documentos.job_pdf SET status = 'concluido' WHERE id = $1", [decimoSexto.job]);
      await expect(processador.reagendar(decimoSexto.job)).rejects.toThrow('estado inconsistente');

      const decimoSetimo = await criarJob(50017);
      const artefatoInconsistente = randomUUID();
      const arquivoInconsistente = await armazenamento.gravar(artefatoInconsistente, pdf);
      await cliente.query(`
        INSERT INTO documentos.artefato_pdf (id, emissao_id, job_id, caminho_relativo, sha256)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        artefatoInconsistente, decimoSetimo.emissao, decimoSetimo.job,
        arquivoInconsistente.caminhoRelativo, Buffer.from(arquivoInconsistente.sha256, 'hex'),
      ]);
      await expect(processador.reagendar(decimoSetimo.job)).rejects.toThrow('estado inconsistente');
      await cliente.query("UPDATE documentos.job_pdf SET status = 'falhou' WHERE id = $1", [decimoSetimo.job]);
      await expect(processador.reagendar(decimoSetimo.job)).rejects.toThrow('estado inconsistente');

      const decimoOitavo = await criarJob(50018);
      const artefatoConcorrente = randomUUID();
      const arquivoConcorrente = await armazenamento.gravar(artefatoConcorrente, pdf);
      const pid = (await cliente.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await cliente.query('BEGIN');
      transacaoAberta = true;
      await cliente.query("UPDATE documentos.job_pdf SET status = 'concluido' WHERE id = $1", [decimoOitavo.job]);
      await cliente.query(`
        INSERT INTO documentos.artefato_pdf (id, emissao_id, job_id, caminho_relativo, sha256)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        artefatoConcorrente, decimoOitavo.emissao, decimoOitavo.job,
        arquivoConcorrente.caminhoRelativo, Buffer.from(arquivoConcorrente.sha256, 'hex'),
      ]);
      const aguardandoConclusao = processador.reagendar(decimoOitavo.job);
      try {
        let aguardandoBloqueio = false;
        for (let tentativa = 0; tentativa < 100 && !aguardandoBloqueio; tentativa += 1) {
          const atividade = await banco.query<{ aguardando: boolean }>(`
            SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity
              WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))
                AND query LIKE '%WHERE j.id = $1 FOR UPDATE OF j%'
            ) AS aguardando
          `, [pid]);
          aguardandoBloqueio = atividade.rows[0].aguardando;
          if (!aguardandoBloqueio) await delay(20);
        }
        expect(aguardandoBloqueio).toBe(true);
        await cliente.query('COMMIT');
        transacaoAberta = false;
        expect(await aguardandoConclusao).toEqual({
          estado: 'concluido', jobId: decimoOitavo.job, emissaoId: decimoOitavo.emissao,
        });
      } finally {
        if (transacaoAberta) {
          await cliente.query('ROLLBACK');
          transacaoAberta = false;
        }
        await aguardandoConclusao;
      }

      const decimoNono = await criarJob(50019, false, false, false);
      await expect(processador.reagendar(decimoNono.job)).rejects.toThrow('incompatível com o processamento');

      const vigesimo = await criarJob(50020);
      await cliente.query("UPDATE documentos.job_pdf SET status = 'processando' WHERE id = $1", [vigesimo.job]);
      await expect(processador.reagendar(vigesimo.job)).rejects.toThrow('estado inconsistente');
      await cliente.query("UPDATE documentos.job_pdf SET status = 'falhou' WHERE id = $1", [vigesimo.job]);

      const { pessoa: pessoaDtc, vinculo: vinculoDtc } = await inserirPessoaEVinculo(cliente);
      const templateDtc = randomUUID();
      const documentoDtc = randomUUID();
      const emissaoDtc = randomUUID();
      const jobDtc = randomUUID();
      await cliente.query(`
        INSERT INTO documentos.template_versao (id, tipo, versao, html, css, vigente_de)
        VALUES ($1, 'DTC_IPAM', $2, '<p>Modelo sintético</p>', '', '2024-01-01')
      `, [templateDtc, `reagendamento-sintetico-${templateDtc}`]);
      await cliente.query(`
        INSERT INTO documentos.documento (
          id, tipo, pessoa_id, vinculo_id, entrada_cifrada, template_versao_id,
          regra_versao_id, criado_por, atualizado_por
        ) VALUES ($1, 'DTC_IPAM', $2, $3, $4, $5, $6, $7, $7)
      `, [documentoDtc, pessoaDtc, vinculoDtc, randomBytes(48), templateDtc, regra, usuario]);
      await cliente.query(`
        INSERT INTO documentos.documento_periodo (documento_id, ordem, inicio, fim)
        VALUES ($1, 1, '2020-01-01', '2020-12-31')
      `, [documentoDtc]);
      const conferenciaDtc = randomUUID();
      await cliente.query(`
        INSERT INTO documentos.conferencia_dtc (
          id, documento_id, revisao_documento, revisao_pessoa, revisao_vinculo, conferido_por, avisos
        )
        SELECT $1, d.id, d.revisao + 1, p.revisao_fonte, v.revisao_fonte, $3, '{}'
        FROM documentos.documento d
        JOIN nucleo.pessoa p ON p.id = d.pessoa_id
        JOIN nucleo.vinculo v ON v.id = d.vinculo_id
        WHERE d.id = $2
      `, [conferenciaDtc, documentoDtc, usuario]);
      await cliente.query(`
        UPDATE documentos.documento d SET status = 'conferido', revisao = d.revisao + 1,
          conferido_por = c.conferido_por, conferido_em = c.conferido_em
        FROM documentos.conferencia_dtc c
        WHERE d.id = $1 AND c.id = $2
      `, [documentoDtc, conferenciaDtc]);
      await cliente.query(`
        INSERT INTO documentos.emissao (
          id, documento_id, tipo, ano, numero, numero_formatado, chave_idempotencia, snapshot_cifrado, emitido_por
        ) VALUES ($1, $2, 'DTC_IPAM', 2024, 50021, 'TESTE-50021', $3, $4, $5)
      `, [emissaoDtc, documentoDtc, `DTC-SINTETICO-${emissaoDtc}`, randomBytes(48), usuario]);
      await cliente.query("UPDATE documentos.documento SET status = 'emitido' WHERE id = $1", [documentoDtc]);
      await cliente.query("INSERT INTO documentos.job_pdf (id, emissao_id, status) VALUES ($1, $2, 'pendente')", [jobDtc, emissaoDtc]);
      await expect(processador.reagendar(jobDtc)).rejects.toThrow('incompatível com o processamento');

      const duracoes: number[] = [];
      for (let indice = 0; indice < 20; indice += 1) {
        const job = await criarJob(50100 + indice);
        const inicio = performance.now();
        const resultado = await processador.processarUm();
        duracoes.push(performance.now() - inicio);
        expect(resultado).toMatchObject({ estado: 'concluido', jobId: job.job, emissaoId: job.emissao });
      }
      const ordenadas = [...duracoes].sort((a, b) => a - b);
      const mediana = (ordenadas[9] + ordenadas[10]) / 2;
      const p95 = ordenadas[18];
      const maximo = ordenadas[19];
      console.info(`Processador provisório aquecido, 45 anos e sem transporte: mediana ${mediana.toFixed(1)} ms; p95 ${p95.toFixed(1)} ms; máximo ${maximo.toFixed(1)} ms.`);
      expect(maximo).toBeLessThan(5000);
    } finally {
      if (transacaoAberta) await cliente.query('ROLLBACK');
      if (navegador) await navegador.close();
      await banco.end();
      await cliente.end();
      if (path.basename(pasta).startsWith('pdf-worker-')) {
        await rm(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    }
  });

  it('não expõe detalhes de erro no health', async () => {
    const controller = new HealthController({
      query: async () => { throw new Error('detalhe interno fictício'); },
      end: async () => {},
    });
    await expect(controller.verificar()).rejects.toMatchObject({
      message: 'Banco de dados indisponível.',
      status: 503,
    });
  });

  it('não substitui a instalação ou o banco já inicializados', async () => {
    await expect(instalar(opcoes)).rejects.toThrow('raiz da nova instalação já existe');
    await expect(instalar({ ...opcoes, raiz: raizAlternativa })).rejects.toThrow('banco escolhido não está vazio');
    await expect(realpath(raizAlternativa)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(arquivoConfig, 'utf8')).toContain('"host": "127.0.0.1"');
  });
});
