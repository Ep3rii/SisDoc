import { randomUUID, timingSafeEqual } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { calcular, converterDias, REGRAS_PLANILHA, textoPeriodos, textoTempo } from '@sisdoc/calculo';
import {
  conteudoDtcSchema,
  documentoDtcSchema,
  fonteDtcSchema,
  numeroProcessoSchema,
  processoCorrespondeMascara,
  resultadoCalculoDtcSchema,
  resultadoCopiaEmitidoSchema,
  resultadoTransicaoDtcSchema,
  snapshotEmissaoDtcSchema,
  validarConteudoDtc,
  type AtualizarDtc,
  type Configuracao,
  type ConferirDtc,
  type ConsultaDtc,
  type ConteudoDtc,
  type CriarDtc,
  type DevolverDtc,
  type DocumentoDtc,
  type EmitirDtc,
  type FonteDtc,
  type LinhaTotalDtc,
  type PaginaDtc,
  type PreviaDtc,
  type ResultadoCalculoDtc,
  type ResultadoCopiaEmitido,
  type ResultadoTransicaoDtc,
  type SituacaoEmissao,
  type TipoDtc,
} from '@sisdoc/contratos';
import { DatabaseError, type Pool, type PoolClient } from 'pg';
import { transacao } from '../banco';
import { dataEmSaoPaulo } from '../data';
import { TEMPLATES_DTC } from '../migracoes/dtc';
import { CHAVE_BLOQUEIO_FONTE_DOF } from '../migracoes/preconferencia-dof';
import { auditarConsultaFuncional } from '../seguranca/auditoria-funcional';
import type { SessaoAutenticada } from '../seguranca/autenticacao';
import { papeisPermitidos } from '../seguranca/permissoes';
import { ProtetorDados } from '../seguranca/protecao-dados';
import { confirmarSessao } from '../seguranca/sessao-transacao';
import { consultarSituacaoEmissao } from './emissoes';
import { lerCpfDof, lerNomeMaeDof } from './identidade-fonte-dof';
import { MENSAGEM_SEM_APROVACAO } from './rascunhos';

const TIPOS_DTC: readonly TipoDtc[] = ['DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS'];
const REVISAO_MAXIMA = 2147483647;

type LinhaDtc = {
  id: string;
  tipo: TipoDtc;
  pessoa_id: string;
  vinculo_id: string;
  criado_por: string;
  autor_nome: string;
  nome: string;
  matricula: string;
  admissao: string | null;
  status: 'rascunho' | 'conferido';
  revisao: number;
  criado_em: Date;
  atualizado_em: Date;
  entrada_cifrada: Buffer;
  resultado_calculo_cifrado: Buffer | null;
  processo_cifrado: Buffer | null;
  conferido_por_nome: string | null;
  conferido_em: Date | null;
  regra_codigo: string;
  regra_versao: string;
  regra_atual: boolean;
};

type Falha = { tipo: 'invalido' | 'conflito' | 'nao_encontrado'; mensagem: string };
type Tentativa<T> = { valor: T } | { falha: Falha };
type RevisoesFonte = { pessoa_revisao: string; vinculo_revisao: string };
type Mudanca = { campo: string; anterior: unknown; novo: unknown };
type LeituraFonte = { fonte: FonteDtc; fonteSelecionadaAlterada: boolean | null } | { erro: 'identidade' | 'fonte' };

function concluir<T>(tentativa: Tentativa<T>): T {
  if ('valor' in tentativa) return tentativa.valor;
  if (tentativa.falha.tipo === 'conflito') throw new ConflictException(tentativa.falha.mensagem);
  if (tentativa.falha.tipo === 'nao_encontrado') throw new NotFoundException(tentativa.falha.mensagem);
  throw new BadRequestException(tentativa.falha.mensagem);
}

async function tentarBloqueioFonte(cliente: PoolClient): Promise<boolean> {
  const bloqueio = await cliente.query<{ obtido: boolean }>(
    'SELECT pg_try_advisory_xact_lock_shared($1, $2) AS obtido', [...CHAVE_BLOQUEIO_FONTE_DOF],
  );
  return bloqueio.rows[0].obtido;
}

/** Ordena períodos por início e anos por ano, para que a ordem gravada coincida com a do cálculo. */
function normalizar(conteudo: ConteudoDtc): ConteudoDtc {
  return conteudoDtcSchema.parse({
    periodos: [...conteudo.periodos]
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
      .map((periodo) => ({ ...periodo, anos: [...periodo.anos].sort((a, b) => a.ano - b.ano) })),
    cargos: conteudo.cargos,
    inss: conteudo.inss,
    processo: conteudo.processo,
    confirmarInicioAjustado: conteudo.confirmarInicioAjustado,
  });
}

function mudancas(anterior: ConteudoDtc | null, novo: ConteudoDtc): Mudanca[] {
  const resultado: Mudanca[] = [];
  const campos: Array<keyof ConteudoDtc> = ['periodos', 'cargos', 'inss', 'processo', 'confirmarInicioAjustado'];
  for (const campo of campos) {
    const valorAnterior = anterior ? anterior[campo] : null;
    if (JSON.stringify(valorAnterior) !== JSON.stringify(novo[campo])) {
      resultado.push({ campo: `dtc.${campo}`, anterior: valorAnterior, novo: novo[campo] });
    }
  }
  return resultado;
}

const ROTULOS_TOTAIS: ReadonlyArray<[LinhaTotalDtc['codigo'], string, boolean]> = [
  ['total_contribuicao', 'Tempo Total de Contribuição', false],
  ['efetivo_exercicio', 'Tempo de Efetivo Exercício na PMSL', false],
  ['incorporacao_pb', 'Tempo de Incorporação de PB', true],
  ['incorporacao_pv', 'Tempo de Incorporação de PV', true],
  ['incorporacao_pb_pv', 'Tempo de Incorporação de PB/PV', true],
  ['licenca_premio', 'Tempo de Incorporação de Licença-prêmio', true],
];

