import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  erroSincronizacaoSchema,
  idOrigemApiSchema,
  loteSincronizacaoSchema,
  normalizarMatricula,
  normalizarNomeBusca,
  servidorApiSincronizacaoSchema,
  type CampoCanonicoSincronizacao,
  type Configuracao,
  type ConfiguracaoSincronizacao,
  type ErroSincronizacao,
  type LoteSincronizacao,
  type PaginaSincronizacoes,
  type ServidorApiSincronizacao,
  type SituacaoSincronizacao,
} from '@sisdoc/contratos';
import { DatabaseError, type Pool, type PoolClient } from 'pg';
import { z } from 'zod';
import { transacao } from '../banco';
import type { SessaoAutenticada } from '../seguranca/autenticacao';
import { papeisPermitidos } from '../seguranca/permissoes';
import { ProtetorDados } from '../seguranca/protecao-dados';
import { confirmarSessao } from '../seguranca/sessao-transacao';
import { ClienteApiSincronizacao, ErroApiExterna, type OpcoesClienteApi } from './cliente-api';

export const MENSAGEM_NAO_CONFIGURADA = 'A sincronização com a API externa não está configurada; '
  + 'preencha o bloco "sincronizacao" da configuração externa e reinicie o serviço.';
export const LIMITE_FALHAS_DISJUNTOR = 5;
export const MAXIMO_ERROS_LOTE = 200;
const LIMITE_REMOCAO_ABSOLUTO = 10;
const LIMITE_REMOCAO_PROPORCIONAL = 0.2;
const RETOMADA_MAXIMA_HORAS = 24;
const MAXIMO_PAGINAS = 100000;
const CHAVE_BLOQUEIO_SINCRONIZACAO = 1936290665;

type TipoExecucao = 'completa' | 'incremental';

const cursorLoteSchema = z.strictObject({
  proximo: z.string().nullable(),
  marco: z.string().nullable(),
  desde: z.string().nullable(),
  fim: z.boolean(),
});
type CursorLote = z.infer<typeof cursorLoteSchema>;

type LinhaLote = {
  id: string;
  origem: string;
  tipo: 'completa' | 'incremental' | 'servidor';
  status: 'processando' | 'concluido' | 'falhou';
  iniciado_em: Date;
  concluido_em: Date | null;
  lidos: number;
  inseridos: number;
  atualizados: number;
  removidos: number;
  erros_sanitizados: unknown;
};

type LinhaEstado = {
  falhas_consecutivas: number;
  disjuntor_aberto_em: Date | null;
  ultima_sincronizacao_em: Date | null;
  cursor_incremental: string | null;
};

type Execucao = {
  loteId: string;
  tipo: TipoExecucao;
  cursor: CursorLote;
  lidos: number;
};

class ErroItem extends Error {}
class Interrompida extends Error {}

const errosLoteSchema = z.array(erroSincronizacaoSchema);

function erro(motivo: string, posicao: number | null = null, referencia: string | null = null): ErroSincronizacao {
  return { posicao, referencia, motivo: motivo.slice(0, 300) };
}

function mesmoBuffer(a: Buffer | null, b: Buffer): boolean {
  return a !== null && a.length === b.length && a.equals(b);
}

