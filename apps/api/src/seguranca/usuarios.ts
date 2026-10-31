import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  papelSchema,
  type AtualizarUsuario,
  type CriarUsuario,
  type PaginaAuditoria,
  type PaginaUsuarios,
  type UsuarioAdministrativo,
} from '@sisdoc/contratos';
import { DatabaseError, type Pool, type PoolClient } from 'pg';
import { transacao } from '../banco';
import { AutenticacaoService, type SessaoAutenticada } from './autenticacao';
import { papeisPermitidos } from './permissoes';
import { gerarHashSenha } from './senhas';
import { confirmarSessao } from './sessao-transacao';

type UsuarioBanco = {
  id: string;
  matricula: string;
  nome: string;
  email: string | null;
  papel: string;
  ativo: boolean;
  troca_senha_obrigatoria: boolean;
};

function usuarioAdministrativo(usuario: UsuarioBanco): UsuarioAdministrativo {
  return {
    id: usuario.id,
    matricula: usuario.matricula,
    nome: usuario.nome,
    email: usuario.email,
    papel: papelSchema.parse(usuario.papel),
    ativo: usuario.ativo,
    trocaSenhaObrigatoria: usuario.troca_senha_obrigatoria,
  };
}

async function registrarEvento(
  cliente: PoolClient,
  sessao: SessaoAutenticada,
  acao: string,
  entidade: string,
  entidadeId: string | null,
  ip: string,
  campos: readonly string[] = [],
): Promise<void> {
  await cliente.query(`
    INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, entidade_id, ip, detalhes)
    VALUES ($1, $2, $3, $4, $5, jsonb_build_object('campos', $6::text[]))
  `, [sessao.usuario.id, acao, entidade, entidadeId, ip, campos]);
}

async function bloquearAdministracao(cliente: PoolClient): Promise<void> {
  await cliente.query('SELECT pg_advisory_xact_lock(1936286851, 2001)');
}

export class UsuariosService {
  constructor(private readonly banco: Pool, private readonly autenticacao: AutenticacaoService) {}