export function calcularDtc(
  tipo: TipoDtc, conteudo: ConteudoDtc, admissao: string, dataReferencia: string,
): { resultado: ResultadoCalculoDtc } | { erro: string } {
  const calculo = calcular({
    tipo,
    posse: admissao,
    dataReferencia,
    periodos: conteudo.periodos.map((periodo) => ({ inicio: periodo.inicio, fim: periodo.fim, anos: periodo.anos })),
    regras: REGRAS_PLANILHA,
  });
  if (!calculo.sucesso) {
    return { erro: [...new Set(calculo.erros.map((erro) => erro.periodo ? `${erro.periodo}º período: ${erro.mensagem}` : erro.mensagem))].join(' ') };
  }
  const { totais } = calculo;
  const dias: Record<LinhaTotalDtc['codigo'], number> = {
    total_contribuicao: totais.totalContribuicao,
    efetivo_exercicio: totais.efetivoExercicio,
    incorporacao_pb: totais.pb,
    incorporacao_pv: totais.pv,
    incorporacao_pb_pv: totais.pb + totais.pv,
    licenca_premio: totais.licencaPremio,
  };
  const linhasTotais = ROTULOS_TOTAIS.map(([codigo, rotulo, incorporacao]) => {
    const convertido = converterDias(dias[codigo], calculo.regras);
    return {
      codigo,
      rotulo,
      dias: dias[codigo],
      anos: convertido.anos,
      meses: convertido.meses,
      diasRestantes: convertido.dias,
      texto: textoTempo(dias[codigo], calculo.regras),
      // Incorporações não têm regra aprovada para DTC; no Comissionado e no INSS todo o bloco é inferido.
      provisoria: incorporacao || tipo !== 'DTC_IPAM',
    };
  });
  return {
    resultado: resultadoCalculoDtcSchema.parse({
      tipo,
      admissaoConsiderada: admissao,
      regra: { codigo: calculo.regras.codigo, versao: calculo.regras.versao, classificacao: calculo.regras.classificacao },
      periodos: calculo.periodos.map((periodo) => ({
        ordem: periodo.ordem,
        inicioInformado: periodo.inicioInformado,
        inicioEfetivo: periodo.inicioEfetivo,
        fim: periodo.fim,
        linhas: periodo.linhas,
        excessoTs: periodo.excessoTs,
        excessoPf: periodo.excessoPf,
        totais: periodo.totais,
      })),
      totais,
      textoPeriodos: textoPeriodos(calculo.periodos),
      textoTotal: textoTempo(totais.totalContribuicao, calculo.regras),
      linhasTotais,
      avisos: calculo.avisos,
    }),
  };
}

export class DtcService {
  private readonly protetor: ProtetorDados;
  private readonly mascarasProcesso: string[];

  constructor(private readonly banco: Pool, configuracao: Configuracao) {
    this.protetor = new ProtetorDados(configuracao.chaves);
    this.mascarasProcesso = configuracao.processos?.mascaras ?? [];
  }

  private cifrar(tabela: string, id: string, campo: string, valor: unknown): Buffer {
    return this.protetor.cifrar(Buffer.from(JSON.stringify(valor), 'utf8'), {
      schema: 'documentos', tabela, registroId: id, campo,
    });
  }

  private ler(tabela: string, id: string, campo: string, valor: Buffer): unknown {
    return JSON.parse(this.protetor.decifrar(valor, {
      schema: 'documentos', tabela, registroId: id, campo,
    }).toString('utf8'));
  }

  private lerTextoPessoa(pessoaId: string, campo: string, cifrado: Buffer | null): { valor: string | null } | { erro: true } {
    if (cifrado === null) return { valor: null };
    let protegido: Buffer;
    try {
      protegido = this.protetor.decifrar(cifrado, { schema: 'nucleo', tabela: 'pessoa', registroId: pessoaId, campo });
    } catch (erro) {
      if (!(erro instanceof Error) || erro.message !== 'Dado protegido inválido ou corrompido.') throw erro;
      return { erro: true };
    }
    const texto = protegido.toString('utf8');
    if (!Buffer.from(texto, 'utf8').equals(protegido) || texto.length > 2000 || /[\u0000-\u001f\u007f]/.test(texto)) {
      return { erro: true };
    }
    return { valor: texto.trim() ? texto : null };
  }

  private processoValido(processo: string | null): boolean {
    return processo === null || this.mascarasProcesso.some((mascara) => processoCorrespondeMascara(processo, mascara));
  }

  private assinarFonte(linha: LinhaDtc, revisoes: RevisoesFonte): Buffer {
    return this.protetor.assinarRevisaoFonteDof({
      documentoId: linha.id,
      documentoRevisao: linha.revisao,
      pessoaId: linha.pessoa_id,
      pessoaRevisao: revisoes.pessoa_revisao,
      vinculoId: linha.vinculo_id,
      vinculoRevisao: revisoes.vinculo_revisao,
    });
  }

  private async consultarRevisoesFonte(cliente: PoolClient, linha: LinhaDtc): Promise<RevisoesFonte> {
    const consulta = await cliente.query<RevisoesFonte>(`
      SELECT p.revisao_fonte::text AS pessoa_revisao, v.revisao_fonte::text AS vinculo_revisao
      FROM nucleo.pessoa p JOIN nucleo.vinculo v ON v.pessoa_id = p.id
      WHERE p.id = $1 AND v.id = $2
    `, [linha.pessoa_id, linha.vinculo_id]);
    if (!consulta.rows[0]) throw new Error('Pessoa ou vínculo da DTC deixou de existir.');
    return consulta.rows[0];
  }

  private fonteCorresponde(linha: LinhaDtc, revisoes: RevisoesFonte, prova: string): boolean {
    const recebida = Buffer.from(prova, 'hex');
    const esperada = this.assinarFonte(linha, revisoes);
    return recebida.length === esperada.length && timingSafeEqual(recebida, esperada);
  }

  private async linha(
    cliente: PoolClient,
    sessao: SessaoAutenticada,
    id: string,
    opcoes: { estados: Array<'rascunho' | 'conferido'>; bloquear?: 'leitura' | 'alteracao'; somenteAutor?: boolean },
  ): Promise<LinhaDtc | undefined> {
    const acessoTerceiros = sessao.usuario.papel === 'admin'
      || (sessao.usuario.papel === 'coordenador' && !opcoes.somenteAutor);
    const consulta = await cliente.query<LinhaDtc>(`
      SELECT d.id, d.tipo, d.pessoa_id, d.vinculo_id, d.criado_por, autor.nome AS autor_nome, p.nome, v.matricula,
        to_char(v.admissao, 'YYYY-MM-DD') AS admissao, d.status, d.revisao, d.criado_em, d.atualizado_em,
        d.entrada_cifrada, d.resultado_calculo_cifrado, d.processo_cifrado,
        conferente.nome AS conferido_por_nome, d.conferido_em,
        r.codigo AS regra_codigo, r.versao AS regra_versao,
        (r.codigo = $3 AND r.versao = $4 AND r.configuracao = $5::jsonb) AS regra_atual
      FROM documentos.documento d
      JOIN nucleo.pessoa p ON p.id = d.pessoa_id
      JOIN nucleo.vinculo v ON v.id = d.vinculo_id AND v.pessoa_id = d.pessoa_id
      JOIN seguranca.usuario autor ON autor.id = d.criado_por
      LEFT JOIN seguranca.usuario conferente ON conferente.id = d.conferido_por
      JOIN documentos.regra_versao r ON r.id = d.regra_versao_id
      WHERE d.id = $1 AND d.tipo = ANY($6::text[]) AND d.status = ANY($7::text[])
        AND (d.criado_por = $2 OR $8::boolean)
      ${opcoes.bloquear === 'alteracao' ? 'FOR UPDATE OF d' : opcoes.bloquear === 'leitura' ? 'FOR SHARE OF d' : ''}
    `, [
      id, sessao.usuario.id, REGRAS_PLANILHA.codigo, REGRAS_PLANILHA.versao, JSON.stringify(REGRAS_PLANILHA),
      TIPOS_DTC, opcoes.estados, acessoTerceiros,
    ]);
    return consulta.rows[0];
  }

