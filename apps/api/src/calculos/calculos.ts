import { BadRequestException, NotFoundException } from '@nestjs/common';
import { calcular, linhasDeclaracaoDof, REGRAS_PLANILHA } from '@sisdoc/calculo';
import {
  dataFuncionalSchema,
  resultadoCalculoDofSchema,
  type ResultadoCalculoDof,
  type SolicitarCalculoDof,
} from '@sisdoc/contratos';
import type { Pool } from 'pg';
import { transacao } from '../banco';
import { auditarConsultaFuncional } from '../seguranca/auditoria-funcional';
import type { SessaoAutenticada } from '../seguranca/autenticacao';
import { papeisPermitidos } from '../seguranca/permissoes';
import { confirmarSessao } from '../seguranca/sessao-transacao';

function dataAtual(): string {
  return dataFuncionalSchema.parse(new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()));
}

export class CalculosService {
  constructor(private readonly banco: Pool) {}

  async calcularDof(
    sessao: SessaoAutenticada,
    ip: string,
    dados: SolicitarCalculoDof,
  ): Promise<ResultadoCalculoDof> {
    const resultado = await transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('calcular'));
      const consulta = await cliente.query<{ admissao: string | null }>(`
        SELECT to_char(admissao, 'YYYY-MM-DD') AS admissao
        FROM nucleo.vinculo WHERE id = $1 AND pessoa_id = $2
      `, [dados.vinculoId, dados.pessoaId]);
      const vinculo = consulta.rows[0];
      if (!vinculo) throw new NotFoundException('Vínculo não encontrado para esta pessoa.');
      await auditarConsultaFuncional(cliente, sessao, 'calculo_solicitado', 'vinculo', dados.vinculoId, dados.pessoaId, ip);
      if (!vinculo.admissao) return { erro: 'A data de admissão do vínculo não está informada na fonte.' } as const;
      return {
        calculo: calcular({
          tipo: 'DOF',
          posse: vinculo.admissao,
          dataReferencia: dataAtual(),
          periodos: [{
            inicio: dados.inicio,
            fim: dados.fim,
            anos: dados.anos,
            ...(dados.acumuladoAnterior ? { acumuladoAnterior: dados.acumuladoAnterior } : {}),
          }],
          regras: REGRAS_PLANILHA,
        }),
      } as const;
    });
    if ('erro' in resultado) throw new BadRequestException(resultado.erro);
    if (!resultado.calculo.sucesso) {
      throw new BadRequestException([...new Set(resultado.calculo.erros.map((erro) => erro.mensagem))].join(' '));
    }
    const calculo = resultado.calculo;
    const periodo = calculo.periodos[0];
    return resultadoCalculoDofSchema.parse({
      regra: {
        codigo: calculo.regras.codigo,
        versao: calculo.regras.versao,
        classificacao: calculo.regras.classificacao,
      },
      periodo: {
        inicioInformado: periodo.inicioInformado,
        inicioEfetivo: periodo.inicioEfetivo,
        fim: periodo.fim,
        linhas: periodo.linhas,
      },
      totais: calculo.totais,
      declaracao: linhasDeclaracaoDof(calculo.totais, calculo.regras),
      avisos: calculo.avisos,
    });
  }
}
