import { randomUUID } from 'node:crypto';
import { UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';
import type { EnviarImportacaoQuery, LotePlanilhaLegado, RelatorioPlanilhaLegado } from '@sisdoc/contratos';
import type { PoolClient } from 'pg';
import type { ProtetorDados } from '../seguranca/protecao-dados';
import { hashArquivo } from './importador';
import { escreverCsv, escreverXlsx, LIMITE_ARQUIVO_BYTES } from './planilhas';

const MAXIMO_LINHAS = 100_000;
const linhaSchema = z.array(z.string());

export async function importarPlanilhaLegado(
  cliente: PoolClient, protetor: ProtetorDados, planilha: string[][], arquivo: Buffer, dados: EnviarImportacaoQuery, usuarioId: string, ip: string,
): Promise<RelatorioPlanilhaLegado> {
  const inicio = planilha.findIndex((linha) => linha.some((valor) => valor.trim() !== ''));
  if (inicio < 0) throw new UnprocessableEntityException('A planilha não possui cabeçalhos.');
  const cabecalhos = planilha[inicio];
  if (cabecalhos.length > 256 || cabecalhos.some((valor) => !valor.trim() || valor.length > 200 || /[\u0000-\u001f]/.test(valor))) {
    throw new UnprocessableEntityException('Use até 256 colunas com cabeçalhos preenchidos, sem controles e com até 200 caracteres.');
  }
  if (new Set(cabecalhos.map((valor) => valor.trim().toLocaleUpperCase('pt-BR'))).size !== cabecalhos.length) {
    throw new UnprocessableEntityException('Há cabeçalhos repetidos. Renomeie as colunas antes de importar para o legado.');
  }
  const linhas = planilha.slice(inicio + 1).filter((linha) => linha.some((valor) => valor !== ''));
  if (linhas.length > MAXIMO_LINHAS) throw new UnprocessableEntityException('A planilha excede 100 mil linhas.');
  if (linhas.some((linha) => linha.length > cabecalhos.length && linha.slice(cabecalhos.length).some((valor) => valor !== ''))) {
    throw new UnprocessableEntityException('Há dados em colunas sem cabeçalho. Corrija a planilha antes de importar.');
  }
  const hash = hashArquivo(arquivo);
  const existente = await cliente.query<{ id: string }>(
    'SELECT id FROM legado.planilha_lote WHERE origem = $1 AND hash_arquivo = $2', [dados.origem, hash],
  );
  const relatorio: RelatorioPlanilhaLegado = {
    destino: 'legado', modo: dados.modo, loteId: null, loteExistente: existente.rows[0]?.id ?? null, cabecalhos, linhas: linhas.length,
  };
  if (dados.modo === 'validar' || relatorio.loteExistente) return relatorio;
  const loteId = randomUUID();
  const inserido = await cliente.query<{ id: string }>(`INSERT INTO legado.planilha_lote
    (id, origem, hash_arquivo, cabecalhos, linhas, usuario_id) VALUES ($1, $2, $3, $4::jsonb, $5, $6)
    ON CONFLICT (origem, hash_arquivo) DO NOTHING RETURNING id`,
  [loteId, dados.origem, hash, JSON.stringify(cabecalhos), linhas.length, usuarioId]);
  if (!inserido.rowCount) {
    const anterior = await cliente.query<{ id: string }>(
      'SELECT id FROM legado.planilha_lote WHERE origem = $1 AND hash_arquivo = $2', [dados.origem, hash],
    );
    if (!anterior.rows[0]) throw new Error('Lote concorrente do legado não encontrado.');
    return { ...relatorio, loteExistente: anterior.rows[0].id };
  }
  for (let inicioLote = 0; inicioLote < linhas.length; inicioLote += 500) {
    const valores: Array<string | number | Buffer> = [];
    const grupos: string[] = [];
    for (const [indice, linha] of linhas.slice(inicioLote, inicioLote + 500).entries()) {
      const id = randomUUID();
      const conteudo = JSON.stringify(cabecalhos.map((_, posicao) => linha[posicao] ?? ''));
      const protegido = protetor.cifrar(Buffer.from(conteudo), { schema: 'legado', tabela: 'planilha_linha', registroId: id, campo: 'conteudo_cifrado' });
      const n = valores.length;
      grupos.push(`($${n + 1}::uuid, $${n + 2}::uuid, $${n + 3}::integer, $${n + 4}::bytea)`);
      valores.push(id, loteId, inicioLote + indice + 1, protegido);
    }
    await cliente.query(`INSERT INTO legado.planilha_linha (id, lote_id, numero, conteudo_cifrado) VALUES ${grupos.join(', ')}`, valores);
  }
  await cliente.query(`INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, entidade_id, ip, detalhes)
    VALUES ($1, 'planilha_legado_importada', 'planilha_lote', $2, $3, $4::jsonb)`,
  [usuarioId, loteId, ip, JSON.stringify({ origem: dados.origem, linhas: linhas.length, colunas: cabecalhos.length })]);
  return { ...relatorio, loteId };
}

export async function listarPlanilhasLegado(cliente: PoolClient): Promise<LotePlanilhaLegado[]> {
  const resultado = await cliente.query<{ id: string; origem: string; cabecalhos: unknown; linhas: number; importado_em: Date }>(
    'SELECT id, origem, cabecalhos, linhas, importado_em FROM legado.planilha_lote ORDER BY importado_em DESC, id DESC LIMIT 100',
  );
  return resultado.rows.map((linha) => ({
    id: linha.id, origem: linha.origem, cabecalhos: linhaSchema.parse(linha.cabecalhos), linhas: linha.linhas, importadoEm: linha.importado_em.toISOString(),
  }));
}

export async function exportarPlanilhaLegado(cliente: PoolClient, protetor: ProtetorDados, loteId: string, formato: 'csv' | 'xlsx'): Promise<Buffer> {
  const lote = await cliente.query<{ cabecalhos: unknown }>('SELECT cabecalhos FROM legado.planilha_lote WHERE id = $1', [loteId]);
  if (!lote.rows[0]) throw new UnprocessableEntityException('Planilha legada não encontrada.');
  const cabecalhos = linhaSchema.parse(lote.rows[0].cabecalhos);
  const registros = await cliente.query<{ id: string; conteudo_cifrado: Buffer }>(
    'SELECT id, conteudo_cifrado FROM legado.planilha_linha WHERE lote_id = $1 ORDER BY numero', [loteId],
  );
  const linhas = [cabecalhos, ...registros.rows.map((registro) => {
    const texto = protetor.decifrar(registro.conteudo_cifrado, { schema: 'legado', tabela: 'planilha_linha', registroId: registro.id, campo: 'conteudo_cifrado' });
    return linhaSchema.parse(JSON.parse(texto.toString('utf8')));
  })];
  if (formato === 'csv' && linhas.some((linha) => linha.some((valor) => /^\s*[=+@\-\t\r]/.test(valor)))) {
    throw new UnprocessableEntityException('Há células interpretáveis como fórmula no CSV. Use XLSX.');
  }
  const arquivo = formato === 'csv' ? escreverCsv(linhas) : escreverXlsx(linhas, 'Legado');
  if (arquivo.length > LIMITE_ARQUIVO_BYTES) throw new UnprocessableEntityException('A exportação excede 64 MB.');
  return arquivo;
}
