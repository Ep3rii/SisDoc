import { EntradaInterativa } from '../entrada-interativa';
import { instalar, type OpcoesInstalacao } from './instalador';

async function executar(): Promise<void> {
  const entrada = new EntradaInterativa('A instalação exige um terminal interativo; senhas não são aceitas por argumentos.');
  const perguntar = (texto: string) => entrada.perguntar(texto);
  const segredo = (texto: string) => entrada.segredo(texto);

  try {
    process.stdout.write(
      'Inicialização de uma nova instalação: use um banco PostgreSQL 16 vazio e uma raiz ainda inexistente.\n' +
      'Os cálculos pela interface e a emissão operacional ainda não estão disponíveis.\n',
    );
    const raiz = await perguntar('Caminho absoluto da nova raiz: ');
    const porta = Number(await perguntar('Porta HTTPS em loopback: '));
    const portaBanco = Number(await perguntar('Porta PostgreSQL em loopback: '));
    const nomeBanco = await perguntar('Nome do banco vazio: ');
    const migrador = await perguntar('Papel proprietário de migração: ');
    const senhaMigrador = await segredo('Senha de migração: ');
    const usuarioBanco = await perguntar('Papel sem privilégios do aplicativo: ');
    const senhaBanco = await segredo('Senha do aplicativo: ');
    const certificado = await perguntar('Caminho absoluto do certificado TLS: ');
    const chave = await perguntar('Caminho absoluto da chave privada TLS: ');
    const ca = await perguntar('Caminho absoluto da cadeia de CA confiável: ');
    const nomeTls = await perguntar('Nome DNS presente no certificado: ');
    const sidServico = await perguntar('SID da conta Windows de serviço sem privilégios: ');
    const listaSenhas = await perguntar('Caminho absoluto da lista local de senhas comuns: ');
    const matricula = await perguntar('Matrícula do administrador inicial: ');
    const nome = await perguntar('Nome do administrador inicial: ');
    const senha = await segredo('Senha inicial do administrador (mínimo 12 caracteres): ');
    const confirmacaoSenha = await segredo('Confirme a senha inicial: ');
    if (senha !== confirmacaoSenha) throw new Error('As senhas informadas não coincidem.');
    const confirmacao = await perguntar('Digite CRIAR para confirmar a inicialização do banco vazio e da nova raiz: ');
    if (confirmacao !== 'CRIAR') throw new Error('Instalação cancelada; nenhuma alteração foi feita.');

    const opcoes: OpcoesInstalacao = {
      raiz,
      porta,
      banco: { porta: portaBanco, nome: nomeBanco, migrador, senhaMigrador, usuario: usuarioBanco, senha: senhaBanco },
      tls: { certificado, chave, ca, nome: nomeTls },
      sidServico,
      listaSenhas,
      administrador: { matricula, nome, senha },
    };
    const arquivo = await instalar(opcoes);
    process.stdout.write(`Configuração criada em: ${arquivo}\n`);
    process.stdout.write('Defina SISDOC_CONFIG com esse caminho antes de executar npm start.\n');
    process.stdout.write('A instalação ainda não está autorizada para uso operacional.\n');
  } finally {
    entrada.fechar();
  }
}

executar().catch((erro: unknown) => {
  const mensagem = erro instanceof Error && erro.name !== 'AbortError' ? erro.message : 'Instalação cancelada.';
  process.stderr.write(`${mensagem}\n`);
  process.exitCode = 1;
});
