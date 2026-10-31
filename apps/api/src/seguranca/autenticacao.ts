import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { papelSchema, type Configuracao } from '@sisdoc/contratos';
import { verify } from 'argon2';
import type { Pool, PoolClient } from 'pg';
import { transacao } from '../banco';
import { ErroPoliticaSenha, gerarHashSenha, verificarSenha } from './senhas';
import { hashSessao, novoTokenSessao, tokenCsrf } from './tokens';
import type { Papel } from './permissoes';

type UsuarioBanco = {
  id: string;
  matricula: string;
  nome: string;
  papel: Papel;
  senha_hash: string;
  ativo: boolean;
  troca_senha_obrigatoria: boolean;
  tentativas_falhas: number;
  bloqueado: boolean;
  bloqueio_expirado: boolean;
};
type UsuarioIdentidade = Pick<UsuarioBanco, 'id' | 'matricula' | 'nome' | 'papel' | 'troca_senha_obrigatoria'>;

export type UsuarioSessao = {
  id: string;
  matricula: string;
  nome: string;
  papel: Papel;
  trocaSenhaObrigatoria: boolean;
};

export type SessaoAutenticada = {
  usuario: UsuarioSessao;
  hash: Buffer;
  csrf: string;
};

type Limite = { escopo: 'ip' | 'matricula'; hash: Buffer; maximo: number };

function usuarioPublico(usuario: UsuarioIdentidade): UsuarioSessao {
  return {
    id: usuario.id,
    matricula: usuario.matricula,
    nome: usuario.nome,
    papel: papelSchema.parse(usuario.papel),
    trocaSenhaObrigatoria: usuario.troca_senha_obrigatoria,
  };
}

@Injectable()
export class AutenticacaoService implements OnModuleInit {
  private readonly hashFicticio: Promise<string>;
  private readonly chaveHmac: Buffer;

  constructor(private readonly banco: Pool, private readonly configuracao: Configuracao) {
    this.chaveHmac = Buffer.from(configuracao.chaves.hmac, 'base64');
    this.hashFicticio = gerarHashSenha(randomBytes(32).toString('base64url'));
  }

  async onModuleInit(): Promise<void> {
    await this.hashFicticio;
  }

  private hashLimite(escopo: Limite['escopo'], valor: string): Buffer {
    return createHmac('sha256', this.chaveHmac).update(`sisdoc/limite/${escopo}/v1\0`, 'utf8')
      .update(valor, 'utf8').digest();
  }

  private async verificarHash(hash: string, senha: string): Promise<boolean> {
    try {
      return await verify(hash, senha);
    } catch {
      throw new ServiceUnavailableException('Não foi possível verificar a credencial. Contate o administrador.');
    }
  }

  private async registrarAuditoria(
    cliente: PoolClient,
    usuarioId: string | null,
    acao: string,
    ip: string,
  ): Promise<void> {
    await cliente.query(
      "INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, ip) VALUES ($1, $2, 'autenticacao', $3)",
      [usuarioId, acao, ip],
    );
  }

  private async prepararLimites(cliente: PoolClient, matricula: string, ip: string): Promise<{ limites: Limite[]; bloqueado: boolean }> {
    const normalizada = (await cliente.query<{ valor: string }>(
      'SELECT upper(btrim($1::text)) AS valor', [matricula],
    )).rows[0].valor;
    const limites: Limite[] = [
      { escopo: 'ip', hash: this.hashLimite('ip', ip), maximo: 20 },
      { escopo: 'matricula', hash: this.hashLimite('matricula', normalizada), maximo: 5 },
    ];
    let bloqueado = false;
    for (const limite of limites) {
      await cliente.query(
        'INSERT INTO seguranca.limite_login (escopo, identificador_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [limite.escopo, limite.hash],
      );
      const resultado = await cliente.query<{
        falhas: number; bloqueado: boolean; janela_expirada: boolean; bloqueio_expirado: boolean;
      }>(`
        SELECT falhas, COALESCE(bloqueado_ate > now(), false) AS bloqueado,
          janela_inicio <= now() - interval '15 minutes' AS janela_expirada,
          COALESCE(bloqueado_ate <= now(), false) AS bloqueio_expirado
        FROM seguranca.limite_login WHERE escopo = $1 AND identificador_hash = $2 FOR UPDATE
      `, [limite.escopo, limite.hash]);
      const estado = resultado.rows[0];
      if (!estado.bloqueado && (estado.janela_expirada || estado.bloqueio_expirado)) {
        await cliente.query(`
          UPDATE seguranca.limite_login SET falhas = 0, janela_inicio = now(), bloqueado_ate = NULL
          WHERE escopo = $1 AND identificador_hash = $2
        `, [limite.escopo, limite.hash]);
      } else if (estado.bloqueado || estado.falhas >= limite.maximo) {
        bloqueado = true;
      }
    }
    return { limites, bloqueado };
  }

