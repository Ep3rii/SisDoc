import { ServiceUnavailableException } from '@nestjs/common';
import { REGRAS_PLANILHA } from '@sisdoc/calculo';
import {
  resultadoCopiaEmitidoSchema,
  snapshotEmissaoDofSchema,
  type CodigoBlocoDof,
  type EmitirDof,
  type ResultadoCopiaEmitido,
  type SituacaoEmissao
} from '@sisdoc/contratos';
import { randomUUID } from 'node:crypto';
import { DatabaseError, type Pool, type PoolClient } from 'pg';
import { transacao } from '../banco';
import { calcularDofNaTransacao } from '../calculos/calculos';
import { dataEmSaoPaulo } from '../data';
import { VERSAO_BLOCO_VAZIO } from '../migracoes/blocos-dof';
import { TEMPLATES_OFICIAIS } from '@sisdoc/templates';
import { TEMPLATE_DOF_PROVISORIO } from '../migracoes/rascunho-dof';
import { auditarConsultaFuncional } from '../seguranca/auditoria-funcional';
import type { SessaoAutenticada } from '../seguranca/autenticacao';
import { papeisPermitidos } from '../seguranca/permissoes';
import { ProtetorDados } from '../seguranca/protecao-dados';
import { confirmarSessao } from '../seguranca/sessao-transacao';
import { ConsultasDof } from './consulta-dof';
import { entradaOrdenada, mudancas, tentarBloqueioFonte } from './contexto-dof';
import { consultarSituacaoEmissao, MENSAGEM_SEM_APROVACAO } from './emissoes';
import { EscritaDof } from './escrita-dof';
import { verificarPreconferenciaDof } from './preconferencia';
import { concluir, type Tentativa } from './resultado-transacao';

/** Emissão oficial e cópia DOF com conferência, aprovação e snapshot transacionais. */
export class EmissaoDofService {
  /** Reutiliza pool, protetor, consultas e escrita do domínio; cada operação mantém sua transação única. */
  constructor(private readonly banco: Pool, private readonly protetor: ProtetorDados,
    private readonly consulta: ConsultasDof, private readonly escrita: EscritaDof) {}

  /** Reconhece repetição oficial do mesmo documento/emitente e audita reutilização incompatível. */
  private async emissaoPorChave(
    cliente: PoolClient, sessao: SessaoAutenticada, ip: string, id: string, chave: string,
  ): Promise<Tentativa<SituacaoEmissao> | undefined> {
    const consulta = await cliente.query<{ id: string; documento_id: string; emitido_por: string; oficial: boolean }>(`
      SELECT e.id, e.documento_id, e.emitido_por,
        EXISTS (SELECT 1 FROM documentos.emissao_aprovacao a WHERE a.emissao_id = e.id) AS oficial
      FROM documentos.emissao e WHERE e.chave_idempotencia = $1
    `, [chave]);
    const existente = consulta.rows[0];
    if (!existente) return undefined;
    if (existente.documento_id !== id || existente.emitido_por !== sessao.usuario.id || !existente.oficial) {
      await auditarConsultaFuncional(cliente, sessao, 'emissao_dof_chave_reutilizada', 'documento', id, null, ip);
      return { falha: { tipo: 'conflito', mensagem: 'A chave de idempotência já foi usada em outra emissão. Reabra a DOF e tente novamente.' } };
    }
    await auditarConsultaFuncional(cliente, sessao, 'emissao_dof_repetida', 'emissao', existente.id, null, ip);
    return { valor: await consultarSituacaoEmissao(cliente, existente.id) };
  }

