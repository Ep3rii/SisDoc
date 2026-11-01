import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import type {
  ConferenciaImportacao, Configuracao, EnviarImportacaoQuery, ExportarDados, PaginaLotesImportacao,
  PreviaLegado,
  PromoverLegado,
  RelatorioImportacao,
  RelatorioPlanilhaLegado,
  RelatorioPromocaoLegado,
  TipoImportacao,
} from '@sisdoc/contratos';
import type { Pool, PoolClient } from 'pg';
import { transacao } from '../banco';
import type { SessaoAutenticada } from '../seguranca/autenticacao';
import { papeisPermitidos } from '../seguranca/permissoes';
import { ProtetorDados } from '../seguranca/protecao-dados';
import { confirmarSessao } from '../seguranca/sessao-transacao';
import { conferenciaGeral } from './conferencia-importacao';
import { ErroImportacao, ErroTransacaoImportacao, hashArquivo } from './estado-importacao';
import { gerarExportacao } from './exportador';
import { ErroFormato, sugerirMapeamento } from './formatos';
import { importarLinhas } from './importador';
import { exportarPlanilhaLegado, importarPlanilhaLegado, lerPlanilhaLegado, listarPlanilhasLegado } from './planilha-legado';
import { ErroPlanilha, escreverXlsx, lerPlanilha, LIMITE_ARQUIVO_BYTES } from './planilhas';
import { assinarValidacaoLegado, colunasConversaoLegado, mapearPlanilhaLegado } from './promocao-legado';

export class ImportacaoService {
  private readonly protetor: ProtetorDados;

  constructor(private readonly banco: Pool, configuracao: Configuracao) {
    this.protetor = new ProtetorDados(configuracao.chaves);
  }

  async exportar(sessao: SessaoAutenticada, ip: string, dados: ExportarDados): Promise<Buffer> {
    return transacao(this.banco, async (cliente) => {
      await cliente.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await confirmarSessao(cliente, sessao, papeisPermitidos('administrar_importacao'));
      const arquivo = await gerarExportacao(cliente, this.protetor, dados);
      await cliente.query(`INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, ip, detalhes)
        VALUES ($1, 'dados_exportados', 'exportacao', $2, $3::jsonb)`,
      [sessao.usuario.id, ip, JSON.stringify(dados)]);
      return arquivo;
    });
  }

