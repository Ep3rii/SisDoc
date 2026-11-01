import { nivelDof, REGRAS_PLANILHA } from '@sisdoc/calculo';
import {
  blocoRascunhoDofSchema,
  dadosFontePreviaDofSchema,
  numeroProcessoSchema,
  rascunhoDofSchema,
  resultadoCalculoDofSchema,
  solicitarCalculoDofSchema,
  type BlocoRascunhoDof,
  type DadosFontePreviaDof,
  type RascunhoDof
} from '@sisdoc/contratos';
import { timingSafeEqual } from 'node:crypto';
import { type PoolClient } from 'pg';
import { ProtetorDados } from '../seguranca/protecao-dados';
import { confirmacaoInicioProtegidaSchema, type LinhaEncaminhamento, type LinhaRascunho, type RevisoesFonte } from './contexto-dof';
import { lerCpfDof, lerNomeMaeDof } from './identidade-fonte-dof';

/** Consultas e validação da revisão/fonte DOF com o cliente e os locks da operação chamadora. */
export class ConsultasDof {
  /** Compartilha protetor e máscaras; todos os métodos recebem o cliente da transação chamadora. */
  constructor(private readonly protetor: ProtetorDados, private readonly mascarasProcesso: string[]) {}

  /** Decifra JSON com contexto de tabela, UUID e campo; corrupção ou JSON inválido não viram valores vazios. */
  ler(tabela: string, id: string, campo: string, valor: Buffer): unknown {
    return JSON.parse(this.protetor.decifrar(valor, {
      schema: 'documentos', tabela, registroId: id, campo,
    }).toString('utf8'));
  }

  /** Vincula prova HMAC à revisão do documento, da pessoa e do vínculo selecionado. */
  private assinarFonte(linha: LinhaRascunho, revisoes: RevisoesFonte): Buffer {
    return this.protetor.assinarRevisaoFonteDof({
      documentoId: linha.id,
      documentoRevisao: linha.revisao,
      pessoaId: linha.pessoa_id,
      pessoaRevisao: revisoes.pessoa_revisao,
      vinculoId: linha.vinculo_id,
      vinculoRevisao: revisoes.vinculo_revisao,
    });
  }

  /** Consulta revisões com o cliente da transação existente; ausência de pessoa/vínculo é inconsistência. */
  async consultarRevisoesFonte(cliente: PoolClient, linha: LinhaRascunho): Promise<RevisoesFonte> {
    const consulta = await cliente.query<RevisoesFonte>(`
      SELECT p.revisao_fonte::text AS pessoa_revisao, v.revisao_fonte::text AS vinculo_revisao
      FROM nucleo.pessoa p JOIN nucleo.vinculo v ON v.pessoa_id = p.id
      WHERE p.id = $1 AND v.id = $2
    `, [linha.pessoa_id, linha.vinculo_id]);
    if (!consulta.rows[0]) throw new Error('Pessoa ou vínculo da verificação deixou de existir.');
    return consulta.rows[0];
  }

  /** Compara a prova da prévia em tempo constante após conferir o comprimento. */
  fonteCorresponde(linha: LinhaRascunho, revisoes: RevisoesFonte, prova: string): boolean {
    const recebida = Buffer.from(prova, 'hex');
    const esperada = this.assinarFonte(linha, revisoes);
    return recebida.length === esperada.length && timingSafeEqual(recebida, esperada);
  }

  /** Lê blocos ordenados e exige texto cifrado e ordem consecutiva antes de apresentar. */
  private async blocos(cliente: PoolClient, documentoId: string): Promise<BlocoRascunhoDof[]> {
    const consulta = await cliente.query<{
      id: string; codigo: string; ordem: number; ativo: boolean; texto_final_cifrado: Buffer | null;
    }>(`
      SELECT b.id, t.codigo, b.ordem, b.ativo, b.texto_final_cifrado
      FROM documentos.documento_bloco b
      JOIN documentos.bloco_versao v ON v.id = b.bloco_versao_id
      JOIN documentos.bloco_texto t ON t.id = v.bloco_id
      WHERE b.documento_id = $1 ORDER BY b.ordem
    `, [documentoId]);
    return consulta.rows.map((linha, indice) => {
      if (linha.ordem !== indice + 1 || !linha.texto_final_cifrado) {
        throw new Error('Conteúdo ou ordem dos blocos do rascunho é inconsistente.');
      }
      return blocoRascunhoDofSchema.parse({
        id: linha.id, codigo: linha.codigo, ativo: linha.ativo,
        texto: this.ler('documento_bloco', linha.id, 'texto_final_cifrado', linha.texto_final_cifrado),
      });
    });
  }

  /** Lê encaminhamento ativo e indica se o destinatário continua coordenador ativo. */
  async encaminhamento(cliente: PoolClient, documentoId: string): Promise<LinhaEncaminhamento | undefined> {
    const consulta = await cliente.query<LinhaEncaminhamento>(`
      SELECT e.id, e.destinatario_id, u.nome AS destinatario_nome,
        (u.ativo AND u.papel = 'coordenador') AS destinatario_disponivel, e.encaminhado_em
      FROM documentos.encaminhamento_dof e
      JOIN seguranca.usuario u ON u.id = e.destinatario_id
      WHERE e.documento_id = $1 AND e.recolhido_em IS NULL
    `, [documentoId]);
    return consulta.rows[0];
  }

