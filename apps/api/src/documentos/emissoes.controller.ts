import type { ServerResponse } from 'node:http';
import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  cancelarEmitidoSchema, chaveIdempotenciaSchema, consultaHistoricoSchema, copiarEmitidoSchema, emitirDofSchema,
} from '@sisdoc/contratos';
import { z } from 'zod';
import { ExigirAcao, exigirSessao, ipRequisicao, type RequisicaoAutenticada } from '../seguranca/guarda';
import { EmissoesService } from './emissoes';
import { RascunhosService } from './rascunhos';

function identificador(valor: string, mensagem: string): string {
  const resultado = z.uuid().safeParse(valor);
  if (!resultado.success) throw new BadRequestException(mensagem);
  return resultado.data;
}

@Controller()
export class EmissoesController {
  constructor(private readonly rascunhos: RascunhosService, private readonly emissoes: EmissoesService) {}

  @ExigirAcao('emitir')
  @Post('documentos/:id/emitir')
  @HttpCode(200)
  emitir(
    @Param('id') id: string, @Headers('idempotency-key') chave: unknown, @Body() corpo: unknown,
    @Req() req: RequisicaoAutenticada,
  ) {
    const documentoId = identificador(id, 'Identificador de documento inválido.');
    const chaveValida = chaveIdempotenciaSchema.safeParse(chave);
    if (!chaveValida.success) {
      throw new BadRequestException('Informe o cabeçalho Idempotency-Key (16 a 200 caracteres) para emitir.');
    }
    const dados = emitirDofSchema.safeParse(corpo);
    if (!dados.success) throw new BadRequestException('Confira a revisão e reabra a prévia antes de emitir.');
    return this.rascunhos.emitir(exigirSessao(req), ipRequisicao(req), documentoId, chaveValida.data, dados.data);
  }

  @ExigirAcao('criar_rascunho')
  @Post('documentos/:id/copia')
  copiar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const documentoId = identificador(id, 'Identificador de documento inválido.');
    if (!copiarEmitidoSchema.safeParse(corpo).success) {
      throw new BadRequestException('Confirme a criação do novo rascunho a partir da emissão.');
    }
    return this.rascunhos.copiar(exigirSessao(req), ipRequisicao(req), documentoId);
  }

  @ExigirAcao('cancelar_emitido')
  @Post('documentos/:id/cancelar')
  @HttpCode(200)
  cancelar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const documentoId = identificador(id, 'Identificador de documento inválido.');
    const dados = cancelarEmitidoSchema.safeParse(corpo);
    if (!dados.success) throw new BadRequestException('Informe o motivo e confirme o cancelamento.');
    return this.emissoes.cancelar(exigirSessao(req), ipRequisicao(req), documentoId, dados.data);
  }

  @ExigirAcao('consultar_emissoes')
  @Get('emissoes/:id')
  situacao(@Param('id') id: string, @Req() req: RequisicaoAutenticada) {
    return this.emissoes.situacao(exigirSessao(req), ipRequisicao(req), identificador(id, 'Identificador de emissão inválido.'));
  }

  @ExigirAcao('consultar_emissoes')
  @Get('emissoes/:id/pdf')
  async pdf(@Param('id') id: string, @Req() req: RequisicaoAutenticada, @Res() resposta: ServerResponse) {
    const arquivo = await this.emissoes.pdf(
      exigirSessao(req), ipRequisicao(req), identificador(id, 'Identificador de emissão inválido.'),
    );
    resposta.setHeader('Content-Type', 'application/pdf');
    resposta.setHeader('Content-Disposition', `attachment; filename="${arquivo.nome}"`);
    resposta.setHeader('Content-Length', String(arquivo.conteudo.length));
    resposta.end(arquivo.conteudo);
  }

  @ExigirAcao('consultar_emissoes')
  @Get('historico')
  historico(@Query() consulta: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = consultaHistoricoSchema.safeParse(consulta);
    if (!dados.success) throw new BadRequestException('Informe o grupo do histórico (DOF ou DTC) e o escopo.');
    return this.emissoes.historico(exigirSessao(req), ipRequisicao(req), dados.data);
  }
}
