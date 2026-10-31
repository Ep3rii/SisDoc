import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  atualizarUsuarioSchema,
  criarUsuarioSchema,
  paginaAuditoriaQuerySchema,
  paginaUsuariosQuerySchema,
  redefinirSenhaSchema,
} from '@sisdoc/contratos';
import { z } from 'zod';
import { ExigirAcao, exigirSessao, ipRequisicao, type RequisicaoAutenticada } from './guarda';
import { UsuariosService } from './usuarios';

function idUsuario(valor: string): string {
  const resultado = z.uuid().safeParse(valor);
  if (!resultado.success) throw new BadRequestException('Identificador de usuário inválido.');
  return resultado.data;
}

@Controller('admin')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @ExigirAcao('gerenciar_usuarios')
  @Get('usuarios')
  listar(@Query() consulta: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = paginaUsuariosQuerySchema.safeParse(consulta);
    if (!dados.success) throw new BadRequestException('Paginação inválida; o limite máximo é 50.');
    return this.usuarios.listar(exigirSessao(req), ipRequisicao(req), dados.data.limite, dados.data.cursor);
  }

  @ExigirAcao('gerenciar_usuarios')
  @Post('usuarios')
  criar(@Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = criarUsuarioSchema.safeParse(corpo);
    if (!dados.success) throw new BadRequestException('Confira matrícula, nome, perfil, e-mail e senha do usuário.');
    return this.usuarios.criar(exigirSessao(req), ipRequisicao(req), dados.data);
  }

  @ExigirAcao('gerenciar_usuarios')
  @Patch('usuarios/:id')
  atualizar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = atualizarUsuarioSchema.safeParse(corpo);
    if (!dados.success) throw new BadRequestException('Informe campos válidos para atualizar o usuário.');
    return this.usuarios.atualizar(exigirSessao(req), ipRequisicao(req), idUsuario(id), dados.data);
  }

  @ExigirAcao('gerenciar_usuarios')
  @Post('usuarios/:id/redefinir-senha')
  @HttpCode(200)
  async redefinir(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = redefinirSenhaSchema.safeParse(corpo);
    if (!dados.success) throw new BadRequestException('Informe uma nova senha válida.');
    await this.usuarios.redefinirSenha(exigirSessao(req), ipRequisicao(req), idUsuario(id), dados.data.senha);
    return { redefinida: true };
  }

  @ExigirAcao('consultar_auditoria')
  @Get('auditoria')
  auditoria(@Query() consulta: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = paginaAuditoriaQuerySchema.safeParse(consulta);
    if (!dados.success) throw new BadRequestException('Paginação inválida; o limite máximo é 50.');
    return this.usuarios.listarAuditoria(exigirSessao(req), ipRequisicao(req), dados.data.limite, dados.data.cursor);
  }
}