  /** Valida identidade, regra, período e confirmação de início antes de montar a revisão salva. */
  async apresentar(cliente: PoolClient, linha: LinhaRascunho): Promise<RascunhoDof> {
    if (!linha.resultado_calculo_cifrado) throw new Error('Rascunho sem resultado de cálculo protegido.');
    const entrada = solicitarCalculoDofSchema.parse(this.ler('documento', linha.id, 'entrada_cifrada', linha.entrada_cifrada));
    if (entrada.pessoaId !== linha.pessoa_id || entrada.vinculoId !== linha.vinculo_id) {
      throw new Error('Identidade do rascunho é inconsistente.');
    }
    const resultado = resultadoCalculoDofSchema.parse(
      this.ler('documento', linha.id, 'resultado_calculo_cifrado', linha.resultado_calculo_cifrado),
    );
    if (resultado.regra.codigo !== linha.regra_codigo || resultado.regra.versao !== linha.regra_versao) {
      throw new Error('Versão de regra do rascunho é inconsistente.');
    }
    const inicioEfetivo = entrada.inicio < resultado.admissaoConsiderada ? resultado.admissaoConsiderada : entrada.inicio;
    if (resultado.periodo.inicioInformado !== entrada.inicio || resultado.periodo.inicioEfetivo !== inicioEfetivo
        || resultado.periodo.fim !== entrada.fim) {
      throw new Error('Período calculado do rascunho é inconsistente.');
    }
    const confirmacaoInicio = linha.confirmacao_inicio_cifrada
      ? confirmacaoInicioProtegidaSchema.parse(
        this.ler('documento', linha.id, 'confirmacao_inicio_cifrada', linha.confirmacao_inicio_cifrada),
      ) : null;
    if (confirmacaoInicio && confirmacaoInicio.confirmadoPor !== linha.criado_por
        && confirmacaoInicio.perfilConfirmante !== 'admin') {
      throw new Error('Autor da confirmação do início é inconsistente.');
    }
    const encaminhamento = await this.encaminhamento(cliente, linha.id);
    return rascunhoDofSchema.parse({
      id: linha.id,
      pessoaId: linha.pessoa_id,
      vinculoId: linha.vinculo_id,
      nome: linha.nome,
      matricula: linha.matricula,
      admissao: linha.admissao,
      revisao: linha.revisao,
      criadoEm: linha.criado_em.toISOString(),
      atualizadoEm: linha.atualizado_em.toISOString(),
      status: 'rascunho',
      entrada,
      resultado,
      inicioAjustadoConfirmado: Boolean(confirmacaoInicio
        && entrada.inicio < resultado.admissaoConsiderada
        && confirmacaoInicio.inicio === entrada.inicio
        && confirmacaoInicio.admissao === resultado.admissaoConsiderada
        && linha.admissao === confirmacaoInicio.admissao),
      blocos: await this.blocos(cliente, linha.id),
      processo: linha.processo_cifrado
        ? numeroProcessoSchema.parse(this.ler('documento', linha.id, 'processo_cifrado', linha.processo_cifrado)) : null,
      mascarasProcesso: this.mascarasProcesso,
      encaminhamento: encaminhamento ? {
        destinatarioId: encaminhamento.destinatario_id,
        destinatarioNome: encaminhamento.destinatario_nome,
        destinatarioDisponivel: encaminhamento.destinatario_disponivel,
        encaminhadoEm: encaminhamento.encaminhado_em.toISOString(),
      } : null,
    });
  }

