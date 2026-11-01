import { REGRAS_PLANILHA } from '@sisdoc/calculo';
import {
  conteudoDtcSchema,
  documentoDtcSchema,
  fonteDtcSchema,
  numeroProcessoSchema,
  processoCorrespondeMascara,
  resultadoCalculoDtcSchema,
  validarConteudoDtc,
  type ConteudoDtc,
  type DocumentoDtc,
  type FonteDtc,
  type TipoDtc
} from '@sisdoc/contratos';
import { type PoolClient } from 'pg';
import type { SessaoAutenticada } from '../seguranca/autenticacao';
import { ProtetorDados } from '../seguranca/protecao-dados';
import { lerCpfDof, lerNomeMaeDof } from './identidade-fonte-dof';
import { assinarFonteDtc, lerPeriodosFonteDtc, provasDtcIguais, type PeriodoFonteDtc } from './revisao-fonte-dtc';

export const TIPOS_DTC: readonly TipoDtc[] = ['DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS'];

export type LinhaDtc = {
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

export type RevisoesFonte = { pessoa_revisao: string; vinculo_revisao: string; periodos: PeriodoFonteDtc[] };

export type LeituraFonte = { fonte: FonteDtc; fonteSelecionadaAlterada: boolean | null } | { erro: 'identidade' | 'fonte' };

/** Consulta e valida fonte DTC; locks e transações pertencem ao serviço chamador. */
export class ConsultasDtc {
  /** Compartilha o protetor e as máscaras configuradas sem criar pool ou sessão próprios. */
  constructor(private readonly protetor: ProtetorDados, private readonly mascarasProcesso: string[]) {}

  /** Decifra JSON com contexto de tabela, registro e campo, impedindo troca de ciphertext. */
  private ler(tabela: string, id: string, campo: string, valor: Buffer): unknown {
    return JSON.parse(this.protetor.decifrar(valor, {
      schema: 'documentos', tabela, registroId: id, campo,
    }).toString('utf8'));
  }

  /** Valida UTF-8 e caracteres do texto protegido; corrupção conhecida é sinalizada, outros erros propagam. */
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

  /** Aceita processo ausente em rascunho ou uma das máscaras da instalação. */
  processoValido(processo: string | null): boolean {
    return processo === null || this.mascarasProcesso.some((mascara) => processoCorrespondeMascara(processo, mascara));
  }

  /** Vincula prova HMAC à revisão do documento, pessoa, vínculo e períodos IPAM. */
  assinarFonte(linha: LinhaDtc, revisoes: RevisoesFonte): Buffer {
    return assinarFonteDtc(this.protetor, {
      documentoId: linha.id,
      documentoRevisao: linha.revisao,
      pessoaId: linha.pessoa_id,
      pessoaRevisao: revisoes.pessoa_revisao,
      vinculoId: linha.vinculo_id,
      vinculoRevisao: revisoes.vinculo_revisao,
    }, revisoes.periodos);
  }

  /** Lê as revisões com o cliente da transação chamadora, sem abrir outra conexão. */
  async consultarRevisoesFonte(cliente: PoolClient, linha: LinhaDtc): Promise<RevisoesFonte> {
    const consulta = await cliente.query<RevisoesFonte>(`
      SELECT p.revisao_fonte::text AS pessoa_revisao, v.revisao_fonte::text AS vinculo_revisao
      FROM nucleo.pessoa p JOIN nucleo.vinculo v ON v.pessoa_id = p.id
      WHERE p.id = $1 AND v.id = $2
    `, [linha.pessoa_id, linha.vinculo_id]);
    if (!consulta.rows[0]) throw new Error('Pessoa ou vínculo da DTC deixou de existir.');
    return { ...consulta.rows[0], periodos: await lerPeriodosFonteDtc(cliente, linha.pessoa_id) };
  }

  /** Compara a prova enviada com a fonte atual sem comparação textual vulnerável a timing. */
  fonteCorresponde(linha: LinhaDtc, revisoes: RevisoesFonte, prova: string): boolean {
    return provasDtcIguais(prova, this.assinarFonte(linha, revisoes));
  }

  /** Exige prova cifrada única da revisão conferida e confere todas as revisões da fonte. */
  async fonteConferidaCorresponde(cliente: PoolClient, linha: LinhaDtc, revisoes: RevisoesFonte): Promise<boolean> {
    const campo = `dtc.provaFonte.${linha.revisao}`;
    const consulta = await cliente.query<{ id: string; valor_novo_cifrado: Buffer }>(`
      SELECT id, valor_novo_cifrado FROM documentos.ajuste_campo WHERE documento_id = $1 AND campo = $2
    `, [linha.id, campo]);
    if (consulta.rows.length !== 1) return false;
    const registro = consulta.rows[0];
    const prova = this.ler('ajuste_campo', registro.id, 'valor_novo_cifrado', registro.valor_novo_cifrado);
    return typeof prova === 'string' && this.fonteCorresponde(linha, revisoes, prova);
  }

  /** Consulta documento visível ao perfil e aplica o lock solicitado na transação existente. */
  async linha(
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

  /** Valida conteúdo e cálculo decifrados e informa pendências sem alterar o documento. */
  apresentar(linha: LinhaDtc): DocumentoDtc {
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

  /** Monta fonte completa e assinada; identidade ou campos inválidos impedem prévia e emissão. */
  async lerFonte(cliente: PoolClient, linha: LinhaDtc): Promise<LeituraFonte> {
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
    const periodos = await lerPeriodosFonteDtc(cliente, linha.pessoa_id);
    const revisoes = { ...origem, periodos };
    const ipam = periodos.filter((periodo) => periodo.removido_em === null)
      .sort((a, b) => a.inicio.localeCompare(b.inicio) || a.fim.localeCompare(b.fim) || a.id.localeCompare(b.id))
      .map(({ inicio, fim }) => ({ inicio, fim }));
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
      provaFonte: this.assinarFonte(linha, revisoes).toString('hex'),
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
      periodosIpam: ipam,
      removidoNaFonte: origem.removido,
    });
    if (!fonte.success) return { erro: 'fonte' };
    return { fonte: fonte.data, fonteSelecionadaAlterada: linha.status === 'conferido'
      ? !await this.fonteConferidaCorresponde(cliente, linha, revisoes) : null };
  }
}
