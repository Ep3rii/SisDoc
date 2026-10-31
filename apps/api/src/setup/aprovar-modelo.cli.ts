import { EntradaInterativa } from '../entrada-interativa';
import {
  aprovacaoModeloSchema, confirmacaoAprovacao, consultarModeloVigente, registrarAprovacaoModelo, tipoAprovacaoSchema,
} from './aprovacao-modelo';
import { arquivoProvisionamento, conectarMigracao, lerProvisionamento } from './migrar';

async function executar(): Promise<void> {
  const entrada = new EntradaInterativa('A aprovação de modelo exige um terminal interativo.');
  try {
    const provisionamento = await lerProvisionamento(arquivoProvisionamento());
    const informado = process.argv[2] ?? await entrada.perguntar('Tipo de documento (DOF, DTC_IPAM, DTC_COMISSIONADO ou DTC_INSS): ');
    const tipoValido = tipoAprovacaoSchema.safeParse(informado.trim().toUpperCase());
    if (!tipoValido.success) throw new Error('Tipo inválido; use DOF, DTC_IPAM, DTC_COMISSIONADO ou DTC_INSS.');
    const tipo = tipoValido.data;
    const cliente = await conectarMigracao(provisionamento);
    try {
      const modelo = await consultarModeloVigente(cliente, tipo);
      process.stdout.write(
        `Banco: ${provisionamento.nome} em ${provisionamento.host}:${provisionamento.porta}.\n` +
        `Tipo de documento: ${tipo}\n` +
        `Regra de cálculo vigente: ${modelo.regra.codigo} versão ${modelo.regra.versao}\n` +
        `Template de emissão: ${modelo.template.versao}\n`,
      );
      if (modelo.aprovacaoExistente) {
        process.stdout.write(
          `Já aprovado por ${modelo.aprovacaoExistente.aprovadoPor} em ${modelo.aprovacaoExistente.aprovadoEm} ` +
          `(referência: ${modelo.aprovacaoExistente.referenciaDecisao}). Nada a fazer.\n`,
        );
        return;
      }
      process.stdout.write(
        'A aprovação é permanente e autoriza a emissão operacional com numeração oficial.\n' +
        'Registre-a somente após a validação formal da regra e do layout pela área responsável.\n',
      );
      const aprovadoPor = await entrada.perguntar('Nome e cargo de quem aprovou formalmente: ');
      const referenciaDecisao = await entrada.perguntar('Referência da decisão (ex.: docs/decisoes/0NN, ofício ou processo): ');
      const dados = aprovacaoModeloSchema.safeParse({ tipo, aprovadoPor, referenciaDecisao });
      if (!dados.success) throw new Error('Informe aprovador e referência com 3 a 200 caracteres.');
      const confirmacao = await entrada.perguntar(`Digite ${confirmacaoAprovacao(tipo)} para registrar a aprovação: `);
      if (confirmacao !== confirmacaoAprovacao(tipo)) throw new Error('Aprovação cancelada; nada foi registrado.');
      const resultado = await registrarAprovacaoModelo(cliente, dados.data);
      process.stdout.write(`Aprovação registrada (${resultado.id}). A emissão de ${tipo} está liberada para coordenadores.\n`);
    } finally {
      await cliente.end();
    }
  } finally {
    entrada.fechar();
  }
}

executar().catch((erro: unknown) => {
  const mensagem = erro instanceof Error && erro.name !== 'AbortError' ? erro.message : 'Aprovação cancelada.';
  process.stderr.write(`${mensagem}\n`);
  process.exitCode = 1;
});
