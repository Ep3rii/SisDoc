import { randomBytes, randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, open, readFile, rmdir, unlink } from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { z } from 'zod';
import { configuracaoProcessosSchema, configuracaoSchema, type Configuracao } from '@sisdoc/contratos';
import { caminhoReal, estaDentro, raizRepositorio } from '../configuracao';
import { aplicarAutenticacao } from '../migracoes/autenticacao';
import { aplicarAcessoAdmin } from '../migracoes/acesso-admin';
import { aplicarBlocosDof } from '../migracoes/blocos-dof';
import { aplicarConfirmacaoInicioDof } from '../migracoes/confirmacao-inicio-dof';
import { aplicarConferenciaDof } from '../migracoes/conferencia-dof';
import { aplicarDevolucaoDof } from '../migracoes/devolucao-dof';
import { aplicarEmissao } from '../migracoes/emissao';
import { aplicarDtc } from '../migracoes/dtc';
import { aplicarImportacao } from '../migracoes/importacao';
import { aplicarEncaminhamentoDof } from '../migracoes/encaminhamento-dof';
import { aplicarPreconferenciaDof } from '../migracoes/preconferencia-dof';
import { aplicarRevisaoFonteDof } from '../migracoes/revisao-fonte-dof';
import { aplicarProcessoDof } from '../migracoes/processo-dof';
import { aplicarConsulta } from '../migracoes/consulta';
import { aplicarRascunhoDof } from '../migracoes/rascunho-dof';
import { aplicarModelo } from '../migracoes/modelo';
import { ErroPoliticaSenha, gerarHashSenha, verificarSenha } from '../seguranca/senhas';

const execFile = promisify(execFileCallback);
const identificador = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(63);
const porta = z.number().int().min(1).max(65535);
const caminho = z.string().min(1);
const opcoesSchema = z.strictObject({
  raiz: caminho,
  porta,
  banco: z.strictObject({
    porta,
    nome: identificador,
    migrador: identificador,
    senhaMigrador: z.string().min(12),
    usuario: identificador,
    senha: z.string().min(12),
  }),
  tls: z.strictObject({
    certificado: caminho,
    chave: caminho,
    ca: caminho,
    nome: z.string().regex(/^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/),
  }),
  sidServico: z.string().regex(/^S-1-(?:\d+-)+\d+$/i),
  listaSenhas: caminho,
  processos: configuracaoProcessosSchema.optional(),
  administrador: z.strictObject({
    matricula: z.string().trim().min(1).max(100),
    nome: z.string().trim().min(3).max(200),
    senha: z.string().min(12),
  }),
});

export type OpcoesInstalacao = z.input<typeof opcoesSchema>;

class ErroInstalacao extends Error {}

type Criado = { caminho: string; tipo: 'arquivo' | 'diretorio' };

function identificadorSql(valor: string): string {
  return `"${valor.replaceAll('"', '""')}"`;
}

async function caminhoExternoExistente(arquivo: string, repositorio: string): Promise<string> {
  if (!path.isAbsolute(arquivo)) {
    throw new ErroInstalacao('Os arquivos informados devem ter caminhos absolutos.');
  }
  let resolvido: string;
  try {
    resolvido = await caminhoReal(arquivo);
  } catch {
    throw new ErroInstalacao('Não foi possível localizar um dos arquivos externos informados.');
  }
  if (estaDentro(resolvido, repositorio)) {
    throw new ErroInstalacao('Certificados e lista de senhas devem ficar fora do repositório.');
  }
  return resolvido;
}

