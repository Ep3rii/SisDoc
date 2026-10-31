import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
import { instalar, type OpcoesInstalacao } from '../apps/api/dist/setup/instalador.js';
import { validarDestinos } from '../scripts/isolar-testes.cjs';

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
