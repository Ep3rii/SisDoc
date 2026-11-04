import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { calcularPreviaDof } from '@sisdoc/calculo';
import {
  type ResultadoCalculoDof,
  type SolicitarCalculoDof,
} from '@sisdoc/contratos';
import type { Pool, PoolClient } from 'pg';
import { transacao } from '../banco';
import { dataEmSaoPaulo } from '../data';
import { auditarConsultaFuncional } from '../seguranca/auditoria-funcional';
import type { SessaoAutenticada } from '../seguranca/autenticacao';
import { papeisPermitidos } from '../seguranca/permissoes';
import { confirmarSessao } from '../seguranca/sessao-transacao';

export async function calcularDofNaTransacao(
  cliente: PoolClient,
  sessao: SessaoAutenticada,
  ip: string,
  dados: SolicitarCalculoDof,
  admissaoEsperada?: string,
): Promise<{ resultado: ResultadoCalculoDof } | { erro: string } | { conflito: string }> {
  await confirmarSessao(cliente, sessao, papeisPermitidos('calcular'));
  const consulta = await cliente.query<{ admissao: string | null }>(`
    SELECT to_char(admissao, 'YYYY-MM-DD') AS admissao
    FROM nucleo.vinculo WHERE id = $1 AND pessoa_id = $2
  `, [dados.vinculoId, dados.pessoaId]);
  const vinculo = consulta.rows[0];
  if (!vinculo) throw new NotFoundException('Vínculo não encontrado para esta pessoa.');
  await auditarConsultaFuncional(cliente, sessao, 'calculo_solicitado', 'vinculo', dados.vinculoId, dados.pessoaId, ip);
  const admissao = dados.ajustesCadastro?.admissao ?? vinculo.admissao;
  if (!admissao) return { erro: 'Informe a data de admissão do vínculo ou um ajuste nesta declaração.' };
  if (admissaoEsperada && admissao !== admissaoEsperada) {
    return { conflito: 'A admissão do vínculo mudou. Recalcule e confira os lançamentos antes de salvar.' };
  }
  return calcularPreviaDof(dados, admissao, dataEmSaoPaulo(new Date()));
}

export class CalculosService {
  constructor(private readonly banco: Pool) {}

  async calcularDof(
    sessao: SessaoAutenticada,
    ip: string,
    dados: SolicitarCalculoDof,
  ): Promise<ResultadoCalculoDof> {
    const tentativa = await transacao(this.banco, (cliente) => calcularDofNaTransacao(cliente, sessao, ip, dados));
    if ('erro' in tentativa) throw new BadRequestException(tentativa.erro);
    if ('conflito' in tentativa) throw new ConflictException(tentativa.conflito);
    return tentativa.resultado;
  }
}
