import { execFile as execFileCallback } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import type { IncomingHttpHeaders } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import * as pty from '@lydell/node-pty';
import {
  detalheServidorSchema,
  paginaAuditoriaSchema,
  paginaBuscaServidoresSchema,
  paginaEventosServidorSchema,
  paginaCoordenadoresDofSchema,
  paginaEncaminhamentosDofSchema,
  paginaUsuariosSchema,
  paginaRascunhosDofSchema,
  preconferenciaDofSchema,
  rascunhoDofSchema,
  resultadoCalculoDofSchema,
  respostaSessaoSchema,
  usuarioAdministrativoSchema,
} from '@sisdoc/contratos';
import { verify } from 'argon2';
import EmbeddedPostgres from 'embedded-postgres';
import forge from 'node-forge';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HealthController } from '../apps/api/dist/app.module.js';
import { transacao } from '../apps/api/dist/banco.js';
import { carregarConfiguracao } from '../apps/api/dist/configuracao.js';
import { aplicarAutenticacao } from '../apps/api/dist/migracoes/autenticacao.js';
import { aplicarBlocosDof } from '../apps/api/dist/migracoes/blocos-dof.js';
import { aplicarConfirmacaoInicioDof } from '../apps/api/dist/migracoes/confirmacao-inicio-dof.js';
import { aplicarEncaminhamentoDof } from '../apps/api/dist/migracoes/encaminhamento-dof.js';
import { aplicarPreconferenciaDof, CHAVE_BLOQUEIO_FONTE_DOF } from '../apps/api/dist/migracoes/preconferencia-dof.js';
import { aplicarProcessoDof } from '../apps/api/dist/migracoes/processo-dof.js';
import { aplicarConsulta } from '../apps/api/dist/migracoes/consulta.js';
import { aplicarRascunhoDof } from '../apps/api/dist/migracoes/rascunho-dof.js';
import { aplicarModelo } from '../apps/api/dist/migracoes/modelo.js';
import { ProtetorDados } from '../apps/api/dist/seguranca/protecao-dados.js';
import { gerarHashSenha } from '../apps/api/dist/seguranca/senhas.js';
import { instalar, type OpcoesInstalacao } from '../apps/api/dist/setup/instalador.js';
import { validarDestinos } from '../scripts/isolar-testes.cjs';
import { cpfSintetico } from './dados-sinteticos.js';
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
  opcoes: { metodo: 'GET' | 'POST' | 'PATCH'; rota: string; corpo?: unknown; cookie?: string; csrf?: string; origem?: string },
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

