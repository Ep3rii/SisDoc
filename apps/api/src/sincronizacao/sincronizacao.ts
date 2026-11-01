import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  erroSincronizacaoSchema,
  loteSincronizacaoSchema,
  servidorApiSincronizacaoSchema,
  type Configuracao,
  type ConfiguracaoSincronizacao,
  type ErroSincronizacao,
  type LoteSincronizacao,
  type PaginaSincronizacoes,
  type SituacaoSincronizacao
} from '@sisdoc/contratos';
import { randomUUID } from 'node:crypto';
import { DatabaseError, type Pool, type PoolClient } from 'pg';
import { z } from 'zod';
import { transacao } from '../banco';
import type { SessaoAutenticada } from '../seguranca/autenticacao';
import { papeisPermitidos } from '../seguranca/permissoes';
import { ProtetorDados } from '../seguranca/protecao-dados';
import { confirmarSessao } from '../seguranca/sessao-transacao';
import { ClienteApiSincronizacao, ErroApiExterna, type OpcoesClienteApi } from './cliente-api';
import { idDoItem, mapearItem } from './mapeamento-sincronizacao';
import { ErroItem, PersistenciaSincronizacao } from './persistencia-sincronizacao';

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
class Interrompida extends Error {}

const errosLoteSchema = z.array(erroSincronizacaoSchema);

/** Limita mensagem já sanitizada do lote sem incluir dados da pessoa ou payload da API. */
function erro(motivo: string, posicao: number | null = null, referencia: string | null = null): ErroSincronizacao {
  return { posicao, referencia, motivo: motivo.slice(0, 300) };
}