  async listarLegado(sessao: SessaoAutenticada, ip: string) {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('administrar_importacao'));
      const lotes = await listarPlanilhasLegado(cliente);
      await cliente.query(`INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, ip)
        VALUES ($1, 'planilhas_legado_consultadas', 'planilha_lote', $2)`, [sessao.usuario.id, ip]);
      return lotes;
    });
  }

  async exportarLegado(sessao: SessaoAutenticada, ip: string, loteId: string, formato: 'csv' | 'xlsx') {
    return transacao(this.banco, async (cliente) => {
      await cliente.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await confirmarSessao(cliente, sessao, papeisPermitidos('administrar_importacao'));
      const arquivo = await exportarPlanilhaLegado(cliente, this.protetor, loteId, formato);
      await cliente.query(`INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, entidade_id, ip, detalhes)
        VALUES ($1, 'planilha_legado_exportada', 'planilha_lote', $2, $3, $4::jsonb)`,
      [sessao.usuario.id, loteId, ip, JSON.stringify({ formato })]);
      return arquivo;
    });
  }

  async previaLegado(sessao: SessaoAutenticada, ip: string, loteId: string, tipo: TipoImportacao): Promise<PreviaLegado> {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('administrar_importacao'));
      const lote = await lerPlanilhaLegado(cliente, this.protetor, loteId);
      await cliente.query(`INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, entidade_id, ip)
        VALUES ($1, 'previa_legado_consultada', 'planilha_lote', $2, $3)`, [sessao.usuario.id, loteId, ip]);
      const colunas = colunasConversaoLegado(tipo);
      const mapeamento = sugerirMapeamento(tipo, lote.cabecalhos);
      if (tipo === 'afastamentos') {
        const intervalo = sugerirMapeamento('incorporacoes', lote.cabecalhos);
        for (const campo of ['TIPO', 'DT_INICIO', 'DT_FIM']) mapeamento[campo] = intervalo[campo];
      }
      return { loteId, tipo, origem: lote.origem, cabecalhos: lote.cabecalhos, linhas: lote.linhas.length,
        amostra: lote.linhas.slice(0, 20), colunas, mapeamento };
    });
  }

  async exportarOcorrenciasLegado(sessao: SessaoAutenticada, ip: string, dados: PromoverLegado): Promise<Buffer> {
    const resultado = await this.promoverLegado(sessao, ip, { ...dados, modo: 'validar' }, true);
    const arquivo = escreverXlsx([
      ['LINHA', 'TIPO', 'REFERENCIA', 'MOTIVO'],
      ...resultado.relatorio.ocorrencias.map((item) => [String(item.linha), item.tipo, item.referencia, item.motivo]),
    ], 'Ocorrencias');
    if (arquivo.length > LIMITE_ARQUIVO_BYTES) throw new UnprocessableEntityException('O relatório excede 64 MB.');
    await transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('administrar_importacao'));
      await cliente.query(`INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, entidade_id, ip)
        VALUES ($1, 'ocorrencias_legado_exportadas', 'planilha_lote', $2, $3)`, [sessao.usuario.id, dados.loteId, ip]);
    });
    return arquivo;
  }

  async promoverLegado(sessao: SessaoAutenticada, ip: string, dados: PromoverLegado, todasOcorrencias = false): Promise<RelatorioPromocaoLegado> {
    const lote = await transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('administrar_importacao'));
      return lerPlanilhaLegado(cliente, this.protetor, dados.loteId);
    });
    let linhas: string[][];
    try {
      linhas = mapearPlanilhaLegado(lote.cabecalhos, lote.linhas, dados);
    } catch (erro) {
      if (erro instanceof ErroFormato) throw new UnprocessableEntityException(erro.message);
      throw erro;
    }
    const cliente = await this.banco.connect();
    let validacao = '';
    let erroLiberacao: Error | undefined;
    try {
      const relatorio = await importarLinhas(cliente, this.protetor, linhas, {
        tipo: dados.tipo, origem: lote.origem, canal: 'legado', usuarioId: sessao.usuario.id,
        gravar: dados.modo === 'gravar', preservarExistentes: true, referenciasCompletas: true, loteLegadoId: dados.loteId,
        revalidarExistente: true,
        ...(todasOcorrencias ? { limiteOcorrencias: Number.MAX_SAFE_INTEGER } : {}),
        hashArquivo: this.protetor.hashConteudo('importacao', 'promocao_legado', {
          loteId: dados.loteId, hash: lote.hash.toString('hex'), tipo: dados.tipo, mapeamento: dados.mapeamento, politica: 'preencher_vazios_v1',
        }),
        antes: (atual) => confirmarSessao(atual as PoolClient, sessao, papeisPermitidos('administrar_importacao')),
        preparar: async (atual) => { validacao = await assinarValidacaoLegado(atual, this.protetor, linhas, dados, lote.origem, sessao.hash); },
        ip,
      });
      return { loteLegadoId: dados.loteId, validacao, relatorio };
    } catch (erro) {
      if (erro instanceof ErroTransacaoImportacao) erroLiberacao = erro;
      if (erro instanceof ErroImportacao || erro instanceof ErroFormato) throw new UnprocessableEntityException(erro.message);
      throw erro;
    } finally {
      cliente.release(erroLiberacao);
    }
  }

  async enviar(sessao: SessaoAutenticada, ip: string, consulta: EnviarImportacaoQuery, conteudo: Buffer): Promise<RelatorioImportacao | RelatorioPlanilhaLegado> {
    if (conteudo.length === 0) throw new BadRequestException('Envie um arquivo CSV ou XLSX com conteúdo.');
    let linhas: string[][];
    try {
      linhas = lerPlanilha(conteudo).linhas;
    } catch (erro) {
      if (erro instanceof ErroPlanilha) throw new UnprocessableEntityException(erro.message);
      throw erro;
    }
    if (consulta.destino === 'legado') {
      return transacao(this.banco, async (cliente) => {
        await confirmarSessao(cliente, sessao, papeisPermitidos('administrar_importacao'));
        return importarPlanilhaLegado(cliente, this.protetor, linhas, conteudo, consulta, sessao.usuario.id, ip);
      });
    }
    const cliente = await this.banco.connect();
    let erroLiberacao: Error | undefined;
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
        referenciasCompletas: true,
        preservarExistentes: true,
      });
    } catch (erro) {
      if (erro instanceof ErroTransacaoImportacao) erroLiberacao = erro;
      if (erro instanceof ErroImportacao || erro instanceof ErroFormato || erro instanceof ErroPlanilha) {
        throw new UnprocessableEntityException(erro.message);
      }
      throw erro;
    } finally {
      cliente.release(erroLiberacao);
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