describe('fundação em recursos descartáveis', () => {
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
      expect(await aplicarModelo(cliente, 'sisdoc_aplicativo')).toBe(false);
      expect(await aplicarAutenticacao(cliente, 'sisdoc_aplicativo')).toBe(false);
      expect(await aplicarConsulta(cliente, 'sisdoc_aplicativo')).toBe(false);
      expect(await aplicarRascunhoDof(cliente, 'sisdoc_aplicativo')).toBe(false);
      expect(await aplicarBlocosDof(cliente, 'sisdoc_aplicativo')).toBe(false);
      expect(await aplicarProcessoDof(cliente, 'sisdoc_aplicativo')).toBe(false);
      expect(await aplicarEncaminhamentoDof(cliente, 'sisdoc_aplicativo')).toBe(false);
      expect(await aplicarPreconferenciaDof(cliente, 'sisdoc_aplicativo')).toBe(false);
      expect(await aplicarConfirmacaoInicioDof(cliente, 'sisdoc_aplicativo')).toBe(false);
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
               EXISTS (
                 SELECT 1 FROM aclexplode((SELECT relacl FROM pg_class WHERE oid = 'seguranca.usuario'::regclass))
                 WHERE grantee = 0 AND privilege_type = 'SELECT'
               ) AS publico_le_usuario,
               EXISTS (
                 SELECT 1 FROM aclexplode((SELECT nspacl FROM pg_namespace WHERE nspname = 'nucleo'))
                 WHERE grantee = 0 AND privilege_type = 'USAGE'
               ) AS publico_usa_nucleo
      `);
      expect(privilegios.rows[0]).toEqual({
        alterar_usuario: true, inserir_pessoa: false, inserir_emissao: false, inserir_auditoria: true,
        alterar_auditoria: false, apagar_auditoria: false, publico_le_usuario: false, publico_usa_nucleo: false,
        alterar_matricula: false, alterar_rascunho: true, alterar_status: false, apagar_ajuste: false,
        alterar_bloco: true, apagar_bloco: false, alterar_versao_bloco: false,
        alterar_processo_cifrado: true, alterar_processo_texto: false,
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
      const usuario = (await cliente.query<{ id: string }>('SELECT id FROM seguranca.usuario LIMIT 1')).rows[0].id;
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
      await cliente.query(`
        UPDATE documentos.documento SET status = 'conferido', conferido_por = $2, conferido_em = now() WHERE id = $1
      `, [dof, usuario]);
      await rejeitarSql(cliente, 'UPDATE documentos.documento SET confirmacao_inicio_cifrada = $2 WHERE id = $1',
        [dof, conteudo], '55000');
      await rejeitarSql(cliente, "UPDATE documentos.documento SET status = 'rascunho' WHERE id = $1", [dof], '23514');
      await cliente.query(`
        UPDATE documentos.documento SET status = 'rascunho', conferido_por = NULL, conferido_em = NULL WHERE id = $1
      `, [dof]);
      await cliente.query('UPDATE documentos.documento SET entrada_cifrada = $2 WHERE id = $1', [dof, conteudo]);
      await cliente.query(`
        UPDATE documentos.documento SET status = 'conferido', conferido_por = $2, conferido_em = now() WHERE id = $1
      `, [dof, usuario]);
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
          expect((await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota, cookie: admin.cookie })).status).toBe(403);
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
        })).status).toBe(403);
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
        for (const papel of ['secretario_adjunto', 'admin']) {
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
        })).status).toBe(403);
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
        const primeiroBloco = { id: randomUUID(), codigo: 'contratacao', ativo: true, texto: 'Texto contratual fictício' };
        const segundoBloco = {
          id: randomUUID(), codigo: 'progressao', ativo: true,
          texto: '<script>window.top.intrusao=1</script> {{nome}} {{cargo}}',
        };
        const motivoBlocos = 'Motivo sintético dos blocos';
        const proposta = { revisao: 1, motivo: motivoBlocos, blocos: [primeiroBloco, segundoBloco] };
        expect((await requisitarApi(portaHttps, caPem, { metodo: 'GET', rota: rotaPrevia })).status).toBe(401);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'GET', rota: rotaPrevia, cookie: coordenador.cookie,
        })).status).toBe(404);
        for (const papel of ['secretario_adjunto', 'admin']) {
          const sessao = sessoes.get(papel);
          if (!sessao) throw new Error('Sessão sintética ausente.');
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: rotaPrevia, cookie: sessao.cookie,
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
        expect(previa.corpo).toContain('Variável não disponível: cargo');
        expect(previa.corpo).not.toContain('<script>');
        expect(previa.corpo).not.toContain(primeiroBloco.texto);
        expect(previa.corpo.match(/<tr>/g)).toHaveLength(46);

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
          await bloqueador.query('COMMIT');
          confirmado = true;
          const leituraCoerente = await leituraBloqueada;
          expect(leituraCoerente.status, leituraCoerente.corpo).toBe(200);
          expect(leituraCoerente.headers['x-sisdoc-revisao']).toBe('5');
          expect(leituraCoerente.corpo).toContain(textoConcorrente);
        } finally {
          if (!confirmado) await bloqueador.query('ROLLBACK');
          await bloqueador.end();
        }
        const eventosBlocos = await cliente.query<{ acao: string; detalhes: unknown }>(`
          SELECT acao, detalhes FROM seguranca.auditoria WHERE entidade_id = $1
        `, [rascunhoBlocos.id]);
        expect(eventosBlocos.rows.map((evento) => evento.acao)).toEqual(expect.arrayContaining([
          'rascunho_blocos_editados', 'previa_dof_aberta', 'rascunho_conflito',
        ]));
        expect(JSON.stringify(eventosBlocos.rows)).not.toContain(motivoBlocos);
        expect(JSON.stringify(eventosBlocos.rows)).not.toContain(segundoBloco.texto);

        const rotaProcesso = `/api/v1/documentos/${rascunhoBlocos.id}/processo`;
        const pedidoProcesso = { revisao: 5, processo: '1234/5678', motivo: 'Processo fictício informado' };
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: rotaProcesso, corpo: pedidoProcesso, cookie: analista.cookie,
        })).status).toBe(403);
        expect((await requisitarApi(portaHttps, caPem, {
          metodo: 'PATCH', rota: rotaProcesso, corpo: pedidoProcesso, ...coordenador,
        })).status).toBe(404);
        for (const papel of ['secretario_adjunto', 'admin']) {
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
          await cliente.query(`
            UPDATE documentos.documento SET status = 'conferido', conferido_por = criado_por, conferido_em = now()
            WHERE id = $1
          `, [rascunhoBlocos.id]);
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

  it('encaminha DOF somente ao coordenador escolhido e recolhe sem permitir edição concorrente', async () => {
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
        for (const chave of ['secretario', 'administrador']) {
          expect((await requisitarApi(portaHttps, caPem, {
            metodo: 'GET', rota: rotaPreconferencia, cookie: sessao(chave).cookie,
          })).status).toBe(403);
        }
        const relatorioInicial = await verificar();
        expect(relatorioInicial).toMatchObject({
          documentoId: rascunho.id, revisao: 3, status: 'nao_conferido', conferenciaDisponivel: false,
        });
        expect(relatorioInicial.bloqueios.map((item) => item.codigo)).toEqual(expect.arrayContaining([
          'conferencia_indisponivel', 'aprovacao_modelo_nao_verificada', 'variaveis_ausentes', 'variaveis_malformadas',
        ]));
        for (const codigo of [
          'cpf_indisponivel', 'cpf_invalido', 'cpf_hash_inconsistente', 'matricula_inconsistente',
          'matricula_ambigua', 'vinculo_removido', 'admissao_ausente', 'admissao_alterada',
          'periodo_inconsistente', 'regra_incompativel', 'calculo_invalido', 'calculo_divergente',
          'processo_ausente', 'mascaras_ausentes', 'processo_invalido',
        ]) expect(relatorioInicial.bloqueios.map((item) => item.codigo)).not.toContain(codigo);
        expect(relatorioInicial.avisos.map((item) => item.codigo)).toEqual(expect.arrayContaining([
          'regra_provisoria', 'dados_sem_data', 'campos_referencia_ausentes',
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
        for (const chave of ['secretario', 'administrador']) {
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
        for (const chave of ['secretario', 'administrador']) {
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
      } finally {
        await encerrar();
      }
    } finally {
      await cliente.end();
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
