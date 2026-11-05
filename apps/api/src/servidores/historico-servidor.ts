import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseError, type Pool, type PoolClient } from 'pg';
import { registroHistoricoSchema, itemHistoricoServidorSchema, paginaHistoricoServidorSchema, resultadoHistoricoServidorSchema,
  alteracaoHistoricoSchema, revisoesHistoricoSchema, filtrarHistorico, somarValoresMonetarios,
  type ConsultaHistoricoServidor, type Configuracao, type RegistroHistorico } from '@sisdoc/contratos';
import { transacao } from '../banco';
import { ProtetorDados } from '../seguranca/protecao-dados';
import { confirmarSessao } from '../seguranca/sessao-transacao';
import { papeisPermitidos } from '../seguranca/permissoes';
import { auditarConsultaFuncional } from '../seguranca/auditoria-funcional';
import type { SessaoAutenticada } from '../seguranca/autenticacao';
import { escreverXlsx } from '../importacao/planilhas';

export type LinhaHistoricoServidor = { id: string; pessoa_id: string; vinculo_id: string; revisao: number; conteudo_cifrado: Buffer; atualizado_em: Date; lote_id: string | null; linha_origem: number | null };
type Linha = LinhaHistoricoServidor;
export class HistoricoServidorService {
  readonly protetor: ProtetorDados;
  constructor(readonly banco: Pool, config: Configuracao) { this.protetor = new ProtetorDados(config.chaves); }
  apresentar(linha: Linha) {
    const registro: unknown = JSON.parse(this.protetor.decifrar(linha.conteudo_cifrado, {
      schema: 'nucleo', tabela: 'historico_servidor', registroId: linha.id, campo: 'conteudo_cifrado',
    }).toString('utf8'));
    return itemHistoricoServidorSchema.parse({
      id: linha.id, pessoaId: linha.pessoa_id, vinculoId: linha.vinculo_id, revisao: linha.revisao,
      registro, atualizadoEm: linha.atualizado_em.toISOString(),
      loteId: linha.lote_id, linhaOrigem: linha.linha_origem,
    });
  }
  async vinculo(cliente: PoolClient, pessoaId: string, vinculoId: string, bloquear = false) {
    const resultado = await cliente.query(`SELECT id FROM nucleo.vinculo WHERE pessoa_id = $1 AND id = $2 ${bloquear ? 'FOR UPDATE' : ''}`, [pessoaId, vinculoId]);
    if (!resultado.rowCount) throw new NotFoundException('Vínculo não encontrado para esta pessoa.');
  }
  async listar(sessao: SessaoAutenticada, ip: string, pessoaId: string, filtros: ConsultaHistoricoServidor) {
    const { vinculoId, limite, cursor } = filtros;
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_pessoa'));
      await this.vinculo(cliente, pessoaId, vinculoId);
      const consulta = await cliente.query<Linha>(`SELECT * FROM nucleo.historico_servidor
        WHERE pessoa_id = $1 AND vinculo_id = $2 ORDER BY id`, [pessoaId, vinculoId]);
      const itens = consulta.rows.map((linha) => this.apresentar(linha)).filter((item) => filtrarHistorico(item.registro, filtros));
      const pagina = itens.filter((item) => !cursor || item.id > cursor).slice(0, limite + 1);
      const soma = (situacao: 'pago' | 'estornado', natureza: 'provento' | 'desconto') => somarValoresMonetarios(
        itens.flatMap(({ registro }) => registro.situacao === situacao && registro.natureza === natureza && registro.valor ? [registro.valor] : []));
      await auditarConsultaFuncional(cliente, sessao, 'historico_servidor_consultado', 'vinculo', vinculoId, pessoaId, ip);
      return paginaHistoricoServidorSchema.parse({
        itens: pagina.slice(0, limite),
        proximoCursor: pagina.length > limite ? pagina[limite - 1].id : null,
        totais: { registros: itens.length, proventosPagos: soma('pago', 'provento'), descontosPagos: soma('pago', 'desconto'),
          proventosEstornados: soma('estornado', 'provento'), descontosEstornados: soma('estornado', 'desconto') },
      });
    });
  }
  async exportar(sessao: SessaoAutenticada, ip: string, pessoaId: string, vinculoId: string) {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('administrar_importacao'));
      await this.vinculo(cliente, pessoaId, vinculoId);
      const resultado = await cliente.query<Linha>('SELECT * FROM nucleo.historico_servidor WHERE pessoa_id = $1 AND vinculo_id = $2 ORDER BY id LIMIT 10001', [pessoaId, vinculoId]);
      if (resultado.rows.length > 10000) throw new UnprocessableEntityException('A exportação está limitada a 10 mil registros por vínculo.');
      const campos = Object.keys(registroHistoricoSchema.shape) as Array<keyof RegistroHistorico>;
      const linhas = resultado.rows.map((linha) => {
        const item = this.apresentar(linha);
        return [item.id, String(item.revisao), item.loteId ?? '', String(item.linhaOrigem ?? ''), ...campos.map((campo) => String(item.registro[campo] ?? ''))];
      });
      await auditarConsultaFuncional(cliente, sessao, 'historico_servidor_exportado', 'vinculo', vinculoId, pessoaId, ip);
      return escreverXlsx([['registroId', 'revisao', 'loteId', 'linhaOrigem', ...campos], ...linhas], 'Historico');
    });
  }
  async revisoes(sessao: SessaoAutenticada, ip: string, pessoaId: string, id: string, limite: number, cursor?: string) {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_pessoa'));
      const atual = await cliente.query('SELECT id FROM nucleo.historico_servidor WHERE id = $1 AND pessoa_id = $2', [id, pessoaId]);
      if (!atual.rowCount) throw new NotFoundException('Registro histórico não encontrado.');
      const resultado = await cliente.query<{ id: string; em: Date; autor: string; conteudo_cifrado: Buffer }>(`
        SELECT r.id,r.em,u.nome AS autor,r.conteudo_cifrado FROM nucleo.historico_servidor_revisao r
        JOIN seguranca.usuario u ON u.id = r.usuario_id WHERE r.historico_id = $1
        AND ($2::uuid IS NULL OR (r.em,r.id) < (SELECT em,id FROM nucleo.historico_servidor_revisao WHERE id = $2 AND historico_id = $1))
        ORDER BY r.em DESC,r.id DESC LIMIT $3`, [id, cursor ?? null, limite + 1]);
      await auditarConsultaFuncional(cliente, sessao, 'historico_servidor_revisoes_consultadas', 'historico_servidor', id, pessoaId, ip);
      return revisoesHistoricoSchema.parse({
        itens: resultado.rows.slice(0, limite).map((linha) => ({
          id: linha.id, em: linha.em.toISOString(), autor: linha.autor,
          alteracao: alteracaoHistoricoSchema.parse(JSON.parse(this.protetor.decifrar(linha.conteudo_cifrado, {
            schema: 'nucleo', tabela: 'historico_servidor_revisao', registroId: linha.id, campo: 'conteudo_cifrado',
          }).toString('utf8'))),
        })),
        proximoCursor: resultado.rows.length > limite ? resultado.rows[limite - 1].id : null,
      });
    });
  }
  async gravar(cliente: PoolClient, sessao: SessaoAutenticada, ip: string, pessoaId: string, vinculoId: string,
    registro: RegistroHistorico, motivo: string, id?: string, revisao?: number, loteId?: string, linhaOrigem?: number) {
    let anterior: ReturnType<typeof itemHistoricoServidorSchema.parse> | null = null;
    if (id) {
      const consulta = await cliente.query<Linha>('SELECT * FROM nucleo.historico_servidor WHERE id = $1 AND pessoa_id = $2 AND vinculo_id = $3 FOR UPDATE', [id, pessoaId, vinculoId]);
      if (!consulta.rows[0]) throw new NotFoundException('Registro histórico não encontrado.');
      anterior = this.apresentar(consulta.rows[0]);
      if (anterior.revisao !== revisao || anterior.revisao >= 2147483646) throw new ConflictException('O histórico foi alterado. Reabra o registro antes de salvar.');
      if (anterior.registro.grupo !== registro.grupo) throw new BadRequestException('O grupo do registro não pode ser alterado.');
    } else if (revisao !== undefined) throw new BadRequestException('Um registro novo não possui revisão anterior.');
    await this.validarRelacoes(cliente, vinculoId, registro, id);
    const avisos: string[] = [];
    const { inicio, fim } = registro;
    if (registro.grupo === 'funcional' && inicio && fim && registro.situacao !== 'cancelado') {
      const existentes = await cliente.query<Linha>('SELECT * FROM nucleo.historico_servidor WHERE vinculo_id = $1 AND grupo = $2', [vinculoId, 'funcional']);
      if (existentes.rows.some((linha) => {
        const outro = this.apresentar(linha).registro;
        return linha.id !== id && outro.situacao !== 'cancelado' && outro.inicio && outro.fim && outro.inicio <= fim && outro.fim >= inicio;
      })) avisos.push('Há intervalos funcionais sobrepostos. Confira os fatos; nenhum dia foi contabilizado automaticamente.');
    }
    return this.persistir(cliente, sessao, ip, pessoaId, vinculoId, registro, motivo, anterior, avisos, id, loteId, linhaOrigem);
  }
  async validarRelacoes(cliente: PoolClient, vinculoId: string, registro: RegistroHistorico, id?: string) {
    if (id) {
      const candidatos = await cliente.query<Linha>('SELECT * FROM nucleo.historico_servidor WHERE vinculo_id = $1 AND grupo = $2', [vinculoId, 'financeiro']);
      const estornos = candidatos.rows.map((linha) => this.apresentar(linha).registro)
        .filter((outro) => outro.situacao === 'estornado' && outro.relacionadoId === id);
      if (estornos.some((outro) => registro.grupo !== 'financeiro' || registro.situacao !== 'pago'
          || registro.valor !== outro.valor || registro.natureza !== outro.natureza)) {
        throw new ConflictException('Pagamento com estorno não pode mudar de situação, valor ou natureza. Registre a correção separadamente.');
      }
    }
    if (registro.eventoId) {
      const evento = await cliente.query('SELECT id FROM nucleo.evento_funcional WHERE id = $1 AND vinculo_id = $2', [registro.eventoId, vinculoId]);
      if (!evento.rowCount) throw new UnprocessableEntityException('O evento relacionado não pertence a este vínculo.');
    }
    if (registro.relacionadoId) {
      const relacionado = await cliente.query<Linha>('SELECT * FROM nucleo.historico_servidor WHERE id = $1 AND vinculo_id = $2', [registro.relacionadoId, vinculoId]);
      if (!relacionado.rows[0] || registro.relacionadoId === id) throw new UnprocessableEntityException('Selecione outro registro histórico do mesmo vínculo.');
      const origem = this.apresentar(relacionado.rows[0]);
      if (registro.situacao === 'estornado' && (origem.registro.grupo !== 'financeiro' || origem.registro.situacao !== 'pago'
          || registro.valor !== origem.registro.valor || registro.natureza !== origem.registro.natureza)) {
        throw new UnprocessableEntityException('Estorno exige pagamento relacionado com mesmo valor e natureza.');
      }
      if (registro.situacao === 'estornado') {
        const candidatos = await cliente.query<Linha>('SELECT * FROM nucleo.historico_servidor WHERE vinculo_id = $1 AND grupo = $2', [vinculoId, 'financeiro']);
        if (candidatos.rows.some((linha) => linha.id !== id && this.apresentar(linha).registro.relacionadoId === registro.relacionadoId
            && this.apresentar(linha).registro.situacao === 'estornado')) throw new ConflictException('Este pagamento já possui estorno registrado.');
      }
    }
  }
  private async persistir(cliente: PoolClient, sessao: SessaoAutenticada, ip: string, pessoaId: string, vinculoId: string,
    registro: RegistroHistorico, motivo: string, anterior: ReturnType<typeof itemHistoricoServidorSchema.parse> | null,
    avisos: string[], id?: string, loteId?: string, linhaOrigem?: number) {
    const registroId = id ?? randomUUID();
    const cifrado = this.protetor.cifrar(Buffer.from(JSON.stringify(registro)), {
      schema: 'nucleo', tabela: 'historico_servidor', registroId, campo: 'conteudo_cifrado',
    });
    try {
      if (anterior) {
        await cliente.query(`UPDATE nucleo.historico_servidor SET conteudo_cifrado = $2, origem = $3, id_origem = $4,
          atualizado_por = $5, atualizado_em = now(), revisao = revisao + 1 WHERE id = $1`,
        [registroId, cifrado, registro.origem, registro.idOrigem, sessao.usuario.id]);
      } else {
        await cliente.query(`INSERT INTO nucleo.historico_servidor (id,pessoa_id,vinculo_id,grupo,origem,id_origem,revisao,conteudo_cifrado,criado_por,atualizado_por,lote_id,linha_origem)
          VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$8,$9,$10)`, [registroId, pessoaId, vinculoId, registro.grupo, registro.origem, registro.idOrigem, cifrado, sessao.usuario.id, loteId ?? null, linhaOrigem ?? null]);
      }
    } catch (erro) {
      if (erro instanceof DatabaseError && erro.code === '23505') throw new ConflictException('Já existe registro com esta origem e identificador neste vínculo.');
      throw erro;
    }
    const auditoriaId = randomUUID();
    await cliente.query('INSERT INTO nucleo.historico_servidor_revisao (id,historico_id,usuario_id,conteudo_cifrado) VALUES ($1,$2,$3,$4)', [
      auditoriaId, registroId, sessao.usuario.id,
      this.protetor.cifrar(Buffer.from(JSON.stringify({ anterior: anterior?.registro ?? null, novo: registro, motivo })), {
        schema: 'nucleo', tabela: 'historico_servidor_revisao', registroId: auditoriaId, campo: 'conteudo_cifrado',
      }),
    ]);
    await auditarConsultaFuncional(cliente, sessao, anterior ? 'historico_servidor_editado' : 'historico_servidor_criado', 'historico_servidor', registroId, pessoaId, ip);
    const atualizado = await cliente.query<Linha>('SELECT * FROM nucleo.historico_servidor WHERE id = $1', [registroId]);
    return resultadoHistoricoServidorSchema.parse({ item: this.apresentar(atualizado.rows[0]), avisos });
  }
  async salvar(sessao: SessaoAutenticada, ip: string, pessoaId: string, dados: {
    vinculoId: string; registro: RegistroHistorico; motivo: string; revisao?: number;
  }, id?: string) {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('editar_servidor'));
      await this.vinculo(cliente, pessoaId, dados.vinculoId, true);
      return this.gravar(cliente, sessao, ip, pessoaId, dados.vinculoId, registroHistoricoSchema.parse(dados.registro), dados.motivo, id, dados.revisao);
    });
  }
}
