import { DatabaseError, type ClientBase } from 'pg';
import { CHAVE_BLOQUEIO_IMPORTACAO, ErroImportacao, ErroTransacaoImportacao } from './estado-importacao';

const TABELAS_ROLLBACK = new Set(['pessoa', 'pessoa_origem', 'vinculo', 'afastamento', 'incorporacao', 'periodo_ipam', 'evento_funcional']);

export type ResultadoRollback = { loteId: string; removidos: number; restaurados: number };

/** Requer papel de migração; restaura em ordem inversa e bloqueia lote posterior ou dados com emissão. */
export async function desfazerLote(cliente: ClientBase, loteId: string): Promise<ResultadoRollback> {
  try {
    await cliente.query('BEGIN');
  } catch (erro) {
    throw new ErroTransacaoImportacao([erro], 'Não foi possível iniciar a transação de rollback do lote.');
  }
  let commitIniciado = false;
  try {
    await cliente.query('SELECT pg_advisory_xact_lock($1, $2)', [...CHAVE_BLOQUEIO_IMPORTACAO]);
    const lote = (await cliente.query<{ status: string; iniciado_em: Date; tipo: string; sistema_origem: string }>(
      'SELECT status, iniciado_em, tipo, sistema_origem FROM nucleo.importacao_lote WHERE id = $1 FOR UPDATE', [loteId],
    )).rows[0];
    if (!lote) throw new ErroImportacao('Lote de importação não encontrado.');
    if (lote.status !== 'concluido') throw new ErroImportacao(`O lote está com situação "${lote.status}" e não pode ser desfeito.`);
    const posterior = await cliente.query<{ id: string }>(`
      SELECT id FROM nucleo.importacao_lote
      WHERE status = 'concluido' AND id <> $1
        AND iniciado_em >= (SELECT iniciado_em FROM nucleo.importacao_lote WHERE id = $1)
      ORDER BY iniciado_em DESC LIMIT 1
    `, [loteId]);
    if (posterior.rows[0]) {
      throw new ErroImportacao(`Desfaça antes o lote mais recente (${posterior.rows[0].id}); os lotes são desfeitos do mais novo para o mais antigo.`);
    }
    const emitidos = await cliente.query<{ total: string }>(`
      WITH registro AS (
        SELECT tabela, (chave->>'id')::uuid AS id FROM nucleo.importacao_registro WHERE lote_id = $1 AND tabela <> 'pessoa_origem'
      ), pessoas AS (
        SELECT id AS pessoa_id FROM registro WHERE tabela = 'pessoa'
        UNION SELECT v.pessoa_id FROM registro r JOIN nucleo.vinculo v ON v.id = r.id WHERE r.tabela = 'vinculo'
        UNION SELECT v.pessoa_id FROM registro r JOIN nucleo.afastamento a ON a.id = r.id JOIN nucleo.vinculo v ON v.id = a.vinculo_id WHERE r.tabela = 'afastamento'
        UNION SELECT v.pessoa_id FROM registro r JOIN nucleo.incorporacao i ON i.id = r.id JOIN nucleo.vinculo v ON v.id = i.vinculo_id WHERE r.tabela = 'incorporacao'
        UNION SELECT v.pessoa_id FROM registro r JOIN nucleo.evento_funcional e ON e.id = r.id JOIN nucleo.vinculo v ON v.id = e.vinculo_id WHERE r.tabela = 'evento_funcional'
        UNION SELECT p.pessoa_id FROM registro r JOIN nucleo.periodo_ipam p ON p.id = r.id WHERE r.tabela = 'periodo_ipam'
      )
      SELECT count(*) AS total FROM documentos.emissao e JOIN documentos.documento d ON d.id = e.documento_id
      WHERE d.pessoa_id IN (SELECT pessoa_id FROM pessoas)
    `, [loteId]);
    if (Number(emitidos.rows[0].total) > 0) {
      throw new ErroImportacao('Há documentos emitidos para servidores alterados por este lote; o lote não pode ser desfeito.');
    }
    const colunas = new Map<string, string[]>();
    const registros = await cliente.query<{ tabela: string; chave: Record<string, string>; acao: string; anterior: unknown }>(
      'SELECT tabela, chave, acao, anterior FROM nucleo.importacao_registro WHERE lote_id = $1 ORDER BY id DESC', [loteId],
    );
    let removidos = 0;
    let restaurados = 0;
    for (const registro of registros.rows) {
      if (!TABELAS_ROLLBACK.has(registro.tabela)) throw new Error('Registro de importação com tabela inesperada.');
      const porOrigem = registro.tabela === 'pessoa_origem';
      const condicao = porOrigem ? 'alvo.sistema_origem = $1 AND alvo.id_origem = $2' : 'alvo.id = $1::uuid';
      const chave = porOrigem ? [registro.chave.sistema_origem, registro.chave.id_origem] : [registro.chave.id];
      if (registro.acao === 'inserido') {
        await cliente.query(`DELETE FROM nucleo.${registro.tabela} AS alvo WHERE ${condicao}`, chave);
        removidos += 1;
        continue;
      }
      let lista = colunas.get(registro.tabela);
      if (!lista) {
        lista = (await cliente.query<{ column_name: string }>(`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'nucleo' AND table_name = $1 AND column_name NOT IN ('id', 'sistema_origem', 'id_origem', 'revisao_fonte')
          ORDER BY ordinal_position
        `, [registro.tabela])).rows.map((linha) => linha.column_name);
        colunas.set(registro.tabela, lista);
      }
      await cliente.query(`
        UPDATE nucleo.${registro.tabela} AS alvo SET ${lista.map((coluna) => `${coluna} = anterior.${coluna}`).join(', ')}
        FROM jsonb_populate_record(NULL::nucleo.${registro.tabela}, $${chave.length + 1}::jsonb) AS anterior
        WHERE ${condicao}
      `, [...chave, JSON.stringify(registro.anterior)]);
      restaurados += 1;
    }
    await cliente.query("UPDATE nucleo.importacao_lote SET status = 'desfeito', desfeito_em = now() WHERE id = $1", [loteId]);
    await cliente.query(`
      INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, entidade_id, detalhes)
      VALUES (NULL, 'importacao_desfeita', 'importacao_lote', $1, $2::jsonb)
    `, [loteId, JSON.stringify({ tipo: lote.tipo, origem: lote.sistema_origem, removidos, restaurados, registradoPor: 'cli_importacao' })]);
    commitIniciado = true;
    await cliente.query('COMMIT');
    return { loteId, removidos, restaurados };
  } catch (erro) {
    if (commitIniciado) {
      throw new ErroTransacaoImportacao([erro], 'Não foi possível confirmar o rollback do lote; confira sua situação antes de tentar novamente.');
    }
    try {
      await cliente.query('ROLLBACK');
    } catch (erroRollback) {
      throw new ErroTransacaoImportacao([erro, erroRollback], 'Não foi possível reverter a transação de rollback do lote.');
    }
    if (erro instanceof DatabaseError && erro.code === '23503') {
      throw new ErroImportacao('Não é possível desfazer: documentos, auditorias ou registros posteriores dependem dos dados deste lote.');
    }
    throw erro;
  }
}