  private async falharLimites(cliente: PoolClient, limites: Limite[]): Promise<void> {
    for (const limite of limites) {
      await cliente.query(`
        UPDATE seguranca.limite_login
        SET falhas = falhas + 1,
          bloqueado_ate = CASE WHEN falhas + 1 >= $3 THEN now() + interval '15 minutes' ELSE bloqueado_ate END
        WHERE escopo = $1 AND identificador_hash = $2
      `, [limite.escopo, limite.hash, limite.maximo]);
    }
  }

  private async conferirCredencial<T>(
    matricula: string,
    senha: string,
    ip: string,
    acao: 'login' | 'troca_senha',
    usuarioObrigatorio: string | undefined,
    aoValidar: (cliente: PoolClient, usuario: UsuarioBanco) => Promise<T>,
  ): Promise<T> {
    if (!isIP(ip)) throw new BadRequestException('Não foi possível identificar o endereço do cliente.');
    const resultado = await transacao(this.banco, async (cliente) => {
      const { limites, bloqueado } = await this.prepararLimites(cliente, matricula, ip);
      if (bloqueado) {
        await this.verificarHash(await this.hashFicticio, senha);
        await this.registrarAuditoria(cliente, usuarioObrigatorio ?? null, `${acao}_falhou`, ip);
        return null;
      }
      const consulta = await cliente.query<UsuarioBanco>(`
        SELECT id, matricula, nome, papel, senha_hash, ativo, troca_senha_obrigatoria, tentativas_falhas,
          COALESCE(bloqueado_ate > now(), false) AS bloqueado,
          COALESCE(bloqueado_ate <= now(), false) AS bloqueio_expirado
        FROM seguranca.usuario WHERE upper(btrim(matricula)) = upper(btrim($1::text)) FOR UPDATE
      `, [matricula]);
      const usuario = consulta.rows[0];
      const senhaValida = await this.verificarHash(usuario?.senha_hash ?? await this.hashFicticio, senha);
      if (!usuario || !senhaValida || !usuario.ativo || usuario.bloqueado ||
          (usuarioObrigatorio && usuario.id !== usuarioObrigatorio)) {
        await this.falharLimites(cliente, limites);
        if (usuario && !usuario.bloqueado) {
          const falhas = usuario.bloqueio_expirado ? 1 : usuario.tentativas_falhas + 1;
          await cliente.query(`
            UPDATE seguranca.usuario SET tentativas_falhas = $2,
              bloqueado_ate = CASE WHEN $2 >= 5 THEN now() + interval '15 minutes' ELSE NULL END
            WHERE id = $1
          `, [usuario.id, falhas]);
        }
        await this.registrarAuditoria(cliente, usuarioObrigatorio ?? null, `${acao}_falhou`, ip);
        return null;
      }
      await cliente.query(`
        UPDATE seguranca.limite_login SET falhas = 0, janela_inicio = now(), bloqueado_ate = NULL
        WHERE escopo = 'matricula' AND identificador_hash = $1
      `, [limites[1].hash]);
      await cliente.query(`
        UPDATE seguranca.usuario SET tentativas_falhas = 0, bloqueado_ate = NULL,
          ultimo_login = CASE WHEN $2 = 'login' THEN now() ELSE ultimo_login END
        WHERE id = $1
      `, [usuario.id, acao]);
      const saida = await aoValidar(cliente, usuario);
      await this.registrarAuditoria(cliente, usuario.id, acao, ip);
      return saida;
    });
    if (resultado === null) throw new UnauthorizedException('Matrícula ou senha inválida.');
    return resultado;
  }

