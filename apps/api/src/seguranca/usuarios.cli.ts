import { readFile } from 'node:fs/promises';
import { request } from 'node:https';
import {
  criarUsuarioSchema,
  loginSchema,
  respostaSessaoSchema,
  usuarioAdministrativoSchema,
  type Configuracao,
} from '@sisdoc/contratos';
import { carregarConfiguracao } from '../configuracao';
import { EntradaInterativa } from '../entrada-interativa';

type Resposta = { dados: unknown; cookie?: string };

async function requisitar(
  config: Configuracao,
  ca: Buffer,
  rota: string,
  corpo?: unknown,
  sessao?: { cookie: string; csrf: string },
): Promise<Resposta> {
  const origem = new URL(`https://${config.tls.nome}:${config.porta}`).origin;
  const conteudo = corpo === undefined ? undefined : JSON.stringify(corpo);
  return new Promise((resolve, reject) => {
    const pedido = request({
      host: '127.0.0.1',
      port: config.porta,
      servername: config.tls.nome,
      path: `/api/v1/${rota}`,
      method: 'POST',
      ca,
      rejectUnauthorized: true,
      timeout: 10000,
      headers: {
        Origin: origem,
        Accept: 'application/json',
        ...(conteudo === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(sessao ? { Cookie: sessao.cookie, 'X-CSRF-Token': sessao.csrf } : {}),
      },
    }, (resposta) => {
      let texto = '';
      resposta.setEncoding('utf8');
      resposta.on('data', (parte: string) => {
        texto += parte;
        if (texto.length > 65536) pedido.destroy(new Error('Resposta do serviço excedeu o tamanho permitido.'));
      });
      resposta.on('error', () => reject(new Error('A resposta do serviço HTTPS foi interrompida.')));
      resposta.on('end', () => {
        let dados: unknown;
        try {
          dados = JSON.parse(texto);
        } catch {
          reject(new Error('O serviço HTTPS retornou uma resposta inválida.'));
          return;
        }
        if (!resposta.statusCode || resposta.statusCode < 200 || resposta.statusCode >= 300) {
          const detalhe = typeof dados === 'object' && dados !== null && 'detail' in dados && typeof dados.detail === 'string'
            ? dados.detail : 'O serviço recusou a operação.';
          reject(new Error(detalhe));
          return;
        }
        resolve({ dados, cookie: resposta.headers['set-cookie']?.[0].split(';')[0] });
      });
    });
    pedido.once('timeout', () => pedido.destroy(new Error('Tempo de conexão HTTPS esgotado.')));
    pedido.once('error', () => reject(new Error('Não foi possível concluir a comunicação HTTPS com o serviço.')));
    pedido.end(conteudo);
  });
}

async function executar(): Promise<void> {
  if (process.argv.length !== 3 || process.argv[2] !== 'criar') {
    throw new Error('Uso: npm run usuario -- criar. Senhas são informadas somente no terminal.');
  }
  const entrada = new EntradaInterativa('O comando exige um terminal interativo; senhas não são aceitas por argumentos.');
  try {
    const configuracao = await carregarConfiguracao(process.env.SISDOC_CONFIG);
    let ca: Buffer;
    try {
      ca = await readFile(configuracao.tls.ca);
    } catch {
      throw new Error('Não foi possível ler a CA TLS configurada.');
    }
    const matriculaAdmin = await entrada.perguntar('Matrícula do administrador: ');
    const senhaAdmin = await entrada.segredo('Senha do administrador: ');
    const matricula = await entrada.perguntar('Matrícula do novo usuário: ');
    const nome = await entrada.perguntar('Nome do novo usuário: ');
    const email = await entrada.perguntar('E-mail do novo usuário (opcional): ');
    const papel = await entrada.perguntar('Perfil (analista, coordenador, secretario_adjunto ou admin): ');
    const senha = await entrada.segredo('Senha inicial do novo usuário: ');
    const confirmacaoSenha = await entrada.segredo('Confirme a senha inicial: ');
    if (senha !== confirmacaoSenha) throw new Error('As senhas informadas não coincidem.');
    const confirmacao = await entrada.perguntar('Digite CRIAR para confirmar: ');
    if (confirmacao !== 'CRIAR') throw new Error('Criação cancelada; nenhum usuário foi alterado.');
    const credenciais = loginSchema.safeParse({ matricula: matriculaAdmin, senha: senhaAdmin });
    const usuario = criarUsuarioSchema.safeParse({ matricula, nome, email: email || null, papel, senha });
    if (!credenciais.success || !usuario.success) throw new Error('Confira os dados informados e a senha mínima de 10 caracteres.');

    const login = await requisitar(configuracao, ca, 'auth/login', credenciais.data);
    const dadosSessao = respostaSessaoSchema.safeParse(login.dados);
    if (!dadosSessao.success || !login.cookie?.startsWith('__Host-sisdoc=')) {
      throw new Error('O serviço retornou uma sessão inválida; contate o administrador.');
    }
    const sessao = { cookie: login.cookie, csrf: dadosSessao.data.csrf };
    let falha: unknown;
    let criado = false;
    let tentouCriar = false;
    try {
      if (dadosSessao.data.usuario.papel !== 'admin' || dadosSessao.data.usuario.trocaSenhaObrigatoria) {
        throw new Error('Use um administrador ativo que já tenha trocado a senha inicial.');
      }
      tentouCriar = true;
      const resultado = await requisitar(configuracao, ca, 'admin/usuarios', usuario.data, sessao);
      if (!usuarioAdministrativoSchema.safeParse(resultado.dados).success) {
        throw new Error('Resposta de criação inválida; confira a lista de usuários antes de repetir.');
      }
      criado = true;
    } catch (erro) {
      falha = tentouCriar ? new Error(
        `${erro instanceof Error ? erro.message : 'Falha ao criar usuário.'} Confira a lista de usuários antes de repetir.`,
      ) : erro;
    }
    try {
      const encerramento = await requisitar(configuracao, ca, 'auth/logout', undefined, sessao);
      if (typeof encerramento.dados !== 'object' || encerramento.dados === null
          || !('encerrada' in encerramento.dados) || encerramento.dados.encerrada !== true) {
        throw new Error('O serviço não confirmou o encerramento da sessão.');
      }
    } catch {
      throw new Error(criado
        ? 'Usuário criado, mas não foi possível confirmar o encerramento da sessão administrativa.'
        : 'Não foi possível confirmar o resultado ou encerrar a sessão. Confira os usuários antes de repetir.');
    }
    if (falha) throw falha;
    process.stdout.write('Usuário criado. A troca da senha será exigida no primeiro acesso.\n');
  } finally {
    entrada.fechar();
  }
}

executar().catch((erro: unknown) => {
  const mensagem = erro instanceof Error && erro.name !== 'AbortError' ? erro.message : 'Operação cancelada.';
  process.stderr.write(`${mensagem}\n`);
  process.exitCode = 1;
});