@Injectable()
export class SincronizacaoService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly protetor: ProtetorDados;
  private readonly sincronizacao: ConfiguracaoSincronizacao | undefined;
  private execucao: Promise<void> | null = null;
  private encerrando = false;
  private temporizador: NodeJS.Timeout | null = null;
  opcoesCliente: OpcoesClienteApi = {};

  constructor(private readonly banco: Pool, configuracao: Configuracao) {
    this.protetor = new ProtetorDados(configuracao.chaves);
    this.sincronizacao = configuracao.sincronizacao;
  }

  onApplicationBootstrap(): void {
    const intervalo = this.sincronizacao?.intervaloMinutos;
    if (!intervalo || process.env.SISDOC_SINCRONIZACAO_AGENDADA === 'desligado') return;
    this.temporizador = setInterval(() => {
      void this.executarAgendada();
    }, intervalo * 60000);
    this.temporizador.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
    this.encerrando = true;
    await this.aguardarExecucao();
  }

  async aguardarExecucao(): Promise<void> {
    if (this.execucao) await this.execucao;
  }

  private referencia(idOrigem: string): string {
    return this.protetor.hashConteudo('sincronizacao', 'referencia', idOrigem).subarray(0, 8).toString('hex');
  }

  private montarSituacao(estado: LinhaEstado | undefined): SituacaoSincronizacao {
    const limiteHoras = this.sincronizacao?.avisoHoras ?? 24;
    if (!this.sincronizacao) {
      return {
        configurada: false, ultimaSincronizacaoEm: null, horasDesdeUltima: null, limiteHoras,
        avisoAtraso: false, disjuntorAberto: false,
      };
    }
    const ultima = estado?.ultima_sincronizacao_em ?? null;
    const horas = ultima ? Math.max(0, (Date.now() - ultima.getTime()) / 3600000) : null;
    return {
      configurada: true,
      ultimaSincronizacaoEm: ultima ? ultima.toISOString() : null,
      horasDesdeUltima: horas === null ? null : Math.round(horas * 10) / 10,
      limiteHoras,
      avisoAtraso: horas === null || horas > limiteHoras,
      disjuntorAberto: this.disjuntorAbertoAte(estado) !== null,
    };
  }

  private disjuntorAbertoAte(estado: LinhaEstado | undefined): Date | null {
    if (!this.sincronizacao || !estado?.disjuntor_aberto_em) return null;
    const ate = new Date(estado.disjuntor_aberto_em.getTime() + this.sincronizacao.pausaDisjuntorMinutos * 60000);
    return ate.getTime() > Date.now() ? ate : null;
  }

  private async lerEstado(cliente: PoolClient, origem: string): Promise<LinhaEstado | undefined> {
    const resultado = await cliente.query<LinhaEstado>(`
      SELECT falhas_consecutivas, disjuntor_aberto_em, ultima_sincronizacao_em, cursor_incremental
      FROM nucleo.sincronizacao_estado WHERE origem = $1
    `, [origem]);
    return resultado.rows[0];
  }

  async situacao(sessao: SessaoAutenticada): Promise<SituacaoSincronizacao> {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_situacao_sincronizacao'));
      const estado = this.sincronizacao ? await this.lerEstado(cliente, this.sincronizacao.origem) : undefined;
      return this.montarSituacao(estado);
    });
  }

  private mapearLote(linha: LinhaLote): LoteSincronizacao {
    const erros = errosLoteSchema.safeParse(linha.erros_sanitizados);
    const lista = erros.success ? erros.data : [erro('Registro de erros ilegível.')];
    return loteSincronizacaoSchema.parse({
      id: linha.id, origem: linha.origem, tipo: linha.tipo, status: linha.status,
      iniciadoEm: linha.iniciado_em.toISOString(), concluidoEm: linha.concluido_em?.toISOString() ?? null,
      lidos: linha.lidos, inseridos: linha.inseridos, atualizados: linha.atualizados, removidos: linha.removidos,
      totalErros: lista.length, erros: lista.slice(0, MAXIMO_ERROS_LOTE),
    });
  }

  async listar(
    sessao: SessaoAutenticada, ip: string, limite: number, cursor: string | undefined,
  ): Promise<PaginaSincronizacoes> {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('administrar_sincronizacao'));
      if (cursor) {
        const existe = await cliente.query('SELECT 1 FROM nucleo.sincronizacao_lote WHERE id = $1', [cursor]);
        if (existe.rowCount !== 1) throw new NotFoundException('Cursor de sincronização não encontrado.');
      }
      const linhas = await cliente.query<LinhaLote>(`
        SELECT l.id, l.origem, l.tipo, l.status, l.iniciado_em, l.concluido_em, l.lidos, l.inseridos,
          l.atualizados, l.removidos, l.erros_sanitizados
        FROM nucleo.sincronizacao_lote l
        WHERE $1::uuid IS NULL OR (l.iniciado_em, l.id) < (
          SELECT c.iniciado_em, c.id FROM nucleo.sincronizacao_lote c WHERE c.id = $1::uuid
        )
        ORDER BY l.iniciado_em DESC, l.id DESC
        LIMIT $2
      `, [cursor ?? null, limite + 1]);
      const estado = this.sincronizacao ? await this.lerEstado(cliente, this.sincronizacao.origem) : undefined;
      await cliente.query(`
        INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, ip, detalhes)
        VALUES ($1, 'sincronizacoes_consultadas', 'sincronizacao_lote', $2, '{}'::jsonb)
      `, [sessao.usuario.id, ip]);
      const pagina = linhas.rows.slice(0, limite);
      const aberto = this.disjuntorAbertoAte(estado);
      return {
        situacao: this.montarSituacao(estado),
        falhasConsecutivas: estado?.falhas_consecutivas ?? 0,
        disjuntorAbertoAte: aberto ? aberto.toISOString() : null,
        itens: pagina.map((linha) => this.mapearLote(linha)),
        proximoCursor: linhas.rows.length > limite ? pagina[pagina.length - 1].id : null,
      };
    });
  }

  async iniciar(sessao: SessaoAutenticada, ip: string, tipo: TipoExecucao): Promise<LoteSincronizacao> {
    return this.preparar(tipo, { sessao, ip });
  }

  private async executarAgendada(): Promise<void> {
    if (this.execucao || this.encerrando) return;
    try {
      await this.preparar('incremental', null);
    } catch {
      // Execução agendada recusada (disjuntor, carga completa pendente ou concorrência); a próxima janela tenta de novo.
    }
  }

  private async preparar(
    tipo: TipoExecucao, autor: { sessao: SessaoAutenticada; ip: string } | null,
  ): Promise<LoteSincronizacao> {
    const config = this.sincronizacao;
    if (!config) throw new ConflictException(MENSAGEM_NAO_CONFIGURADA);
    if (this.execucao || this.encerrando) {
      throw new ConflictException('Já existe uma sincronização em andamento; aguarde a conclusão do lote atual.');
    }
    const conexao = await this.banco.connect();
    let liberar = true;
    try {
      const bloqueio = await conexao.query<{ obtido: boolean }>(
        'SELECT pg_try_advisory_lock($1, hashtext($2)) AS obtido', [CHAVE_BLOQUEIO_SINCRONIZACAO, config.origem],
      );
      if (!bloqueio.rows[0].obtido) {
        throw new ConflictException('Já existe uma sincronização em andamento; aguarde a conclusão do lote atual.');
      }
      const resultado = await transacao(this.banco, async (cliente) => {
        if (autor) await confirmarSessao(cliente, autor.sessao, papeisPermitidos('administrar_sincronizacao'));
        const auditar = (acao: string, loteId: string | null, detalhes: Record<string, unknown>) => cliente.query(`
          INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, entidade_id, ip, detalhes)
          VALUES ($1, $2, 'sincronizacao_lote', $3, $4, $5::jsonb)
        `, [autor?.sessao.usuario.id ?? null, acao, loteId, autor?.ip ?? null,
          JSON.stringify({ ...detalhes, agendada: autor === null })]);
        await cliente.query(`
          UPDATE nucleo.sincronizacao_lote SET status = 'falhou', concluido_em = now(),
            erros_sanitizados = CASE WHEN jsonb_array_length(erros_sanitizados) < $2 THEN erros_sanitizados || $3::jsonb
              ELSE erros_sanitizados END
          WHERE origem = $1 AND status = 'processando'
        `, [config.origem, MAXIMO_ERROS_LOTE, JSON.stringify([erro('Execução interrompida sem conclusão; o lote pode ser retomado.')])]);
        await cliente.query(`
          INSERT INTO nucleo.sincronizacao_estado (origem) VALUES ($1) ON CONFLICT (origem) DO NOTHING
        `, [config.origem]);
        const estado = await cliente.query<LinhaEstado>(`
          SELECT falhas_consecutivas, disjuntor_aberto_em, ultima_sincronizacao_em, cursor_incremental
          FROM nucleo.sincronizacao_estado WHERE origem = $1 FOR UPDATE
        `, [config.origem]);
        const aberto = this.disjuntorAbertoAte(estado.rows[0]);
        if (aberto) {
          await auditar('sincronizacao_recusada', null, { tipo, motivo: 'disjuntor_aberto' });
          return {
            recusa: `A sincronização está suspensa após ${LIMITE_FALHAS_DISJUNTOR} falhas consecutivas. `
              + `Verifique a disponibilidade da API externa e a credencial; nova tentativa liberada a partir de ${aberto.toISOString()}.`,
          };
        }
        if (tipo === 'incremental' && !estado.rows[0].cursor_incremental) {
          return { recusa: 'Execute uma sincronização completa antes da incremental.' };
        }
        const anterior = await cliente.query<{ id: string; cursor: string | null; lidos: number }>(`
          SELECT id, cursor, lidos FROM nucleo.sincronizacao_lote
          WHERE origem = $1 ORDER BY iniciado_em DESC, id DESC LIMIT 1
        `, [config.origem]);
        let execucao: Execucao | null = null;
        const ultimo = anterior.rows[0];
        if (ultimo?.cursor) {
          const retomavel = await cliente.query(`
            SELECT 1 FROM nucleo.sincronizacao_lote
            WHERE id = $1 AND tipo = $2 AND status = 'falhou' AND iniciado_em > now() - make_interval(hours => $3)
          `, [ultimo.id, tipo, RETOMADA_MAXIMA_HORAS]);
          const cursor = cursorLoteSchema.safeParse((() => {
            try { return JSON.parse(ultimo.cursor); } catch { return null; }
          })());
          if (retomavel.rowCount === 1 && cursor.success) {
            await cliente.query(`
              UPDATE nucleo.sincronizacao_lote SET status = 'processando', concluido_em = NULL WHERE id = $1
            `, [ultimo.id]);
            execucao = { loteId: ultimo.id, tipo, cursor: cursor.data, lidos: ultimo.lidos };
          }
        }
        const retomada = execucao !== null;
        if (!execucao) {
          const novo = await cliente.query<{ id: string }>(`
            INSERT INTO nucleo.sincronizacao_lote (origem, tipo, status) VALUES ($1, $2, 'processando') RETURNING id
          `, [config.origem, tipo]);
          execucao = {
            loteId: novo.rows[0].id, tipo, lidos: 0,
            cursor: {
              proximo: null, marco: null, fim: false,
              desde: tipo === 'incremental' ? estado.rows[0].cursor_incremental : null,
            },
          };
        }
        await auditar('sincronizacao_iniciada', execucao.loteId, { tipo, retomada });
        const lote = await cliente.query<LinhaLote>(`
          SELECT id, origem, tipo, status, iniciado_em, concluido_em, lidos, inseridos, atualizados, removidos,
            erros_sanitizados
          FROM nucleo.sincronizacao_lote WHERE id = $1
        `, [execucao.loteId]);
        return { execucao, lote: this.mapearLote(lote.rows[0]) };
      });
      if ('recusa' in resultado) throw new ConflictException(resultado.recusa);
      liberar = false;
      this.execucao = this.executar(config, resultado.execucao).finally(async () => {
        try {
          await conexao.query('SELECT pg_advisory_unlock($1, hashtext($2))', [CHAVE_BLOQUEIO_SINCRONIZACAO, config.origem]);
          conexao.release();
        } catch {
          conexao.release(true);
        }
        this.execucao = null;
      });
      return resultado.lote;
    } finally {
      if (liberar) {
        await conexao.query('SELECT pg_advisory_unlock_all()').catch(() => undefined);
        conexao.release();
      }
    }
  }

  private async salvarCursor(execucao: Execucao): Promise<void> {
    await this.banco.query('UPDATE nucleo.sincronizacao_lote SET cursor = $2 WHERE id = $1', [
      execucao.loteId, JSON.stringify(execucao.cursor),
    ]);
  }

  private async executar(config: ConfiguracaoSincronizacao, execucao: Execucao): Promise<void> {
    try {
      const cliente = new ClienteApiSincronizacao(config, this.opcoesCliente);
      let paginas = 0;
      while (!execucao.cursor.fim) {
        if (this.encerrando) throw new Interrompida();
        if (++paginas > MAXIMO_PAGINAS) {
          throw new ErroApiExterna('A API externa excedeu o número máximo de páginas por lote.', false);
        }
        const pagina = await cliente.buscarPagina({ cursor: execucao.cursor.proximo, alteradoDesde: execucao.cursor.desde });
        if (pagina.proximo_cursor !== null && pagina.proximo_cursor === execucao.cursor.proximo) {
          throw new ErroApiExterna('A API externa repetiu o cursor de paginação.', false);
        }
        execucao.cursor.marco ??= pagina.gerado_em;
        for (const item of pagina.itens) {
          if (this.encerrando) throw new Interrompida();
          execucao.lidos += 1;
          await this.processarItem(config, execucao, item);
        }
        execucao.cursor.proximo = pagina.proximo_cursor;
        execucao.cursor.fim = pagina.proximo_cursor === null;
        await this.salvarCursor(execucao);
      }
      if (execucao.tipo === 'completa') await this.reconciliar(config, execucao.loteId);
      await this.concluir(config, execucao);
    } catch (falha) {
      await this.falhar(config, execucao.loteId, falha).catch(() => undefined);
    }
  }

  private mapear(config: ConfiguracaoSincronizacao, bruto: unknown): unknown {
    const mapa = config.mapeamento;
    if (!mapa || typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) return bruto;
    const origem = bruto as Record<string, unknown>;
    const nome = (campo: CampoCanonicoSincronizacao) => mapa[campo] ?? campo;
    const resultado: Record<string, unknown> = {};
    const camposServidor: CampoCanonicoSincronizacao[] = [
      'id', 'alterado_em', 'cpf', 'nome', 'nascimento', 'nome_mae', 'nome_pai', 'pis_pasep', 'rg_numero', 'rg_orgao',
      'rg_expedicao', 'titulo_eleitor', 'endereco',
    ];
    for (const campo of camposServidor) {
      if (Object.hasOwn(origem, nome(campo))) resultado[campo] = origem[nome(campo)];
    }
    const vinculos = origem[nome('vinculos')];
    if (Array.isArray(vinculos)) {
      const camposVinculo = [
        'id', 'matricula', 'regime_juridico', 'cargo', 'classe', 'nivel', 'referencia', 'setor', 'orgao_codigo',
        'orgao_nome', 'admissao', 'desligamento',
      ] as const;
      resultado.vinculos = vinculos.map((vinculo: unknown) => {
        if (typeof vinculo !== 'object' || vinculo === null) return vinculo;
        const fonte = vinculo as Record<string, unknown>;
        const saida: Record<string, unknown> = {};
        for (const campo of camposVinculo) {
          const chave = nome(`vinculo.${campo}`);
          if (Object.hasOwn(fonte, chave)) saida[campo] = fonte[chave];
        }
        return saida;
      });
    } else if (vinculos !== undefined) {
      resultado.vinculos = vinculos;
    }
    return resultado;
  }

  private idDoItem(mapeado: unknown): string | null {
    if (typeof mapeado !== 'object' || mapeado === null) return null;
    const id = idOrigemApiSchema.safeParse((mapeado as Record<string, unknown>).id);
    return id.success ? id.data : null;
  }

  private async processarItem(config: ConfiguracaoSincronizacao, execucao: Execucao, bruto: unknown): Promise<void> {
    const posicao = execucao.lidos;
    const mapeado = this.mapear(config, bruto);
    const idOrigem = this.idDoItem(mapeado);
    await transacao(this.banco, async (cliente) => {
      const stagingId = randomUUID();
      const payload = this.protetor.cifrar(Buffer.from(JSON.stringify(bruto ?? null), 'utf8'), {
        schema: 'nucleo', tabela: 'staging_api', registroId: stagingId, campo: 'payload_cifrado',
      });
      await cliente.query(`
        INSERT INTO nucleo.staging_api (id, lote_id, id_origem, payload_cifrado) VALUES ($1, $2, $3, $4)
      `, [stagingId, execucao.loteId, idOrigem ?? `#sem-id-${posicao}`, payload]);
      let resultado: { inserido: boolean; atualizado: boolean } | null = null;
      let falha: ErroSincronizacao | null = null;
      await cliente.query('SAVEPOINT item_sincronizacao');
      try {
        if (!idOrigem) throw new ErroItem('Item sem identificador de origem válido.');
        resultado = await this.aplicar(cliente, config.origem, mapeado);
        await cliente.query('RELEASE SAVEPOINT item_sincronizacao');
      } catch (problema) {
        await cliente.query('ROLLBACK TO SAVEPOINT item_sincronizacao');
        let motivo: string;
        if (problema instanceof ErroItem) motivo = problema.message;
        else if (problema instanceof DatabaseError && problema.code?.startsWith('23')) {
          motivo = problema.code === '23505'
            ? 'Conflito com registro existente desta origem (matrícula ou identificador já usados por outro servidor).'
            : 'O item viola uma regra de integridade do modelo canônico.';
        } else throw problema;
        falha = erro(motivo, posicao, idOrigem ? this.referencia(idOrigem) : null);
      }
      if (resultado) {
        await cliente.query('UPDATE nucleo.staging_api SET processado_em = now() WHERE id = $1', [stagingId]);
      }
      await cliente.query(`
        UPDATE nucleo.sincronizacao_lote SET lidos = $2, inseridos = inseridos + $3, atualizados = atualizados + $4,
          erros_sanitizados = CASE WHEN $5::jsonb IS NOT NULL AND jsonb_array_length(erros_sanitizados) < $6
            THEN erros_sanitizados || $5::jsonb ELSE erros_sanitizados END
        WHERE id = $1
      `, [
        execucao.loteId, posicao, resultado?.inserido ? 1 : 0, resultado?.atualizado ? 1 : 0,
        falha ? JSON.stringify([falha]) : null, MAXIMO_ERROS_LOTE,
      ]);
    });
  }

  private motivoValidacao(problemas: z.ZodError['issues']): string {
    const campos = [...new Set(problemas.map((problema) => problema.path.map((parte) => String(parte)).join('.') || 'item'))];
    return `Dados inválidos nos campos: ${campos.slice(0, 10).join(', ')}.`;
  }

  private cifrarCampo(pessoaId: string, campo: string, valor: string | null): Buffer | null {
    if (valor === null) return null;
    return this.protetor.cifrar(Buffer.from(valor, 'utf8'), {
      schema: 'nucleo', tabela: 'pessoa', registroId: pessoaId, campo,
    });
  }

  private decifrarCampo(pessoaId: string, campo: string, valor: Buffer | null): string | null {
    if (valor === null) return null;
    return this.protetor.decifrar(valor, { schema: 'nucleo', tabela: 'pessoa', registroId: pessoaId, campo }).toString('utf8');
  }

  private async atualizarPessoa(cliente: PoolClient, pessoaId: string, dados: ServidorApiSincronizacao): Promise<boolean> {
    const atual = await cliente.query<{
      nome: string; nascimento: string | null; rg_orgao: string | null; rg_expedicao: string | null;
      nome_mae_cifrado: Buffer | null; nome_pai_cifrado: Buffer | null; pis_pasep_cifrado: Buffer | null;
      rg_numero_cifrado: Buffer | null; titulo_eleitor_cifrado: Buffer | null; endereco_cifrado: Buffer | null;
    }>(`
      SELECT nome, nascimento::text AS nascimento, rg_orgao, rg_expedicao::text AS rg_expedicao, nome_mae_cifrado,
        nome_pai_cifrado, pis_pasep_cifrado, rg_numero_cifrado, titulo_eleitor_cifrado, endereco_cifrado
      FROM nucleo.pessoa WHERE id = $1 FOR UPDATE
    `, [pessoaId]);
    const linha = atual.rows[0];
    const cifrados = {
      nome_mae_cifrado: dados.nome_mae, nome_pai_cifrado: dados.nome_pai, pis_pasep_cifrado: dados.pis_pasep,
      rg_numero_cifrado: dados.rg_numero, titulo_eleitor_cifrado: dados.titulo_eleitor, endereco_cifrado: dados.endereco,
    } as const;
    const iguais = linha.nome === dados.nome && linha.nascimento === dados.nascimento
      && linha.rg_orgao === dados.rg_orgao && linha.rg_expedicao === dados.rg_expedicao
      && (Object.keys(cifrados) as (keyof typeof cifrados)[])
        .every((campo) => this.decifrarCampo(pessoaId, campo, linha[campo]) === cifrados[campo]);
    if (iguais) return false;
    await cliente.query(`
      UPDATE nucleo.pessoa SET nome = $2, nome_busca = $3, nascimento = $4, rg_orgao = $5, rg_expedicao = $6,
        nome_mae_cifrado = $7, nome_pai_cifrado = $8, pis_pasep_cifrado = $9, rg_numero_cifrado = $10,
        titulo_eleitor_cifrado = $11, endereco_cifrado = $12, atualizado_em = now()
      WHERE id = $1
    `, [
      pessoaId, dados.nome, normalizarNomeBusca(dados.nome), dados.nascimento, dados.rg_orgao, dados.rg_expedicao,
      this.cifrarCampo(pessoaId, 'nome_mae_cifrado', dados.nome_mae),
      this.cifrarCampo(pessoaId, 'nome_pai_cifrado', dados.nome_pai),
      this.cifrarCampo(pessoaId, 'pis_pasep_cifrado', dados.pis_pasep),
      this.cifrarCampo(pessoaId, 'rg_numero_cifrado', dados.rg_numero),
      this.cifrarCampo(pessoaId, 'titulo_eleitor_cifrado', dados.titulo_eleitor),
      this.cifrarCampo(pessoaId, 'endereco_cifrado', dados.endereco),
    ]);
    return true;
  }

  private async aplicar(
    cliente: PoolClient, origem: string, mapeado: unknown,
  ): Promise<{ inserido: boolean; atualizado: boolean }> {
    const validacao = servidorApiSincronizacaoSchema.safeParse(mapeado);
    if (!validacao.success) throw new ErroItem(this.motivoValidacao(validacao.error.issues));
    const dados = validacao.data;
    const cpfHash = this.protetor.hashCpf(dados.cpf);
    const hashPessoa = this.protetor.hashConteudo('sincronizacao', 'pessoa', [
      dados.cpf, dados.nome, dados.nascimento, dados.nome_mae, dados.nome_pai, dados.pis_pasep, dados.rg_numero,
      dados.rg_orgao, dados.rg_expedicao, dados.titulo_eleitor, dados.endereco,
    ]);
    let inserido = false;
    let mudou = false;
    let pessoaId: string;
    const vinculoOrigem = await cliente.query<{
      pessoa_id: string; hash_conteudo: Buffer | null; removido_na_fonte_em: Date | null; cpf_hash: Buffer;
    }>(`
      SELECT po.pessoa_id, po.hash_conteudo, po.removido_na_fonte_em, p.cpf_hash
      FROM nucleo.pessoa_origem po JOIN nucleo.pessoa p ON p.id = po.pessoa_id
      WHERE po.sistema_origem = $1 AND po.id_origem = $2
      FOR UPDATE OF po
    `, [origem, dados.id]);
    const existente = vinculoOrigem.rows[0];
    if (existente) {
      if (!existente.cpf_hash.equals(cpfHash)) {
        throw new ErroItem('O CPF informado diverge do servidor já associado a este identificador de origem; revise na fonte.');
      }
      pessoaId = existente.pessoa_id;
      if (!mesmoBuffer(existente.hash_conteudo, hashPessoa)) {
        mudou = await this.atualizarPessoa(cliente, pessoaId, dados) || mudou;
        await cliente.query(`
          UPDATE nucleo.pessoa_origem SET hash_conteudo = $3, sincronizado_em = now(), removido_na_fonte_em = NULL
          WHERE sistema_origem = $1 AND id_origem = $2
        `, [origem, dados.id, hashPessoa]);
        mudou = true;
      } else if (existente.removido_na_fonte_em) {
        await cliente.query(`
          UPDATE nucleo.pessoa_origem SET sincronizado_em = now(), removido_na_fonte_em = NULL
          WHERE sistema_origem = $1 AND id_origem = $2
        `, [origem, dados.id]);
        mudou = true;
      }
    } else {
      const porCpf = await cliente.query<{ id: string }>(
        'SELECT id FROM nucleo.pessoa WHERE cpf_hash = $1 FOR UPDATE', [cpfHash],
      );
      if (porCpf.rows[0]) {
        pessoaId = porCpf.rows[0].id;
        await this.atualizarPessoa(cliente, pessoaId, dados);
      } else {
        pessoaId = randomUUID();
        await cliente.query(`
          INSERT INTO nucleo.pessoa (
            id, cpf_cifrado, cpf_hash, nome, nome_busca, nascimento, nome_mae_cifrado, nome_pai_cifrado,
            pis_pasep_cifrado, rg_numero_cifrado, rg_orgao, rg_expedicao, titulo_eleitor_cifrado, endereco_cifrado
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `, [
          pessoaId, this.cifrarCampo(pessoaId, 'cpf_cifrado', dados.cpf), cpfHash, dados.nome,
          normalizarNomeBusca(dados.nome), dados.nascimento,
          this.cifrarCampo(pessoaId, 'nome_mae_cifrado', dados.nome_mae),
          this.cifrarCampo(pessoaId, 'nome_pai_cifrado', dados.nome_pai),
          this.cifrarCampo(pessoaId, 'pis_pasep_cifrado', dados.pis_pasep),
          this.cifrarCampo(pessoaId, 'rg_numero_cifrado', dados.rg_numero), dados.rg_orgao, dados.rg_expedicao,
          this.cifrarCampo(pessoaId, 'titulo_eleitor_cifrado', dados.titulo_eleitor),
          this.cifrarCampo(pessoaId, 'endereco_cifrado', dados.endereco),
        ]);
      }
      await cliente.query(`
        INSERT INTO nucleo.pessoa_origem (pessoa_id, sistema_origem, id_origem, hash_conteudo, sincronizado_em)
        VALUES ($1, $2, $3, $4, now())
      `, [pessoaId, origem, dados.id, hashPessoa]);
      inserido = true;
    }

    for (const vinculo of dados.vinculos) {
      const matriculaNorm = normalizarMatricula(vinculo.matricula);
      const campos = [
        vinculo.matricula, vinculo.regime_juridico, vinculo.cargo, vinculo.classe, vinculo.nivel, vinculo.referencia,
        vinculo.setor, vinculo.orgao_codigo, vinculo.orgao_nome, vinculo.admissao, vinculo.desligamento,
      ];
      const hashVinculo = this.protetor.hashConteudo('sincronizacao', 'vinculo', [vinculo.id, ...campos]);
      const atual = await cliente.query<{
        pessoa_id: string; matricula_norm: string; hash_conteudo: Buffer | null; removido_na_fonte_em: Date | null;
      }>(`
        SELECT pessoa_id, matricula_norm, hash_conteudo, removido_na_fonte_em FROM nucleo.vinculo
        WHERE sistema_origem = $1 AND id_origem = $2 FOR UPDATE
      `, [origem, vinculo.id]);
      const linha = atual.rows[0];
      if (!linha) {
        await cliente.query(`
          INSERT INTO nucleo.vinculo (
            pessoa_id, matricula, matricula_norm, sistema_origem, id_origem, regime_juridico, cargo, classe, nivel,
            referencia, setor, orgao_codigo, orgao_nome, admissao, desligamento, hash_conteudo, sincronizado_em
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now())
        `, [pessoaId, vinculo.matricula, matriculaNorm, origem, vinculo.id, ...campos.slice(1), hashVinculo]);
        mudou = true;
        continue;
      }
      if (linha.pessoa_id !== pessoaId) {
        throw new ErroItem('Um vínculo informado já pertence a outro servidor nesta origem; revise na fonte.');
      }
      if (linha.matricula_norm !== matriculaNorm) {
        throw new ErroItem('A matrícula de um vínculo existente mudou na fonte; a nova matrícula deve chegar como novo vínculo.');
      }
      if (!mesmoBuffer(linha.hash_conteudo, hashVinculo)) {
        await cliente.query(`
          UPDATE nucleo.vinculo SET matricula = $3, regime_juridico = $4, cargo = $5, classe = $6, nivel = $7,
            referencia = $8, setor = $9, orgao_codigo = $10, orgao_nome = $11, admissao = $12, desligamento = $13,
            hash_conteudo = $14, sincronizado_em = now(), removido_na_fonte_em = NULL
          WHERE sistema_origem = $1 AND id_origem = $2
        `, [origem, vinculo.id, ...campos, hashVinculo]);
        mudou = true;
      } else if (linha.removido_na_fonte_em) {
        await cliente.query(`
          UPDATE nucleo.vinculo SET sincronizado_em = now(), removido_na_fonte_em = NULL
          WHERE sistema_origem = $1 AND id_origem = $2
        `, [origem, vinculo.id]);
        mudou = true;
      }
    }
    return { inserido, atualizado: !inserido && mudou };
  }

  private async registrarErroLote(cliente: PoolClient | Pool, loteId: string, falha: ErroSincronizacao): Promise<void> {
    await cliente.query(`
      UPDATE nucleo.sincronizacao_lote SET erros_sanitizados = CASE WHEN jsonb_array_length(erros_sanitizados) < $2
        THEN erros_sanitizados || $3::jsonb ELSE erros_sanitizados END
      WHERE id = $1
    `, [loteId, MAXIMO_ERROS_LOTE, JSON.stringify([falha])]);
  }

  // Remoção lógica só depois de ler todas as páginas de uma carga completa; ausência em página incompleta nunca prova remoção.
  private async reconciliar(config: ConfiguracaoSincronizacao, loteId: string): Promise<void> {
    await transacao(this.banco, async (cliente) => {
      const servidoresVistos = new Set<string>();
      const servidoresInvalidos = new Set<string>();
      const vinculosVistos = new Set<string>();
      let semIdentificador = false;
      let ultimo: string | null = null;
      for (;;) {
        const lote: { rows: { id: string; id_origem: string; payload_cifrado: Buffer }[] } = await cliente.query(`
          SELECT id, id_origem, payload_cifrado FROM nucleo.staging_api
          WHERE lote_id = $1 AND ($2::uuid IS NULL OR id > $2::uuid) ORDER BY id LIMIT 500
        `, [loteId, ultimo]);
        if (lote.rows.length === 0) break;
        for (const linha of lote.rows) {
          ultimo = linha.id;
          if (linha.id_origem.startsWith('#')) {
            semIdentificador = true;
            continue;
          }
          servidoresVistos.add(linha.id_origem);
          let bruto: unknown = null;
          try {
            bruto = JSON.parse(this.protetor.decifrar(linha.payload_cifrado, {
              schema: 'nucleo', tabela: 'staging_api', registroId: linha.id, campo: 'payload_cifrado',
            }).toString('utf8'));
          } catch {
            bruto = null;
          }
          const valido = servidorApiSincronizacaoSchema.safeParse(this.mapear(config, bruto));
          if (!valido.success) {
            servidoresInvalidos.add(linha.id_origem);
            continue;
          }
          for (const vinculo of valido.data.vinculos) vinculosVistos.add(vinculo.id);
        }
      }
      if (semIdentificador) {
        await this.registrarErroLote(cliente, loteId, erro(
          'Remoção lógica não aplicada: a carga completa trouxe itens sem identificador válido.',
        ));
        return;
      }
      if (servidoresVistos.size === 0) {
        await this.registrarErroLote(cliente, loteId, erro(
          'Remoção lógica não aplicada: a carga completa não trouxe nenhum servidor.',
        ));
        return;
      }
      const origens = await cliente.query<{ id_origem: string; pessoa_id: string }>(`
        SELECT id_origem, pessoa_id FROM nucleo.pessoa_origem
        WHERE sistema_origem = $1 AND removido_na_fonte_em IS NULL
      `, [config.origem]);
      const pessoasProtegidas = new Set<string>();
      const todasOrigens = await cliente.query<{ id_origem: string; pessoa_id: string }>(`
        SELECT id_origem, pessoa_id FROM nucleo.pessoa_origem WHERE sistema_origem = $1 AND id_origem = ANY($2::text[])
      `, [config.origem, [...servidoresInvalidos]]);
      for (const linha of todasOrigens.rows) pessoasProtegidas.add(linha.pessoa_id);
      const vinculos = await cliente.query<{ id: string; id_origem: string; pessoa_id: string }>(`
        SELECT id, id_origem, pessoa_id FROM nucleo.vinculo WHERE sistema_origem = $1 AND removido_na_fonte_em IS NULL
      `, [config.origem]);
      const origensRemovidas = origens.rows.filter((linha) => !servidoresVistos.has(linha.id_origem))
        .map((linha) => linha.id_origem);
      const vinculosRemovidos = vinculos.rows
        .filter((linha) => !vinculosVistos.has(linha.id_origem) && !pessoasProtegidas.has(linha.pessoa_id))
        .map((linha) => linha.id);
      const total = origensRemovidas.length + vinculosRemovidos.length;
      const ativos = origens.rows.length + vinculos.rows.length;
      if (total > LIMITE_REMOCAO_ABSOLUTO && total > ativos * LIMITE_REMOCAO_PROPORCIONAL) {
        await this.registrarErroLote(cliente, loteId, erro(
          `Remoção lógica não aplicada: a carga indicaria ${total} registros ausentes, acima do limite de segurança; `
          + 'confirme a fonte e repita a carga completa.',
        ));
        return;
      }
      if (total === 0) return;
      await cliente.query(`
        UPDATE nucleo.pessoa_origem SET removido_na_fonte_em = now()
        WHERE sistema_origem = $1 AND id_origem = ANY($2::text[]) AND removido_na_fonte_em IS NULL
      `, [config.origem, origensRemovidas]);
      if (vinculosRemovidos.length > 0) {
        await cliente.query(`
          UPDATE nucleo.vinculo SET removido_na_fonte_em = now()
          WHERE id = ANY($1::uuid[]) AND removido_na_fonte_em IS NULL
        `, [vinculosRemovidos]);
      }
      await cliente.query('UPDATE nucleo.sincronizacao_lote SET removidos = removidos + $2 WHERE id = $1', [loteId, total]);
    });
  }

  private async concluir(config: ConfiguracaoSincronizacao, execucao: Execucao): Promise<void> {
    await transacao(this.banco, async (cliente) => {
      await cliente.query(`
        UPDATE nucleo.sincronizacao_lote SET status = 'concluido', concluido_em = now(), cursor = $2 WHERE id = $1
      `, [execucao.loteId, JSON.stringify(execucao.cursor)]);
      await cliente.query(`
        UPDATE nucleo.staging_api SET processado_em = now() WHERE lote_id = $1 AND processado_em IS NULL
      `, [execucao.loteId]);
      await cliente.query(`
        UPDATE nucleo.sincronizacao_estado SET falhas_consecutivas = 0, disjuntor_aberto_em = NULL,
          ultima_sincronizacao_em = now(), cursor_incremental = COALESCE($2, cursor_incremental), atualizado_em = now()
        WHERE origem = $1
      `, [config.origem, execucao.cursor.marco]);
      await cliente.query(`
        INSERT INTO seguranca.auditoria (acao, entidade, entidade_id, detalhes)
        VALUES ('sincronizacao_concluida', 'sincronizacao_lote', $1, $2::jsonb)
      `, [execucao.loteId, JSON.stringify({ tipo: execucao.tipo })]);
    });
    await this.expurgarStaging();
  }

  async expurgarStaging(): Promise<number> {
    const resultado = await this.banco.query(`
      DELETE FROM nucleo.staging_api s USING nucleo.sincronizacao_lote l
      WHERE l.id = s.lote_id AND l.status = 'concluido' AND s.processado_em IS NOT NULL
        AND s.recebido_em < now() - interval '30 days'
    `);
    return resultado.rowCount ?? 0;
  }

  private async falhar(config: ConfiguracaoSincronizacao, loteId: string, falha: unknown): Promise<void> {
    const interrompida = falha instanceof Interrompida;
    const motivo = interrompida
      ? 'Sincronização interrompida pelo encerramento do serviço; será retomada na próxima execução.'
      : falha instanceof ErroApiExterna ? falha.message : 'Falha interna ao processar a sincronização.';
    await transacao(this.banco, async (cliente) => {
      await cliente.query(`
        UPDATE nucleo.sincronizacao_lote SET status = 'falhou', concluido_em = now() WHERE id = $1
      `, [loteId]);
      await this.registrarErroLote(cliente, loteId, erro(motivo));
      if (!interrompida) {
        await cliente.query(`
          UPDATE nucleo.sincronizacao_estado SET falhas_consecutivas = falhas_consecutivas + 1,
            disjuntor_aberto_em = CASE WHEN falhas_consecutivas + 1 >= $2 THEN now() ELSE disjuntor_aberto_em END,
            atualizado_em = now()
          WHERE origem = $1
        `, [config.origem, LIMITE_FALHAS_DISJUNTOR]);
      }
      await cliente.query(`
        INSERT INTO seguranca.auditoria (acao, entidade, entidade_id, detalhes)
        VALUES ('sincronizacao_falhou', 'sincronizacao_lote', $1, $2::jsonb)
      `, [loteId, JSON.stringify({ interrompida })]);
    });
  }
}