  async validarSenhaNova(senha: string): Promise<void> {
    const lista = this.configuracao.seguranca?.listaSenhas;
    if (!lista) throw new ServiceUnavailableException('Configure a lista local de senhas comuns antes de alterar senhas.');
    try {
      await verificarSenha(senha, lista);
    } catch (erro) {
      if (!(erro instanceof ErroPoliticaSenha)) throw erro;
      if (erro.codigo === 'invalida') throw new BadRequestException(erro.message);
      throw new ServiceUnavailableException(erro.message);
    }
  }

  async entrar(
    matricula: string,
    senha: string,
    ip: string,
    tokenAnterior?: string,
  ): Promise<{ token: string; csrf: string; usuario: UsuarioSessao }> {
    return this.conferirCredencial(matricula, senha, ip, 'login', undefined, async (cliente, usuario) => {
      if (tokenAnterior) await cliente.query('DELETE FROM seguranca.sessao WHERE id_hash = $1', [hashSessao(tokenAnterior)]);
      const token = novoTokenSessao();
      await cliente.query(`
        INSERT INTO seguranca.sessao (id_hash, usuario_id, expira_em, ultimo_uso, ip)
        VALUES ($1, $2, now() + interval '8 hours', now(), $3)
      `, [hashSessao(token), usuario.id, ip]);
      return { token, csrf: tokenCsrf(token, this.configuracao.chaves.hmac), usuario: usuarioPublico(usuario) };
    });
  }

  async obterSessao(token: string): Promise<SessaoAutenticada> {
    const hash = hashSessao(token);
    const resultado = await this.banco.query<UsuarioIdentidade>(`
      UPDATE seguranca.sessao s SET ultimo_uso = now()
      FROM seguranca.usuario u
      WHERE s.id_hash = $1 AND s.usuario_id = u.id AND u.ativo
        AND s.expira_em > now() AND s.ultimo_uso > now() - interval '30 minutes'
      RETURNING u.id, u.matricula, u.nome, u.papel, u.troca_senha_obrigatoria
    `, [hash]);
    if (!resultado.rows[0]) throw new UnauthorizedException('Sessão inválida ou expirada.');
    return {
      usuario: usuarioPublico(resultado.rows[0]),
      hash,
      csrf: tokenCsrf(token, this.configuracao.chaves.hmac),
    };
  }

  async sair(sessao: SessaoAutenticada, ip: string): Promise<void> {
    await transacao(this.banco, async (cliente) => {
      await cliente.query('DELETE FROM seguranca.sessao WHERE id_hash = $1', [sessao.hash]);
      await this.registrarAuditoria(cliente, sessao.usuario.id, 'logout', ip);
    });
  }

  async registrarAcessoNegado(usuarioId: string, acao: string, ip: string): Promise<void> {
    await this.banco.query(`
      INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, detalhes, ip)
      VALUES ($1, 'acesso_negado', 'autorizacao', jsonb_build_object('acao', $2::text), $3)
    `, [usuarioId, acao, ip]);
  }

  async trocarSenha(sessao: SessaoAutenticada, senhaAtual: string, senhaNova: string, ip: string): Promise<void> {
    await this.validarSenhaNova(senhaNova);
    const senhaHash = await gerarHashSenha(senhaNova);
    await this.conferirCredencial(
      sessao.usuario.matricula, senhaAtual, ip, 'troca_senha', sessao.usuario.id,
      async (cliente, usuario) => {
        if (await this.verificarHash(usuario.senha_hash, senhaNova)) {
          throw new BadRequestException('A nova senha deve ser diferente da atual.');
        }
        await cliente.query(`
          UPDATE seguranca.usuario SET senha_hash = $2, troca_senha_obrigatoria = false
          WHERE id = $1
        `, [usuario.id, senhaHash]);
        await cliente.query('DELETE FROM seguranca.sessao WHERE usuario_id = $1', [usuario.id]);
        return true;
      },
    );
  }
}
