import { tipoImportacaoSchema, type RelatorioImportacao } from '@sisdoc/contratos';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { z } from 'zod';
import { arquivoProvisionamento, conectarMigracao, lerProvisionamento } from '../setup/migrar';
import { lerArgumentos, texto } from './argumentos-cli';
import { ErroImportacao, hashArquivo } from './estado-importacao';
import { ErroFormato } from './formatos';
import { importarLinhas } from './importador';
import { lerLegado, lerMapeamento } from './legado';
import { ErroPlanilha, lerPlanilha } from './planilhas';
import { conectarAplicacao, lerArquivo } from './recursos-cli';
import { desfazerLote } from './rollback-importacao';

/** Atualiza progresso somente em terminal TTY, sem misturar a barra com saída redirecionada de relatório. */
function barraProgresso(rotulo: string): (feitos: number, total: number) => void {
  if (!process.stderr.isTTY) return () => undefined;
  let ultimo = -1;
  return (feitos, total) => {
    const percentual = Math.floor((feitos / total) * 100);
    if (percentual === ultimo) return;
    ultimo = percentual;
    const preenchido = Math.round(percentual / 4);
    process.stderr.write(`\r${rotulo} [${'#'.repeat(preenchido)}${'.'.repeat(25 - preenchido)}] ${percentual}% (${feitos}/${total})`);
    if (feitos >= total) process.stderr.write('\n');
  };
}

/** Apresenta contagens, avisos e ocorrências mascaradas, limitando detalhes exibidos no terminal a cinquenta itens. */
export function imprimirRelatorio(relatorio: RelatorioImportacao): void {
  const c = relatorio.contagens;
  const linhas = [
    `Tipo: ${relatorio.tipo} | origem: ${relatorio.origem} | modo: ${relatorio.modo === 'gravacao' ? 'GRAVAÇÃO' : 'validação (nada foi gravado)'}`,
    relatorio.loteExistente ? `Arquivo já importado no lote ${relatorio.loteExistente}; nada a fazer.` : '',
    relatorio.loteId ? `Lote: ${relatorio.loteId}` : '',
    `Lidos: ${c.lidos} | válidos: ${c.validos} | rejeitados: ${c.rejeitados} | duplicados: ${c.duplicados} | quarentena: ${c.quarentena} | anomalias: ${c.anomalias}`,
    `Registros no banco — inseridos: ${c.inseridos} | atualizados: ${c.atualizados} | inalterados: ${c.inalterados}`,
    ...relatorio.avisos.map((aviso) => `Aviso: ${aviso}`),
  ].filter(Boolean);
  process.stdout.write(`${linhas.join('\n')}\n`);
  const exibidas = relatorio.ocorrencias.slice(0, 50);
  if (exibidas.length > 0) {
    process.stdout.write('Ocorrências (CPF e matrícula mascarados):\n');
    for (const item of exibidas) process.stdout.write(`  linha ${item.linha} [${item.tipo}] ${item.referencia}: ${item.motivo}\n`);
    const restantes = relatorio.ocorrencias.length - exibidas.length + relatorio.ocorrenciasOmitidas;
    if (restantes > 0) process.stdout.write(`  ... e mais ${restantes} ocorrência(s); use --relatorio <arquivo.json> para a lista completa.\n`);
  }
  process.stdout.write(`Duração: ${(relatorio.duracaoMs / 1000).toFixed(1)} s\n`);
}

const AJUDA = `Uso:
  npm run importacao -- --tipo <tipo> --arquivo <caminho> --origem <origem> --usuario <matrícula admin> [--commit] [--relatorio <arquivo.json>]
  npm run importacao -- --legado <mapeamento.json> --usuario <matrícula admin> [--commit]
  npm run importacao -- --rollback <id do lote>
Tipos: dados_funcionais, afastamentos, incorporacoes, periodos_ipam, eventos_funcionais.
Sem --commit a importação apenas valida e nada é gravado.`;

