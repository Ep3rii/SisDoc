import { NotFoundException } from '@nestjs/common';
import {
  cpfSchema,
  normalizarMatricula,
  normalizarNomeBusca,
  type BuscarServidoresQuery,
  type DetalheServidor,
  type PaginaBuscaServidores,
  type PaginaEventosServidor,
  type Configuracao,
  type ReferenciaServidor,
  type ReferenciaServidorQuery,
} from '@sisdoc/contratos';
import type { Pool } from 'pg';
import { transacao } from '../banco';
import { auditarConsultaFuncional } from '../seguranca/auditoria-funcional';
import type { SessaoAutenticada } from '../seguranca/autenticacao';
import { papeisPermitidos } from '../seguranca/permissoes';
import { ProtetorDados } from '../seguranca/protecao-dados';
import { confirmarSessao } from '../seguranca/sessao-transacao';
import { decifrarTexto } from '../importacao/exportador';

type LinhaBusca = {
  pessoa_id: string;
  vinculo_id: string;
  nome: string;
  matricula: string;
  orgao_nome: string | null;
  sistema_origem: string;
  removido: boolean;
};

type LinhaVinculo = {
  id: string;
  matricula: string;
  sistema_origem: string;
  matricula_anterior_id: string | null;
  regime_juridico: string | null;
  cargo: string | null;
  classe: string | null;
  nivel: string | null;
  referencia: string | null;
  setor: string | null;
  orgao_nome: string | null;
  admissao: string | null;
  desligamento: string | null;
  removido: boolean;
};

export class ServidoresService {
  private readonly protetor: ProtetorDados;

  constructor(private readonly banco: Pool, configuracao: Configuracao) {
    this.protetor = new ProtetorDados(configuracao.chaves);
  }

