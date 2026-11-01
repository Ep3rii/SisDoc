import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { normalizarMatricula, type PromoverLegado } from '@sisdoc/contratos';
import type { ClientBase } from 'pg';
import { DatabaseError } from 'pg';
import { analisarLinhas, COLUNAS, COLUNAS_AFASTAMENTO_INTERVALO } from './formatos';
import type { ProtetorDados } from '../seguranca/protecao-dados';

export function colunasConversaoLegado(tipo: PromoverLegado['tipo']): string[] {
  return [...new Set([...COLUNAS[tipo], ...(tipo === 'afastamentos' ? COLUNAS_AFASTAMENTO_INTERVALO : [])])];
}

export function mapearPlanilhaLegado(cabecalhos: string[], linhas: string[][], dados: PromoverLegado): string[][] {
  const colunas = colunasConversaoLegado(dados.tipo);
  if (Object.keys(dados.mapeamento).some((campo) => !colunas.includes(campo))) {
    throw new UnprocessableEntityException('O mapeamento contém campos desconhecidos para o tipo selecionado.');
  }
  const posicoes = colunas.map((coluna) => dados.mapeamento[coluna] ?? null);
  const utilizadas = posicoes.filter((posicao): posicao is number => posicao !== null);
  if (new Set(utilizadas).size !== utilizadas.length || utilizadas.some((indice) => indice >= cabecalhos.length)) {
    throw new UnprocessableEntityException('Selecione uma coluna existente e diferente para cada campo.');
  }
  const selecionadas = colunas.filter((_, indice) => posicoes[indice] !== null);
  const indices = utilizadas;
  const resultado = [selecionadas, ...linhas.map((linha) => indices.map((indice) => linha[indice] ?? ''))];
  // Não inclua cabeçalhos não selecionados: eles determinam a modalidade anual/intervalo.
  analisarLinhas(dados.tipo, [selecionadas]);
  return resultado;
}

export async function assinarValidacaoLegado(
  cliente: ClientBase, protetor: ProtetorDados, linhas: string[][], dados: PromoverLegado, origem: string, hashSessao: Buffer,
): Promise<string> {
  try {
    await cliente.query('SELECT documentos.bloquear_periodos_ipam()');
  } catch (erro) {
    if (erro instanceof DatabaseError && erro.code === '55P03') {
      throw new ConflictException('Os períodos IPAM estão sendo alterados. Aguarde e valide novamente.');
    }
    throw erro;
  }
  const analise = analisarLinhas(dados.tipo, linhas).analise;
  const cpfs = analise.tipo === 'dados_funcionais' ? analise.pessoas.map((pessoa) => pessoa.cpf)
    : analise.tipo === 'periodos_ipam' ? analise.registros.map((registro) => registro.cpf) : [];
  const matriculas = analise.tipo === 'dados_funcionais' ? analise.vinculos.map((vinculo) => vinculo.campos.matriculaNorm)
    : analise.tipo !== 'periodos_ipam' ? analise.registros.map((registro) => normalizarMatricula(registro.matriculaNorm)) : [];
  const pessoas = await cliente.query<{ id: string; revisao: string }>(`SELECT id, revisao_fonte::text AS revisao
    FROM nucleo.pessoa WHERE cpf_hash = ANY($1::bytea[]) OR id IN
      (SELECT pessoa_id FROM nucleo.vinculo WHERE matricula_norm = ANY($2::text[])) ORDER BY id FOR UPDATE`,
  [[...new Set(cpfs)].map((cpf) => protetor.hashCpf(cpf)), [...new Set(matriculas)]]);
  const vinculos = await cliente.query<{ id: string; pessoa_id: string; revisao: string }>(`SELECT id, pessoa_id, revisao_fonte::text AS revisao
    FROM nucleo.vinculo WHERE matricula_norm = ANY($1::text[]) OR pessoa_id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
  [[...new Set(matriculas)], pessoas.rows.map((pessoa) => pessoa.id)]);
  const periodos = await cliente.query<{ id: string; revisao: string; mes_inicio: string; mes_fim: string }>(`SELECT id,
    xmin::text AS revisao, mes_inicio::text, mes_fim::text FROM nucleo.periodo_ipam
    WHERE pessoa_id = ANY($1::uuid[]) ORDER BY id`, [pessoas.rows.map((pessoa) => pessoa.id)]);
  const assinatura = protetor.hashConteudo('importacao', 'validacao_legado', {
    loteId: dados.loteId, tipo: dados.tipo, origem, mapeamento: dados.mapeamento,
    linhasHash: protetor.hashConteudo('importacao', 'linhas_legado', linhas).toString('hex'),
    sessao: hashSessao.toString('hex'), politica: 'preencher_vazios_v1',
    pessoas: pessoas.rows, vinculos: vinculos.rows, periodos: periodos.rows,
  }).toString('hex');
  if (dados.modo === 'gravar' && dados.validacao !== assinatura) {
    throw new ConflictException('Os dados ou o mapeamento mudaram desde a validação. Valide novamente antes de aplicar.');
  }
  return assinatura;
}
