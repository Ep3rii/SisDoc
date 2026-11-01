import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  cpfSchema,
  normalizarMatricula,
  normalizarNomeBusca,
  type AtualizarServidor,
  type BuscarServidoresQuery,
  type DetalheServidor,
  type PaginaBuscaServidores,
  type PaginaEventosServidor,
  type Configuracao,
  type ReferenciaServidor,
  type ReferenciaServidorQuery,
  type ResultadoEdicaoServidor,
} from '@sisdoc/contratos';
import { DatabaseError, type Pool } from 'pg';
import { randomUUID } from 'node:crypto';
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
  cpf_cifrado: Buffer;
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
        id: string; revisao_pessoa: string; revisao_vinculo: string; nome: string; nascimento: string | null;
        rg_orgao: string | null; rg_expedicao: string | null; matricula: string; regime_juridico: string | null;
        cargo: string | null; classe: string | null; nivel: string | null; referencia: string | null;
        setor: string | null; orgao_codigo: string | null; orgao_nome: string | null;
        admissao: string | null; desligamento: string | null;
        cpf_cifrado: Buffer; nome_mae_cifrado: Buffer | null; nome_pai_cifrado: Buffer | null;
        pis_pasep_cifrado: Buffer | null; rg_numero_cifrado: Buffer | null;
        titulo_eleitor_cifrado: Buffer | null; endereco_cifrado: Buffer | null;
      }>(`SELECT p.id, p.revisao_fonte::text AS revisao_pessoa, v.revisao_fonte::text AS revisao_vinculo,
        p.nome, to_char(p.nascimento, 'YYYY-MM-DD') AS nascimento,
        p.rg_orgao, to_char(p.rg_expedicao, 'YYYY-MM-DD') AS rg_expedicao,
        p.cpf_cifrado, p.nome_mae_cifrado, p.nome_pai_cifrado, p.pis_pasep_cifrado,
        p.rg_numero_cifrado, p.titulo_eleitor_cifrado, p.endereco_cifrado,
        v.matricula, v.regime_juridico, v.cargo, v.classe, v.nivel, v.referencia, v.setor,
        v.orgao_codigo, v.orgao_nome, to_char(v.admissao, 'YYYY-MM-DD') AS admissao,
        to_char(v.desligamento, 'YYYY-MM-DD') AS desligamento
        FROM nucleo.pessoa p JOIN nucleo.vinculo v ON v.pessoa_id = p.id WHERE p.id = $1 AND v.id = $2`,
      [pessoaId, consulta.vinculoId]);
      const p = pessoal.rows[0];
      if (!p) throw new NotFoundException('Vínculo não encontrado para esta pessoa.');
      const cadastro: ReferenciaServidor['cadastro'] = {
        nome: p.nome,
        cpf: decifrarTexto(this.protetor, p.id, 'pessoa', 'cpf_cifrado', p.cpf_cifrado) ?? '',
        nascimento: p.nascimento,
        nomeMae: decifrarTexto(this.protetor, p.id, 'pessoa', 'nome_mae_cifrado', p.nome_mae_cifrado),
        nomePai: decifrarTexto(this.protetor, p.id, 'pessoa', 'nome_pai_cifrado', p.nome_pai_cifrado),
        pisPasep: decifrarTexto(this.protetor, p.id, 'pessoa', 'pis_pasep_cifrado', p.pis_pasep_cifrado),
        rgNumero: decifrarTexto(this.protetor, p.id, 'pessoa', 'rg_numero_cifrado', p.rg_numero_cifrado),
        rgOrgao: p.rg_orgao,
        rgExpedicao: p.rg_expedicao,
        tituloEleitor: decifrarTexto(this.protetor, p.id, 'pessoa', 'titulo_eleitor_cifrado', p.titulo_eleitor_cifrado),
        endereco: decifrarTexto(this.protetor, p.id, 'pessoa', 'endereco_cifrado', p.endereco_cifrado),
        matricula: p.matricula,
        regimeJuridico: p.regime_juridico,
        cargo: p.cargo,
        classe: p.classe,
        nivel: p.nivel,
        referencia: p.referencia,
        setor: p.setor,
        orgaoCodigo: p.orgao_codigo,
        orgao: p.orgao_nome,
        admissao: p.admissao,
        desligamento: p.desligamento,
      };
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
      return {
        pessoaId: p.id,
        vinculoId: consulta.vinculoId,
        revisaoPessoa: p.revisao_pessoa,
        revisaoVinculo: p.revisao_vinculo,
        cadastro,
        pessoa,
        registros,
        proximoCursor: resultado.rows.length > consulta.limite ? registros[registros.length - 1].id : null,
      };
    });
  }

  async atualizar(
    sessao: SessaoAutenticada,
    ip: string,
    dados: AtualizarServidor,
  ): Promise<ResultadoEdicaoServidor> {
    try {
      return await transacao(this.banco, async (cliente) => {
        await confirmarSessao(cliente, sessao, papeisPermitidos('editar_servidor'));
        const consulta = await cliente.query<{
          pessoa_id: string; vinculo_id: string; revisao_pessoa: string; revisao_vinculo: string;
        }>(`
          SELECT p.id AS pessoa_id, v.id AS vinculo_id,
            p.revisao_fonte::text AS revisao_pessoa, v.revisao_fonte::text AS revisao_vinculo
          FROM nucleo.pessoa p JOIN nucleo.vinculo v ON v.pessoa_id = p.id
          WHERE p.id = $1 AND v.id = $2 FOR UPDATE OF p, v
        `, [dados.pessoaId, dados.vinculoId]);
        const atual = consulta.rows[0];
        if (!atual) throw new NotFoundException('Vínculo não encontrado para esta pessoa.');
        if (atual.revisao_pessoa !== dados.revisaoPessoa || atual.revisao_vinculo !== dados.revisaoVinculo) {
          throw new ConflictException('O cadastro foi alterado desde a consulta. Atualize os dados antes de editar novamente.');
        }

        const estado = await cliente.query<{
          nome: string; cpf_cifrado: Buffer; nascimento: string | null; nome_mae_cifrado: Buffer | null;
          nome_pai_cifrado: Buffer | null; pis_pasep_cifrado: Buffer | null; rg_numero_cifrado: Buffer | null;
          rg_orgao: string | null; rg_expedicao: string | null; titulo_eleitor_cifrado: Buffer | null;
          endereco_cifrado: Buffer | null; matricula: string; regime_juridico: string | null; cargo: string | null;
          classe: string | null; nivel: string | null; referencia: string | null; setor: string | null;
          orgao_codigo: string | null; orgao_nome: string | null; admissao: string | null; desligamento: string | null;
        }>(`
          SELECT p.nome, p.cpf_cifrado, to_char(p.nascimento, 'YYYY-MM-DD') AS nascimento,
            p.nome_mae_cifrado, p.nome_pai_cifrado, p.pis_pasep_cifrado, p.rg_numero_cifrado,
            p.rg_orgao, to_char(p.rg_expedicao, 'YYYY-MM-DD') AS rg_expedicao,
            p.titulo_eleitor_cifrado, p.endereco_cifrado, v.matricula, v.regime_juridico, v.cargo,
            v.classe, v.nivel, v.referencia, v.setor, v.orgao_codigo, v.orgao_nome,
            to_char(v.admissao, 'YYYY-MM-DD') AS admissao,
            to_char(v.desligamento, 'YYYY-MM-DD') AS desligamento
          FROM nucleo.pessoa p JOIN nucleo.vinculo v ON v.pessoa_id = p.id
          WHERE p.id = $1 AND v.id = $2
        `, [dados.pessoaId, dados.vinculoId]);
        const linha = estado.rows[0];
        const cadastroAtual: ReferenciaServidor['cadastro'] = {
          nome: linha.nome,
          cpf: decifrarTexto(this.protetor, dados.pessoaId, 'pessoa', 'cpf_cifrado', linha.cpf_cifrado) ?? '',
          nascimento: linha.nascimento,
          nomeMae: decifrarTexto(this.protetor, dados.pessoaId, 'pessoa', 'nome_mae_cifrado', linha.nome_mae_cifrado),
          nomePai: decifrarTexto(this.protetor, dados.pessoaId, 'pessoa', 'nome_pai_cifrado', linha.nome_pai_cifrado),
          pisPasep: decifrarTexto(this.protetor, dados.pessoaId, 'pessoa', 'pis_pasep_cifrado', linha.pis_pasep_cifrado),
          rgNumero: decifrarTexto(this.protetor, dados.pessoaId, 'pessoa', 'rg_numero_cifrado', linha.rg_numero_cifrado),
          rgOrgao: linha.rg_orgao,
          rgExpedicao: linha.rg_expedicao,
          tituloEleitor: decifrarTexto(this.protetor, dados.pessoaId, 'pessoa', 'titulo_eleitor_cifrado', linha.titulo_eleitor_cifrado),
          endereco: decifrarTexto(this.protetor, dados.pessoaId, 'pessoa', 'endereco_cifrado', linha.endereco_cifrado),
          matricula: linha.matricula,
          regimeJuridico: linha.regime_juridico,
          cargo: linha.cargo,
          classe: linha.classe,
          nivel: linha.nivel,
          referencia: linha.referencia,
          setor: linha.setor,
          orgaoCodigo: linha.orgao_codigo,
          orgao: linha.orgao_nome,
          admissao: linha.admissao,
          desligamento: linha.desligamento,
        };
        const camposAlterados = (Object.keys(dados.cadastro) as (keyof AtualizarServidor['cadastro'])[])
          .filter((campo) => dados.cadastro[campo] !== cadastroAtual[campo]);
        if (camposAlterados.length === 0) {
          throw new UnprocessableEntityException('Nenhuma alteração foi informada no cadastro.');
        }

        const pessoaColunas: Partial<Record<keyof AtualizarServidor['cadastro'], { coluna: string; valor: unknown; cifrado?: string }>> = {
          nome: { coluna: 'nome', valor: dados.cadastro.nome },
          cpf: { coluna: 'cpf_cifrado', valor: dados.cadastro.cpf, cifrado: 'cpf_cifrado' },
          nascimento: { coluna: 'nascimento', valor: dados.cadastro.nascimento },
          nomeMae: { coluna: 'nome_mae_cifrado', valor: dados.cadastro.nomeMae, cifrado: 'nome_mae_cifrado' },
          nomePai: { coluna: 'nome_pai_cifrado', valor: dados.cadastro.nomePai, cifrado: 'nome_pai_cifrado' },
          pisPasep: { coluna: 'pis_pasep_cifrado', valor: dados.cadastro.pisPasep, cifrado: 'pis_pasep_cifrado' },
          rgNumero: { coluna: 'rg_numero_cifrado', valor: dados.cadastro.rgNumero, cifrado: 'rg_numero_cifrado' },
          rgOrgao: { coluna: 'rg_orgao', valor: dados.cadastro.rgOrgao },
          rgExpedicao: { coluna: 'rg_expedicao', valor: dados.cadastro.rgExpedicao },
          tituloEleitor: { coluna: 'titulo_eleitor_cifrado', valor: dados.cadastro.tituloEleitor, cifrado: 'titulo_eleitor_cifrado' },
          endereco: { coluna: 'endereco_cifrado', valor: dados.cadastro.endereco, cifrado: 'endereco_cifrado' },
        };
        const vinculoColunas: Partial<Record<keyof AtualizarServidor['cadastro'], { coluna: string; valor: unknown }>> = {
          matricula: { coluna: 'matricula', valor: dados.cadastro.matricula },
          regimeJuridico: { coluna: 'regime_juridico', valor: dados.cadastro.regimeJuridico },
          cargo: { coluna: 'cargo', valor: dados.cadastro.cargo },
          classe: { coluna: 'classe', valor: dados.cadastro.classe },
          nivel: { coluna: 'nivel', valor: dados.cadastro.nivel },
          referencia: { coluna: 'referencia', valor: dados.cadastro.referencia },
          setor: { coluna: 'setor', valor: dados.cadastro.setor },
          orgaoCodigo: { coluna: 'orgao_codigo', valor: dados.cadastro.orgaoCodigo },
          orgao: { coluna: 'orgao_nome', valor: dados.cadastro.orgao },
          admissao: { coluna: 'admissao', valor: dados.cadastro.admissao },
          desligamento: { coluna: 'desligamento', valor: dados.cadastro.desligamento },
        };
        const edicaoId = randomUUID();
        const atualizarTabela = async (
          tabela: 'pessoa' | 'vinculo',
          campos: readonly (keyof AtualizarServidor['cadastro'])[],
          colunas: typeof pessoaColunas | typeof vinculoColunas,
          id: string,
        ): Promise<string | undefined> => {
          const selecionados = campos.filter((campo) => campo in colunas);
          if (selecionados.length === 0) return undefined;
          const valores: unknown[] = [id];
          const atribuicoes = selecionados.map((campo) => {
            const definicao = colunas[campo];
            if (!definicao) throw new Error('Campo editável sem mapeamento de persistência.');
            let valor = definicao.valor;
            if ('cifrado' in definicao && definicao.cifrado) {
              const texto = valor;
              if (texto === null) {
                valores.push(null);
              } else {
                if (typeof texto !== 'string') throw new Error('Campo protegido inválido.');
                if (definicao.cifrado === 'cpf_cifrado') {
                  const cpf = cpfSchema.parse(texto);
                  valores.push(this.protetor.cifrar(Buffer.from(cpf, 'ascii'), {
                    schema: 'nucleo', tabela: 'pessoa', registroId: id, campo: 'cpf_cifrado',
                  }));
                  return `${definicao.coluna} = $${valores.length}`;
                }
                valores.push(this.protetor.cifrar(Buffer.from(texto, 'utf8'), {
                  schema: 'nucleo', tabela: 'pessoa', registroId: id, campo: definicao.cifrado,
                }));
              }
            } else {
              valores.push(valor);
            }
            if (campo === 'matricula') {
              valores.push(normalizarMatricula(dados.cadastro.matricula));
              return `${definicao.coluna} = $${valores.length - 1}, matricula_norm = $${valores.length}`;
            }
            return `${definicao.coluna} = $${valores.length}`;
          });
          if (tabela === 'pessoa') {
            if (selecionados.includes('nome')) {
              valores.push(normalizarNomeBusca(dados.cadastro.nome));
              atribuicoes.push(`nome_busca = $${valores.length}`);
            }
            if (selecionados.includes('cpf')) {
              const cpf = cpfSchema.parse(dados.cadastro.cpf);
              valores.push(this.protetor.hashCpf(cpf));
              atribuicoes.push(`cpf_hash = $${valores.length}`);
            }
            atribuicoes.push('atualizado_em = now()');
          }
          const retorno = await cliente.query<{ revisao_fonte: string }>(
            `UPDATE nucleo.${tabela} SET ${atribuicoes.join(', ')} WHERE id = $1 RETURNING revisao_fonte::text`,
            valores,
          );
          return retorno.rows[0]?.revisao_fonte;
        };

        const revisaoPessoa = await atualizarTabela('pessoa', camposAlterados, pessoaColunas, dados.pessoaId)
          ?? atual.revisao_pessoa;
        const revisaoVinculo = await atualizarTabela('vinculo', camposAlterados, vinculoColunas, dados.vinculoId)
          ?? atual.revisao_vinculo;
        const motivoCifrado = this.protetor.cifrar(Buffer.from(dados.motivo, 'utf8'), {
          schema: 'nucleo', tabela: 'edicao_servidor_auditoria', registroId: edicaoId, campo: 'motivo_cifrado',
        });
        await cliente.query(`
          INSERT INTO nucleo.edicao_servidor_auditoria
            (id, usuario_id, pessoa_id, vinculo_id, campos, motivo_cifrado)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [edicaoId, sessao.usuario.id, dados.pessoaId, dados.vinculoId, camposAlterados, motivoCifrado]);
        await cliente.query(`
          INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, entidade_id, pessoa_id, ip, detalhes)
          VALUES ($1, 'cadastro_servidor_editado', 'servidor', $2, $3, $4, jsonb_build_object('campos', $5::text[]))
        `, [sessao.usuario.id, dados.vinculoId, dados.pessoaId, ip, camposAlterados]);
        return { atualizado: true, revisaoPessoa, revisaoVinculo };
      });
    } catch (erro) {
      if (erro instanceof DatabaseError && erro.code === '23505') {
        throw new ConflictException('O CPF ou a matrícula informados já estão cadastrados para outro servidor.');
      }
      throw erro;
    }
  }

  async buscar(sessao: SessaoAutenticada, ip: string, consulta: BuscarServidoresQuery): Promise<PaginaBuscaServidores> {
    const termo = consulta.q ?? '';
    const nome = normalizarNomeBusca(termo);
    const cpf = cpfSchema.safeParse(consulta.q);
    const consultarNome = (consulta.tipo === 'nome' || !consulta.tipo) && nome.length >= 3;
    const consultarMatricula = (consulta.tipo === 'matricula' || !consulta.tipo) && termo.length > 0 && termo.length <= 100;
    const consultarCpf = (consulta.tipo === 'cpf' || !consulta.tipo) && cpf.success;
    const padraoNome = consultarNome ? `%${nome.replace(/[#%_]/g, '#$&')}%` : null;
    const matricula = consultarMatricula ? normalizarMatricula(termo) : null;
    const cpfHash = consultarCpf && cpf.success ? this.protetor.hashCpf(cpf.data) : null;
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_pessoa'));
      const resultado = await cliente.query<LinhaBusca>(`
        SELECT p.id AS pessoa_id, v.id AS vinculo_id, p.nome, p.cpf_cifrado, v.matricula, v.orgao_nome,
          v.sistema_origem, v.removido_na_fonte_em IS NOT NULL AS removido
        FROM nucleo.vinculo v JOIN nucleo.pessoa p ON p.id = v.pessoa_id
        WHERE ($4::uuid IS NULL OR
          (nucleo.chave_matricula_natural(v.matricula) COLLATE "C", v.sistema_origem COLLATE "C", v.id) >
          (SELECT nucleo.chave_matricula_natural(c.matricula) COLLATE "C", c.sistema_origem COLLATE "C", c.id
            FROM nucleo.vinculo c WHERE c.id = $4::uuid))
          AND ($6::boolean OR ($1::text IS NOT NULL AND p.nome_busca LIKE $1 ESCAPE '#')
            OR ($2::text IS NOT NULL AND v.matricula_norm = $2)
            OR ($3::bytea IS NOT NULL AND p.cpf_hash = $3))
        ORDER BY nucleo.chave_matricula_natural(v.matricula) COLLATE "C", v.sistema_origem COLLATE "C", v.id LIMIT $5
      `, [padraoNome, matricula, cpfHash, consulta.cursor ?? null, consulta.limite + 1, !consulta.q]);
      await auditarConsultaFuncional(cliente, sessao, 'servidores_pesquisados', 'busca', null, null, ip);
      return {
        itens: resultado.rows.slice(0, consulta.limite).map((linha) => ({
          pessoaId: linha.pessoa_id,
          vinculoId: linha.vinculo_id,
          nome: linha.nome,
          cpf: cpfSchema.parse(decifrarTexto(this.protetor, linha.pessoa_id, 'pessoa', 'cpf_cifrado', linha.cpf_cifrado)),
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
        FROM nucleo.vinculo WHERE pessoa_id = $1 AND ($2::uuid IS NULL OR
          (nucleo.chave_matricula_natural(matricula) COLLATE "C", sistema_origem COLLATE "C", id) >
          (SELECT nucleo.chave_matricula_natural(c.matricula) COLLATE "C", c.sistema_origem COLLATE "C", c.id
            FROM nucleo.vinculo c WHERE c.id = $2::uuid AND c.pessoa_id = $1))
        ORDER BY nucleo.chave_matricula_natural(matricula) COLLATE "C", sistema_origem COLLATE "C", id LIMIT $3
      `, [pessoa.id, cursor ?? null, limite + 1]);
      await auditarConsultaFuncional(cliente, sessao, 'servidor_consultado', 'pessoa', pessoa.id, pessoa.id, ip);
      return {
        pessoa: { id: pessoa.id, nome: pessoa.nome, cpf },
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
