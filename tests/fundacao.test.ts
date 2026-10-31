import { execFile as execFileCallback } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
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
import { verify } from 'argon2';
import EmbeddedPostgres from 'embedded-postgres';
import forge from 'node-forge';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HealthController } from '../apps/api/dist/app.module.js';
import { carregarConfiguracao } from '../apps/api/dist/configuracao.js';
import { aplicarAutenticacao } from '../apps/api/dist/migracoes/autenticacao.js';
import { aplicarModelo } from '../apps/api/dist/migracoes/modelo.js';
import { ProtetorDados } from '../apps/api/dist/seguranca/protecao-dados.js';
import { instalar, type OpcoesInstalacao } from '../apps/api/dist/setup/instalador.js';
import { validarDestinos } from '../scripts/isolar-testes.cjs';
import { cpfSintetico } from './dados-sinteticos.js';

const senhaMigrador = 'MigracaoFicticia!12345';
const senhaAplicativo = 'AplicativoFicticio!12345';
const senhaAdmin = 'AdministradorFicticio!12345';
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

async function executarSetup(perguntas: Pergunta[]): Promise<string> {
  const terminal = pty.spawn(process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', 'npm run setup'], {
    name: 'xterm-color',
    cols: 240,
    rows: 50,
    cwd: process.cwd(),
    env: ambiente(),
  });
  return new Promise<string>((resolve, reject) => {
    let texto = '';
    let pendente = '';
    let proxima = 0;
    const sanitizar = () => [senhaMigrador, senhaAplicativo, senhaAdmin].reduce(
      (valor, senha) => valor.replaceAll(senha, '[segredo fictício]'), texto,
    );
    const prazo = setTimeout(() => {
      terminal.kill();
      reject(new Error(`O setup interativo excedeu o tempo na pergunta ${proxima + 1}: ${sanitizar().slice(-3000)}`));
    }, 20000);
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
        reject(new Error(`Setup interativo falhou (${exitCode}, pergunta ${proxima + 1}): ${sanitizar().slice(-3000)}`));
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
      { texto: 'Matrícula do administrador inicial: ', resposta: opcoes.administrador.matricula },
      { texto: 'Nome do administrador inicial: ', resposta: opcoes.administrador.nome },
      { texto: 'Senha inicial do administrador (mínimo 12 caracteres): ', resposta: senhaAdmin },
      { texto: 'Confirme a senha inicial: ', resposta: senhaAdmin },
      { texto: 'Digite CRIAR para confirmar a inicialização do banco vazio e da nova raiz: ', resposta: 'CRIAR' },
    ];
    const saida = await executarSetup(perguntas);
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
      expect(await aplicarModelo(cliente, 'sisdoc_aplicativo')).toBe(false);
      expect(await aplicarAutenticacao(cliente, 'sisdoc_aplicativo')).toBe(false);
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
      }>(`
        SELECT has_any_column_privilege(current_user, 'seguranca.usuario', 'UPDATE') AS alterar_usuario,
               has_table_privilege(current_user, 'nucleo.pessoa', 'INSERT') AS inserir_pessoa,
               has_table_privilege(current_user, 'documentos.emissao', 'INSERT') AS inserir_emissao,
               has_table_privilege(current_user, 'seguranca.auditoria', 'INSERT') AS inserir_auditoria,
               has_table_privilege(current_user, 'seguranca.auditoria', 'UPDATE') AS alterar_auditoria,
               has_table_privilege(current_user, 'seguranca.auditoria', 'DELETE') AS apagar_auditoria,
               has_column_privilege(current_user, 'seguranca.usuario', 'matricula', 'UPDATE') AS alterar_matricula,
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
        alterar_matricula: false,
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
    const terminal = pty.spawn(process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', 'npm start'], {
      name: 'xterm-color', cols: 200, rows: 40, cwd: process.cwd(),
      env: { ...ambiente(), SISDOC_CONFIG: arquivoConfig },
    });
    let saiu = false;
    const termino = new Promise<number>((resolve) => terminal.onExit(({ exitCode }) => {
      saiu = true;
      resolve(exitCode);
    }));
    try {
      await aguardarResposta(portaHttps, caPem);
      const health = await requisitar(portaHttps, caPem);
      expect(health.status).toBe(200);
      expect(JSON.parse(health.corpo)).toEqual({ status: 'ok' });
      expect(health.headers['cache-control']).toBe('no-store');
      expect(health.headers['content-security-policy']).toContain("default-src 'self'");
      expect(health.headers['strict-transport-security']).toContain('max-age=');
      const pagina = await requisitar(portaHttps, caPem, nomeTls, '/');
      expect(pagina.status).toBe(200);
      expect(pagina.corpo).toContain('<title>SisDoc</title>');
      expect((await requisitar(portaHttps, caPem, nomeTls, '/api/v1/servidores')).status).toBe(404);
      await expect(requisitar(portaHttps, caPem, 'outro.local')).rejects.toThrow();
    } finally {
      if (!saiu) {
        terminal.write('\u0003');
        await Promise.race([termino, delay(3000)]);
        if (!saiu) terminal.kill();
        await Promise.race([termino, delay(3000)]);
      }
    }
    expect(saiu).toBe(true);
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
