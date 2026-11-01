import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import { iniciarSincronizacaoSchema, paginaUuidQuerySchema } from '@sisdoc/contratos';
import { ExigirAcao, exigirSessao, ipRequisicao, type RequisicaoAutenticada } from '../seguranca/guarda';
import { SincronizacaoService } from './sincronizacao';

@Controller()
export class SincronizacaoController {
  constructor(private readonly sincronizacao: SincronizacaoService) {}

  @ExigirAcao('administrar_sincronizacao')
  @Post('admin/sincronizacoes')
  @HttpCode(202)
  iniciar(@Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = iniciarSincronizacaoSchema.safeParse(corpo);
    if (!dados.success) throw new BadRequestException('Informe o tipo da sincronização: completa ou incremental.');
    return this.sincronizacao.iniciar(exigirSessao(req), ipRequisicao(req), dados.data.tipo);
  }

  @ExigirAcao('administrar_sincronizacao')
  @Get('admin/sincronizacoes')
  listar(@Query() consulta: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = paginaUuidQuerySchema.safeParse(consulta);
    if (!dados.success) throw new BadRequestException('Paginação inválida; o limite máximo é 50.');
    return this.sincronizacao.listar(exigirSessao(req), ipRequisicao(req), dados.data.limite, dados.data.cursor);
  }

  @ExigirAcao('consultar_situacao_sincronizacao')
  @Get('sincronizacao/situacao')
  situacao(@Req() req: RequisicaoAutenticada) {
    return this.sincronizacao.situacao(exigirSessao(req));
  }
}