  async referencia(sessao: SessaoAutenticada, ip: string, pessoaId: string, consulta: ReferenciaServidorQuery): Promise<ReferenciaServidor> {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_pessoa'));
      const pessoal = await cliente.query<{
        id: string; nome: string; nascimento: string | null; rg_orgao: string | null; rg_expedicao: string | null;
        cpf_cifrado: Buffer; nome_mae_cifrado: Buffer | null; nome_pai_cifrado: Buffer | null;
        pis_pasep_cifrado: Buffer | null; rg_numero_cifrado: Buffer | null;
        titulo_eleitor_cifrado: Buffer | null; endereco_cifrado: Buffer | null;
      }>(`SELECT p.id, p.nome, to_char(p.nascimento, 'YYYY-MM-DD') AS nascimento,
        p.rg_orgao, to_char(p.rg_expedicao, 'YYYY-MM-DD') AS rg_expedicao,
        p.cpf_cifrado, p.nome_mae_cifrado, p.nome_pai_cifrado, p.pis_pasep_cifrado,
        p.rg_numero_cifrado, p.titulo_eleitor_cifrado, p.endereco_cifrado
        FROM nucleo.pessoa p JOIN nucleo.vinculo v ON v.pessoa_id = p.id WHERE p.id = $1 AND v.id = $2`,
      [pessoaId, consulta.vinculoId]);
      const p = pessoal.rows[0];
      if (!p) throw new NotFoundException('Vínculo não encontrado para esta pessoa.');
      const pessoa: ReferenciaServidor['pessoa'] = {
        Nome: p.nome, Nascimento: p.nascimento, 'Órgão expedidor': p.rg_orgao, 'Expedição RG': p.rg_expedicao,
      };
      for (const [rotulo, campo] of [
        ['CPF', 'cpf_cifrado'], ['Mãe', 'nome_mae_cifrado'], ['Pai', 'nome_pai_cifrado'],
        ['PIS/PASEP', 'pis_pasep_cifrado'], ['RG', 'rg_numero_cifrado'],
        ['Título de eleitor', 'titulo_eleitor_cifrado'], ['Endereço', 'endereco_cifrado'],
      ] as const) pessoa[rotulo] = decifrarTexto(this.protetor, p.id, 'pessoa', campo, p[campo]);
      const definicoes = {
        eventos_funcionais: { tabela: 'evento_funcional', pai: 'vinculo_id',
          campos: ['tipo', 'data_evento', 'data_publicacao', 'ato_tipo', 'ato_numero', 'fonte', 'removido_na_fonte_em'],
          cifrados: ['descricao_origem_cifrada', 'dados_cifrados'] },
        afastamentos: { tabela: 'afastamento', pai: 'vinculo_id',
          campos: ['tipo', 'data_inicio', 'data_fim', 'ano_ref', 'dias_ano', 'fonte', 'removido_na_fonte_em'],
          cifrados: ['observacao_cifrada'] },
        incorporacoes: { tabela: 'incorporacao', pai: 'vinculo_id',
          campos: ['tipo', 'data_inicio', 'data_fim', 'ano_ref', 'dias_entrada', 'convencao', 'origem', 'removido_na_fonte_em'],
          cifrados: [] },
        periodos_ipam: { tabela: 'periodo_ipam', pai: 'pessoa_id',
          campos: ['mes_inicio', 'mes_fim', 'fonte', 'removido_na_fonte_em'], cifrados: [] },
      } as const;
      const d = definicoes[consulta.tipo];
      const colunas = d.campos.map((campo) => `${campo}::text AS ${campo}`).concat([...d.cifrados]);
      const resultado = await cliente.query<Record<string, string | Buffer | null>>(
        `SELECT id::text, ${colunas.join(', ')} FROM nucleo.${d.tabela}
        WHERE ${d.pai} = $1 AND ($2::uuid IS NULL OR id > $2) ORDER BY id LIMIT $3`,
        [d.pai === 'pessoa_id' ? pessoaId : consulta.vinculoId, consulta.cursor ?? null, consulta.limite + 1],
      );
      const registros = resultado.rows.slice(0, consulta.limite).map((registro) => {
        if (typeof registro.id !== 'string') throw new Error('Registro de referência sem identificador.');
        const id = registro.id;
        const campos: Record<string, string | null> = {};
        for (const campo of d.campos) {
          const valor = registro[campo];
          if (valor !== null && typeof valor !== 'string') throw new Error('Campo de referência inválido.');
          campos[campo] = valor;
        }
        for (const campo of d.cifrados) {
          const valor = registro[campo];
          if (valor !== null && !Buffer.isBuffer(valor)) throw new Error('Campo protegido de referência inválido.');
          campos[campo.replace(/_cifrad[oa]$/, '')] = decifrarTexto(this.protetor, id, d.tabela, campo, valor);
        }
        return { id, campos };
      });
      await auditarConsultaFuncional(cliente, sessao, 'referencias_consultadas', consulta.tipo, consulta.vinculoId, pessoaId, ip);
      return { pessoa, registros, proximoCursor: resultado.rows.length > consulta.limite ? registros[registros.length - 1].id : null };
    });
  }

  async buscar(sessao: SessaoAutenticada, ip: string, consulta: BuscarServidoresQuery): Promise<PaginaBuscaServidores> {
    const nome = normalizarNomeBusca(consulta.q);
    const cpf = cpfSchema.safeParse(consulta.q);
    const consultarNome = (consulta.tipo === 'nome' || !consulta.tipo) && nome.length >= 3;
    const consultarMatricula = (consulta.tipo === 'matricula' || !consulta.tipo) && consulta.q.length <= 100;
    const consultarCpf = (consulta.tipo === 'cpf' || !consulta.tipo) && cpf.success;
    const padraoNome = consultarNome ? `%${nome.replace(/[#%_]/g, '#$&')}%` : null;
    const matricula = consultarMatricula ? normalizarMatricula(consulta.q) : null;
    const cpfHash = consultarCpf && cpf.success ? this.protetor.hashCpf(cpf.data) : null;
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_pessoa'));
      const resultado = await cliente.query<LinhaBusca>(`
        SELECT p.id AS pessoa_id, v.id AS vinculo_id, p.nome, v.matricula, v.orgao_nome,
          v.sistema_origem, v.removido_na_fonte_em IS NOT NULL AS removido
        FROM nucleo.vinculo v JOIN nucleo.pessoa p ON p.id = v.pessoa_id
        WHERE ($4::uuid IS NULL OR v.id > $4::uuid)
          AND (($1::text IS NOT NULL AND p.nome_busca LIKE $1 ESCAPE '#')
            OR ($2::text IS NOT NULL AND v.matricula_norm = $2)
            OR ($3::bytea IS NOT NULL AND p.cpf_hash = $3))
        ORDER BY v.id LIMIT $5
      `, [padraoNome, matricula, cpfHash, consulta.cursor ?? null, consulta.limite + 1]);
      await auditarConsultaFuncional(cliente, sessao, 'servidores_pesquisados', 'busca', null, null, ip);
      return {
        itens: resultado.rows.slice(0, consulta.limite).map((linha) => ({
          pessoaId: linha.pessoa_id,
          vinculoId: linha.vinculo_id,
          nome: linha.nome,
          matricula: linha.matricula,
          orgao: linha.orgao_nome,
          sistemaOrigem: linha.sistema_origem,
          removidoNaFonte: linha.removido,
        })),
        proximoCursor: resultado.rows.length > consulta.limite ? resultado.rows[consulta.limite - 1].vinculo_id : null,
      };
    });
  }

  async detalhar(
    sessao: SessaoAutenticada,
    ip: string,
    pessoaId: string,
    limite: number,
    cursor?: string,
  ): Promise<DetalheServidor> {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_pessoa'));
      const pessoas = await cliente.query<{ id: string; nome: string; cpf_cifrado: Buffer }>(
        'SELECT id, nome, cpf_cifrado FROM nucleo.pessoa WHERE id = $1', [pessoaId],
      );
      const pessoa = pessoas.rows[0];
      if (!pessoa) throw new NotFoundException('Pessoa não encontrada.');
      const cpf = cpfSchema.parse(this.protetor.decifrar(pessoa.cpf_cifrado, {
        schema: 'nucleo', tabela: 'pessoa', registroId: pessoa.id, campo: 'cpf_cifrado',
      }).toString('ascii'));
      const resultado = await cliente.query<LinhaVinculo>(`
        SELECT id, matricula, sistema_origem, matricula_anterior_id, regime_juridico, cargo, classe,
          nivel, referencia, setor, orgao_nome, to_char(admissao, 'YYYY-MM-DD') AS admissao,
          to_char(desligamento, 'YYYY-MM-DD') AS desligamento, removido_na_fonte_em IS NOT NULL AS removido
        FROM nucleo.vinculo WHERE pessoa_id = $1 AND ($2::uuid IS NULL OR id > $2::uuid)
        ORDER BY id LIMIT $3
      `, [pessoa.id, cursor ?? null, limite + 1]);
      await auditarConsultaFuncional(cliente, sessao, 'servidor_consultado', 'pessoa', pessoa.id, pessoa.id, ip);
      return {
        pessoa: { id: pessoa.id, nome: pessoa.nome, cpfMascarado: `***.***.${cpf.slice(6, 9)}-**` },
        vinculos: resultado.rows.slice(0, limite).map((linha) => ({
          id: linha.id,
          matricula: linha.matricula,
          sistemaOrigem: linha.sistema_origem,
          matriculaAnteriorId: linha.matricula_anterior_id,
          regimeJuridico: linha.regime_juridico,
          cargo: linha.cargo,
          classe: linha.classe,
          nivel: linha.nivel,
          referencia: linha.referencia,
          setor: linha.setor,
          orgao: linha.orgao_nome,
          admissao: linha.admissao,
          desligamento: linha.desligamento,
          removidoNaFonte: linha.removido,
        })),
        proximoCursor: resultado.rows.length > limite ? resultado.rows[limite - 1].id : null,
      };
    });
  }

  async eventos(
    sessao: SessaoAutenticada,
    ip: string,
    pessoaId: string,
    vinculoId: string,
    limite: number,
    cursor?: string,
  ): Promise<PaginaEventosServidor> {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_pessoa'));
      const vinculo = await cliente.query(
        'SELECT id FROM nucleo.vinculo WHERE id = $1 AND pessoa_id = $2', [vinculoId, pessoaId],
      );
      if (vinculo.rowCount !== 1) throw new NotFoundException('Vínculo não encontrado para esta pessoa.');
      const resultado = await cliente.query<{
        id: string; tipo: string; data_evento: string | null; data_publicacao: string | null;
        ato_tipo: string | null; ato_numero: string | null; fonte: string; removido: boolean;
      }>(`
        SELECT id, tipo, to_char(data_evento, 'YYYY-MM-DD') AS data_evento,
          to_char(data_publicacao, 'YYYY-MM-DD') AS data_publicacao, ato_tipo, ato_numero, fonte,
          removido_na_fonte_em IS NOT NULL AS removido
        FROM nucleo.evento_funcional
        WHERE vinculo_id = $1 AND ($2::uuid IS NULL OR id > $2::uuid)
        ORDER BY id LIMIT $3
      `, [vinculoId, cursor ?? null, limite + 1]);
      await auditarConsultaFuncional(cliente, sessao, 'eventos_consultados', 'vinculo', vinculoId, pessoaId, ip);
      return {
        itens: resultado.rows.slice(0, limite).map((linha) => ({
          id: linha.id,
          tipo: linha.tipo,
          dataEvento: linha.data_evento,
          dataPublicacao: linha.data_publicacao,
          atoTipo: linha.ato_tipo,
          atoNumero: linha.ato_numero,
          fonte: linha.fonte,
          removidoNaFonte: linha.removido,
        })),
        proximoCursor: resultado.rows.length > limite ? resultado.rows[limite - 1].id : null,
      };
    });
  }
}
