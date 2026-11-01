'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { X509Certificate } = require('node:crypto');
const { createSecureContext } = require('node:tls');
const { isIP } = require('node:net');
let etapa = 'runtime Windows x64/Node 24';

class ErroVerificacao extends Error {}

/** Recusa histórico desconhecido ou incompleto, sem aplicar migrações. */
function verificarHistorico(versoes, sequencia) {
  const esperado = ['000-fundacao', ...sequencia.map((item) => item.versao)];
  if (versoes.length !== esperado.length || esperado.some((versao, indice) => versoes[indice] !== versao)) {
    throw new ErroVerificacao('Histórico de migrações incompleto ou diferente deste release; não iniciar nem migrar sem conferir.');
  }
  return esperado.at(-1);
}

/** Confere os limites do login da aplicação, sem alterar papéis ou privilégios. */
function verificarPapel(papel) {
  if (!papel || !papel.rolcanlogin || papel.rolsuper || papel.rolcreatedb || papel.rolcreaterole
      || papel.rolreplication || papel.rolbypassrls || papel.membro || papel.dono) {
    throw new ErroVerificacao('O login da aplicação deve ser distinto do proprietário e sem privilégios administrativos ou associações.');
  }
}

/** Verifica versão, escuta local, login e sequência utilizando somente consultas. */
async function verificarBanco(cliente, sequencia) {
  const versao = await cliente.query('SHOW server_version_num');
  if (Math.floor(Number(versao.rows[0].server_version_num) / 10000) !== 16) {
    throw new ErroVerificacao('Esta instalação exige PostgreSQL 16.');
  }
  const escuta = await cliente.query('SHOW listen_addresses');
  const enderecos = escuta.rows[0].listen_addresses.split(',').map((item) => item.trim().replaceAll("'", ''));
  if (!enderecos.length || enderecos.some((item) => !['127.0.0.1', '::1', 'localhost'].includes(item))) {
    throw new ErroVerificacao('O PostgreSQL deve escutar somente em loopback.');
  }
  const papeis = await cliente.query(`
    SELECT r.rolcanlogin, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
      EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid) AS membro,
      EXISTS (SELECT 1 FROM pg_database d WHERE d.datname = current_database() AND d.datdba = r.oid) AS dono
    FROM pg_roles r WHERE r.rolname = current_user
  `);
  verificarPapel(papeis.rows[0]);
  const historico = await cliente.query('SELECT versao FROM seguranca.migracao ORDER BY versao');
  return verificarHistorico(historico.rows.map((item) => item.versao), sequencia);
}

/** Confere certificado, nome, validade e par de chaves TLS sem abrir servidor ou instalar confiança Windows. */
async function verificarTls(tls) {
  const [cert, key, ca] = await Promise.all([
    fs.readFile(tls.certificado), fs.readFile(tls.chave), fs.readFile(tls.ca),
  ]);
  createSecureContext({ cert, key, ca, minVersion: 'TLSv1.2' });
  const certificado = new X509Certificate(cert);
  const agora = Date.now();
  if (agora < Date.parse(certificado.validFrom) || agora >= Date.parse(certificado.validTo)) {
    throw new ErroVerificacao('Certificado TLS fora da validade.');
  }
  const nomeValido = isIP(tls.nome) ? certificado.checkIP(tls.nome) : certificado.checkHost(tls.nome);
  if (!nomeValido) throw new ErroVerificacao('Nome TLS não corresponde ao certificado.');
}

