import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import type { IncomingHttpHeaders } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  dadosFontePreviaDofSchema,
  documentoDtcSchema,
  historicoEmissoesSchema,
  OBSERVACAO_PADRAO_INSS,
  preconferenciaDofSchema,
  previaConferidaDofSchema,
  previaDtcSchema,
  rascunhoDofSchema,
  respostaSessaoSchema,
  resultadoConferenciaDofSchema,
  resultadoCopiaEmitidoSchema,
  resultadoTransicaoDtcSchema,
  situacaoEmissaoSchema,
  type Configuracao,
  type SituacaoEmissao,
  type TipoDtc,
} from '@sisdoc/contratos';
import { CNPJ_SEMAD, MARCA_INSS_PROVISORIO, TEXTO_SEM_EMENDAS } from '@sisdoc/templates';
import EmbeddedPostgres from 'embedded-postgres';
import forge from 'node-forge';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAplicacao } from '../apps/api/dist/aplicacao.js';
import { carregarConfiguracao } from '../apps/api/dist/configuracao.js';
import { MENSAGEM_SEM_APROVACAO } from '../apps/api/dist/documentos/rascunhos.js';
import { WorkerPdfEmissao } from '../apps/api/dist/documentos/worker-pdf-emissao.js';
import { SEQUENCIA_MIGRACOES } from '../apps/api/dist/migracoes/sequencia.js';
import { ProtetorDados } from '../apps/api/dist/seguranca/protecao-dados.js';
import { gerarHashSenha } from '../apps/api/dist/seguranca/senhas.js';
import { registrarAprovacaoModelo } from '../apps/api/dist/setup/aprovacao-modelo.js';
import { instalar, type OpcoesInstalacao } from '../apps/api/dist/setup/instalador.js';
import { migrar } from '../apps/api/dist/setup/migrar.js';
import { cpfSintetico } from './dados-sinteticos.js';

const senhaMigrador = 'MigracaoDtcFicticia!12345';
const senhaAplicativo = 'AplicativoDtcFicticio!12345';
const senhaAdmin = 'AdministradorDtcFicticio!12345';
const senhaUsuarios = 'UsuarioDtcFicticio!12345';
const nomeTls = 'sisdoc.local';

type Sessao = { cookie: string; csrf: string };
type Resposta = { status: number | undefined; corpo: string; bruto: Buffer; headers: IncomingHttpHeaders };
type ItemTexto = { texto: string; x: number; y: number; largura: number; altura: number };
type PaginaPdf = { largura: number; altura: number; itens: ItemTexto[]; texto: string };

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
  const nomeCa = [{ name: 'commonName', value: 'CA temporaria de testes de DTC' }];
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

async function lerPaginas(pdf: Buffer): Promise<PaginaPdf[]> {
  const tarefa = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, verbosity: 0 });
  try {
    const documento = await tarefa.promise;
    const paginas: PaginaPdf[] = [];
    for (let numero = 1; numero <= documento.numPages; numero += 1) {
      const pagina = await documento.getPage(numero);
      const viewport = pagina.getViewport({ scale: 1 });
      const conteudo = await pagina.getTextContent();
      const itens = conteudo.items.flatMap((item) => 'str' in item ? [{
        texto: item.str, x: item.transform[4], y: item.transform[5], largura: item.width, altura: item.height,
      }] : []);
      paginas.push({
        largura: viewport.width, altura: viewport.height, itens,
        texto: itens.map((item) => item.texto).join(' ').replace(/\s+/g, ' '),
      });
    }
    return paginas;
  } finally {
    await tarefa.destroy();
  }
}

// Confere A4, rodapé "Página N de M" e que nenhum texto ultrapassa as margens (sem corte lateral ou vertical).
function conferirSemCorte(paginas: PaginaPdf[]): string {
  expect(paginas.length).toBeGreaterThan(0);
  for (const [indice, pagina] of paginas.entries()) {
    expect(Math.abs(pagina.largura - 595.28)).toBeLessThan(1);
    expect(Math.abs(pagina.altura - 841.89)).toBeLessThan(1);
    expect(pagina.texto).toMatch(new RegExp(`Página\\s+${indice + 1}\\s+de\\s+${paginas.length}`));
    for (const item of pagina.itens.filter((elemento) => elemento.texto.trim())) {
      expect(item.x).toBeGreaterThanOrEqual(24.5);
      expect(item.x + item.largura).toBeLessThanOrEqual(pagina.largura - 24.5);
      expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.y + item.altura).toBeLessThanOrEqual(pagina.altura + 0.5);
    }
  }
  return paginas.map((pagina) => pagina.texto).join(' ').replace(/\s+/g, '');
}

function contem(textoCompacto: string, esperado: string): void {
  // Rótulos podem sair em caixa alta por CSS; a comparação ignora caixa e espaços.
  expect(textoCompacto.toLocaleUpperCase('pt-BR'), esperado).toContain(esperado.replace(/\s+/g, '').toLocaleUpperCase('pt-BR'));
}

const PERIODOS_MAXIMOS = [
  ['1980-01-01', '1984-12-31'],
  ['1986-01-01', '1990-12-31'],
  ['1992-01-01', '1996-12-31'],
  ['1998-01-01', '2002-12-31'],
] as const;

const CATEGORIAS = ['efetivo', 'comissionado', 'contratado', 'servico_prestado'] as const;

function periodo(inicio: string, fim: string, tipo: TipoDtc, indice: number) {
  const anoInicio = Number(inicio.slice(0, 4));
  const anoFim = Number(fim.slice(0, 4));
  return {
    inicio, fim,
    anos: Array.from({ length: anoFim - anoInicio + 1 }, (_, posicao) => ({
      ano: anoInicio + posicao, abrangencia: 'intervalo_declarado',
      faltas: posicao === 1 ? 3 : 0, ts: 0, pf: 0, ip: 0, outros: 0, pb: 0, pv: 0, licencaPremio: 0,
    })),
    categoria: tipo === 'DTC_INSS' ? CATEGORIAS[indice % CATEGORIAS.length] : null,
    cargo: tipo === 'DTC_INSS' ? `Cargo fictício de período ${indice + 1} com denominação extensa para quebra de linha` : null,
  };
}