  /** Valida conferência e aprovação, reservando número, snapshot e job PDF atomicamente e sem duplicar emissão. */
  async emitir(
    sessao: SessaoAutenticada, ip: string, id: string, chave: string, dados: EmitirDof,
  ): Promise<SituacaoEmissao> {
    /** Executa tentativa transacional completa; repetição é restrita ao conflito da chave idempotente. */
    const executar = () => transacao<Tentativa<SituacaoEmissao>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('emitir'));
      const repetida = await this.emissaoPorChave(cliente, sessao, ip, id, chave);
      if (repetida) return repetida;
      const linha = await this.consulta.linha(cliente, id, sessao.usuario.id, 'alteracao', true, 'conferido');
      if (!linha) {
        // Uma requisição concorrente com a mesma chave pode ter concluído enquanto aguardávamos o bloqueio.
        const concorrente = await this.emissaoPorChave(cliente, sessao, ip, id, chave);
        if (concorrente) return concorrente;
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dof_nao_encontrada', 'documento', id, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'DOF conferida não encontrada para emissão.' } };
      }
      if (linha.revisao !== dados.revisao) {
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dof_revisao_invalida', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A revisão da DOF mudou. Reabra a lista de conferidos antes de emitir.' } };
      }
      if (!await tentarBloqueioFonte(cliente)) {
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dof_fonte_ocupada', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A fonte está sendo atualizada. Aguarde e tente emitir novamente.' } };
      }
      const atual = await this.consulta.linha(cliente, id, sessao.usuario.id, 'alteracao', true, 'conferido');
      if (!atual) throw new Error('DOF conferida não pôde ser recuperada durante a emissão.');
      const revisoes = await this.consulta.consultarRevisoesFonte(cliente, atual);
      if (!this.consulta.fonteCorresponde(atual, revisoes, dados.provaFonte)) {
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dof_fonte_alterada', 'documento', id, atual.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A fonte ou a revisão mudou desde a prévia. Reabra a prévia antes de emitir.' } };
      }
      const conferencia = await cliente.query<{
        revisao_pessoa: string; revisao_vinculo: string; conferido_por: string; conferente_nome: string;
      }>(`
        SELECT c.revisao_pessoa::text, c.revisao_vinculo::text, c.conferido_por, u.nome AS conferente_nome
        FROM documentos.conferencia_dof c JOIN seguranca.usuario u ON u.id = c.conferido_por
        WHERE c.documento_id = $1 AND c.revisao_documento = $2
      `, [id, atual.revisao]);
      const conferido = conferencia.rows[0];
      if (!conferido) throw new Error('DOF conferida sem registro correspondente.');
      if (conferido.revisao_pessoa !== revisoes.pessoa_revisao || conferido.revisao_vinculo !== revisoes.vinculo_revisao) {
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dof_fonte_alterada', 'documento', id, atual.pessoa_id, ip);
        return {
          falha: {
            tipo: 'conflito',
            mensagem: 'A pessoa ou o vínculo mudou na fonte após a conferência. Devolva a DOF para nova conferência.',
          },
        };
      }
      const rascunho = await this.consulta.apresentar(cliente, atual);
      const relatorio = await verificarPreconferenciaDof(cliente, sessao, ip, rascunho, atual.regra_atual, this.protetor);
      if (relatorio.bloqueios.length > 0 || !rascunho.processo || !atual.regra_atual) {
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dof_com_pendencias', 'documento', id, atual.pessoa_id, ip);
        const pendencias = relatorio.bloqueios.map((bloqueio) => bloqueio.mensagem).join(' ');
        return {
          falha: {
            tipo: 'conflito',
            mensagem: `Há pendências que impedem a emissão. Devolva a DOF para correção. ${pendencias}`.trim(),
          },
        };
      }
      const leitura = await this.consulta.lerFonte(cliente, atual, 'conferido');
      if ('erro' in leitura) {
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dof_fonte_invalida', 'documento', id, atual.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'Os dados da fonte não puderam ser validados. Solicite a verificação da fonte antes de emitir.' } };
      }
      const aprovacoes = await cliente.query<{
        id: string; aprovado_por: string; referencia_decisao: string; aprovado_em: Date;
        regra_id: string; regra_codigo: string; regra_versao: string; template_id: string; template_versao: string;
        autor_id: string; autor_nome: string;
      }>(`
        SELECT a.id, a.aprovado_por, a.referencia_decisao, a.aprovado_em,
          r.id AS regra_id, r.codigo AS regra_codigo, r.versao AS regra_versao,
          t.id AS template_id, t.versao AS template_versao, autor.id AS autor_id, autor.nome AS autor_nome
        FROM documentos.documento d
        JOIN documentos.regra_versao r ON r.id = d.regra_versao_id
        JOIN seguranca.usuario autor ON autor.id = d.criado_por
        JOIN documentos.template_versao t ON t.tipo = 'DOF' AND t.versao = $2
        JOIN documentos.aprovacao_modelo a ON a.tipo = 'DOF' AND a.regra_versao_id = r.id AND a.template_versao_id = t.id
        WHERE d.id = $1
      `, [id, TEMPLATES_OFICIAIS.DOF]);
      const aprovacao = aprovacoes.rows[0];
      if (!aprovacao) {
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dof_bloqueada_sem_aprovacao', 'documento', id, atual.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: MENSAGEM_SEM_APROVACAO } };
      }
      const tempo = await cliente.query<{ agora: Date }>('SELECT now() AS agora');
      const agora = tempo.rows[0].agora;
      const dataEmissao = dataEmSaoPaulo(agora);
      const ano = Number(dataEmissao.slice(0, 4));
      await cliente.query(`
        INSERT INTO documentos.numeracao (tipo, ano, sufixo) VALUES ('DOF', $1, 'P')
        ON CONFLICT (tipo, ano) DO NOTHING
      `, [ano]);
      const numeracao = await cliente.query<{ ultimo_numero: string; sufixo: string }>(`
        SELECT ultimo_numero::text, sufixo FROM documentos.numeracao WHERE tipo = 'DOF' AND ano = $1 FOR UPDATE
      `, [ano]);
      if (!numeracao.rows[0]) throw new Error('A numeração da DOF não pôde ser reservada.');
      const reservado = await cliente.query<{ ultimo_numero: string }>(`
        UPDATE documentos.numeracao SET ultimo_numero = ultimo_numero + 1
        WHERE tipo = 'DOF' AND ano = $1 RETURNING ultimo_numero::text
      `, [ano]);
      const numero = Number(reservado.rows[0].ultimo_numero);
      if (!Number.isSafeInteger(numero) || numero < 1) throw new Error('O número reservado para a DOF é inválido.');
      const numeroFormatado = `N° ${numero}${numeracao.rows[0].sufixo}/${ano}`;
      const emissaoId = randomUUID();
      const { documentoId: _documentoId, revisao: _revisao, provaFonte: _prova, ...fonte } = leitura.fonte;
      const snapshot = snapshotEmissaoDofSchema.parse({
        classificacao: 'emissao',
        tipo: 'DOF',
        documentoId: id,
        emissaoId,
        revisao: atual.revisao,
        numero,
        ano,
        numeroFormatado,
        emitidoEm: agora.toISOString(),
        dataEmissao,
        nome: rascunho.nome,
        matricula: rascunho.matricula,
        fonte,
        entrada: rascunho.entrada,
        resultado: rascunho.resultado,
        blocos: rascunho.blocos,
        processo: rascunho.processo,
        regra: { id: aprovacao.regra_id, codigo: aprovacao.regra_codigo, versao: aprovacao.regra_versao },
        template: { id: aprovacao.template_id, versao: aprovacao.template_versao },
        aprovacao: {
          id: aprovacao.id,
          aprovadoPor: aprovacao.aprovado_por,
          referenciaDecisao: aprovacao.referencia_decisao,
          aprovadoEm: aprovacao.aprovado_em.toISOString(),
        },
        assinaturas: {
          autor: { id: aprovacao.autor_id, nome: aprovacao.autor_nome },
          conferente: { id: conferido.conferido_por, nome: conferido.conferente_nome },
          emitente: { id: sessao.usuario.id, nome: sessao.usuario.nome },
        },
      });
      await cliente.query(`
        INSERT INTO documentos.emissao
          (id, documento_id, tipo, ano, numero, numero_formatado, chave_idempotencia, snapshot_cifrado, emitido_por)
        VALUES ($1, $2, 'DOF', $3, $4, $5, $6, $7, $8)
      `, [emissaoId, id, ano, numero, numeroFormatado, chave,
        this.protetor.cifrar(Buffer.from(JSON.stringify(snapshot), 'utf8'), {
          schema: 'documentos', tabela: 'emissao', registroId: emissaoId, campo: 'snapshot_cifrado',
        }), sessao.usuario.id]);
      await cliente.query(`
        INSERT INTO documentos.emissao_aprovacao (emissao_id, aprovacao_id, tipo) VALUES ($1, $2, 'DOF')
      `, [emissaoId, aprovacao.id]);
      await cliente.query(`
        INSERT INTO documentos.job_pdf (id, emissao_id, status) VALUES ($1, $2, 'pendente')
      `, [randomUUID(), emissaoId]);
      const atualizado = await cliente.query(`
        UPDATE documentos.documento SET status = 'emitido', atualizado_por = $2, atualizado_em = now()
        WHERE id = $1 AND status = 'conferido' AND revisao = $3
      `, [id, sessao.usuario.id, atual.revisao]);
      if (atualizado.rowCount !== 1) throw new Error('A transição para emitido não pôde ser registrada.');
      await auditarConsultaFuncional(cliente, sessao, 'dof_emitida', 'documento', id, atual.pessoa_id, ip);
      return { valor: await consultarSituacaoEmissao(cliente, emissaoId) };
    });
    try {
      return concluir(await executar());
    } catch (erro) {
      if (erro instanceof DatabaseError && erro.code === '23505' && erro.constraint === 'emissao_chave_idempotencia_key') {
        return concluir(await executar());
      }
      throw erro;
    }
  }

  /** Cria pedido autorizado a partir do snapshot oficial, recalculando pela fonte atual e usando novos UUIDs de blocos. */
  async copiar(sessao: SessaoAutenticada, ip: string, documentoId: string): Promise<ResultadoCopiaEmitido> {
    const tentativa = await transacao<Tentativa<ResultadoCopiaEmitido>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('criar_rascunho'));
      const origem = await cliente.query<{
        emissao_id: string; snapshot_cifrado: Buffer; criado_por: string; emitido_por: string; pessoa_id: string;
        admissao: string | null;
      }>(`
        SELECT e.id AS emissao_id, e.snapshot_cifrado, d.criado_por, e.emitido_por, d.pessoa_id,
          to_char(v.admissao, 'YYYY-MM-DD') AS admissao
        FROM documentos.documento d
        JOIN documentos.emissao e ON e.documento_id = d.id
        JOIN documentos.emissao_aprovacao a ON a.emissao_id = e.id
        JOIN nucleo.vinculo v ON v.id = d.vinculo_id AND v.pessoa_id = d.pessoa_id
        WHERE d.id = $1 AND d.tipo = 'DOF' AND d.status IN ('emitido', 'cancelado')
      `, [documentoId]);
      const linha = origem.rows[0];
      if (!linha || !(linha.criado_por === sessao.usuario.id || linha.emitido_por === sessao.usuario.id
          || sessao.usuario.papel === 'coordenador' || sessao.usuario.papel === 'admin')) {
        await auditarConsultaFuncional(cliente, sessao, 'copia_emissao_nao_encontrada', 'documento', documentoId, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'DOF emitida não encontrada para cópia.' } };
      }
      const snapshot = snapshotEmissaoDofSchema.parse(JSON.parse(this.protetor.decifrar(linha.snapshot_cifrado, {
        schema: 'documentos', tabela: 'emissao', registroId: linha.emissao_id, campo: 'snapshot_cifrado',
      }).toString('utf8')));
      if (snapshot.documentoId !== documentoId || snapshot.emissaoId !== linha.emissao_id) {
        throw new Error('O snapshot não pertence à emissão consultada.');
      }
      if (!await tentarBloqueioFonte(cliente)) {
        await auditarConsultaFuncional(cliente, sessao, 'copia_emissao_fonte_ocupada', 'documento', documentoId, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A fonte está sendo atualizada. Aguarde e tente copiar novamente.' } };
      }
      if (!linha.admissao) {
        return { falha: { tipo: 'conflito', mensagem: 'A admissão do vínculo não está informada na fonte. Solicite a correção antes de copiar.' } };
      }
      const entrada = entradaOrdenada(snapshot.entrada);
      const calculo = await calcularDofNaTransacao(cliente, sessao, ip, entrada, linha.admissao);
      if ('erro' in calculo) return { falha: { tipo: 'invalido', mensagem: calculo.erro } };
      if ('conflito' in calculo) return { falha: { tipo: 'conflito', mensagem: calculo.conflito } };
      const versoes = await cliente.query<{ template_id: string; regra_id: string }>(`
        SELECT t.id AS template_id, r.id AS regra_id
        FROM documentos.template_versao t CROSS JOIN documentos.regra_versao r
        WHERE t.tipo = 'DOF' AND t.versao = $1 AND r.codigo = $2 AND r.versao = $3
          AND r.configuracao = $4::jsonb
      `, [TEMPLATE_DOF_PROVISORIO, REGRAS_PLANILHA.codigo, REGRAS_PLANILHA.versao, JSON.stringify(REGRAS_PLANILHA)]);
      const versao = versoes.rows[0];
      if (!versao) throw new ServiceUnavailableException('As versões de cálculo e modelo não estão disponíveis.');
      const id = randomUUID();
      await cliente.query(`
        INSERT INTO documentos.documento (
          id, tipo, pessoa_id, vinculo_id, entrada_cifrada, resultado_calculo_cifrado,
          template_versao_id, regra_versao_id, substitui_id, criado_por, atualizado_por
        ) VALUES ($1, 'DOF', $2, $3, $4, $5, $6, $7, $8, $9, $9)
      `, [
        id, entrada.pessoaId, entrada.vinculoId, this.escrita.cifrar('documento', id, 'entrada_cifrada', entrada),
        this.escrita.cifrar('documento', id, 'resultado_calculo_cifrado', calculo.resultado),
        versao.template_id, versao.regra_id, documentoId, sessao.usuario.id,
      ]);
      await cliente.query(`
        INSERT INTO documentos.documento_periodo (id, documento_id, ordem, inicio, fim)
        VALUES ($1, $2, 1, $3, $4)
      `, [randomUUID(), id, entrada.inicio, entrada.fim]);
      const codigos = [...new Set(snapshot.blocos.map((bloco) => bloco.codigo))];
      const catalogo = await cliente.query<{ id: string; codigo: CodigoBlocoDof }>(`
        SELECT v.id, t.codigo FROM documentos.bloco_texto t
        JOIN documentos.bloco_versao v ON v.bloco_id = t.id
        WHERE t.ativo AND t.codigo = ANY($1::text[]) AND v.versao = $2
          AND t.tipos_documento @> ARRAY['DOF']::text[]
      `, [codigos, VERSAO_BLOCO_VAZIO]);
      if (catalogo.rows.length !== codigos.length) {
        throw new ServiceUnavailableException('As versões dos blocos não estão disponíveis para a cópia.');
      }
      const versoesBloco = new Map(catalogo.rows.map((item) => [item.codigo, item.id]));
      for (const [indice, bloco] of snapshot.blocos.entries()) {
        const blocoId = randomUUID();
        await cliente.query(`
          INSERT INTO documentos.documento_bloco (id, documento_id, bloco_versao_id, ordem, ativo, texto_final_cifrado)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [blocoId, id, versoesBloco.get(bloco.codigo), indice + 1, bloco.ativo,
          this.escrita.cifrar('documento_bloco', blocoId, 'texto_final_cifrado', bloco.texto)]);
      }
      await cliente.query(`
        UPDATE documentos.documento SET processo_cifrado = $1, atualizado_por = $2, atualizado_em = now(),
          revisao = revisao + 1 WHERE id = $3
      `, [this.escrita.cifrar('documento', id, 'processo_cifrado', snapshot.processo), sessao.usuario.id, id]);
      const motivo = `Cópia da emissão ${snapshot.numeroFormatado}.`;
      await this.escrita.registrarAjustes(cliente, id, sessao.usuario.id, motivo, [
        ...mudancas(null, entrada),
        { campo: 'processo', anterior: null, novo: snapshot.processo },
      ]);
      await auditarConsultaFuncional(cliente, sessao, 'rascunho_copiado_de_emissao', 'documento', id, entrada.pessoaId, ip);
      const criado = await this.consulta.linha(cliente, id, sessao.usuario.id);
      if (!criado) throw new Error('Rascunho copiado não pôde ser recuperado.');
      return {
        valor: resultadoCopiaEmitidoSchema.parse({ documentoId: id, revisao: criado.revisao, origemEmissaoId: linha.emissao_id }),
      };
    });
    return concluir(tentativa);
  }
}