/** Diagnostica pré-requisitos sem exportar dados, imprimir segredos, escrever arquivos ou iniciar a API. */
async function executar() {
  if (process.argv.length !== 2) throw new ErroVerificacao('Use npm run verificar-instalacao sem argumentos; defina SISDOC_CONFIG.');
  if (process.platform !== 'win32' || process.arch !== 'x64' || Number(process.versions.node.split('.')[0]) !== 24) {
    throw new ErroVerificacao('Use Windows x64 com Node.js 24.');
  }
  const raiz = path.resolve(__dirname, '..');
  etapa = 'build e dependências';
  const { carregarConfiguracao } = require(path.join(raiz, 'apps', 'api', 'dist', 'configuracao.js'));
  const { SEQUENCIA_MIGRACOES } = require(path.join(raiz, 'apps', 'api', 'dist', 'migracoes', 'sequencia.js'));
  const { TEMPLATES_OFICIAIS } = require('@sisdoc/templates');
  const { Client } = require('pg');
  const { chromium } = require('playwright');
  etapa = 'configuração externa SISDOC_CONFIG';
  const config = await carregarConfiguracao(process.env.SISDOC_CONFIG);
  etapa = 'certificado/chave TLS';
  await verificarTls(config.tls);
  etapa = 'lista de senhas comuns';
  if (!config.seguranca) throw new ErroVerificacao('Configure seguranca.listaSenhas antes de usar a instalação.');
  if (!(await fs.readFile(config.seguranca.listaSenhas, 'utf8')).split(/\r?\n/).some((linha) => linha.trim())) {
    throw new ErroVerificacao('A lista local de senhas comuns está vazia.');
  }
  etapa = 'pasta PDF e permissões de acesso';
  const pastaPdf = await fs.lstat(config.pdf.diretorio);
  if (!pastaPdf.isDirectory() || pastaPdf.isSymbolicLink()) throw new ErroVerificacao('A pasta PDF deve ser regular e local.');
  await fs.access(config.pdf.diretorio, constants.R_OK | constants.W_OK);
  etapa = 'Chromium no contexto da conta executora';
  const navegador = await chromium.launch({ headless: true });
  await navegador.close();
  console.log('OK: configuração externa, TLS, lista de senhas, pasta PDF acessível e Chromium.');

  const cliente = new Client({
    host: config.banco.host, port: config.banco.porta, database: config.banco.nome,
    user: config.banco.usuario, password: config.banco.senha, connectionTimeoutMillis: 5000,
  });
  etapa = 'conexão PostgreSQL, privilégios e histórico';
  try {
    await cliente.connect();
    await cliente.query('BEGIN READ ONLY');
    await cliente.query("SET LOCAL statement_timeout = '10s'");
    const versao = await verificarBanco(cliente, SEQUENCIA_MIGRACOES);
    etapa = 'templates vigentes e aprovações';
    const modelos = await cliente.query(`
      SELECT t.tipo, t.versao, count(a.id)::integer AS aprovacoes
      FROM documentos.template_versao t
      LEFT JOIN documentos.aprovacao_modelo a ON a.template_versao_id = t.id
      WHERE t.versao = ANY($1::text[]) GROUP BY t.tipo, t.versao
    `, [Object.values(TEMPLATES_OFICIAIS)]);
    for (const [tipo, versaoModelo] of Object.entries(TEMPLATES_OFICIAIS)) {
      const modelo = modelos.rows.find((item) => item.tipo === tipo && item.versao === versaoModelo);
      if (!modelo) throw new ErroVerificacao('Templates vigentes ausentes apesar do histórico; conferir restauração.');
      console.log(`${modelo.aprovacoes > 0 ? 'REGISTRADA' : 'PENDENTE'}: aprovação de template ${tipo} v2 (não substitui conferir a regra vigente).`);
    }
    await cliente.query('ROLLBACK');
    console.log(`OK: PostgreSQL 16 local, login restrito e histórico completo até ${versao}.`);
  } finally {
    await cliente.end();
  }
  console.log(config.processos
    ? `CONFIGURADO: ${config.processos.mascaras.length} formato(s) de processo; conferir padrão institucional.`
    : 'PENDENTE: máscaras de processo compartilhadas por DOF/DTC.');
  console.log('Verificação somente leitura concluída. Não certifica ACLs, integridade dos PDFs/dados, confiança do navegador ou aceite no Windows Server.');
}

module.exports = { verificarHistorico, verificarPapel, verificarBanco, verificarTls };
if (require.main === module) {
  executar().catch((erro) => {
    console.error(`Verificação não concluída na etapa: ${etapa}.`);
    if (erro instanceof ErroVerificacao) console.error(erro.message);
    console.error('Consulte docs\\MIGRACAO_WINDOWS_SERVER.md. Nenhum dado foi exportado ou migrado; detalhes de erros externos omitidos para proteger segredos.');
    process.exitCode = 1;
  });
}
