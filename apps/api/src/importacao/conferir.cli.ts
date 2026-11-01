import path from 'node:path';
import { tipoImportacaoSchema } from '@sisdoc/contratos';
import { ErroFormato } from './formatos';
import { conectarAplicacao, lerArgumentos, lerArquivo, texto } from './importacao.cli';
import { conferenciaGeral, conferirArquivo, ErroImportacao } from './importador';
import { ErroPlanilha, lerPlanilha } from './planilhas';

const AJUDA = `Uso:
  npm run importacao:conferir                         (contagens gerais por origem)
  npm run importacao:conferir -- --tipo <tipo> --arquivo <caminho> --origem <origem> [--amostra 20]
A amostra compara campo a campo registros sorteados do arquivo com o banco, com CPF e matrícula mascarados.`;

async function executar(): Promise<void> {
  const argumentos = lerArgumentos(process.argv.slice(2));
  if (argumentos.ajuda) {
    process.stdout.write(`${AJUDA}\n`);
    return;
  }
  const { cliente, protetor } = await conectarAplicacao();
  try {
    const arquivo = texto(argumentos, 'arquivo');
    if (!arquivo) {
      const geral = await conferenciaGeral(cliente);
      process.stdout.write(`Pessoas no banco: ${geral.totais.pessoas} | vínculos: ${geral.totais.vinculos}\n`);
      if (geral.origens.length === 0) process.stdout.write('Nenhum dado importado ainda.\n');
      for (const origem of geral.origens) {
        process.stdout.write(`- ${origem.origem}: pessoas ${origem.pessoas}, vínculos ${origem.vinculos}, afastamentos ${origem.afastamentos}, `
          + `incorporações ${origem.incorporacoes}, períodos IPAM ${origem.periodosIpam}, eventos ${origem.eventos}, removidos na fonte ${origem.removidosNaFonte}\n`);
      }
      return;
    }
    const tipo = tipoImportacaoSchema.safeParse(texto(argumentos, 'tipo'));
    const origem = texto(argumentos, 'origem');
    if (!tipo.success || !origem) throw new Error('Informe --tipo e --origem junto com --arquivo.');
    const amostra = Number(texto(argumentos, 'amostra') ?? '20');
    if (!Number.isInteger(amostra) || amostra < 0 || amostra > 500) throw new Error('--amostra deve ser um inteiro entre 0 e 500.');
    const conteudo = await lerArquivo(arquivo);
    const resultado = await conferirArquivo(cliente, protetor, tipo.data, origem, lerPlanilha(conteudo).linhas, amostra);
    process.stdout.write(`Arquivo ${path.basename(arquivo)} (${resultado.tipo}, origem ${resultado.origem}): ${resultado.noArquivo} registro(s) válidos, `
      + `${resultado.noBanco} encontrados no banco, ${resultado.ausentes} ausentes.\n`);
    for (const item of resultado.amostra) {
      const diferencas = Object.entries(item.campos).filter(([, estado]) => estado === 'difere').map(([campo]) => campo);
      process.stdout.write(`  ${item.referencia}: ${diferencas.length === 0 ? 'confere' : `difere em ${diferencas.join(', ')}`}\n`);
    }
    if (resultado.ausentes > 0 || resultado.amostra.some((item) => Object.values(item.campos).includes('difere'))) process.exitCode = 2;
  } finally {
    await cliente.end();
  }
}

executar().catch((erro: unknown) => {
  const conhecido = erro instanceof ErroImportacao || erro instanceof ErroFormato || erro instanceof ErroPlanilha
    || (erro instanceof Error && !('code' in erro));
  process.stderr.write(`${conhecido && erro instanceof Error ? erro.message : 'Falha inesperada na conferência.'}\n`);
  process.exitCode = 1;
});