  private apresentar(linha: LinhaDtc): DocumentoDtc {
    if (!linha.resultado_calculo_cifrado) throw new Error('DTC sem resultado de cálculo.');
    const entrada = conteudoDtcSchema.parse(this.ler('documento', linha.id, 'entrada_cifrada', linha.entrada_cifrada));
    const processo = linha.processo_cifrado
      ? numeroProcessoSchema.parse(this.ler('documento', linha.id, 'processo_cifrado', linha.processo_cifrado)) : null;
    const conteudo: ConteudoDtc = { ...entrada, processo };
    const resultado = resultadoCalculoDtcSchema.parse(
      this.ler('documento', linha.id, 'resultado_calculo_cifrado', linha.resultado_calculo_cifrado),
    );
    if (resultado.tipo !== linha.tipo || resultado.regra.codigo !== linha.regra_codigo || resultado.regra.versao !== linha.regra_versao) {
      throw new Error('Tipo ou versão de regra da DTC é inconsistente.');
    }
    if (resultado.periodos.length !== conteudo.periodos.length) throw new Error('Períodos calculados da DTC são inconsistentes.');
    const pendencias = validarConteudoDtc(linha.tipo, conteudo).map((problema) => problema.mensagem);
    if (!processo) pendencias.push('Informe o número do processo.');
    else if (!this.processoValido(processo)) pendencias.push('O número do processo não corresponde às máscaras configuradas.');
    if (resultado.avisos.some((aviso) => aviso.codigo === 'inicio_ajustado_posse') && !conteudo.confirmarInicioAjustado) {
      pendencias.push('Confirme o ajuste do início do período à data de posse.');
    }
    if (!linha.regra_atual) pendencias.push('A versão de regra deste documento não é a vigente; crie uma cópia.');
    if (linha.admissao !== resultado.admissaoConsiderada) {
      pendencias.push('A admissão mudou na fonte; salve o rascunho novamente para recalcular.');
    }
    return documentoDtcSchema.parse({
      id: linha.id,
      tipo: linha.tipo,
      pessoaId: linha.pessoa_id,
      vinculoId: linha.vinculo_id,
      nome: linha.nome,
      matricula: linha.matricula,
      admissao: linha.admissao,
      status: linha.status,
      revisao: linha.revisao,
      criadoEm: linha.criado_em.toISOString(),
      atualizadoEm: linha.atualizado_em.toISOString(),
      autorNome: linha.autor_nome,
      conferidoPorNome: linha.conferido_por_nome,
      conferidoEm: linha.conferido_em ? linha.conferido_em.toISOString() : null,
      conteudo,
      resultado,
      mascarasProcesso: this.mascarasProcesso,
      pendencias,
    });
  }

  private async lerFonte(cliente: PoolClient, linha: LinhaDtc): Promise<LeituraFonte> {
    const consulta = await cliente.query<RevisoesFonte & {
      cpf_cifrado: Buffer; cpf_hash: Buffer; nascimento: string | null; nome_mae_cifrado: Buffer | null;
      nome_pai_cifrado: Buffer | null; pis_pasep_cifrado: Buffer | null; rg_numero_cifrado: Buffer | null;
      rg_orgao: string | null; rg_expedicao: string | null; titulo_eleitor_cifrado: Buffer | null;
      endereco_cifrado: Buffer | null; regime_juridico: string | null; cargo: string | null; referencia: string | null;
      orgao_nome: string | null; removido: boolean; consultado_em: Date; fonte_selecionada_alterada: boolean | null;
    }>(`
      SELECT p.cpf_cifrado, p.cpf_hash, to_char(p.nascimento, 'YYYY-MM-DD') AS nascimento,
        p.nome_mae_cifrado, p.nome_pai_cifrado, p.pis_pasep_cifrado, p.rg_numero_cifrado, p.rg_orgao,
        to_char(p.rg_expedicao, 'YYYY-MM-DD') AS rg_expedicao, p.titulo_eleitor_cifrado, p.endereco_cifrado,
        v.regime_juridico, v.cargo, v.referencia, v.orgao_nome,
        p.revisao_fonte::text AS pessoa_revisao, v.revisao_fonte::text AS vinculo_revisao,
        v.removido_na_fonte_em IS NOT NULL AS removido, clock_timestamp() AS consultado_em,
        (c.revisao_pessoa <> p.revisao_fonte OR c.revisao_vinculo <> v.revisao_fonte) AS fonte_selecionada_alterada
      FROM nucleo.pessoa p JOIN nucleo.vinculo v ON v.pessoa_id = p.id
      LEFT JOIN documentos.conferencia_dtc c ON c.documento_id = $3 AND c.revisao_documento = $4
      WHERE p.id = $1 AND v.id = $2
    `, [linha.pessoa_id, linha.vinculo_id, linha.id, linha.revisao]);
    const origem = consulta.rows[0];
    if (!origem) throw new Error('Pessoa ou vínculo da DTC deixou de existir.');
    if (linha.status === 'conferido' && origem.fonte_selecionada_alterada === null) {
      throw new Error('DTC conferida sem registro correspondente.');
    }
    const ipam = await cliente.query<{ inicio: string; fim: string }>(`
      SELECT to_char(mes_inicio, 'YYYY-MM-DD') AS inicio, to_char(mes_fim, 'YYYY-MM-DD') AS fim
      FROM nucleo.periodo_ipam WHERE pessoa_id = $1 AND removido_na_fonte_em IS NULL
      ORDER BY mes_inicio, mes_fim LIMIT 50
    `, [linha.pessoa_id]);
    const cpf = lerCpfDof(this.protetor, linha.pessoa_id, origem.cpf_cifrado, origem.cpf_hash);
    const nomeMae = lerNomeMaeDof(this.protetor, linha.pessoa_id, origem.nome_mae_cifrado);
    if ('erro' in cpf || 'erro' in nomeMae) return { erro: 'identidade' };
    const textos = {
      nomePai: this.lerTextoPessoa(linha.pessoa_id, 'nome_pai_cifrado', origem.nome_pai_cifrado),
      pisPasep: this.lerTextoPessoa(linha.pessoa_id, 'pis_pasep_cifrado', origem.pis_pasep_cifrado),
      rg: this.lerTextoPessoa(linha.pessoa_id, 'rg_numero_cifrado', origem.rg_numero_cifrado),
      tituloEleitor: this.lerTextoPessoa(linha.pessoa_id, 'titulo_eleitor_cifrado', origem.titulo_eleitor_cifrado),
      endereco: this.lerTextoPessoa(linha.pessoa_id, 'endereco_cifrado', origem.endereco_cifrado),
    };
    const valores: Record<keyof typeof textos, string | null> = {
      nomePai: null, pisPasep: null, rg: null, tituloEleitor: null, endereco: null,
    };
    for (const chave of Object.keys(textos) as Array<keyof typeof textos>) {
      const leitura = textos[chave];
      if ('erro' in leitura) return { erro: 'fonte' };
      valores[chave] = leitura.valor;
    }
    const fonte = fonteDtcSchema.safeParse({
      documentoId: linha.id,
      revisao: linha.revisao,
      provaFonte: this.assinarFonte(linha, origem).toString('hex'),
      consultadoEm: origem.consultado_em.toISOString(),
      nome: linha.nome,
      matricula: linha.matricula,
      cpf: cpf.valor,
      nascimento: origem.nascimento,
      nomeMae: nomeMae.valor,
      ...valores,
      rgOrgao: origem.rg_orgao,
      rgExpedicao: origem.rg_expedicao,
      regimeJuridico: origem.regime_juridico,
      cargo: origem.cargo,
      referencia: origem.referencia,
      orgao: origem.orgao_nome,
      admissao: linha.admissao,
      periodosIpam: ipam.rows,
      removidoNaFonte: origem.removido,
    });
    if (!fonte.success) return { erro: 'fonte' };
    return { fonte: fonte.data, fonteSelecionadaAlterada: origem.fonte_selecionada_alterada };
  }

