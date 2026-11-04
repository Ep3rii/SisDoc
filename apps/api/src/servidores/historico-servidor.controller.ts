import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { eventosServidorQuerySchema, salvarHistoricoSchema, importarHistoricoQuerySchema, paginaUuidQuerySchema } from '@sisdoc/contratos';
import type { ServerResponse } from 'node:http';
import { z } from 'zod';
import { ExigirAcao, exigirSessao, ipRequisicao, type RequisicaoAutenticada } from '../seguranca/guarda';
import { HistoricoServidorService } from './historico-servidor';
import { lerCorpoBruto } from '../importacao/corpo-arquivo';
import { importarHistorico } from './importacao-historico';

function uuid(id: string) {
  const resultado = z.uuid().safeParse(id);
  if (!resultado.success) throw new BadRequestException('Identificador inválido.');
  return resultado.data;
}
@Controller('servidores/:pessoa/historico')
export class HistoricoServidorController {
  constructor(private readonly historico: HistoricoServidorService) {}
  @ExigirAcao('administrar_importacao')
  @Post('exportar')
  async exportar(@Param('pessoa') pessoa: string, @Body() corpo: unknown, @Req() req: RequisicaoAutenticada, @Res() res: ServerResponse) {
    const dados = z.strictObject({ vinculoId: z.uuid() }).safeParse(corpo);
    if (!dados.success) throw new BadRequestException('Informe o vínculo da exportação.');
    const arquivo = await this.historico.exportar(exigirSessao(req), ipRequisicao(req), uuid(pessoa), dados.data.vinculoId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="historico-vinculo.xlsx"');
    res.statusCode = 200; res.end(arquivo);
  }
  @ExigirAcao('consultar_pessoa')
  @Get(':id/revisoes')
  revisoes(@Param('pessoa') pessoa: string, @Param('id') id: string, @Query() consulta: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = paginaUuidQuerySchema.safeParse(consulta);
    if (!dados.success) throw new BadRequestException('Paginação inválida.');
    return this.historico.revisoes(exigirSessao(req), ipRequisicao(req), uuid(pessoa), uuid(id), dados.data.limite, dados.data.cursor);
  }
  @ExigirAcao('editar_servidor')
  @Post('importar')
  async importar(@Param('pessoa') pessoa: string, @Query() consulta: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = importarHistoricoQuerySchema.safeParse(consulta);
    if (!dados.success) throw new BadRequestException('Informe vínculo, origem, modo e validação do histórico.');
    return importarHistorico(this.historico, exigirSessao(req), ipRequisicao(req), uuid(pessoa), dados.data, await lerCorpoBruto(req));
  }
  @ExigirAcao('consultar_pessoa')
  @Get()
  listar(@Param('pessoa') pessoa: string, @Query() consulta: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = eventosServidorQuerySchema.safeParse(consulta);
    if (!dados.success) throw new BadRequestException('Informe vínculo e paginação válida.');
    return this.historico.listar(exigirSessao(req), ipRequisicao(req), uuid(pessoa), dados.data.vinculoId, dados.data.limite, dados.data.cursor);
  }
  @ExigirAcao('editar_servidor')
  @Post()
  criar(@Param('pessoa') pessoa: string, @Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = salvarHistoricoSchema.safeParse(corpo);
    if (!dados.success || dados.data.revisao !== undefined) throw new BadRequestException('Confira campos e motivo (mínimo 15 caracteres).');
    return this.historico.salvar(exigirSessao(req), ipRequisicao(req), uuid(pessoa), dados.data);
  }
  @ExigirAcao('editar_servidor')
  @Patch(':id')
  editar(@Param('pessoa') pessoa: string, @Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = salvarHistoricoSchema.safeParse(corpo);
    if (!dados.success || dados.data.revisao === undefined) throw new BadRequestException('Informe revisão, campos e motivo válido.');
    return this.historico.salvar(exigirSessao(req), ipRequisicao(req), uuid(pessoa), dados.data, uuid(id));
  }
}
