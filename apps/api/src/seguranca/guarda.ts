import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Configuracao } from '@sisdoc/contratos';
import { CONFIGURACAO } from '../injecao';
import { AutenticacaoService, type SessaoAutenticada } from './autenticacao';
import { perfilPermiteAcao, type Acao } from './permissoes';
import { csrfValido, origemValida, tokenDoCookie } from './tokens';

const PUBLICA = 'sisdoc.publica';
const ACAO = 'sisdoc.acao';
export type AcaoRota = Acao | 'sessao' | 'trocar_senha' | 'sair';

export const Publica = () => SetMetadata(PUBLICA, true);
export const ExigirAcao = (acao: AcaoRota) => SetMetadata(ACAO, acao);

export interface RequisicaoAutenticada extends IncomingMessage {
  sessao?: SessaoAutenticada;
}

export function ipRequisicao(req: IncomingMessage): string {
  const ip = req.socket.remoteAddress;
  if (!ip || !isIP(ip)) throw new BadRequestException('Não foi possível identificar o endereço do cliente.');
  return ip;
}

export function exigirSessao(req: RequisicaoAutenticada): SessaoAutenticada {
  if (!req.sessao) throw new UnauthorizedException('Sessão inválida ou expirada.');
  return req.sessao;
}

@Injectable()
export class GuardaAcesso implements CanActivate {
  constructor(
    private readonly refletor: Reflector,
    private readonly autenticacao: AutenticacaoService,
    @Inject(CONFIGURACAO) private readonly configuracao: Configuracao,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const alvos = [contexto.getHandler(), contexto.getClass()];
    if (this.refletor.getAllAndOverride<boolean>(PUBLICA, alvos)) return true;
    const acao = this.refletor.getAllAndOverride<AcaoRota>(ACAO, alvos);
    if (!acao) throw new ForbiddenException('A rota não possui política de acesso configurada.');
    const req = contexto.switchToHttp().getRequest<RequisicaoAutenticada>();
    const token = tokenDoCookie(req);
    if (!token) throw new UnauthorizedException('Sessão inválida ou expirada.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '')) {
      const cabecalho = req.headers['x-csrf-token'];
      if (!origemValida(req, this.configuracao)
          || !csrfValido(token, typeof cabecalho === 'string' ? cabecalho : undefined, this.configuracao.chaves.hmac)) {
        throw new ForbiddenException('Origem ou token CSRF inválido.');
      }
    }
    const sessao = await this.autenticacao.obterSessao(token);
    const acaoSessao = acao === 'sessao' || acao === 'trocar_senha' || acao === 'sair';
    const negado = (sessao.usuario.trocaSenhaObrigatoria && !acaoSessao)
      || (!acaoSessao && !perfilPermiteAcao(sessao.usuario.papel, acao));
    if (negado) {
      await this.autenticacao.registrarAcessoNegado(sessao.usuario.id, acao, ipRequisicao(req));
      throw new ForbiddenException(sessao.usuario.trocaSenhaObrigatoria
        ? 'Altere a senha inicial antes de continuar.' : 'Seu perfil não permite esta ação.');
    }
    req.sessao = sessao;
    return true;
  }
}