  private async registrarAjustes(
    cliente: PoolClient, documentoId: string, usuarioId: string, motivo: string, alteracoes: Mudanca[],
  ): Promise<void> {
    for (const alteracao of alteracoes) {
      const id = randomUUID();
      await cliente.query(`
        INSERT INTO documentos.ajuste_campo
          (id, documento_id, campo, valor_original_cifrado, valor_novo_cifrado, motivo_cifrado, usuario_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        id, documentoId, alteracao.campo,
        alteracao.anterior === null ? null : this.cifrar('ajuste_campo', id, 'valor_original_cifrado', alteracao.anterior),
        this.cifrar('ajuste_campo', id, 'valor_novo_cifrado', alteracao.novo),
        this.cifrar('ajuste_campo', id, 'motivo_cifrado', motivo),
        usuarioId,
      ]);
    }
  }

  private async gravarFilhos(cliente: PoolClient, documentoId: string, conteudo: ConteudoDtc): Promise<void> {
    await cliente.query('DELETE FROM documentos.documento_periodo WHERE documento_id = $1', [documentoId]);
    await cliente.query('DELETE FROM documentos.documento_cargo_comissionado WHERE documento_id = $1', [documentoId]);
    for (const [indice, periodo] of conteudo.periodos.entries()) {
      await cliente.query(`
        INSERT INTO documentos.documento_periodo (id, documento_id, ordem, inicio, fim, categoria, cargo)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [randomUUID(), documentoId, indice + 1, periodo.inicio, periodo.fim, periodo.categoria, periodo.cargo]);
    }
    for (const [indice, cargo] of conteudo.cargos.entries()) {
      await cliente.query(`
        INSERT INTO documentos.documento_cargo_comissionado (
          id, documento_id, ordem, cargo, decreto_nomeacao, publicacao_nomeacao, data_entrada_exercicio,
          decreto_exoneracao, publicacao_exoneracao, data_encerramento
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        randomUUID(), documentoId, indice + 1, cargo.cargo, cargo.decretoNomeacao, cargo.publicacaoNomeacao,
        cargo.dataEntradaExercicio, cargo.decretoExoneracao, cargo.publicacaoExoneracao, cargo.dataEncerramento,
      ]);
    }
  }

  private async admissao(cliente: PoolClient, pessoaId: string, vinculoId: string): Promise<{ admissao: string | null } | undefined> {
    const consulta = await cliente.query<{ admissao: string | null }>(`
      SELECT to_char(admissao, 'YYYY-MM-DD') AS admissao FROM nucleo.vinculo WHERE id = $1 AND pessoa_id = $2
    `, [vinculoId, pessoaId]);
    return consulta.rows[0];
  }

  private async versoes(cliente: PoolClient, tipo: TipoDtc): Promise<{ template_id: string; regra_id: string }> {
    const versoes = await cliente.query<{ template_id: string; regra_id: string }>(`
      SELECT t.id AS template_id, r.id AS regra_id
      FROM documentos.template_versao t CROSS JOIN documentos.regra_versao r
      WHERE t.tipo = $1 AND t.versao = $2 AND r.codigo = $3 AND r.versao = $4 AND r.configuracao = $5::jsonb
    `, [tipo, TEMPLATES_DTC[tipo], REGRAS_PLANILHA.codigo, REGRAS_PLANILHA.versao, JSON.stringify(REGRAS_PLANILHA)]);
    const versao = versoes.rows[0];
    if (!versao) throw new ServiceUnavailableException('As versões de cálculo e modelo da DTC não estão disponíveis.');
    return versao;
  }

  private async inserir(
    cliente: PoolClient, sessao: SessaoAutenticada, tipo: TipoDtc, pessoaId: string, vinculoId: string,
    conteudo: ConteudoDtc, resultado: ResultadoCalculoDtc, motivo: string,
  ): Promise<string> {
    const versao = await this.versoes(cliente, tipo);
    const id = randomUUID();
    await cliente.query(`
      INSERT INTO documentos.documento (
        id, tipo, pessoa_id, vinculo_id, entrada_cifrada, resultado_calculo_cifrado,
        template_versao_id, regra_versao_id, criado_por, atualizado_por
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
    `, [
      id, tipo, pessoaId, vinculoId, this.cifrar('documento', id, 'entrada_cifrada', { ...conteudo, processo: null }),
      this.cifrar('documento', id, 'resultado_calculo_cifrado', resultado),
      versao.template_id, versao.regra_id, sessao.usuario.id,
    ]);
    if (conteudo.processo) {
      await cliente.query('UPDATE documentos.documento SET processo_cifrado = $2 WHERE id = $1', [
        id, this.cifrar('documento', id, 'processo_cifrado', conteudo.processo),
      ]);
    }
    await this.gravarFilhos(cliente, id, conteudo);
    await this.registrarAjustes(cliente, id, sessao.usuario.id, motivo, mudancas(null, conteudo));
    return id;
  }

  async listar(sessao: SessaoAutenticada, ip: string, consulta: ConsultaDtc): Promise<PaginaDtc> {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_documentos'));
      const linhas = await cliente.query<{
        id: string; tipo: TipoDtc; nome: string; matricula: string; status: 'rascunho' | 'conferido';
        revisao: number; atualizado_em: Date; autor_nome: string;
      }>(`
        SELECT d.id, d.tipo, p.nome, v.matricula, d.status, d.revisao, d.atualizado_em, autor.nome AS autor_nome
        FROM documentos.documento d
        JOIN nucleo.pessoa p ON p.id = d.pessoa_id
        JOIN nucleo.vinculo v ON v.id = d.vinculo_id AND v.pessoa_id = d.pessoa_id
        JOIN seguranca.usuario autor ON autor.id = d.criado_por
        WHERE d.tipo = ANY($1::text[]) AND d.status = $2 AND (d.criado_por = $3 OR $4::boolean)
          AND NOT EXISTS (SELECT 1 FROM documentos.exclusao_documento x
            WHERE x.documento_id = d.id AND x.status = 'pendente')
        ORDER BY d.atualizado_em DESC, d.id LIMIT 50
      `, [consulta.tipo ? [consulta.tipo] : TIPOS_DTC, consulta.estado, sessao.usuario.id,
        sessao.usuario.papel === 'coordenador' || sessao.usuario.papel === 'admin']);
      await auditarConsultaFuncional(cliente, sessao, 'dtc_listadas', 'documento', null, null, ip);
      return {
        itens: linhas.rows.map((linha) => ({
          id: linha.id, tipo: linha.tipo, nome: linha.nome, matricula: linha.matricula, status: linha.status,
          revisao: linha.revisao, atualizadoEm: linha.atualizado_em.toISOString(), autorNome: linha.autor_nome,
        })),
      };
    });
  }

  async obter(sessao: SessaoAutenticada, ip: string, id: string): Promise<DocumentoDtc> {
    const tentativa = await transacao<Tentativa<DocumentoDtc>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_documentos'));
      const linha = await this.linha(cliente, sessao, id, { estados: ['rascunho', 'conferido'] });
      if (!linha) {
        await auditarConsultaFuncional(cliente, sessao, 'dtc_nao_encontrada', 'documento', id, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'DTC não encontrada.' } };
      }
      await auditarConsultaFuncional(cliente, sessao, 'dtc_consultada', 'documento', id, linha.pessoa_id, ip);
      return { valor: this.apresentar(linha) };
    });
    return concluir(tentativa);
  }

  async criar(sessao: SessaoAutenticada, ip: string, dados: CriarDtc): Promise<DocumentoDtc> {
    const tentativa = await transacao<Tentativa<DocumentoDtc>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('criar_rascunho'));
      const conteudo = normalizar(dados);
      if (!this.processoValido(conteudo.processo)) {
        return { falha: { tipo: 'invalido', mensagem: 'O número do processo não corresponde às máscaras configuradas.' } };
      }
      if (!await tentarBloqueioFonte(cliente)) {
        await auditarConsultaFuncional(cliente, sessao, 'dtc_fonte_ocupada', 'vinculo', dados.vinculoId, null, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A fonte está sendo atualizada. Aguarde e tente salvar novamente.' } };
      }
      const vinculo = await this.admissao(cliente, dados.pessoaId, dados.vinculoId);
      if (!vinculo) return { falha: { tipo: 'nao_encontrado', mensagem: 'Vínculo não encontrado para esta pessoa.' } };
      if (!vinculo.admissao) return { falha: { tipo: 'invalido', mensagem: 'A data de admissão do vínculo não está informada na fonte.' } };
      const calculo = calcularDtc(dados.tipo, conteudo, vinculo.admissao, dataEmSaoPaulo(new Date()));
      if ('erro' in calculo) return { falha: { tipo: 'invalido', mensagem: calculo.erro } };
      const id = await this.inserir(
        cliente, sessao, dados.tipo, dados.pessoaId, dados.vinculoId, conteudo, calculo.resultado, 'Criação do rascunho de DTC.',
      );
      await auditarConsultaFuncional(cliente, sessao, 'dtc_criada', 'documento', id, dados.pessoaId, ip);
      const linha = await this.linha(cliente, sessao, id, { estados: ['rascunho'] });
      if (!linha) throw new Error('DTC recém-criada não pôde ser recuperada.');
      return { valor: this.apresentar(linha) };
    });
    return concluir(tentativa);
  }

  async atualizar(sessao: SessaoAutenticada, ip: string, id: string, dados: AtualizarDtc): Promise<DocumentoDtc> {
    const tentativa = await transacao<Tentativa<DocumentoDtc>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('editar_rascunho'));
      const linha = await this.linha(cliente, sessao, id, { estados: ['rascunho'], bloquear: 'alteracao', somenteAutor: true });
      if (!linha) {
        await auditarConsultaFuncional(cliente, sessao, 'dtc_nao_encontrada', 'documento', id, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'Rascunho de DTC não encontrado.' } };
      }
      if (linha.revisao !== dados.revisao || linha.revisao === REVISAO_MAXIMA) {
        await auditarConsultaFuncional(cliente, sessao, 'dtc_conflito', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'O rascunho foi alterado ou atingiu o limite de revisões; reabra-o antes de continuar.' } };
      }
      if (!linha.regra_atual) {
        return { falha: { tipo: 'conflito', mensagem: 'A versão de regra deste rascunho não é a vigente. Crie uma cópia.' } };
      }
      const { revisao: _revisao, motivo, ...informado } = dados;
      const conteudo = normalizar(informado);
      const problemas = validarConteudoDtc(linha.tipo, conteudo);
      if (problemas.length > 0) return { falha: { tipo: 'invalido', mensagem: problemas.map((item) => item.mensagem).join(' ') } };
      if (!this.processoValido(conteudo.processo)) {
        return { falha: { tipo: 'invalido', mensagem: 'O número do processo não corresponde às máscaras configuradas.' } };
      }
      if (!await tentarBloqueioFonte(cliente)) {
        await auditarConsultaFuncional(cliente, sessao, 'dtc_fonte_ocupada', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A fonte está sendo atualizada. Aguarde e tente salvar novamente.' } };
      }
      const atual = await this.linha(cliente, sessao, id, { estados: ['rascunho'], bloquear: 'alteracao', somenteAutor: true });
      if (!atual) throw new Error('Rascunho de DTC não pôde ser recuperado.');
      if (!atual.admissao) return { falha: { tipo: 'invalido', mensagem: 'A data de admissão do vínculo não está informada na fonte.' } };
      const anterior = this.apresentar(atual);
      const calculo = calcularDtc(atual.tipo, conteudo, atual.admissao, dataEmSaoPaulo(new Date()));
      if ('erro' in calculo) return { falha: { tipo: 'invalido', mensagem: calculo.erro } };
      await this.gravarFilhos(cliente, id, conteudo);
      const atualizado = await cliente.query(`
        UPDATE documentos.documento SET entrada_cifrada = $2, resultado_calculo_cifrado = $3, processo_cifrado = $4,
          atualizado_por = $5, atualizado_em = now(), revisao = revisao + 1
        WHERE id = $1 AND status = 'rascunho' AND revisao = $6
      `, [
        id, this.cifrar('documento', id, 'entrada_cifrada', { ...conteudo, processo: null }),
        this.cifrar('documento', id, 'resultado_calculo_cifrado', calculo.resultado),
        conteudo.processo ? this.cifrar('documento', id, 'processo_cifrado', conteudo.processo) : null,
        sessao.usuario.id, atual.revisao,
      ]);
      if (atualizado.rowCount !== 1) throw new Error('A atualização da DTC não pôde ser registrada.');
      await this.registrarAjustes(cliente, id, sessao.usuario.id, motivo, mudancas(anterior.conteudo, conteudo));
      await auditarConsultaFuncional(cliente, sessao, 'dtc_atualizada', 'documento', id, atual.pessoa_id, ip);
      const relida = await this.linha(cliente, sessao, id, { estados: ['rascunho'], somenteAutor: true });
      if (!relida) throw new Error('DTC atualizada não pôde ser recuperada.');
      return { valor: this.apresentar(relida) };
    });
    return concluir(tentativa);
  }

  async previa(sessao: SessaoAutenticada, ip: string, id: string): Promise<PreviaDtc> {
    const tentativa = await transacao<Tentativa<PreviaDtc>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_documentos'));
      const linha = await this.linha(cliente, sessao, id, { estados: ['rascunho', 'conferido'], bloquear: 'leitura' });
      if (!linha) {
        await auditarConsultaFuncional(cliente, sessao, 'dtc_nao_encontrada', 'documento', id, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'DTC não encontrada.' } };
      }
      if (!await tentarBloqueioFonte(cliente)) {
        return { falha: { tipo: 'conflito', mensagem: 'A fonte está sendo atualizada. Aguarde e abra a prévia novamente.' } };
      }
      const leitura = await this.lerFonte(cliente, linha);
      if ('erro' in leitura) {
        await auditarConsultaFuncional(cliente, sessao, 'previa_dtc_fonte_invalida', 'documento', id, linha.pessoa_id, ip);
        return {
          falha: {
            tipo: 'conflito',
            mensagem: leitura.erro === 'identidade'
              ? 'A identidade protegida não pôde ser validada. Solicite a correção da fonte.'
              : 'Os dados da fonte são inválidos. Solicite sua verificação antes de abrir a prévia.',
          },
        };
      }
      await auditarConsultaFuncional(cliente, sessao, 'previa_dtc_aberta', 'documento', id, linha.pessoa_id, ip);
      return {
        valor: { documento: this.apresentar(linha), fonte: leitura.fonte, fonteSelecionadaAlterada: leitura.fonteSelecionadaAlterada },
      };
    });
    return concluir(tentativa);
  }

  async conferir(sessao: SessaoAutenticada, ip: string, id: string, dados: ConferirDtc): Promise<ResultadoTransicaoDtc> {
    const tentativa = await transacao<Tentativa<ResultadoTransicaoDtc>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('conferir'));
      const linha = await this.linha(cliente, sessao, id, { estados: ['rascunho'], bloquear: 'alteracao' });
      if (!linha) {
        await auditarConsultaFuncional(cliente, sessao, 'conferencia_dtc_nao_encontrada', 'documento', id, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'Rascunho de DTC não encontrado para conferência.' } };
      }
      if (linha.revisao !== dados.revisao || linha.revisao === REVISAO_MAXIMA) {
        return { falha: { tipo: 'conflito', mensagem: 'A revisão do rascunho mudou ou atingiu o limite. Reabra a prévia antes de conferir.' } };
      }
      if (!await tentarBloqueioFonte(cliente)) {
        return { falha: { tipo: 'conflito', mensagem: 'A fonte está sendo atualizada. Aguarde e tente novamente.' } };
      }
      const revisoes = await this.consultarRevisoesFonte(cliente, linha);
      if (!this.fonteCorresponde(linha, revisoes, dados.provaFonte)) {
        await auditarConsultaFuncional(cliente, sessao, 'conferencia_dtc_fonte_alterada', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A fonte mudou desde a prévia. Feche e reabra a prévia antes de conferir.' } };
      }
      const documento = this.apresentar(linha);
      if (documento.pendencias.length > 0) {
        await auditarConsultaFuncional(cliente, sessao, 'conferencia_dtc_com_pendencias', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: `Há pendências que impedem a conferência. ${documento.pendencias.join(' ')}` } };
      }
      const leitura = await this.lerFonte(cliente, linha);
      if ('erro' in leitura || leitura.fonte.removidoNaFonte) {
        return { falha: { tipo: 'conflito', mensagem: 'Os dados da fonte não puderam ser validados ou o vínculo foi removido na fonte.' } };
      }
      const conferenciaId = randomUUID();
      await cliente.query(`
        INSERT INTO documentos.conferencia_dtc
          (id, documento_id, revisao_documento, revisao_pessoa, revisao_vinculo, conferido_por, avisos)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        conferenciaId, id, linha.revisao + 1, revisoes.pessoa_revisao, revisoes.vinculo_revisao, sessao.usuario.id,
        [...new Set(documento.resultado.avisos.map((aviso) => aviso.codigo))].slice(0, 40),
      ]);
      const atualizado = await cliente.query<{ revisao: number }>(`
        UPDATE documentos.documento SET status = 'conferido', conferido_por = $2,
          conferido_em = (SELECT conferido_em FROM documentos.conferencia_dtc WHERE id = $3),
          atualizado_por = $2, atualizado_em = now(), revisao = revisao + 1
        WHERE id = $1 AND status = 'rascunho' AND revisao = $4
        RETURNING revisao
      `, [id, sessao.usuario.id, conferenciaId, linha.revisao]);
      if (!atualizado.rows[0]) throw new Error('A transição para conferido não pôde ser registrada.');
      await auditarConsultaFuncional(cliente, sessao, 'dtc_conferida', 'documento', id, linha.pessoa_id, ip);
      return { valor: resultadoTransicaoDtcSchema.parse({ documentoId: id, revisao: atualizado.rows[0].revisao, status: 'conferido' }) };
    });
    return concluir(tentativa);
  }

  async devolver(sessao: SessaoAutenticada, ip: string, id: string, dados: DevolverDtc): Promise<ResultadoTransicaoDtc> {
    const tentativa = await transacao<Tentativa<ResultadoTransicaoDtc>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('receber_encaminhamento'));
      const linha = await this.linha(cliente, sessao, id, { estados: ['conferido'], bloquear: 'alteracao' });
      if (!linha) {
        await auditarConsultaFuncional(cliente, sessao, 'conferido_dtc_nao_encontrado', 'documento', id, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'DTC conferida não encontrada.' } };
      }
      if (linha.revisao !== dados.revisao || linha.revisao === REVISAO_MAXIMA) {
        return { falha: { tipo: 'conflito', mensagem: 'A revisão da DTC mudou. Reabra a lista de conferidos.' } };
      }
      const conferencia = await cliente.query<{ id: string }>(`
        SELECT id FROM documentos.conferencia_dtc WHERE documento_id = $1 AND revisao_documento = $2
      `, [id, linha.revisao]);
      if (!conferencia.rows[0]) throw new Error('DTC conferida sem registro correspondente.');
      const devolucaoId = randomUUID();
      await cliente.query(`
        INSERT INTO documentos.devolucao_conferido_dtc (id, documento_id, conferencia_id, devolvido_por, motivo_cifrado)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        devolucaoId, id, conferencia.rows[0].id, sessao.usuario.id,
        this.cifrar('devolucao_conferido_dtc', devolucaoId, 'motivo_cifrado', dados.motivo),
      ]);
      const atualizado = await cliente.query<{ revisao: number }>(`
        UPDATE documentos.documento SET status = 'rascunho', conferido_por = NULL, conferido_em = NULL,
          atualizado_por = $2, atualizado_em = now(), revisao = revisao + 1
        WHERE id = $1 AND status = 'conferido' AND revisao = $3
        RETURNING revisao
      `, [id, sessao.usuario.id, linha.revisao]);
      if (!atualizado.rows[0]) throw new Error('A devolução da DTC conferida não pôde ser registrada.');
      await auditarConsultaFuncional(cliente, sessao, 'dtc_conferida_devolvida', 'documento', id, linha.pessoa_id, ip);
      return { valor: resultadoTransicaoDtcSchema.parse({ documentoId: id, revisao: atualizado.rows[0].revisao, status: 'rascunho' }) };
    });
    return concluir(tentativa);
  }

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
      await auditarConsultaFuncional(cliente, sessao, 'emissao_dtc_chave_reutilizada', 'documento', id, null, ip);
      return { falha: { tipo: 'conflito', mensagem: 'A chave de idempotência já foi usada em outra emissão. Reabra a DTC e tente novamente.' } };
    }
    await auditarConsultaFuncional(cliente, sessao, 'emissao_dtc_repetida', 'emissao', existente.id, null, ip);
    return { valor: await consultarSituacaoEmissao(cliente, existente.id) };
  }

  async emitir(
    sessao: SessaoAutenticada, ip: string, id: string, chave: string, dados: EmitirDtc,
  ): Promise<SituacaoEmissao> {
    const executar = () => transacao<Tentativa<SituacaoEmissao>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('emitir'));
      const repetida = await this.emissaoPorChave(cliente, sessao, ip, id, chave);
      if (repetida) return repetida;
      const linha = await this.linha(cliente, sessao, id, { estados: ['conferido'], bloquear: 'alteracao' });
      if (!linha) {
        const concorrente = await this.emissaoPorChave(cliente, sessao, ip, id, chave);
        if (concorrente) return concorrente;
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dtc_nao_encontrada', 'documento', id, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'DTC conferida não encontrada para emissão.' } };
      }
      if (linha.revisao !== dados.revisao) {
        return { falha: { tipo: 'conflito', mensagem: 'A revisão da DTC mudou. Reabra a lista de conferidos antes de emitir.' } };
      }
      if (!await tentarBloqueioFonte(cliente)) {
        return { falha: { tipo: 'conflito', mensagem: 'A fonte está sendo atualizada. Aguarde e tente emitir novamente.' } };
      }
      const revisoes = await this.consultarRevisoesFonte(cliente, linha);
      if (!this.fonteCorresponde(linha, revisoes, dados.provaFonte)) {
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dtc_fonte_alterada', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A fonte ou a revisão mudou desde a prévia. Reabra a prévia antes de emitir.' } };
      }
      const conferencia = await cliente.query<{
        revisao_pessoa: string; revisao_vinculo: string; conferido_por: string; conferente_nome: string;
      }>(`
        SELECT c.revisao_pessoa::text, c.revisao_vinculo::text, c.conferido_por, u.nome AS conferente_nome
        FROM documentos.conferencia_dtc c JOIN seguranca.usuario u ON u.id = c.conferido_por
        WHERE c.documento_id = $1 AND c.revisao_documento = $2
      `, [id, linha.revisao]);
      const conferido = conferencia.rows[0];
      if (!conferido) throw new Error('DTC conferida sem registro correspondente.');
      if (conferido.revisao_pessoa !== revisoes.pessoa_revisao || conferido.revisao_vinculo !== revisoes.vinculo_revisao) {
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dtc_fonte_alterada', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: 'A pessoa ou o vínculo mudou na fonte após a conferência. Devolva a DTC para nova conferência.' } };
      }
      const documento = this.apresentar(linha);
      if (documento.pendencias.length > 0 || !documento.conteudo.processo) {
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dtc_com_pendencias', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: `Há pendências que impedem a emissão. Devolva a DTC para correção. ${documento.pendencias.join(' ')}`.trim() } };
      }
      const leitura = await this.lerFonte(cliente, linha);
      if ('erro' in leitura) {
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
        JOIN documentos.template_versao t ON t.tipo = d.tipo AND t.versao = $2
        JOIN documentos.aprovacao_modelo a ON a.tipo = d.tipo AND a.regra_versao_id = r.id AND a.template_versao_id = t.id
        WHERE d.id = $1
      `, [id, TEMPLATES_DTC[linha.tipo]]);
      const aprovacao = aprovacoes.rows[0];
      if (!aprovacao) {
        await auditarConsultaFuncional(cliente, sessao, 'emissao_dtc_bloqueada_sem_aprovacao', 'documento', id, linha.pessoa_id, ip);
        return { falha: { tipo: 'conflito', mensagem: MENSAGEM_SEM_APROVACAO } };
      }
      const agora = (await cliente.query<{ agora: Date }>('SELECT now() AS agora')).rows[0].agora;
      const dataEmissao = dataEmSaoPaulo(agora);
      const ano = Number(dataEmissao.slice(0, 4));
      // Sufixo vazio: a numeração oficial das DTCs não foi definida (decisão 023).
      await cliente.query(`
        INSERT INTO documentos.numeracao (tipo, ano, sufixo) VALUES ($1, $2, '') ON CONFLICT (tipo, ano) DO NOTHING
      `, [linha.tipo, ano]);
      const numeracao = await cliente.query<{ sufixo: string }>(`
        SELECT sufixo FROM documentos.numeracao WHERE tipo = $1 AND ano = $2 FOR UPDATE
      `, [linha.tipo, ano]);
      if (!numeracao.rows[0]) throw new Error('A numeração da DTC não pôde ser reservada.');
      const reservado = await cliente.query<{ ultimo_numero: string }>(`
        UPDATE documentos.numeracao SET ultimo_numero = ultimo_numero + 1 WHERE tipo = $1 AND ano = $2
        RETURNING ultimo_numero::text
      `, [linha.tipo, ano]);
      const numero = Number(reservado.rows[0].ultimo_numero);
      if (!Number.isSafeInteger(numero) || numero < 1) throw new Error('O número reservado para a DTC é inválido.');
      const numeroFormatado = `N° ${numero}${numeracao.rows[0].sufixo}/${ano}`;
      const emissaoId = randomUUID();
      const { documentoId: _documentoId, revisao: _revisao, provaFonte: _prova, ...fonte } = leitura.fonte;
      const snapshot = snapshotEmissaoDtcSchema.parse({
        classificacao: 'emissao',
        tipo: linha.tipo,
        documentoId: id,
        emissaoId,
        revisao: linha.revisao,
        numero,
        ano,
        numeroFormatado,
        emitidoEm: agora.toISOString(),
        dataEmissao,
        nome: documento.nome,
        matricula: documento.matricula,
        fonte,
        conteudo: documento.conteudo,
        resultado: documento.resultado,
        processo: documento.conteudo.processo,
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [emissaoId, id, linha.tipo, ano, numero, numeroFormatado, chave,
        this.protetor.cifrar(Buffer.from(JSON.stringify(snapshot), 'utf8'), {
          schema: 'documentos', tabela: 'emissao', registroId: emissaoId, campo: 'snapshot_cifrado',
        }), sessao.usuario.id]);
      await cliente.query(`
        INSERT INTO documentos.emissao_aprovacao (emissao_id, aprovacao_id, tipo) VALUES ($1, $2, $3)
      `, [emissaoId, aprovacao.id, linha.tipo]);
      await cliente.query(`
        INSERT INTO documentos.job_pdf (id, emissao_id, status) VALUES ($1, $2, 'pendente')
      `, [randomUUID(), emissaoId]);
      const atualizado = await cliente.query(`
        UPDATE documentos.documento SET status = 'emitido', atualizado_por = $2, atualizado_em = now()
        WHERE id = $1 AND status = 'conferido' AND revisao = $3
      `, [id, sessao.usuario.id, linha.revisao]);
      if (atualizado.rowCount !== 1) throw new Error('A transição para emitido não pôde ser registrada.');
      await auditarConsultaFuncional(cliente, sessao, 'dtc_emitida', 'documento', id, linha.pessoa_id, ip);
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

  async copiar(sessao: SessaoAutenticada, ip: string, documentoId: string): Promise<ResultadoCopiaEmitido> {
    const tentativa = await transacao<Tentativa<ResultadoCopiaEmitido>>(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('criar_rascunho'));
      const origem = await cliente.query<{
        emissao_id: string; snapshot_cifrado: Buffer; criado_por: string; emitido_por: string; pessoa_id: string;
        vinculo_id: string; tipo: TipoDtc; admissao: string | null;
      }>(`
        SELECT e.id AS emissao_id, e.snapshot_cifrado, d.criado_por, e.emitido_por, d.pessoa_id, d.vinculo_id, d.tipo,
          to_char(v.admissao, 'YYYY-MM-DD') AS admissao
        FROM documentos.documento d
        JOIN documentos.emissao e ON e.documento_id = d.id
        JOIN documentos.emissao_aprovacao a ON a.emissao_id = e.id
        JOIN nucleo.vinculo v ON v.id = d.vinculo_id AND v.pessoa_id = d.pessoa_id
        WHERE d.id = $1 AND d.tipo = ANY($2::text[]) AND d.status IN ('emitido', 'cancelado')
      `, [documentoId, TIPOS_DTC]);
      const linha = origem.rows[0];
      if (!linha || !(linha.criado_por === sessao.usuario.id || linha.emitido_por === sessao.usuario.id
          || sessao.usuario.papel === 'coordenador' || sessao.usuario.papel === 'admin')) {
        await auditarConsultaFuncional(cliente, sessao, 'copia_emissao_nao_encontrada', 'documento', documentoId, null, ip);
        return { falha: { tipo: 'nao_encontrado', mensagem: 'DTC emitida não encontrada para cópia.' } };
      }
      const snapshot = snapshotEmissaoDtcSchema.parse(JSON.parse(this.protetor.decifrar(linha.snapshot_cifrado, {
        schema: 'documentos', tabela: 'emissao', registroId: linha.emissao_id, campo: 'snapshot_cifrado',
      }).toString('utf8')));
      if (snapshot.documentoId !== documentoId || snapshot.emissaoId !== linha.emissao_id || snapshot.tipo !== linha.tipo) {
        throw new Error('O snapshot não pertence à emissão consultada.');
      }
      if (!await tentarBloqueioFonte(cliente)) {
        return { falha: { tipo: 'conflito', mensagem: 'A fonte está sendo atualizada. Aguarde e tente copiar novamente.' } };
      }
      if (!linha.admissao) {
        return { falha: { tipo: 'conflito', mensagem: 'A admissão do vínculo não está informada na fonte. Solicite a correção antes de copiar.' } };
      }
      // A cópia é um novo pedido: processo e confirmação do início ajustado devem ser informados de novo.
      const conteudo = normalizar({ ...snapshot.conteudo, processo: null, confirmarInicioAjustado: false });
      const calculo = calcularDtc(linha.tipo, conteudo, linha.admissao, dataEmSaoPaulo(new Date()));
      if ('erro' in calculo) return { falha: { tipo: 'invalido', mensagem: calculo.erro } };
      const id = await this.inserir(
        cliente, sessao, linha.tipo, linha.pessoa_id, linha.vinculo_id, conteudo, calculo.resultado,
        `Cópia da emissão ${snapshot.numeroFormatado}.`,
      );
      await auditarConsultaFuncional(cliente, sessao, 'dtc_copiada', 'documento', id, linha.pessoa_id, ip);
      const criada = await this.linha(cliente, sessao, id, { estados: ['rascunho'] });
      if (!criada) throw new Error('Cópia da DTC não pôde ser recuperada.');
      return {
        valor: resultadoCopiaEmitidoSchema.parse({ documentoId: id, revisao: criada.revisao, origemEmissaoId: linha.emissao_id }),
      };
    });
    return concluir(tentativa);
  }
}
