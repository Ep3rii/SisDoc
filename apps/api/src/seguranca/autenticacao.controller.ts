import type { ServerResponse } from 'node:http';
import {
  Body,
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { loginSchema, trocarSenhaSchema, type Configuracao } from '@sisdoc/contratos';
import { CONFIGURACAO } from '../injecao';
import { AutenticacaoService, type UsuarioSessao } from './autenticacao';
import { ExigirAcao, exigirSessao, ipRequisicao, Publica, type RequisicaoAutenticada } from './guarda';
import { cookieExpirado, cookieSessao, origemValida, tokenDoCookie } from './tokens';

@Controller('auth')
export class AutenticacaoController {
  constructor(
    private readonly autenticacao: AutenticacaoService,
    @Inject(CONFIGURACAO) private readonly configuracao: Configuracao,
  ) {}

  @Publica()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutenticada,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<{ usuario: UsuarioSessao; csrf: string }> {
    if (!origemValida(req, this.configuracao)) throw new ForbiddenException('Origem da requisição inválida.');
    const dados = loginSchema.safeParse(corpo);
    if (!dados.success) throw new UnauthorizedException('Matrícula ou senha inválida.');
    const resultado = await this.autenticacao.entrar(
      dados.data.matricula, dados.data.senha, ipRequisicao(req), tokenDoCookie(req),
    );
    res.setHeader('Set-Cookie', cookieSessao(resultado.token));
    return { usuario: resultado.usuario, csrf: resultado.csrf };
  }

  @ExigirAcao('sessao')
  @Get('me')
  me(@Req() req: RequisicaoAutenticada): { usuario: UsuarioSessao; csrf: string } {
    const sessao = exigirSessao(req);
    return { usuario: sessao.usuario, csrf: sessao.csrf };
  }

  @ExigirAcao('sair')
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: RequisicaoAutenticada,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<{ encerrada: true }> {
    await this.autenticacao.sair(exigirSessao(req), ipRequisicao(req));
    res.setHeader('Set-Cookie', cookieExpirado());
    return { encerrada: true };
  }

  @ExigirAcao('trocar_senha')
  @Post('trocar-senha')
  @HttpCode(200)
  async trocarSenha(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutenticada,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<{ alterada: true }> {
    const dados = trocarSenhaSchema.safeParse(corpo);
    if (!dados.success) throw new BadRequestException('Informe a senha atual e uma nova senha válida.');
    await this.autenticacao.trocarSenha(exigirSessao(req), dados.data.senhaAtual, dados.data.senhaNova, ipRequisicao(req));
    res.setHeader('Set-Cookie', cookieExpirado());
    return { alterada: true };
  }
}