/** Exige matrícula de administrador ativo para atribuir responsabilidade ao lote importado. */
async function usuarioAdmin(cliente: Client, matricula: string | undefined): Promise<string> {
  if (!matricula) throw new Error('Informe --usuario com a matrícula de um administrador ativo.');
  const resultado = await cliente.query<{ id: string }>(
    "SELECT id FROM seguranca.usuario WHERE upper(btrim(matricula)) = upper(btrim($1)) AND papel = 'admin' AND ativo", [matricula],
  );
  if (!resultado.rows[0]) throw new Error('Usuário administrador ativo não encontrado para a matrícula informada.');
  return resultado.rows[0].id;
}

/** Coordena validação/gravação/rollback pelos comandos existentes e fecha o cliente ao concluir ou falhar. */
async function executar(): Promise<void> {
  const argumentos = lerArgumentos(process.argv.slice(2));
  if (argumentos.ajuda || Object.keys(argumentos).length === 0) {
    process.stdout.write(`${AJUDA}\n`);
    return;
  }
  const rollback = texto(argumentos, 'rollback');
  if (rollback) {
    const lote = z.uuid().safeParse(rollback);
    if (!lote.success) throw new Error('Informe o identificador (UUID) do lote em --rollback.');
    const cliente = await conectarMigracao(await lerProvisionamento(arquivoProvisionamento()));
    try {
      const resultado = await desfazerLote(cliente, lote.data);
      process.stdout.write(`Lote ${resultado.loteId} desfeito: ${resultado.removidos} registro(s) removido(s) e ${resultado.restaurados} restaurado(s).\n`);
    } finally {
      await cliente.end();
    }
    return;
  }
  const gravar = argumentos.commit === true;
  const relatorioArquivo = texto(argumentos, 'relatorio');
  const { cliente, protetor } = await conectarAplicacao();
  try {
    const usuarioId = await usuarioAdmin(cliente, texto(argumentos, 'usuario'));
    const legado = texto(argumentos, 'legado');
    const relatorios: RelatorioImportacao[] = [];
    if (legado) {
      const mapeamento = await lerMapeamento(path.resolve(legado));
      const conjuntos = await lerLegado(mapeamento);
      if (conjuntos.length === 0) throw new Error('O mapeamento não define nenhuma consulta.');
      for (const conjunto of conjuntos) {
        const relatorio = await importarLinhas(cliente, protetor, conjunto.linhas, {
          tipo: conjunto.tipo, origem: mapeamento.origem, canal: 'legado', usuarioId, gravar, hashArquivo: conjunto.hash,
          progresso: barraProgresso(conjunto.tipo),
        });
        imprimirRelatorio(relatorio);
        relatorios.push(relatorio);
      }
    } else {
      const tipo = tipoImportacaoSchema.safeParse(texto(argumentos, 'tipo'));
      if (!tipo.success) throw new Error('Informe --tipo: dados_funcionais, afastamentos, incorporacoes, periodos_ipam ou eventos_funcionais.');
      const arquivo = texto(argumentos, 'arquivo');
      const origem = texto(argumentos, 'origem');
      if (!arquivo || !origem) throw new Error('Informe --arquivo e --origem (ex.: --origem planilha-dof).');
      const conteudo = await lerArquivo(arquivo);
      const relatorio = await importarLinhas(cliente, protetor, lerPlanilha(conteudo).linhas, {
        tipo: tipo.data, origem, canal: 'cli', usuarioId, gravar, hashArquivo: hashArquivo(conteudo),
        progresso: barraProgresso(tipo.data),
      });
      imprimirRelatorio(relatorio);
      relatorios.push(relatorio);
    }
    if (relatorioArquivo) {
      await writeFile(path.resolve(relatorioArquivo), JSON.stringify(relatorios.length === 1 ? relatorios[0] : relatorios, null, 2), 'utf8');
      process.stdout.write(`Relatório completo gravado em ${path.resolve(relatorioArquivo)}.\n`);
    }
    if (!gravar) process.stdout.write('Validação concluída. Para gravar, repita o comando com --commit.\n');
  } finally {
    await cliente.end();
  }
}

if (require.main === module) {
  executar().catch((erro: unknown) => {
    const conhecido = erro instanceof ErroImportacao || erro instanceof ErroFormato || erro instanceof ErroPlanilha
      || (erro instanceof Error && !('code' in erro));
    process.stderr.write(`${conhecido && erro instanceof Error ? erro.message : 'Falha inesperada na importação; nenhum dado parcial foi gravado.'}\n`);
    process.exitCode = 1;
  });
}
