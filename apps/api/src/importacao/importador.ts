import {
  origemImportacaoSchema,
  type RelatorioImportacao
} from '@sisdoc/contratos';
import { randomUUID } from 'node:crypto';
import { type ClientBase } from 'pg';
import type { ProtetorDados } from '../seguranca/protecao-dados';
import { CHAVE_BLOQUEIO_IMPORTACAO, ErroImportacao, ErroTransacaoImportacao, type Estado, type OpcoesImportacao } from './estado-importacao';
import {
  analisarLinhas
} from './formatos';
import { gravarAfastamentos, gravarDadosFuncionais, gravarEventos, gravarIncorporacoes, gravarPeriodosIpam } from './gravacao-importacao';
import { relatorio, totalRegistros } from './relatorio-importacao';

/** Executa análise e gravação/validação sob um único lock; validação sempre desfaz as escritas simuladas. */
export async function importarLinhas(
  cliente: ClientBase, protetor: ProtetorDados, linhas: string[][], opcoes: OpcoesImportacao,
): Promise<RelatorioImportacao> {
  const inicio = performance.now();
  const origem = origemImportacaoSchema.parse(opcoes.origem);
  const resultado = analisarLinhas(opcoes.tipo, linhas);
  const total = Math.max(1, totalRegistros(resultado));
  let feitos = 0;
  const estado: Estado = {
    cliente, protetor, loteId: randomUUID(), origem, preservarExistentes: opcoes.preservarExistentes ?? false,
    ocorrencias: [...resultado.ocorrencias],
    contagens: { inseridos: 0, atualizados: 0, inalterados: 0, rejeitadosBanco: 0 },
    progresso: (avanco) => {
      feitos = Math.min(total, feitos + avanco);
      opcoes.progresso?.(feitos, total);
    },
  };
  try {
    await cliente.query('BEGIN');
  } catch (erro) {
    throw new ErroTransacaoImportacao([erro], 'Não foi possível iniciar a transação de importação.');
  }
  let aberta = true;
  let commitIniciado = false;
  try {
    if (opcoes.antes) await opcoes.antes(cliente);
    await cliente.query('SELECT pg_advisory_xact_lock($1, $2)', [...CHAVE_BLOQUEIO_IMPORTACAO]);
    if (opcoes.preparar) await opcoes.preparar(cliente);
    const usuario = await cliente.query("SELECT 1 FROM seguranca.usuario WHERE id = $1 AND ativo AND papel = 'admin'", [opcoes.usuarioId]);
    if (usuario.rowCount !== 1) throw new ErroImportacao('A importação exige um usuário administrador ativo.');
    const anterior = await cliente.query<{ id: string }>(`
      SELECT id FROM nucleo.importacao_lote
      WHERE tipo = $1 AND sistema_origem = $2 AND hash_arquivo = $3 AND status = 'concluido'
      ORDER BY iniciado_em DESC LIMIT 1
    `, [opcoes.tipo, origem, opcoes.hashArquivo]);
    if (anterior.rows[0] && !(opcoes.revalidarExistente && !opcoes.gravar)) {
      await cliente.query('ROLLBACK');
      aberta = false;
      const banco = { inseridos: 0, atualizados: 0, inalterados: totalRegistros(resultado), rejeitadosBanco: 0 };
      return relatorio(resultado, opcoes, null, anterior.rows[0].id, resultado.ocorrencias, banco, inicio, linhas);
    }
    await cliente.query(`
      INSERT INTO nucleo.importacao_lote (id, origem, hash_arquivo, usuario_id, status, tipo, sistema_origem, canal)
      VALUES ($1, $2, $3, $4, 'processando', $5, $6, $7)
    `, [estado.loteId, `${opcoes.canal}:${origem}`, opcoes.hashArquivo, opcoes.usuarioId, opcoes.tipo, origem, opcoes.canal]);
    const analise = resultado.analise;
    if (analise.tipo === 'dados_funcionais') await gravarDadosFuncionais(estado, analise);
    else if (analise.tipo === 'afastamentos') await gravarAfastamentos(estado, analise.registros);
    else if (analise.tipo === 'incorporacoes') await gravarIncorporacoes(estado, analise.registros);
    else if (analise.tipo === 'periodos_ipam') await gravarPeriodosIpam(estado, analise.registros);
    else await gravarEventos(estado, analise.registros);
    opcoes.progresso?.(total, total);
    const final = relatorio(resultado, opcoes, opcoes.gravar ? estado.loteId : null, anterior.rows[0]?.id ?? null, estado.ocorrencias, estado.contagens, inicio, linhas);
    if (!opcoes.gravar) {
      await cliente.query('ROLLBACK');
      aberta = false;
      return final;
    }
    await cliente.query(`
      UPDATE nucleo.importacao_lote SET status = 'concluido', contagens = $2::jsonb, concluido_em = now() WHERE id = $1
    `, [estado.loteId, JSON.stringify(final.contagens)]);
    await cliente.query(`
      INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, entidade_id, ip, detalhes)
      VALUES ($1, 'importacao_concluida', 'importacao_lote', $2, $3, $4::jsonb)
    `, [opcoes.usuarioId, estado.loteId, opcoes.ip ?? null, JSON.stringify({
      tipo: opcoes.tipo, origem, canal: opcoes.canal, contagens: final.contagens,
      ...(opcoes.loteLegadoId ? { loteLegadoId: opcoes.loteLegadoId, politica: 'preencher_vazios' } : {}),
    })]);
    commitIniciado = true;
    await cliente.query('COMMIT');
    aberta = false;
    return final;
  } catch (erro) {
    if (commitIniciado) {
      throw new ErroTransacaoImportacao([erro], 'Não foi possível confirmar a importação; confira o lote antes de tentar novamente.');
    }
    if (aberta) {
      try {
        await cliente.query('ROLLBACK');
      } catch (erroRollback) {
        throw new ErroTransacaoImportacao([erro, erroRollback], 'Não foi possível reverter a importação.');
      }
    }
    const erroHttp = erro instanceof Error && 'getStatus' in erro;
    if (opcoes.gravar && !(erro instanceof ErroImportacao) && !erroHttp) {
      try {
        await registrarFalha(cliente, opcoes, origem, resultado.lidos);
      } catch (erroRegistro) {
        throw new AggregateError([erro, erroRegistro], 'A importação falhou e não foi possível registrar a falha do lote.');
      }
    }
    throw erro;
  }
}

/** Registra falha técnica somente após rollback confirmado; falha deste registro também deve ser propagada. */
async function registrarFalha(cliente: ClientBase, opcoes: OpcoesImportacao, origem: string, lidos: number): Promise<void> {
  await cliente.query(`
      INSERT INTO nucleo.importacao_lote (origem, hash_arquivo, usuario_id, status, tipo, sistema_origem, canal, contagens, concluido_em)
      VALUES ($1, $2, $3, 'falhou', $4, $5, $6, $7::jsonb, now())
  `, [`${opcoes.canal}:${origem}`, opcoes.hashArquivo, opcoes.usuarioId, opcoes.tipo, origem, opcoes.canal, JSON.stringify({ lidos })]);
}
