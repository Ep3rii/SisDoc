import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { atualizarRascunhoDofSchema, criarRascunhoDofSchema, paginaUuidQuerySchema } from '@sisdoc/contratos';
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

  @ExigirAcao('criar_rascunho')
  @Get(':id')
  obter(@Param('id') id: string, @Req() req: RequisicaoAutenticada) {
    return this.rascunhos.obter(exigirSessao(req), ipRequisicao(req), idDocumento(id));
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
}
