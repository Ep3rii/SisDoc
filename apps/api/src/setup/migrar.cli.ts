import { arquivoProvisionamento, lerProvisionamento, migrar } from './migrar';

async function executar(): Promise<void> {
  const arquivo = arquivoProvisionamento();
  const provisionamento = await lerProvisionamento(arquivo);
  process.stdout.write(
    `Atualizando o banco ${provisionamento.nome} em ${provisionamento.host}:${provisionamento.porta} ` +
    `com o papel de migração ${provisionamento.migracao.usuario}.\n` +
    'Pare o serviço do SisDoc antes de migrar e inicie-o novamente ao final.\n',
  );
  const resultado = await migrar(provisionamento);
  if (resultado.aplicadas.length === 0) {
    process.stdout.write(`Nenhuma migração pendente. Versão atual: ${resultado.versaoAtual}.\n`);
  } else {
    process.stdout.write(`Migrações aplicadas: ${resultado.aplicadas.join(', ')}. Versão atual: ${resultado.versaoAtual}.\n`);
  }
}

executar().catch((erro: unknown) => {
  const mensagem = erro instanceof Error ? erro.message : 'Falha ao aplicar as migrações.';
  process.stderr.write(`Migração não concluída; nenhuma alteração parcial foi mantida. ${mensagem}\n`);
  process.exitCode = 1;
});
