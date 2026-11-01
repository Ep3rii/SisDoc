import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import type {
  ConferenciaImportacao, Configuracao, EnviarImportacaoQuery, PaginaLotesImportacao, RelatorioImportacao,
} from '@sisdoc/contratos';
import type { Pool, PoolClient } from 'pg';
import { transacao } from '../banco';
import type { SessaoAutenticada } from '../seguranca/autenticacao';
import { papeisPermitidos } from '../seguranca/permissoes';
import { ProtetorDados } from '../seguranca/protecao-dados';
import { confirmarSessao } from '../seguranca/sessao-transacao';
import { ErroFormato } from './formatos';
import { conferenciaGeral, ErroImportacao, hashArquivo, importarLinhas } from './importador';
import { ErroPlanilha, lerPlanilha } from './planilhas';

export class ImportacaoService {
  private readonly protetor: ProtetorDados;

  constructor(private readonly banco: Pool, configuracao: Configuracao) {
    this.protetor = new ProtetorDados(configuracao.chaves);
  }

  async enviar(sessao: SessaoAutenticada, ip: string, consulta: EnviarImportacaoQuery, conteudo: Buffer): Promise<RelatorioImportacao> {
    if (conteudo.length === 0) throw new BadRequestException('Envie um arquivo CSV ou XLSX com conteúdo.');
    let linhas: string[][];
    try {
      linhas = lerPlanilha(conteudo).linhas;
    } catch (erro) {
      if (erro instanceof ErroPlanilha) throw new UnprocessableEntityException(erro.message);
      throw erro;
    }
    const cliente = await this.banco.connect();
    try {
      return await importarLinhas(cliente, this.protetor, linhas, {
        tipo: consulta.tipo,
        origem: consulta.origem,
        canal: 'tela',
        usuarioId: sessao.usuario.id,
        gravar: consulta.modo === 'gravar',
        hashArquivo: hashArquivo(conteudo),
        antes: (transacaoAtual) => confirmarSessao(transacaoAtual as PoolClient, sessao, papeisPermitidos('administrar_importacao')),
        ip,
      });
    } catch (erro) {
      if (erro instanceof ErroImportacao || erro instanceof ErroFormato || erro instanceof ErroPlanilha) {
        throw new UnprocessableEntityException(erro.message);
      }
      throw erro;
    } finally {
      cliente.release();
    }
  }

  async listar(sessao: SessaoAutenticada, ip: string, limite: number, cursor?: string): Promise<PaginaLotesImportacao> {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('administrar_importacao'));
      const resultado = await cliente.query<{
        id: string; tipo: string; sistema_origem: string; canal: string; status: string; contagens: Record<string, number> | null;
        usuario: string | null; iniciado_em: Date; cursor: string; concluido_em: Date | null; desfeito_em: Date | null;
      }>(`
        SELECT l.id, l.tipo, l.sistema_origem, l.canal, l.status, l.contagens, u.nome AS usuario,
          l.iniciado_em, to_char(l.iniciado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor,
          l.concluido_em, l.desfeito_em
        FROM nucleo.importacao_lote l LEFT JOIN seguranca.usuario u ON u.id = l.usuario_id
        WHERE l.tipo IS NOT NULL AND ($1::timestamptz IS NULL OR l.iniciado_em < $1::timestamptz)
        ORDER BY l.iniciado_em DESC, l.id DESC LIMIT $2
      `, [cursor ?? null, limite + 1]);
      await cliente.query(`
        INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, entidade_id, ip, detalhes)
        VALUES ($1, 'importacoes_consultadas', 'importacao_lote', NULL, $2, '{}'::jsonb)
      `, [sessao.usuario.id, ip]);
      const itens = resultado.rows.slice(0, limite);
      return {
        itens: itens.map((lote) => ({
          id: lote.id,
          tipo: lote.tipo as PaginaLotesImportacao['itens'][number]['tipo'],
          origem: lote.sistema_origem,
          canal: lote.canal as PaginaLotesImportacao['itens'][number]['canal'],
          status: lote.status as PaginaLotesImportacao['itens'][number]['status'],
          contagens: lote.contagens ?? {},
          usuario: lote.usuario ?? 'Usuário removido',
          iniciadoEm: lote.iniciado_em.toISOString(),
          concluidoEm: lote.concluido_em?.toISOString() ?? null,
          desfeitoEm: lote.desfeito_em?.toISOString() ?? null,
        })),
        proximoCursor: resultado.rows.length > limite ? itens[itens.length - 1].cursor : null,
      };
    });
  }

  async conferencia(sessao: SessaoAutenticada, ip: string): Promise<ConferenciaImportacao> {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('administrar_importacao'));
      const resultado = await conferenciaGeral(cliente);
      await cliente.query(`
        INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, entidade_id, ip, detalhes)
        VALUES ($1, 'importacao_conferida', 'importacao_lote', NULL, $2, '{}'::jsonb)
      `, [sessao.usuario.id, ip]);
      return resultado;
    });
  }
}