async function validarRaiz(raiz: string, repositorio: string): Promise<string> {
  if (!path.isAbsolute(raiz) || raiz.startsWith('\\\\')) {
    throw new ErroInstalacao('Informe uma raiz local absoluta para a nova instalação.');
  }
  const normalizada = path.resolve(raiz);
  if (normalizada === path.parse(normalizada).root) {
    throw new ErroInstalacao('A raiz de uma unidade não pode ser usada como instalação.');
  }
  let pai: string;
  try {
    pai = await caminhoReal(path.dirname(normalizada));
  } catch {
    throw new ErroInstalacao('O diretório pai da instalação não existe ou não está acessível.');
  }
  const destino = path.join(pai, path.basename(normalizada));
  if (estaDentro(destino, repositorio) || estaDentro(repositorio, destino)) {
    throw new ErroInstalacao('A instalação deve ficar fora do repositório e de seus diretórios ancestrais.');
  }
  const perfil = process.env.USERPROFILE;
  if (!perfil) {
    throw new ErroInstalacao('Não foi possível verificar o perfil Windows do usuário.');
  }
  const perfilReal = await caminhoReal(perfil);
  if (estaDentro(destino, perfilReal)) {
    throw new ErroInstalacao('Escolha uma raiz externa ao perfil pessoal do usuário.');
  }
  try {
    await caminhoReal(destino);
    throw new ErroInstalacao('A raiz da nova instalação já existe; nada será sobrescrito.');
  } catch (erro) {
    if (erro instanceof ErroInstalacao) throw erro;
    if (!(erro instanceof Error) || !('code' in erro) || erro.code !== 'ENOENT') {
      throw new ErroInstalacao('Não foi possível verificar a raiz da instalação.');
    }
  }
  return destino;
}

async function verificarTls(tls: z.infer<typeof opcoesSchema>['tls']): Promise<void> {
  let certificado: Buffer;
  let chave: Buffer;
  let ca: Buffer;
  try {
    [certificado, chave, ca] = await Promise.all([
      readFile(tls.certificado),
      readFile(tls.chave),
      readFile(tls.ca),
    ]);
  } catch {
    throw new ErroInstalacao('Não foi possível ler os arquivos de certificado, chave e CA.');
  }

  let servidor: https.Server;
  try {
    servidor = https.createServer({ cert: certificado, key: chave, minVersion: 'TLSv1.2' }, (_req, res) => {
      res.writeHead(204);
      res.end();
    });
  } catch {
    throw new ErroInstalacao('O certificado ou a chave TLS é inválido.');
  }
  try {
    await new Promise<void>((resolve, reject) => {
      servidor.once('error', reject);
      servidor.listen(0, '127.0.0.1', () => {
        servidor.removeListener('error', reject);
        resolve();
      });
    });
    const endereco = servidor.address();
    if (!endereco || typeof endereco === 'string') throw new Error('Endereço TLS indisponível.');
    await new Promise<void>((resolve, reject) => {
      const requisicao = https.get({
        host: '127.0.0.1',
        port: endereco.port,
        servername: tls.nome,
        ca,
        rejectUnauthorized: true,
        agent: false,
        timeout: 5000,
      }, (resposta) => {
        resposta.resume();
        resposta.once('end', () => resposta.statusCode === 204 ? resolve() : reject(new Error('Resposta TLS inválida.')));
      });
      requisicao.once('timeout', () => requisicao.destroy(new Error('Tempo de verificação TLS esgotado.')));
      requisicao.once('error', reject);
    });
  } catch {
    throw new ErroInstalacao('O certificado não pôde ser validado pela CA e pelo nome informados.');
  } finally {
    if (servidor.listening) {
      await new Promise<void>((resolve, reject) => servidor.close((erro) => erro ? reject(erro) : resolve()));
    }
  }
}

