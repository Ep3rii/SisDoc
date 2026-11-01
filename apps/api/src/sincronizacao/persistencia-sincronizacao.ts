import {
  normalizarMatricula,
  normalizarNomeBusca,
  servidorApiSincronizacaoSchema,
  type ServidorApiSincronizacao
} from '@sisdoc/contratos';
import { randomUUID } from 'node:crypto';
import { type PoolClient } from 'pg';
import { z } from 'zod';
import { ProtetorDados } from '../seguranca/protecao-dados';

/** Falha de item com mensagem sanitizada para o savepoint chamador. */
export class ErroItem extends Error {}

/** Identifica hash de conteúdo inalterado sem tratar ausência como igualdade. */
function mesmoBuffer(a: Buffer | null, b: Buffer): boolean {
  return a !== null && a.length === b.length && a.equals(b);
}

/** Persiste um item validado; savepoint, transação e contagens pertencem ao coordenador do lote. */
export class PersistenciaSincronizacao {
  /** Compartilha o protetor do serviço, sem criar pool ou acesso próprio à fonte externa. */
  constructor(private readonly protetor: ProtetorDados) {}

  /** Resume caminhos de campos inválidos, sem incluir valores pessoais recebidos da fonte. */
  private motivoValidacao(problemas: z.ZodError['issues']): string {
    const campos = [...new Set(problemas.map((problema) => problema.path.map((parte) => String(parte)).join('.') || 'item'))];
    return `Dados inválidos nos campos: ${campos.slice(0, 10).join(', ')}.`;
  }

  /** Protege campo opcional da pessoa com contexto de UUID e coluna do núcleo. */
  private cifrarCampo(pessoaId: string, campo: string, valor: string | null): Buffer | null {
    if (valor === null) return null;
    return this.protetor.cifrar(Buffer.from(valor, 'utf8'), {
      schema: 'nucleo', tabela: 'pessoa', registroId: pessoaId, campo,
    });
  }

  /** Lê texto opcional autenticado para comparar valores e evitar recifrar dados inalterados. */
  private decifrarCampo(pessoaId: string, campo: string, valor: Buffer | null): string | null {
    if (valor === null) return null;
    return this.protetor.decifrar(valor, { schema: 'nucleo', tabela: 'pessoa', registroId: pessoaId, campo }).toString('utf8');
  }

  /** Trava pessoa, compara dados e atualiza somente quando necessário, com o cliente já transacional. */
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

  /** Valida item e resolve pessoa/vínculos por origem, rejeitando troca de CPF, pessoa ou matrícula existente. */
  async aplicar(
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
}
