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
} from '@sisdoc/contratos';
import type { Pool, PoolClient } from 'pg';
import { transacao } from '../banco';
import type { SessaoAutenticada } from '../seguranca/autenticacao';
import { papeisPermitidos } from '../seguranca/permissoes';
import { ProtetorDados } from '../seguranca/protecao-dados';
import { confirmarSessao } from '../seguranca/sessao-transacao';

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

async function auditar(
  cliente: PoolClient,
  sessao: SessaoAutenticada,
  acao: string,
  entidade: string,
  entidadeId: string | null,
  pessoaId: string | null,
  ip: string,
): Promise<void> {
  await cliente.query(`
    INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, entidade_id, pessoa_id, ip)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [sessao.usuario.id, acao, entidade, entidadeId, pessoaId, ip]);
}

export class ServidoresService {
  private readonly protetor: ProtetorDados;

  constructor(private readonly banco: Pool, configuracao: Configuracao) {
    this.protetor = new ProtetorDados(configuracao.chaves);
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
      await auditar(cliente, sessao, 'servidores_pesquisados', 'busca', null, null, ip);
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
      await auditar(cliente, sessao, 'servidor_consultado', 'pessoa', pessoa.id, pessoa.id, ip);
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
      await auditar(cliente, sessao, 'eventos_consultados', 'vinculo', vinculoId, pessoaId, ip);
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