@Injectable()
export class SincronizacaoService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Sincronizacao');
  private readonly protetor: ProtetorDados;
  private readonly persistencia: PersistenciaSincronizacao;
  private readonly sincronizacao: ConfiguracaoSincronizacao | undefined;
  private execucao: Promise<void> | null = null;
  private encerrando = false;
  private temporizador: NodeJS.Timeout | null = null;
  opcoesCliente: OpcoesClienteApi = {};

  /** Compõe mapeamento/persistência com o mesmo protetor e mantém integração externa opcional. */
  constructor(private readonly banco: Pool, configuracao: Configuracao) {
    this.protetor = new ProtetorDados(configuracao.chaves);
    this.persistencia = new PersistenciaSincronizacao(this.protetor);
    this.sincronizacao = configuracao.sincronizacao;
  }

  /** Agenda incremental somente quando configurado e não desabilitado operacionalmente. */
  onApplicationBootstrap(): void {
    const intervalo = this.sincronizacao?.intervaloMinutos;
    if (!intervalo || process.env.SISDOC_SINCRONIZACAO_AGENDADA === 'desligado') return;
    this.temporizador = setInterval(() => {
      void this.executarAgendada();
    }, intervalo * 60000);
    this.temporizador.unref();
  }

  /** Suspende o agendamento e aguarda o lote antes que a infraestrutura feche o pool. */
  async onModuleDestroy(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
    this.encerrando = true;
    await this.aguardarExecucao();
  }

  /** Permite encerramento e testes aguardarem a execução corrente sem iniciar nova carga. */
  async aguardarExecucao(): Promise<void> {
    if (this.execucao) await this.execucao;
  }

  /** Produz referência técnica HMAC truncada sem exibir identificador pessoal no relatório de erros. */
  private referencia(idOrigem: string): string {
    return this.protetor.hashConteudo('sincronizacao', 'referencia', idOrigem).subarray(0, 8).toString('hex');
  }

  /** Calcula atraso e disjuntor sem bloquear trabalho local quando a integração estiver ausente. */
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

  /** Determina a janela restante de suspensão pela configuração, sem alterar contadores persistidos. */
  private disjuntorAbertoAte(estado: LinhaEstado | undefined): Date | null {
    if (!this.sincronizacao || !estado?.disjuntor_aberto_em) return null;
    const ate = new Date(estado.disjuntor_aberto_em.getTime() + this.sincronizacao.pausaDisjuntorMinutos * 60000);
    return ate.getTime() > Date.now() ? ate : null;
  }

  /** Consulta cursor e indicadores somente da origem configurada na transação chamadora. */
  private async lerEstado(cliente: PoolClient, origem: string): Promise<LinhaEstado | undefined> {
    const resultado = await cliente.query<LinhaEstado>(`
      SELECT falhas_consecutivas, disjuntor_aberto_em, ultima_sincronizacao_em, cursor_incremental
      FROM nucleo.sincronizacao_estado WHERE origem = $1
    `, [origem]);
    return resultado.rows[0];
  }

  /** Confirma sessão antes de apresentar situação da integração, sem fazer consulta à API externa. */
  async situacao(sessao: SessaoAutenticada): Promise<SituacaoSincronizacao> {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_situacao_sincronizacao'));
      const estado = this.sincronizacao ? await this.lerEstado(cliente, this.sincronizacao.origem) : undefined;
      return this.montarSituacao(estado);
    });
  }

  /** Valida erros persistidos e sinaliza registro ilegível, limitando a lista apresentada. */
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

  /** Pagina lotes autorizados por data/UUID e audita consulta sem expor payloads de staging. */
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

  /** Solicita preparação manual autenticada; executar a carga não faz parte da requisição HTTP. */
  async iniciar(sessao: SessaoAutenticada, ip: string, tipo: TipoExecucao): Promise<LoteSincronizacao> {
    return this.preparar(tipo, { sessao, ip });
  }

  /** Tenta incremental em janela livre e comunica recusa esperada ou falha técnica sem encerrar o serviço. */
  private async executarAgendada(): Promise<void> {
    if (this.execucao || this.encerrando) return;
    try {
      await this.preparar('incremental', null);
    } catch (falha) {
      if (falha instanceof ConflictException) {
        this.logger.warn('Sincronização agendada recusada; verifique disjuntor, carga inicial e concorrência.');
      } else {
        this.logger.error('Falha técnica ao preparar sincronização agendada; consulte a infraestrutura.');
      }
    }
  }

  /** Reserva lock de sessão por origem, registra início/retomada e libera a conexão após terminar a carga. */
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
        /** Registra preparação ou recusa no mesmo cliente, identificando se a operação foi agendada. */
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
            try { return JSON.parse(ultimo.cursor); } catch {
              this.logger.warn('Cursor persistido ilegível; o lote anterior não será retomado.');
              return null;
            }
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
          this.logger.error('Falha ao liberar lock da sincronização; conexão descartada.');
        }
        this.execucao = null;
      });
      return resultado.lote;
    } finally {
      if (liberar) {
        let erroLiberacao: Error | undefined;
        try {
          await conexao.query('SELECT pg_advisory_unlock_all()');
        } catch {
          erroLiberacao = new Error('Falha ao liberar locks da sincronização.');
          this.logger.error('Falha ao limpar locks após preparação; conexão descartada.');
        }
        conexao.release(erroLiberacao);
      }
    }
  }

  /** Salva ponto de retomada apenas depois de processar os itens da página. */
  private async salvarCursor(execucao: Execucao): Promise<void> {
    await this.banco.query('UPDATE nucleo.sincronizacao_lote SET cursor = $2 WHERE id = $1', [
      execucao.loteId, JSON.stringify(execucao.cursor),
    ]);
  }

  /** Processa páginas limitadas, respeita encerramento e registra falhas sem afetar operações locais. */
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
      try {
        await this.falhar(config, execucao.loteId, falha);
      } catch {
        this.logger.error('A sincronização falhou e seu estado não pôde ser registrado; confira os lotes e a infraestrutura.');
      }
    }
  }

  /** Guarda staging cifrado e isola o item por savepoint, preservando erro sanitizado e contagens do lote. */
  private async processarItem(config: ConfiguracaoSincronizacao, execucao: Execucao, bruto: unknown): Promise<void> {
    const posicao = execucao.lidos;
    const mapeado = mapearItem(config, bruto);
    const idOrigem = idDoItem(mapeado);
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
        resultado = await this.persistencia.aplicar(cliente, config.origem, mapeado);
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

  /** Anexa erro sanitizado sem exceder o limite persistido de ocorrências. */
  private async registrarErroLote(cliente: PoolClient | Pool, loteId: string, falha: ErroSincronizacao): Promise<void> {
    await cliente.query(`
      UPDATE nucleo.sincronizacao_lote SET erros_sanitizados = CASE WHEN jsonb_array_length(erros_sanitizados) < $2
        THEN erros_sanitizados || $3::jsonb ELSE erros_sanitizados END
      WHERE id = $1
    `, [loteId, MAXIMO_ERROS_LOTE, JSON.stringify([falha])]);
  }

  /** Reconcilia somente carga completa; protege itens inválidos e recusa remoções acima dos limites de segurança. */
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
            this.logger.error('Payload de staging inválido; referências desse servidor serão protegidas na reconciliação.');
            bruto = null;
          }
          const valido = servidorApiSincronizacaoSchema.safeParse(mapearItem(config, bruto));
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

  /** Confirma lote e cursor incremental, reseta disjuntor e expurga somente staging antigo concluído. */
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

  /** Remove payloads processados de lotes concluídos há mais de 30 dias, mantendo lotes retomáveis. */
  async expurgarStaging(): Promise<number> {
    const resultado = await this.banco.query(`
      DELETE FROM nucleo.staging_api s USING nucleo.sincronizacao_lote l
      WHERE l.id = s.lote_id AND l.status = 'concluido' AND s.processado_em IS NOT NULL
        AND s.recebido_em < now() - interval '30 days'
    `);
    return resultado.rowCount ?? 0;
  }

  /** Registra falha sanitizada e incrementa disjuntor, exceto no encerramento controlado do serviço. */
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