async function sidAtual(): Promise<string> {
  let saida: string;
  try {
    ({ stdout: saida } = await execFile('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true }));
  } catch {
    throw new ErroInstalacao('Não foi possível identificar a conta Windows que executa a instalação.');
  }
  const sid = saida.match(/S-1-(?:\d+-)+\d+/i)?.[0];
  if (!sid) throw new ErroInstalacao('Não foi possível identificar o SID da conta instaladora.');
  return sid;
}

async function aplicarAcl(diretorio: string, argumentos: string[]): Promise<void> {
  try {
    await execFile('icacls.exe', [diretorio, ...argumentos], { windowsHide: true });
  } catch {
    throw new ErroInstalacao('Não foi possível aplicar as permissões Windows à instalação.');
  }
}

async function criarDiretorios(raiz: string, sidInstalador: string, sidServico: string, criados: Criado[]): Promise<void> {
  await mkdir(raiz);
  criados.push({ caminho: raiz, tipo: 'diretorio' });
  await aplicarAcl(raiz, [
    '/inheritance:r',
    '/grant:r',
    `*${sidInstalador}:(OI)(CI)F`,
    '*S-1-5-18:(OI)(CI)F',
    `*${sidServico}:RX`,
  ]);
  for (const nome of ['app', 'releases', 'config', 'pdf', 'logs', 'backup', 'scripts', 'chromium']) {
    const diretorio = path.join(raiz, nome);
    await mkdir(diretorio);
    criados.push({ caminho: diretorio, tipo: 'diretorio' });
    if (nome !== 'backup') {
      const permissao = nome === 'pdf' || nome === 'logs' ? 'M' : 'RX';
      await aplicarAcl(diretorio, ['/grant:r', `*${sidServico}:(OI)(CI)${permissao}`]);
    }
  }
}

async function limparCriados(criados: Criado[]): Promise<void> {
  for (const item of [...criados].reverse()) {
    if (item.tipo === 'arquivo') await unlink(item.caminho);
    else await rmdir(item.caminho);
  }
}

async function verificarBanco(cliente: Client, opcoes: z.infer<typeof opcoesSchema>): Promise<void> {
  const versao = await cliente.query<{ server_version_num: string }>('SHOW server_version_num');
  if (Math.floor(Number(versao.rows[0].server_version_num) / 10000) !== 16) {
    throw new ErroInstalacao('A instalação exige PostgreSQL 16.');
  }
  const endereco = await cliente.query<{ listen_addresses: string }>('SHOW listen_addresses');
  const enderecos = endereco.rows[0].listen_addresses.split(',').map((item) => item.trim().replaceAll("'", ''));
  if (enderecos.length === 0 || enderecos.some((item) => !['127.0.0.1', '::1', 'localhost'].includes(item))) {
    throw new ErroInstalacao('O PostgreSQL deve escutar somente em loopback.');
  }
  const dono = await cliente.query<{ dono: string; atual: string }>(
    'SELECT pg_get_userbyid(datdba) AS dono, current_user AS atual FROM pg_database WHERE datname = current_database()',
  );
  if (dono.rows[0].dono !== dono.rows[0].atual || dono.rows[0].atual !== opcoes.banco.migrador) {
    throw new ErroInstalacao('A credencial de migração deve ser proprietária do banco vazio.');
  }
  const papel = await cliente.query<{
    rolcanlogin: boolean; rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean;
    rolreplication: boolean; rolbypassrls: boolean; membro: boolean; dono: boolean;
  }>(
    `SELECT r.rolcanlogin, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
            EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid) AS membro,
            EXISTS (SELECT 1 FROM pg_database d WHERE d.datname = current_database() AND d.datdba = r.oid) AS dono
       FROM pg_roles r WHERE r.rolname = $1`,
    [opcoes.banco.usuario],
  );
  const app = papel.rows[0];
  if (!app || !app.rolcanlogin || app.rolsuper || app.rolcreatedb || app.rolcreaterole ||
      app.rolreplication || app.rolbypassrls || app.membro || app.dono) {
    throw new ErroInstalacao('A conta do aplicativo deve existir, permitir login e não ter privilégios administrativos ou associações a outros papéis.');
  }
  const vazios = await cliente.query<{ vazio: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1 FROM pg_namespace n
       WHERE n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
         AND n.nspname NOT IN ('information_schema', 'public')
     ) AND NOT EXISTS (
       SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
     ) AND NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
     ) AND NOT EXISTS (
       SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'
     ) AS vazio`,
  );
  if (!vazios.rows[0].vazio) {
    throw new ErroInstalacao('O banco escolhido não está vazio; nenhuma estrutura será alterada.');
  }
}

async function conectarAplicativo(opcoes: z.infer<typeof opcoesSchema>): Promise<void> {
  const conexao = {
    host: '127.0.0.1',
    port: opcoes.banco.porta,
    database: opcoes.banco.nome,
    user: opcoes.banco.usuario,
    connectionTimeoutMillis: 5000,
  };
  const cliente = new Client({ ...conexao, password: opcoes.banco.senha });
  try {
    await cliente.connect();
    await cliente.query('SELECT 1');
  } catch {
    throw new ErroInstalacao('Não foi possível conectar com a credencial do aplicativo.');
  } finally {
    await cliente.end();
  }
  const senhaIncorreta = new Client({ ...conexao, password: randomBytes(32).toString('hex') });
  try {
    await senhaIncorreta.connect();
    throw new ErroInstalacao('O PostgreSQL aceitou uma senha incorreta; configure autenticação por senha em loopback.');
  } catch (erro) {
    if (erro instanceof ErroInstalacao) throw erro;
    if (!(erro instanceof Error) || !('code' in erro) || erro.code !== '28P01') {
      throw new ErroInstalacao('Não foi possível verificar a autenticação por senha do PostgreSQL.');
    }
  } finally {
    await senhaIncorreta.end();
  }
}

export async function instalar(entrada: OpcoesInstalacao): Promise<string> {
  if (process.platform !== 'win32') {
    throw new ErroInstalacao('A instalação operacional exige Windows e permissões ACL verificáveis.');
  }
  const resultado = opcoesSchema.safeParse(entrada);
  if (!resultado.success) throw new ErroInstalacao('Os parâmetros de instalação estão incompletos ou inválidos.');
  const opcoes = resultado.data;
  if (opcoes.banco.migrador === opcoes.banco.usuario) {
    throw new ErroInstalacao('As credenciais de migração e do aplicativo devem usar papéis distintos.');
  }
  const sidInstalador = await sidAtual();
  if ([sidInstalador.toUpperCase(), 'S-1-5-18', 'S-1-5-32-544'].includes(opcoes.sidServico.toUpperCase())) {
    throw new ErroInstalacao('Informe um SID de serviço distinto da conta instaladora e sem privilégios administrativos.');
  }
  const repositorio = await raizRepositorio();
  const raiz = await validarRaiz(opcoes.raiz, repositorio);
  const tls = {
    certificado: await caminhoExternoExistente(opcoes.tls.certificado, repositorio),
    chave: await caminhoExternoExistente(opcoes.tls.chave, repositorio),
    ca: await caminhoExternoExistente(opcoes.tls.ca, repositorio),
    nome: opcoes.tls.nome,
  };
  const listaSenhas = await caminhoExternoExistente(opcoes.listaSenhas, repositorio);
  try {
    await verificarSenha(opcoes.administrador.senha, listaSenhas);
  } catch (erro) {
    if (erro instanceof ErroPoliticaSenha) throw new ErroInstalacao(erro.message);
    throw erro;
  }
  await verificarTls(tls);
  const senhaHash = await gerarHashSenha(opcoes.administrador.senha);
  await conectarAplicativo(opcoes);

  const cliente = new Client({
    host: '127.0.0.1',
    port: opcoes.banco.porta,
    database: opcoes.banco.nome,
    user: opcoes.banco.migrador,
    password: opcoes.banco.senhaMigrador,
    connectionTimeoutMillis: 5000,
  });
  try {
    await cliente.connect();
  } catch {
    await cliente.end();
    throw new ErroInstalacao('Não foi possível conectar com a credencial de migração.');
  }

  const criados: Criado[] = [];
  let transacaoAberta = false;
  let commitIniciado = false;
  try {
    await cliente.query('BEGIN');
    transacaoAberta = true;
    const bloqueio = await cliente.query<{ obtido: boolean }>(
      'SELECT pg_try_advisory_xact_lock($1, $2) AS obtido',
      [1936286820, 1],
    );
    if (!bloqueio.rows[0].obtido) throw new ErroInstalacao('Já existe outra instalação em andamento neste banco.');
    await verificarBanco(cliente, opcoes);
    await criarDiretorios(raiz, sidInstalador, opcoes.sidServico, criados);
    const papel = identificadorSql(opcoes.banco.usuario);
    const banco = identificadorSql(opcoes.banco.nome);
    await cliente.query(`REVOKE ALL ON DATABASE ${banco} FROM PUBLIC`);
    await cliente.query(`GRANT CONNECT ON DATABASE ${banco} TO ${papel}`);
    await cliente.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await cliente.query('CREATE SCHEMA seguranca');
    await cliente.query('REVOKE ALL ON SCHEMA seguranca FROM PUBLIC');
    await cliente.query(`
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
      )
    `);
    await cliente.query(`
      CREATE TABLE seguranca.migracao (
        versao text PRIMARY KEY,
        aplicada_em timestamptz NOT NULL DEFAULT now()
      )
    `);
    await cliente.query("INSERT INTO seguranca.migracao (versao) VALUES ('000-fundacao')");
    await cliente.query(
      'INSERT INTO seguranca.usuario (id, matricula, nome, senha_hash, papel) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), opcoes.administrador.matricula, opcoes.administrador.nome, senhaHash, 'admin'],
    );
    await cliente.query(`GRANT USAGE ON SCHEMA seguranca TO ${papel}`);
    await cliente.query(`GRANT SELECT, INSERT, UPDATE ON seguranca.usuario TO ${papel}`);
    await aplicarModelo(cliente, opcoes.banco.usuario);
    await aplicarAutenticacao(cliente, opcoes.banco.usuario);
    await aplicarConsulta(cliente, opcoes.banco.usuario);
    await aplicarRascunhoDof(cliente, opcoes.banco.usuario);
    await aplicarBlocosDof(cliente, opcoes.banco.usuario);
    await aplicarProcessoDof(cliente, opcoes.banco.usuario);
    await aplicarEncaminhamentoDof(cliente, opcoes.banco.usuario);
    await aplicarPreconferenciaDof(cliente, opcoes.banco.usuario);
    await aplicarConfirmacaoInicioDof(cliente, opcoes.banco.usuario);
    await aplicarDevolucaoDof(cliente, opcoes.banco.usuario);
    await aplicarRevisaoFonteDof(cliente, opcoes.banco.usuario);
    await aplicarConferenciaDof(cliente, opcoes.banco.usuario);
    await aplicarEmissao(cliente, opcoes.banco.usuario);
    await aplicarDtc(cliente, opcoes.banco.usuario);
    await aplicarImportacao(cliente, opcoes.banco.usuario);
    await aplicarAcessoAdmin(cliente, opcoes.banco.usuario);

    const configuracao: Configuracao = configuracaoSchema.parse({
      porta: opcoes.porta,
      banco: {
        host: '127.0.0.1',
        porta: opcoes.banco.porta,
        nome: opcoes.banco.nome,
        usuario: opcoes.banco.usuario,
        senha: opcoes.banco.senha,
      },
      tls,
      chaves: { cifra: randomBytes(32).toString('base64'), hmac: randomBytes(32).toString('base64') },
      seguranca: { listaSenhas },
      ...(opcoes.processos ? { processos: opcoes.processos } : {}),
    });
    const arquivo = path.join(raiz, 'config', 'aplicacao.json');
    const handle = await open(arquivo, 'wx', 0o600);
    criados.push({ caminho: arquivo, tipo: 'arquivo' });
    try {
      await handle.writeFile(`${JSON.stringify(configuracao, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    commitIniciado = true;
    await cliente.query('COMMIT');
    transacaoAberta = false;
    return arquivo;
  } catch (erro) {
    let estadoIncerto = commitIniciado;
    if (transacaoAberta && !commitIniciado) {
      try {
        await cliente.query('ROLLBACK');
      } catch {
        estadoIncerto = true;
      }
    }
    if (!estadoIncerto) {
      try {
        await limparCriados(criados);
      } catch {
        throw new ErroInstalacao('A instalação falhou e a limpeza dos arquivos criados não foi concluída; verifique a raiz informada.');
      }
    }
    if (estadoIncerto) {
      throw new ErroInstalacao('O estado do banco não pôde ser confirmado. Preserve a raiz e verifique a transação antes de tentar novamente.');
    }
    if (erro instanceof ErroInstalacao) throw erro;
    throw new ErroInstalacao('A instalação falhou. Verifique as permissões e a disponibilidade do banco e da raiz informada.');
  } finally {
    await cliente.end();
  }
}