  /** Consulta DOF acessível e revalida acesso de terceiros depois do lock para impedir uso de encaminhamento recolhido. */
  async linha(
    cliente: PoolClient,
    id: string,
    autorId: string,
    bloquear?: 'leitura' | 'alteracao',
    permitirEncaminhado = false,
    estado: 'rascunho' | 'conferido' = 'rascunho',
  ): Promise<LinhaRascunho | undefined> {
    if (permitirEncaminhado && !bloquear) {
      throw new Error('Acesso a encaminhamento requer bloqueio do rascunho.');
    }
    const consulta = await cliente.query<LinhaRascunho>(`
      SELECT d.id, d.pessoa_id, d.vinculo_id, d.criado_por, p.nome, v.matricula,
        to_char(v.admissao, 'YYYY-MM-DD') AS admissao, d.revisao, d.criado_em, d.atualizado_em,
        d.entrada_cifrada, d.resultado_calculo_cifrado, d.processo_cifrado, d.confirmacao_inicio_cifrada,
        r.codigo AS regra_codigo, r.versao AS regra_versao,
        (r.codigo = $3 AND r.versao = $4 AND r.configuracao = $5::jsonb) AS regra_atual
      FROM documentos.documento d
      JOIN nucleo.pessoa p ON p.id = d.pessoa_id
      JOIN nucleo.vinculo v ON v.id = d.vinculo_id AND v.pessoa_id = d.pessoa_id
      JOIN documentos.regra_versao r ON r.id = d.regra_versao_id
      WHERE d.id = $1 AND (d.criado_por = $2 OR $6::boolean OR EXISTS (
        SELECT 1 FROM seguranca.usuario u WHERE u.id = $2 AND u.ativo AND u.papel = 'admin'
      )) AND d.tipo = 'DOF' AND d.status = $7
      ${bloquear === 'alteracao' ? 'FOR UPDATE OF d' : bloquear === 'leitura' ? 'FOR SHARE OF d' : ''}
    `, [id, autorId, REGRAS_PLANILHA.codigo, REGRAS_PLANILHA.versao, JSON.stringify(REGRAS_PLANILHA), permitirEncaminhado, estado]);
    const linha = consulta.rows[0];
    if (!linha || linha.criado_por === autorId) return linha;
    // Revalida após bloquear o documento, para não aceitar um encaminhamento recolhido durante a espera.
    const acesso = await cliente.query(`
      SELECT 1 FROM seguranca.usuario u WHERE u.id = $2 AND u.ativo AND u.papel = 'admin'
      UNION ALL
      SELECT 1 FROM documentos.encaminhamento_dof e
      JOIN seguranca.usuario u ON u.id = e.destinatario_id
      WHERE e.documento_id = $1 AND e.destinatario_id = $2 AND e.recolhido_em IS NULL
        AND u.ativo AND u.papel IN ('coordenador', 'admin')
    `, [id, autorId]);
    return (acesso.rowCount ?? 0) > 0 ? linha : undefined;
  }

  /** Lê fonte autenticada e assinada, recusando identidade inválida e conferência sem registro correspondente. */
  async lerFonte(
    cliente: PoolClient, atual: LinhaRascunho, estado: 'rascunho' | 'conferido',
  ): Promise<{ fonte: DadosFontePreviaDof; fonteSelecionadaAlterada: boolean | null } | { erro: 'identidade' | 'fonte' }> {
    const id = atual.id;
    const consulta = await cliente.query<RevisoesFonte & {
      cpf_cifrado: Buffer; cpf_hash: Buffer; nascimento: string | null; nome_mae_cifrado: Buffer | null;
      regime_juridico: string | null; cargo: string | null; referencia: string | null; orgao_nome: string | null;
      removido: boolean; consultado_em: Date; fonte_selecionada_alterada: boolean | null;
    }>(`
      SELECT p.cpf_cifrado, p.cpf_hash, to_char(p.nascimento, 'YYYY-MM-DD') AS nascimento,
        p.nome_mae_cifrado, v.regime_juridico, v.cargo, v.referencia, v.orgao_nome,
        p.revisao_fonte::text AS pessoa_revisao, v.revisao_fonte::text AS vinculo_revisao,
        v.removido_na_fonte_em IS NOT NULL AS removido, clock_timestamp() AS consultado_em,
        (c.revisao_pessoa <> p.revisao_fonte OR c.revisao_vinculo <> v.revisao_fonte) AS fonte_selecionada_alterada
      FROM nucleo.pessoa p JOIN nucleo.vinculo v ON v.pessoa_id = p.id
      LEFT JOIN documentos.conferencia_dof c ON c.documento_id = $3 AND c.revisao_documento = $4
      WHERE p.id = $1 AND v.id = $2
    `, [atual.pessoa_id, atual.vinculo_id, atual.id, atual.revisao]);
    const origem = consulta.rows[0];
    if (!origem) throw new Error('Pessoa ou vínculo da prévia deixou de existir.');
    if (estado === 'conferido' && origem.fonte_selecionada_alterada === null) {
      throw new Error('DOF conferida sem registro correspondente.');
    }
    const cpf = lerCpfDof(this.protetor, atual.pessoa_id, origem.cpf_cifrado, origem.cpf_hash);
    const nomeMae = lerNomeMaeDof(this.protetor, atual.pessoa_id, origem.nome_mae_cifrado);
    if ('erro' in cpf || 'erro' in nomeMae) return { erro: 'identidade' };
    const nivel = nivelDof(origem.referencia ?? '');
    const fonte = dadosFontePreviaDofSchema.safeParse({
      documentoId: id,
      revisao: atual.revisao,
      provaFonte: this.assinarFonte(atual, origem).toString('hex'),
      consultadoEm: origem.consultado_em.toISOString(),
      nome: atual.nome,
      matricula: atual.matricula,
      cpf: cpf.valor,
      nascimento: origem.nascimento,
      nomeMae: nomeMae.valor,
      regimeJuridico: origem.regime_juridico,
      cargo: origem.cargo,
      nivel: nivel.nivel || null,
      avisoNivel: nivel.avisos.join(' ') || null,
      referencia: origem.referencia,
      orgao: origem.orgao_nome,
      admissao: atual.admissao,
      removidoNaFonte: origem.removido,
    });
    if (!fonte.success) return { erro: 'fonte' };
    return { fonte: fonte.data, fonteSelecionadaAlterada: origem.fonte_selecionada_alterada };
  }
}
