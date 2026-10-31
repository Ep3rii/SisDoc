import type { ServerResponse } from 'node:http';
import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import {
  atualizarBlocosDofSchema, atualizarProcessoDofSchema, atualizarRascunhoDofSchema, criarRascunhoDofSchema,
  encaminharRascunhoDofSchema, paginaUuidQuerySchema, recolherRascunhoDofSchema,
} from '@sisdoc/contratos';
import { renderizarPreviaDof } from '@sisdoc/templates';
import { z } from 'zod';
import { ExigirAcao, exigirSessao, ipRequisicao, type RequisicaoAutenticada } from '../seguranca/guarda';
import { RascunhosService } from './rascunhos';

function idDocumento(valor: string): string {
  const resultado = z.uuid().safeParse(valor);
  if (!resultado.success) throw new BadRequestException('Identificador de rascunho inválido.');
  return resultado.data;
}

@Controller('documentos')
export class RascunhosController {
  constructor(private readonly rascunhos: RascunhosService) {}

  @ExigirAcao('criar_rascunho')
  @Get()
  listar(@Query() consulta: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = paginaUuidQuerySchema.safeParse(consulta);
    if (!dados.success) throw new BadRequestException('Paginação inválida; o limite máximo é 50.');
    return this.rascunhos.listar(exigirSessao(req), ipRequisicao(req), dados.data.limite, dados.data.cursor);
  }

  @ExigirAcao('editar_rascunho')
  @Get('coordenadores')
  listarCoordenadores(@Query() consulta: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = paginaUuidQuerySchema.safeParse(consulta);
    if (!dados.success) throw new BadRequestException('Paginação inválida; o limite máximo é 50.');
    return this.rascunhos.listarCoordenadores(exigirSessao(req), ipRequisicao(req), dados.data.limite, dados.data.cursor);
  }

  @ExigirAcao('receber_encaminhamento')
  @Get('encaminhados')
  listarEncaminhados(@Query() consulta: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = paginaUuidQuerySchema.safeParse(consulta);
    if (!dados.success) throw new BadRequestException('Paginação inválida; o limite máximo é 50.');
    return this.rascunhos.listarEncaminhados(exigirSessao(req), ipRequisicao(req), dados.data.limite, dados.data.cursor);
  }

  @ExigirAcao('criar_rascunho')
  @Get(':id')
  obter(@Param('id') id: string, @Req() req: RequisicaoAutenticada) {
    return this.rascunhos.obter(exigirSessao(req), ipRequisicao(req), idDocumento(id));
  }

  @ExigirAcao('criar_rascunho')
  @Get(':id/previa')
  async previa(@Param('id') id: string, @Req() req: RequisicaoAutenticada, @Res() resposta: ServerResponse) {
    const rascunho = await this.rascunhos.obterParaPrevia(exigirSessao(req), ipRequisicao(req), idDocumento(id));
    resposta.setHeader('Content-Type', 'text/html; charset=utf-8');
    resposta.setHeader('Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox");
    resposta.setHeader('X-Sisdoc-Revisao', String(rascunho.revisao));
    resposta.end(renderizarPreviaDof(rascunho));
  }

  @ExigirAcao('conferir')
  @Get(':id/preconferencia')
  verificarPreconferencia(@Param('id') id: string, @Req() req: RequisicaoAutenticada) {
    return this.rascunhos.verificarPreconferencia(exigirSessao(req), ipRequisicao(req), idDocumento(id));
  }

  @ExigirAcao('criar_rascunho')
  @Post()
  criar(@Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = criarRascunhoDofSchema.safeParse(corpo);
    if (!dados.success) throw new BadRequestException('Confira os dados do cálculo e informe o motivo dos lançamentos.');
    return this.rascunhos.criar(exigirSessao(req), ipRequisicao(req), dados.data);
  }

  @ExigirAcao('editar_rascunho')
  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = atualizarRascunhoDofSchema.safeParse(corpo);
    if (!dados.success) throw new BadRequestException('Confira a revisão, os dados do cálculo e o motivo da alteração.');
    return this.rascunhos.atualizar(exigirSessao(req), ipRequisicao(req), idDocumento(id), dados.data);
  }

  @ExigirAcao('editar_rascunho')
  @Patch(':id/blocos')
  atualizarBlocos(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = atualizarBlocosDofSchema.safeParse(corpo);
    if (!dados.success) throw new BadRequestException('Confira a revisão, os blocos e o motivo da alteração.');
    return this.rascunhos.atualizarBlocos(exigirSessao(req), ipRequisicao(req), idDocumento(id), dados.data);
  }

  @ExigirAcao('editar_rascunho')
  @Patch(':id/processo')
  atualizarProcesso(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = atualizarProcessoDofSchema.safeParse(corpo);
    if (!dados.success) throw new BadRequestException('Confira a revisão, o número do processo e o motivo da alteração.');
    return this.rascunhos.atualizarProcesso(exigirSessao(req), ipRequisicao(req), idDocumento(id), dados.data);
  }

  @ExigirAcao('editar_rascunho')
  @Post(':id/encaminhar')
  encaminhar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = encaminharRascunhoDofSchema.safeParse(corpo);
    if (!dados.success) throw new BadRequestException('Confira a revisão e o coordenador selecionado.');
    return this.rascunhos.encaminhar(exigirSessao(req), ipRequisicao(req), idDocumento(id), dados.data);
  }

  @ExigirAcao('editar_rascunho')
  @Post(':id/recolher')
  recolher(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = recolherRascunhoDofSchema.safeParse(corpo);
    if (!dados.success) throw new BadRequestException('Confira a revisão e informe o motivo do recolhimento.');
    return this.rascunhos.recolher(exigirSessao(req), ipRequisicao(req), idDocumento(id), dados.data);
  }
}