const CARGOS_MAXIMOS = [1, 2, 3].map((ordem) => ({
  cargo: `Assessor fictício especial nível ${ordem} da coordenação sintética`,
  decretoNomeacao: `Decreto fictício nº ${100 + ordem}/1985`,
  publicacaoNomeacao: `DOM fictício de 0${ordem}/02/1985`,
  dataEntradaExercicio: `198${ordem}-03-0${ordem}`,
  decretoExoneracao: ordem === 3 ? null : `Decreto fictício nº ${200 + ordem}/1990`,
  publicacaoExoneracao: ordem === 3 ? null : `DOM fictício de 1${ordem}/05/1990`,
  dataEncerramento: ordem === 3 ? null : `199${ordem}-05-1${ordem}`,
}));

const INSS_FICTICIO = {
  licencas: {
    possui: true,
    descricao: 'Licença fictícia para tratamento de saúde de 01/03/1987 a 30/04/1987; licença fictícia sem vencimentos de 01/06/1993 a 31/07/1993.',
  },
  documentacao: { nomeacao: true, ctps: true, folha: true, frequencia: true, outros: 'Ficha funcional fictícia' },
  observacao: OBSERVACAO_PADRAO_INSS,
};

function corpoDtc(tipo: TipoDtc, fonte: { pessoaId: string; vinculoId: string }, quantidade = 4) {
  return {
    tipo, ...fonte, confirmacaoDados: true,
    periodos: PERIODOS_MAXIMOS.slice(0, quantidade).map(([inicio, fim], indice) => periodo(inicio, fim, tipo, indice)),
    cargos: tipo === 'DTC_COMISSIONADO' ? CARGOS_MAXIMOS : [],
    inss: tipo === 'DTC_INSS' ? INSS_FICTICIO : null,
    processo: '1234/5678',
    confirmarInicioAjustado: false,
  };
}