  async listar(sessao: SessaoAutenticada, ip: string, limite: number, cursor?: string): Promise<PaginaUsuarios> {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('gerenciar_usuarios'));
      const resultado = await cliente.query<UsuarioBanco>(`
        SELECT id, matricula, nome, email, papel, ativo, troca_senha_obrigatoria
        FROM seguranca.usuario WHERE ($1::uuid IS NULL OR id > $1::uuid)
        ORDER BY id LIMIT $2
      `, [cursor ?? null, limite + 1]);
      await registrarEvento(cliente, sessao, 'usuarios_listados', 'usuario', null, ip);
      return {
        itens: resultado.rows.slice(0, limite).map(usuarioAdministrativo),
        proximoCursor: resultado.rows.length > limite ? resultado.rows[limite - 1].id : null,
      };
    });
  }

  async criar(sessao: SessaoAutenticada, ip: string, dados: CriarUsuario): Promise<UsuarioAdministrativo> {
    await this.autenticacao.validarSenhaNova(dados.senha);
    const senhaHash = await gerarHashSenha(dados.senha);
    try {
      return await transacao(this.banco, async (cliente) => {
        await bloquearAdministracao(cliente);
        await confirmarSessao(cliente, sessao, papeisPermitidos('gerenciar_usuarios'));
        const resultado = await cliente.query<UsuarioBanco>(`
          INSERT INTO seguranca.usuario (id, matricula, nome, email, senha_hash, papel)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, matricula, nome, email, papel, ativo, troca_senha_obrigatoria
        `, [randomUUID(), dados.matricula, dados.nome, dados.email ?? null, senhaHash, dados.papel]);
        const usuario = usuarioAdministrativo(resultado.rows[0]);
        await registrarEvento(cliente, sessao, 'usuario_criado', 'usuario', usuario.id, ip);
        return usuario;
      });
    } catch (erro) {
      if (erro instanceof DatabaseError && erro.code === '23505'
          && ['usuario_matricula_normalizada', 'usuario_matricula_key'].includes(erro.constraint ?? '')) {
        throw new ConflictException('Já existe um usuário com essa matrícula.');
      }
      throw erro;
    }
  }

  async atualizar(
    sessao: SessaoAutenticada,
    ip: string,
    id: string,
    dados: AtualizarUsuario,
  ): Promise<UsuarioAdministrativo> {
    return transacao(this.banco, async (cliente) => {
      await bloquearAdministracao(cliente);
      await confirmarSessao(cliente, sessao, papeisPermitidos('gerenciar_usuarios'));
      const consulta = await cliente.query<UsuarioBanco>(`
        SELECT id, matricula, nome, email, papel, ativo, troca_senha_obrigatoria
        FROM seguranca.usuario WHERE id = $1 FOR UPDATE
      `, [id]);
      const atual = consulta.rows[0];
      if (!atual) throw new NotFoundException('Usuário não encontrado.');
      const papel = dados.papel ?? atual.papel;
      const ativo = dados.ativo ?? atual.ativo;
      if (atual.papel === 'admin' && atual.ativo && (papel !== 'admin' || !ativo)) {
        const outros = await cliente.query<{ existe: boolean }>(`
          SELECT EXISTS (SELECT 1 FROM seguranca.usuario WHERE id <> $1 AND papel = 'admin' AND ativo) AS existe
        `, [id]);
        if (!outros.rows[0].existe) {
          throw new ConflictException('Mantenha ao menos um administrador ativo.');
        }
      }
      const resultado = await cliente.query<UsuarioBanco>(`
        UPDATE seguranca.usuario SET nome = $2, email = $3, papel = $4, ativo = $5
        WHERE id = $1
        RETURNING id, matricula, nome, email, papel, ativo, troca_senha_obrigatoria
      `, [id, dados.nome ?? atual.nome, dados.email === undefined ? atual.email : dados.email, papel, ativo]);
      if (papel !== atual.papel || ativo !== atual.ativo) {
        await cliente.query('DELETE FROM seguranca.sessao WHERE usuario_id = $1', [id]);
      }
      await registrarEvento(cliente, sessao, 'usuario_atualizado', 'usuario', id, ip, Object.keys(dados));
      return usuarioAdministrativo(resultado.rows[0]);
    });
  }

  async redefinirSenha(sessao: SessaoAutenticada, ip: string, id: string, senha: string): Promise<void> {
    await this.autenticacao.validarSenhaNova(senha);
    const senhaHash = await gerarHashSenha(senha);
    await transacao(this.banco, async (cliente) => {
      await bloquearAdministracao(cliente);
      await confirmarSessao(cliente, sessao, papeisPermitidos('gerenciar_usuarios'));
      const resultado = await cliente.query(`
        UPDATE seguranca.usuario SET senha_hash = $2, troca_senha_obrigatoria = true,
          tentativas_falhas = 0, bloqueado_ate = NULL
        WHERE id = $1 RETURNING id
      `, [id, senhaHash]);
      if (resultado.rowCount !== 1) throw new NotFoundException('Usuário não encontrado.');
      await cliente.query('DELETE FROM seguranca.sessao WHERE usuario_id = $1', [id]);
      await registrarEvento(cliente, sessao, 'senha_redefinida', 'usuario', id, ip);
    });
  }

  async listarAuditoria(sessao: SessaoAutenticada, ip: string, limite: number, cursor?: string): Promise<PaginaAuditoria> {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_auditoria'));
      const resultado = await cliente.query<{
        id: string; usuario_id: string | null; acao: string; entidade: string; entidade_id: string | null; em: Date;
      }>(`
        SELECT id, usuario_id, acao, entidade,
          CASE WHEN entidade = 'usuario' THEN entidade_id ELSE NULL END AS entidade_id, em
        FROM seguranca.auditoria
        WHERE ($1::bigint IS NULL OR id < $1::bigint)
        ORDER BY id DESC LIMIT $2
      `, [cursor ?? null, limite + 1]);
      await registrarEvento(cliente, sessao, 'auditoria_consultada', 'auditoria', null, ip);
      return {
        itens: resultado.rows.slice(0, limite).map((evento) => ({
          id: evento.id,
          usuarioId: evento.usuario_id,
          acao: evento.acao,
          entidade: evento.entidade,
          entidadeId: evento.entidade_id,
          em: evento.em.toISOString(),
        })),
        proximoCursor: resultado.rows.length > limite ? resultado.rows[limite - 1].id : null,
      };
    });
  }
}