describe('DTC IPAM, Comissionado e INSS de ponta a ponta', () => {
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
  const conferidas = new Map<TipoDtc, { documentoId: string; revisao: number }>();
  const emitidas = new Map<TipoDtc | 'DOF', SituacaoEmissao>();
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
    metodo: 'GET' | 'POST' | 'PATCH'; rota: string; corpo?: unknown; sessao?: Sessao; provaFonte?: string; chave?: string;
  }): Promise<Resposta> {
    const conteudo = opcoesPedido.corpo === undefined ? undefined : JSON.stringify(opcoesPedido.corpo);
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
        timeout: 30000,
        headers: {
          Origin: `https://${nomeTls}:${portaHttps}`,
          ...(conteudo === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(opcoesPedido.sessao ? { Cookie: opcoesPedido.sessao.cookie, 'X-CSRF-Token': opcoesPedido.sessao.csrf } : {}),
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
    const matricula = `DTC-${chave.toUpperCase()}`;
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
    const cpf = cpfSintetico(920000000 + contadorCpf);
    const matricula = `DTC-FICTICIA-${contadorCpf}`;
    await banco().query(`
      INSERT INTO nucleo.pessoa (id, cpf_cifrado, cpf_hash, nome, nome_busca, nascimento, nome_mae_cifrado, nome_pai_cifrado)
      VALUES ($1, $2, $3, $4, lower($4), '1958-03-02', $5, $6)
    `, [pessoaId, protetor.cifrar(Buffer.from(cpf, 'ascii'), {
      schema: 'nucleo', tabela: 'pessoa', registroId: pessoaId, campo: 'cpf_cifrado',
    }), protetor.hashCpf(cpf), nome, protetor.cifrar(Buffer.from('Filiação materna fictícia', 'utf8'), {
      schema: 'nucleo', tabela: 'pessoa', registroId: pessoaId, campo: 'nome_mae_cifrado',
    }), protetor.cifrar(Buffer.from('Filiação paterna fictícia', 'utf8'), {
      schema: 'nucleo', tabela: 'pessoa', registroId: pessoaId, campo: 'nome_pai_cifrado',
    })]);
    await banco().query(`
      INSERT INTO nucleo.vinculo
        (id, pessoa_id, matricula, matricula_norm, sistema_origem, id_origem, admissao, cargo, referencia, regime_juridico, orgao_nome)
      VALUES ($1, $2, $3, $3, 'fonte-dtc-sintetica', $4, '1980-01-01', 'Cargo fictício', 'PNS-A',
        'Regime fictício', 'Órgão fictício')
    `, [vinculoId, pessoaId, matricula, randomUUID()]);
    return { pessoaId, vinculoId };
  }

  async function criarDtc(tipo: TipoDtc, nome: string, quantidade = 4, autor = 'analista') {
    const fonte = await criarFonte(nome);
    const criado = await requisitar({ metodo: 'POST', rota: 'dtc', sessao: sessao(autor), corpo: corpoDtc(tipo, fonte, quantidade) });
    expect(criado.status, criado.corpo).toBe(201);
    return documentoDtcSchema.parse(JSON.parse(criado.corpo));
  }

  async function previa(documentoId: string, quem = 'coordenador') {
    const resposta = await requisitar({ metodo: 'GET', rota: `dtc/${documentoId}/previa`, sessao: sessao(quem) });
    expect(resposta.status, resposta.corpo).toBe(200);
    return previaDtcSchema.parse(JSON.parse(resposta.corpo));
  }

  async function conferir(documentoId: string, quem = 'coordenador'): Promise<{ documentoId: string; revisao: number }> {
    const dados = await previa(documentoId, quem);
    const resposta = await requisitar({
      metodo: 'POST', rota: `dtc/${documentoId}/conferir`, sessao: sessao(quem),
      corpo: { revisao: dados.documento.revisao, provaFonte: dados.fonte.provaFonte, confirmar: true },
    });
    expect(resposta.status, resposta.corpo).toBe(200);
    const resultado = resultadoTransicaoDtcSchema.parse(JSON.parse(resposta.corpo));
    expect(resultado.status).toBe('conferido');
    return { documentoId, revisao: resultado.revisao };
  }

  async function emitirDtc(documentoId: string, quem = 'coordenador', chave = randomUUID()) {
    const dados = await previa(documentoId, quem === 'coordenador' || quem === 'coordenador2' ? quem : 'coordenador');
    return requisitar({
      metodo: 'POST', rota: `dtc/${documentoId}/emitir`, sessao: sessao(quem), chave,
      corpo: { revisao: dados.documento.revisao, provaFonte: dados.fonte.provaFonte },
    });
  }

  async function auditorias(acao: string, entidadeId: string): Promise<number> {
    const consulta = await banco().query<{ total: string }>(
      'SELECT count(*)::text AS total FROM seguranca.auditoria WHERE acao = $1 AND entidade_id = $2',
      [acao, entidadeId],
    );
    return Number(consulta.rows[0].total);
  }

  async function baixarPdf(emissaoId: string): Promise<Buffer> {
    const baixado = await requisitar({ metodo: 'GET', rota: `emissoes/${emissaoId}/pdf`, sessao: sessao('coordenador') });
    expect(baixado.status, baixado.corpo).toBe(200);
    expect(baixado.headers['content-type']).toBe('application/pdf');
    expect(baixado.bruto.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    return baixado.bruto;
  }

  // Fluxo DOF de fatia 5 no máximo de 45 anos, para verificar o PDF da DOF sob as mesmas regras de corte.
  async function prepararDofConferida(): Promise<{ documentoId: string; revisao: number; provaFonte: string }> {
    const { pessoaId, vinculoId } = await criarFonte('Pessoa Dof Fictícia');
    const calculo = {
      pessoaId, vinculoId, inicio: '1980-01-01', fim: '2024-12-31', confirmacaoDados: true,
      anos: Array.from({ length: 45 }, (_, indice) => ({
        ano: 1980 + indice, abrangencia: 'intervalo_declarado',
        faltas: indice === 3 ? 2 : 0, ts: 0, pf: 0, ip: 0, outros: 0, pb: 0, pv: 0, licencaPremio: 0,
      })),
    };
    const criado = await requisitar({
      metodo: 'POST', rota: 'documentos', sessao: sessao('analista'),
      corpo: { calculo, admissaoEsperada: '1980-01-01', motivo: 'Cálculo sintético de 45 anos' },
    });
    expect(criado.status, criado.corpo).toBe(201);
    const rascunho = rascunhoDofSchema.parse(JSON.parse(criado.corpo));
    const processo = await requisitar({
      metodo: 'PATCH', rota: `documentos/${rascunho.id}/processo`, sessao: sessao('analista'),
      corpo: { revisao: rascunho.revisao, processo: '1234/5678', motivo: 'Processo fictício' },
    });
    expect(processo.status, processo.corpo).toBe(200);
    const encaminhado = await requisitar({
      metodo: 'POST', rota: `documentos/${rascunho.id}/encaminhar`, sessao: sessao('analista'),
      corpo: { revisao: rascunhoDofSchema.parse(JSON.parse(processo.corpo)).revisao, destinatarioId: idUsuario('coordenador') },
    });
    expect(encaminhado.status, encaminhado.corpo).toBe(201);
    const revisao = rascunhoDofSchema.parse(JSON.parse(encaminhado.corpo)).revisao;
    const dadosPrevia = await requisitar({ metodo: 'GET', rota: `documentos/${rascunho.id}/dados-previa`, sessao: sessao('coordenador') });
    const fonte = dadosFontePreviaDofSchema.parse(JSON.parse(dadosPrevia.corpo));
    const relatorio = await requisitar({
      metodo: 'GET', rota: `documentos/${rascunho.id}/preconferencia`, sessao: sessao('coordenador'), provaFonte: fonte.provaFonte,
    });
    const pre = preconferenciaDofSchema.parse(JSON.parse(relatorio.corpo));
    const conferido = await requisitar({
      metodo: 'POST', rota: `documentos/${rascunho.id}/conferir`, sessao: sessao('coordenador'),
      corpo: { revisao, provaFonte: fonte.provaFonte, provaRelatorio: pre.provaRelatorio, confirmar: true },
    });
    expect(conferido.status, conferido.corpo).toBe(201);
    resultadoConferenciaDofSchema.parse(JSON.parse(conferido.corpo));
    const previaConferida = await requisitar({
      metodo: 'GET', rota: `documentos/${rascunho.id}/dados-previa-conferida`, sessao: sessao('coordenador'),
    });
    const dados = previaConferidaDofSchema.parse(JSON.parse(previaConferida.corpo));
    return { documentoId: rascunho.id, revisao: dados.revisao, provaFonte: dados.fonte.provaFonte };
  }

  beforeAll(async () => {
    if (process.platform !== 'win32' || !process.env.PUBLIC) {
      throw new Error('Esta verificação de instalação requer Windows e uma pasta pública local.');
    }
    const temporarios = process.env.SISDOC_TEST_TEMP ?? os.tmpdir();
    if (!path.isAbsolute(temporarios) || /[^\x00-\x7f]/.test(temporarios)) {
      throw new Error('Defina SISDOC_TEST_TEMP com um diretório local absoluto ASCII ou com caminho curto 8.3 existente.');
    }
    temporario = await mkdtemp(path.join(temporarios, 'sisdoc-dtc-'));
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
      password: 'SuperusuarioDtcFicticio!12345',
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
    await administradorBanco.query('CREATE DATABASE sisdoc_dtc OWNER sisdoc_migrador');
    await administradorBanco.query('CREATE DATABASE sisdoc_dtc_migrar OWNER sisdoc_migrador');
    opcoes = {
      raiz,
      porta: portaHttps,
      banco: {
        porta: portaBanco, nome: 'sisdoc_dtc', migrador: 'sisdoc_migrador', senhaMigrador,
        usuario: 'sisdoc_aplicativo', senha: senhaAplicativo,
      },
      tls: { certificado, chave, ca, nome: nomeTls },
      sidServico: 'S-1-5-19',
      listaSenhas,
      processos: { mascaras: ['####/####'] },
      administrador: { matricula: 'ADMIN-DTC-FICTICIO', nome: 'Operador Fictício', senha: senhaAdmin },
    };
    await instalar(opcoes);
    config = await carregarConfiguracao(path.join(raiz, 'config', 'aplicacao.json'));
    protetor = new ProtetorDados(config.chaves);
    migrador = new Client({
      host: '127.0.0.1', port: portaBanco, database: 'sisdoc_dtc', user: 'sisdoc_migrador', password: senhaMigrador,
    });
    await migrador.connect();
    poolAplicativo = new Pool({
      host: config.banco.host, port: config.banco.porta, database: config.banco.nome,
      user: config.banco.usuario, password: config.banco.senha, max: 10,
    });
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
    if (temporario && path.basename(temporario).startsWith('sisdoc-dtc-')) {
      await rm(temporario, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  it('valida limites e regras por tipo e restringe a criação a analista e coordenador', async () => {
    const fonte = await criarFonte('Pessoa Validação Fictícia');
    const cincoPeriodos = corpoDtc('DTC_IPAM', fonte);
    cincoPeriodos.periodos.push(periodo('2004-01-01', '2006-12-31', 'DTC_IPAM', 4));
    expect((await requisitar({ metodo: 'POST', rota: 'dtc', sessao: sessao('analista'), corpo: cincoPeriodos })).status).toBe(400);
    const quatroCargos = corpoDtc('DTC_COMISSIONADO', fonte);
    quatroCargos.cargos = [...CARGOS_MAXIMOS, CARGOS_MAXIMOS[0]];
    expect((await requisitar({ metodo: 'POST', rota: 'dtc', sessao: sessao('analista'), corpo: quatroCargos })).status).toBe(400);
    const semCargo = { ...corpoDtc('DTC_COMISSIONADO', fonte), cargos: [] };
    const respostaSemCargo = await requisitar({ metodo: 'POST', rota: 'dtc', sessao: sessao('analista'), corpo: semCargo });
    expect(respostaSemCargo.status).toBe(400);
    expect(JSON.parse(respostaSemCargo.corpo).detail).toContain('cargo em comissão');
    const inssSemCategoria = corpoDtc('DTC_INSS', fonte);
    inssSemCategoria.periodos[0] = { ...inssSemCategoria.periodos[0], categoria: null };
    expect((await requisitar({ metodo: 'POST', rota: 'dtc', sessao: sessao('analista'), corpo: inssSemCategoria })).status).toBe(400);
    const ipamComInss = { ...corpoDtc('DTC_IPAM', fonte), inss: INSS_FICTICIO };
    expect((await requisitar({ metodo: 'POST', rota: 'dtc', sessao: sessao('analista'), corpo: ipamComInss })).status).toBe(400);
    const sobrepostos = corpoDtc('DTC_IPAM', fonte, 2);
    sobrepostos.periodos[1] = periodo('1984-01-01', '1990-12-31', 'DTC_IPAM', 1);
    expect((await requisitar({ metodo: 'POST', rota: 'dtc', sessao: sessao('analista'), corpo: sobrepostos })).status).toBe(400);
    const processoInvalido = { ...corpoDtc('DTC_IPAM', fonte), processo: '12/34' };
    expect((await requisitar({ metodo: 'POST', rota: 'dtc', sessao: sessao('analista'), corpo: processoInvalido })).status).toBe(400);
    for (const quem of ['secretario', 'admin']) {
      expect((await requisitar({ metodo: 'POST', rota: 'dtc', sessao: sessao(quem), corpo: corpoDtc('DTC_IPAM', fonte) })).status)
        .toBe(403);
    }
    expect((await requisitar({ metodo: 'POST', rota: 'dtc', corpo: corpoDtc('DTC_IPAM', fonte) })).status).toBe(401);
    const total = await banco().query("SELECT count(*)::int AS total FROM documentos.documento WHERE tipo LIKE 'DTC_%'");
    expect(total.rows[0].total).toBe(0);
  });

  it('cria nos máximos, edita com motivo, confere e devolve as três DTCs', async () => {
    const nomes: Record<TipoDtc, string> = {
      DTC_IPAM: 'Pessoa Ipam Fictícia', DTC_COMISSIONADO: 'Pessoa Comissionada Fictícia', DTC_INSS: 'Pessoa Inss Fictícia',
    };
    for (const tipo of ['DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS'] as const) {
      const criado = await criarDtc(tipo, nomes[tipo]);
      expect(criado).toMatchObject({ tipo, status: 'rascunho', revisao: 1, pendencias: [] });
      expect(criado.conteudo.periodos).toHaveLength(4);
      expect(criado.resultado.periodos).toHaveLength(4);
      expect(criado.resultado.linhasTotais.map((linha) => linha.codigo)).toEqual([
        'total_contribuicao', 'efetivo_exercicio', 'incorporacao_pb', 'incorporacao_pv', 'incorporacao_pb_pv', 'licenca_premio',
      ]);
      expect(criado.resultado.linhasTotais[0].dias).toBe(criado.resultado.totais.totalContribuicao);
      expect(criado.conteudo.cargos).toHaveLength(tipo === 'DTC_COMISSIONADO' ? 3 : 0);
      if (tipo !== 'DTC_IPAM') {
        expect(criado.resultado.avisos.some((aviso) => aviso.codigo === 'perfil_inferido')).toBe(true);
        expect(criado.resultado.linhasTotais.every((linha) => linha.provisoria)).toBe(true);
      }
      const filhos = await banco().query<{ periodos: number; cargos: number; categorias: number }>(`
        SELECT (SELECT count(*)::int FROM documentos.documento_periodo WHERE documento_id = $1) AS periodos,
          (SELECT count(*)::int FROM documentos.documento_cargo_comissionado WHERE documento_id = $1) AS cargos,
          (SELECT count(*)::int FROM documentos.documento_periodo WHERE documento_id = $1 AND categoria IS NOT NULL) AS categorias
      `, [criado.id]);
      expect(filhos.rows[0]).toEqual({
        periodos: 4, cargos: tipo === 'DTC_COMISSIONADO' ? 3 : 0, categorias: tipo === 'DTC_INSS' ? 4 : 0,
      });
      expect(await auditorias('dtc_criada', criado.id)).toBe(1);

      // Somente o autor edita; a edição exige motivo e registra o ajuste.
      const { tipo: _tipo, pessoaId: _p, vinculoId: _v, confirmacaoDados: _c, ...conteudo } = corpoDtc(tipo, {
        pessoaId: criado.pessoaId, vinculoId: criado.vinculoId,
      });
      const editado = { ...conteudo, processo: '4321/8765' };
      expect((await requisitar({
        metodo: 'PATCH', rota: `dtc/${criado.id}`, sessao: sessao('analista2'), corpo: { ...editado, revisao: 1, motivo: 'Correção' },
      })).status).toBe(404);
      expect((await requisitar({
        metodo: 'PATCH', rota: `dtc/${criado.id}`, sessao: sessao('analista'), corpo: { ...editado, revisao: 1 },
      })).status).toBe(400);
      const atualizado = await requisitar({
        metodo: 'PATCH', rota: `dtc/${criado.id}`, sessao: sessao('analista'),
        corpo: { ...editado, revisao: 1, motivo: 'Correção do processo fictício' },
      });
      expect(atualizado.status, atualizado.corpo).toBe(200);
      expect(documentoDtcSchema.parse(JSON.parse(atualizado.corpo))).toMatchObject({ revisao: 2, conteudo: { processo: '4321/8765' } });
      expect((await requisitar({
        metodo: 'PATCH', rota: `dtc/${criado.id}`, sessao: sessao('analista'),
        corpo: { ...editado, revisao: 1, motivo: 'Revisão antiga' },
      })).status).toBe(409);

      // Prévia com fonte; somente quem vê o documento a abre.
      const dados = await previa(criado.id, 'analista');
      expect(dados.fonte).toMatchObject({ nome: nomes[tipo], nomePai: 'Filiação paterna fictícia', admissao: '1980-01-01' });
      expect((await requisitar({ metodo: 'GET', rota: `dtc/${criado.id}/previa`, sessao: sessao('analista2') })).status).toBe(404);
      for (const quem of ['secretario', 'admin']) {
        expect((await requisitar({ metodo: 'GET', rota: `dtc/${criado.id}/previa`, sessao: sessao(quem) })).status).toBe(403);
      }
      expect((await requisitar({
        metodo: 'POST', rota: `dtc/${criado.id}/conferir`, sessao: sessao('coordenador'),
        corpo: { revisao: dados.documento.revisao, provaFonte: dados.fonte.provaFonte },
      })).status).toBe(400);

      const primeira = await conferir(criado.id);
      expect(await auditorias('dtc_conferida', criado.id)).toBe(1);
      expect((await requisitar({
        metodo: 'POST', rota: `dtc/${criado.id}/devolver`, sessao: sessao('analista'),
        corpo: { revisao: primeira.revisao, motivo: 'Devolução sintética' },
      })).status).toBe(403);
      const devolvido = await requisitar({
        metodo: 'POST', rota: `dtc/${criado.id}/devolver`, sessao: sessao('coordenador2'),
        corpo: { revisao: primeira.revisao, motivo: 'Devolução sintética para revisão' },
      });
      expect(devolvido.status, devolvido.corpo).toBe(200);
      expect(resultadoTransicaoDtcSchema.parse(JSON.parse(devolvido.corpo)).status).toBe('rascunho');
      expect(await auditorias('dtc_conferida_devolvida', criado.id)).toBe(1);
      // O autor analista também pode conferir a própria DTC (A.3: criar/conferir = analista e coordenador).
      conferidas.set(tipo, await conferir(criado.id, 'analista'));
    }
    const lista = await requisitar({ metodo: 'GET', rota: 'dtc?estado=conferido', sessao: sessao('coordenador') });
    expect(lista.status, lista.corpo).toBe(200);
    expect(JSON.parse(lista.corpo).itens).toHaveLength(3);
    const devolucoes = await banco().query('SELECT count(*)::int AS total FROM documentos.devolucao_conferido_dtc');
    expect(devolucoes.rows[0].total).toBe(3);
  });

  it('bloqueia a emissão sem aprovação formal do tipo e restringe a emissão ao coordenador', async () => {
    for (const tipo of ['DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS'] as const) {
      const alvo = conferidas.get(tipo);
      if (!alvo) throw new Error(`DTC ${tipo} conferida ausente.`);
      const bloqueada = await emitirDtc(alvo.documentoId);
      expect(bloqueada.status, bloqueada.corpo).toBe(409);
      expect(JSON.parse(bloqueada.corpo).detail).toBe(MENSAGEM_SEM_APROVACAO);
      expect(await auditorias('emissao_dtc_bloqueada_sem_aprovacao', alvo.documentoId)).toBe(1);
    }
    expect((await banco().query('SELECT count(*)::int AS total FROM documentos.emissao')).rows[0].total).toBe(0);
    expect((await banco().query('SELECT count(*)::int AS total FROM documentos.numeracao')).rows[0].total).toBe(0);

    // Aprovar a DOF não libera as DTCs.
    await registrarAprovacaoModelo(banco(), { tipo: 'DOF', aprovadoPor: 'Responsável fictício', referenciaDecisao: 'Decisão fictícia DOF' });
    const ipam = conferidas.get('DTC_IPAM');
    if (!ipam) throw new Error('DTC IPAM conferida ausente.');
    expect((await emitirDtc(ipam.documentoId)).status).toBe(409);

    for (const tipo of ['DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS'] as const) {
      await registrarAprovacaoModelo(banco(), {
        tipo, aprovadoPor: 'Responsável fictício', referenciaDecisao: `Decisão fictícia ${tipo}`,
      });
    }
    for (const quem of ['analista', 'secretario', 'admin']) {
      expect((await emitirDtc(ipam.documentoId, quem)).status).toBe(403);
    }
  });

  it('emite as três DTCs com numeração própria por tipo e snapshot imutável', async () => {
    const ano = new Date().getFullYear();
    for (const tipo of ['DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS'] as const) {
      const alvo = conferidas.get(tipo);
      if (!alvo) throw new Error(`DTC ${tipo} conferida ausente.`);
      const chave = randomUUID();
      const dados = await previa(alvo.documentoId);
      expect(dados.documento.revisao).toBe(alvo.revisao);
      const pedido = {
        metodo: 'POST' as const, rota: `dtc/${alvo.documentoId}/emitir`, sessao: sessao('coordenador'), chave,
        corpo: { revisao: alvo.revisao, provaFonte: dados.fonte.provaFonte },
      };
      const resposta = await requisitar(pedido);
      expect(resposta.status, resposta.corpo).toBe(200);
      const emitida = situacaoEmissaoSchema.parse(JSON.parse(resposta.corpo));
      expect(emitida).toMatchObject({ tipo, documentoId: alvo.documentoId, status: 'emitido', numero: `N° 1/${ano}` });
      expect(emitida.pdf.status).toBe('pendente');
      const repetida = await requisitar(pedido);
      expect(repetida.status, repetida.corpo).toBe(200);
      expect(situacaoEmissaoSchema.parse(JSON.parse(repetida.corpo)).emissaoId).toBe(emitida.emissaoId);
      expect(await auditorias('dtc_emitida', alvo.documentoId)).toBe(1);
      emitidas.set(tipo, emitida);
    }
    const numeracao = await banco().query<{ tipo: string; ultimo_numero: string; sufixo: string }>(
      'SELECT tipo, ultimo_numero::text, sufixo FROM documentos.numeracao ORDER BY tipo',
    );
    expect(numeracao.rows).toEqual([
      { tipo: 'DTC_COMISSIONADO', ultimo_numero: '1', sufixo: '' },
      { tipo: 'DTC_INSS', ultimo_numero: '1', sufixo: '' },
      { tipo: 'DTC_IPAM', ultimo_numero: '1', sufixo: '' },
    ]);
    const ipam = emitidas.get('DTC_IPAM');
    if (!ipam) throw new Error('Emissão IPAM ausente.');
    await expect(banco().query("UPDATE documentos.documento SET status = 'conferido' WHERE id = $1", [ipam.documentoId]))
      .rejects.toBeDefined();
  });

  it('gera os quatro PDFs (DOF e três DTCs) nos máximos, sem corte de conteúdo', async () => {
    const dof = await prepararDofConferida();
    const respostaDof = await requisitar({
      metodo: 'POST', rota: `documentos/${dof.documentoId}/emitir`, sessao: sessao('coordenador'), chave: randomUUID(),
      corpo: { revisao: dof.revisao, provaFonte: dof.provaFonte },
    });
    expect(respostaDof.status, respostaDof.corpo).toBe(200);
    emitidas.set('DOF', situacaoEmissaoSchema.parse(JSON.parse(respostaDof.corpo)));

    await worker.ciclo();
    for (const [tipo, emitida] of emitidas) {
      const situacao = situacaoEmissaoSchema.parse(JSON.parse((await requisitar({
        metodo: 'GET', rota: `emissoes/${emitida.emissaoId}`, sessao: sessao('coordenador'),
      })).corpo));
      expect(situacao.pdf, tipo).toMatchObject({ status: 'concluido', disponivel: true, erro: null });
    }

    const textoDof = conferirSemCorte(await lerPaginas(await baixarPdf(emitidas.get('DOF')?.emissaoId ?? '')));
    for (let ano = 1980; ano <= 2024; ano += 1) contem(textoDof, String(ano));

    const comuns = (texto: string, tipo: TipoDtc) => {
      contem(texto, 'SECRETARIA MUNICIPAL DE ADMINISTRAÇÃO — SEMAD');
      contem(texto, 'Portaria MPS nº 154/2008');
      contem(texto, `DECLARAÇÃO ${emitidas.get(tipo)?.numero ?? ''}`);
      for (const [indice, [inicio, fim]] of PERIODOS_MAXIMOS.entries()) {
        const formatar = (valor: string) => valor.split('-').reverse().join('/');
        contem(texto, `${indice + 1}º período`);
        contem(texto, formatar(inicio));
        contem(texto, formatar(fim));
        for (let ano = Number(inicio.slice(0, 4)); ano <= Number(fim.slice(0, 4)); ano += 1) contem(texto, String(ano));
      }
      for (const rotulo of [
        'Tempo Total de Contribuição', 'Tempo de Efetivo Exercício na PMSL', 'Tempo de Incorporação de PB',
        'Tempo de Incorporação de PV', 'Tempo de Incorporação de PB/PV', 'Tempo de Incorporação de Licença-prêmio',
      ]) contem(texto, rotulo);
    };

    const textoIpam = conferirSemCorte(await lerPaginas(await baixarPdf(emitidas.get('DTC_IPAM')?.emissaoId ?? '')));
    comuns(textoIpam, 'DTC_IPAM');
    contem(textoIpam, TEXTO_SEM_EMENDAS);
    contem(textoIpam, 'Pessoa Ipam Fictícia');
    expect(textoIpam).not.toContain('PRÉVIA'.replace(/\s+/g, ''));

    const textoComissionado = conferirSemCorte(await lerPaginas(await baixarPdf(emitidas.get('DTC_COMISSIONADO')?.emissaoId ?? '')));
    comuns(textoComissionado, 'DTC_COMISSIONADO');
    contem(textoComissionado, `CNPJ ${CNPJ_SEMAD}`);
    for (const [indice, cargo] of CARGOS_MAXIMOS.entries()) {
      contem(textoComissionado, `${indice + 1}º cargo em comissão exercido`);
      contem(textoComissionado, cargo.cargo);
      contem(textoComissionado, cargo.decretoNomeacao);
      if (cargo.decretoExoneracao) contem(textoComissionado, cargo.decretoExoneracao);
    }

    const textoInss = conferirSemCorte(await lerPaginas(await baixarPdf(emitidas.get('DTC_INSS')?.emissaoId ?? '')));
    comuns(textoInss, 'DTC_INSS');
    contem(textoInss, MARCA_INSS_PROVISORIO);
    contem(textoInss, OBSERVACAO_PADRAO_INSS);
    contem(textoInss, INSS_FICTICIO.licencas.descricao);
    contem(textoInss, 'Filiação paterna fictícia');
    for (const rotulo of ['Efetivo/Estável', 'Comissionado/Mandato Eletivo', 'Contratado', 'Serviço Prestado']) contem(textoInss, rotulo);
    for (let indice = 1; indice <= 4; indice += 1) {
      contem(textoInss, `Cargo fictício de período ${indice} com denominação extensa para quebra de linha`);
    }

    const baixado = await requisitar({
      metodo: 'GET', rota: `emissoes/${emitidas.get('DTC_INSS')?.emissaoId ?? ''}/pdf`, sessao: sessao('coordenador'),
    });
    expect(baixado.headers['content-disposition']).toMatch(/filename="PESSOA_INSS_FICTICIA_DTC-INSS_\d{4}-\d{2}-\d{2}\.pdf"/);
  });

  it('lista as cinco últimas DTCs no histórico e copia uma emissão como novo rascunho', async () => {
    for (const nome of ['Pessoa Extra Um Fictícia', 'Pessoa Extra Dois Fictícia', 'Pessoa Extra Três Fictícia']) {
      const criado = await criarDtc('DTC_IPAM', nome, 1);
      await conferir(criado.id);
      const resposta = await emitirDtc(criado.id);
      expect(resposta.status, resposta.corpo).toBe(200);
    }
    const historico = async (quem: string, escopo: string, tipo = 'DTC') => requisitar({
      metodo: 'GET', rota: `historico?tipo=${tipo}&escopo=${escopo}`, sessao: sessao(quem),
    });
    const proprio = historicoEmissoesSchema.parse(JSON.parse((await historico('analista', 'proprio')).corpo));
    expect(proprio.itens).toHaveLength(5);
    expect(proprio.itens.every((item) => item.tipo.startsWith('DTC_') && item.podeCopiar && !item.podeCancelar)).toBe(true);
    const ordenados = [...proprio.itens].sort((a, b) => b.emitidoEm.localeCompare(a.emitidoEm));
    expect(proprio.itens.map((item) => item.emissaoId)).toEqual(ordenados.map((item) => item.emissaoId));
    const dofs = historicoEmissoesSchema.parse(JSON.parse((await historico('analista', 'proprio', 'DOF')).corpo));
    expect(dofs.itens.map((item) => item.tipo)).toEqual(['DOF']);
    expect(historicoEmissoesSchema.parse(JSON.parse((await historico('analista2', 'proprio')).corpo)).itens).toHaveLength(0);
    expect((await historico('analista', 'todos')).status).toBe(400);
    expect(historicoEmissoesSchema.parse(JSON.parse((await historico('coordenador2', 'todos')).corpo)).itens).toHaveLength(6);
    const secretario = historicoEmissoesSchema.parse(JSON.parse((await historico('secretario', 'todos')).corpo));
    expect(secretario.itens.every((item) => item.podeCancelar && !item.podeCopiar)).toBe(true);

    const origem = emitidas.get('DTC_COMISSIONADO');
    if (!origem) throw new Error('Emissão Comissionado ausente.');
    for (const quem of ['secretario', 'admin']) {
      expect((await requisitar({
        metodo: 'POST', rota: `dtc/${origem.documentoId}/copia`, sessao: sessao(quem), corpo: { confirmar: true },
      })).status).toBe(403);
    }
    expect((await requisitar({
      metodo: 'POST', rota: `dtc/${origem.documentoId}/copia`, sessao: sessao('analista2'), corpo: { confirmar: true },
    })).status).toBe(404);
    expect((await requisitar({
      metodo: 'POST', rota: `dtc/${origem.documentoId}/copia`, sessao: sessao('analista'), corpo: {},
    })).status).toBe(400);
    const copia = await requisitar({
      metodo: 'POST', rota: `dtc/${origem.documentoId}/copia`, sessao: sessao('analista'), corpo: { confirmar: true },
    });
    expect(copia.status, copia.corpo).toBe(201);
    const resultado = resultadoCopiaEmitidoSchema.parse(JSON.parse(copia.corpo));
    expect(resultado.origemEmissaoId).toBe(origem.emissaoId);
    const aberto = await requisitar({ metodo: 'GET', rota: `dtc/${resultado.documentoId}`, sessao: sessao('analista') });
    expect(aberto.status, aberto.corpo).toBe(200);
    const rascunho = documentoDtcSchema.parse(JSON.parse(aberto.corpo));
    expect(rascunho).toMatchObject({ tipo: 'DTC_COMISSIONADO', status: 'rascunho' });
    expect(rascunho.conteudo.cargos).toHaveLength(3);
    expect(rascunho.conteudo.periodos).toHaveLength(4);
    const original = await banco().query('SELECT status FROM documentos.documento WHERE id = $1', [origem.documentoId]);
    expect(original.rows[0].status).toBe('emitido');
    const porCoordenador = await requisitar({
      metodo: 'POST', rota: `dtc/${origem.documentoId}/copia`, sessao: sessao('coordenador2'), corpo: { confirmar: true },
    });
    expect(porCoordenador.status, porCoordenador.corpo).toBe(201);
  });

  it('cancela DTC emitida somente por secretário adjunto ou administrador', async () => {
    const alvo = emitidas.get('DTC_IPAM');
    const outro = emitidas.get('DTC_INSS');
    if (!alvo || !outro) throw new Error('Emissões ausentes.');
    const motivo = 'Cancelamento sintético de DTC por erro material';
    const rota = `documentos/${alvo.documentoId}/cancelar`;
    for (const quem of ['analista', 'coordenador']) {
      expect((await requisitar({ metodo: 'POST', rota, sessao: sessao(quem), corpo: { motivo, confirmar: true } })).status).toBe(403);
    }
    const cancelado = await requisitar({ metodo: 'POST', rota, sessao: sessao('secretario'), corpo: { motivo, confirmar: true } });
    expect(cancelado.status, cancelado.corpo).toBe(200);
    expect(situacaoEmissaoSchema.parse(JSON.parse(cancelado.corpo))).toMatchObject({ status: 'cancelado', numero: alvo.numero });
    expect((await requisitar({ metodo: 'POST', rota, sessao: sessao('admin'), corpo: { motivo, confirmar: true } })).status).toBe(409);
    const porAdmin = await requisitar({
      metodo: 'POST', rota: `documentos/${outro.documentoId}/cancelar`, sessao: sessao('admin'), corpo: { motivo, confirmar: true },
    });
    expect(porAdmin.status, porAdmin.corpo).toBe(200);
    const status = await banco().query<{ status: string }>(
      'SELECT status FROM documentos.documento WHERE id = ANY($1::uuid[]) ORDER BY status', [[alvo.documentoId, outro.documentoId]],
    );
    expect(status.rows.map((linha) => linha.status)).toEqual(['cancelado', 'cancelado']);
    const ipamNumeracao = await banco().query<{ ultimo_numero: string }>(
      "SELECT ultimo_numero::text FROM documentos.numeracao WHERE tipo = 'DTC_IPAM'",
    );
    expect(ipamNumeracao.rows).toEqual([{ ultimo_numero: '4' }]);
  });

  it('migra um banco na versão 013 para 014-dtc com npm run migrar', async () => {
    const provisionamento = {
      host: '127.0.0.1', porta: portaBanco, nome: 'sisdoc_dtc_migrar',
      migracao: { usuario: 'sisdoc_migrador', senha: senhaMigrador },
      aplicativo: { usuario: 'sisdoc_aplicativo', senha: senhaAplicativo },
    };
    const anterior = new Client({
      host: '127.0.0.1', port: portaBanco, database: 'sisdoc_dtc_migrar', user: 'sisdoc_migrador', password: senhaMigrador,
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
      const ate013 = SEQUENCIA_MIGRACOES.slice(0, 13);
      expect(ate013.at(-1)?.versao).toBe('013-emissao');
      for (const migracao of ate013) {
        expect(await migracao.aplicar(anterior, 'sisdoc_aplicativo')).toBe(true);
      }
      await anterior.query('COMMIT');
      const semDtc = await anterior.query("SELECT to_regclass('documentos.conferencia_dtc') IS NULL AS ausente");
      expect(semDtc.rows[0].ausente).toBe(true);
      expect(await migrar(provisionamento)).toEqual({ aplicadas: ['014-dtc'], versaoAtual: '014-dtc' });
      expect(await migrar(provisionamento)).toEqual({ aplicadas: [], versaoAtual: '014-dtc' });
      const privilegios = await anterior.query<{ conferencia: boolean; tabela: boolean; categoria: boolean; apagar: boolean }>(`
        SELECT has_column_privilege('sisdoc_aplicativo', 'documentos.conferencia_dtc', 'conferido_por', 'INSERT') AS conferencia,
          has_table_privilege('sisdoc_aplicativo', 'documentos.conferencia_dtc', 'INSERT') AS tabela,
          has_column_privilege('sisdoc_aplicativo', 'documentos.documento_periodo', 'categoria', 'INSERT') AS categoria,
          has_table_privilege('sisdoc_aplicativo', 'documentos.conferencia_dtc', 'DELETE') AS apagar
      `);
      expect(privilegios.rows[0]).toEqual({ conferencia: true, tabela: false, categoria: true, apagar: false });
      const templates = await anterior.query<{ tipo: string; versao: string }>(`
        SELECT tipo, versao FROM documentos.template_versao WHERE tipo LIKE 'DTC_%' AND versao LIKE 'emissao-%' ORDER BY tipo
      `);
      expect(templates.rows).toEqual([
        { tipo: 'DTC_COMISSIONADO', versao: 'emissao-dtc-comissionado-1' },
        { tipo: 'DTC_INSS', versao: 'emissao-dtc-inss-provisorio-1' },
        { tipo: 'DTC_IPAM', versao: 'emissao-dtc-ipam-1' },
      ]);
    } finally {
      await anterior.end();
    }
  });
});
