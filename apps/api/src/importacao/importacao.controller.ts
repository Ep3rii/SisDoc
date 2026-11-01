import { BadRequestException, Body, Controller, Get, HttpCode, Post, PayloadTooLargeException, Query, Req, Res, UnsupportedMediaTypeException } from '@nestjs/common';
import { enviarImportacaoQuerySchema, exportarDadosSchema, paginaLotesImportacaoQuerySchema } from '@sisdoc/contratos';
import type { ServerResponse } from 'node:http';
import { z } from 'zod';
import { ExigirAcao, exigirSessao, ipRequisicao, type RequisicaoAutenticada } from '../seguranca/guarda';
import { ImportacaoService } from './importacao';
import { LIMITE_ARQUIVO_BYTES } from './planilhas';

async function lerCorpoBruto(req: RequisicaoAutenticada): Promise<Buffer> {
  const tipo = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (tipo !== 'application/octet-stream') {
    throw new UnsupportedMediaTypeException('Envie o arquivo como application/octet-stream.');
  }
  const declarado = Number(req.headers['content-length'] ?? '0');
  if (declarado > LIMITE_ARQUIVO_BYTES) throw new PayloadTooLargeException('O arquivo excede o limite de 64 MB.');
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of req as AsyncIterable<Buffer>) {
    total += parte.length;
    if (total > LIMITE_ARQUIVO_BYTES) {
      req.destroy();
      throw new PayloadTooLargeException('O arquivo excede o limite de 64 MB.');
    }
    partes.push(parte);
  }
  return Buffer.concat(partes, total);
}

@Controller('admin/importacoes')
export class ImportacaoController {
  constructor(private readonly importacao: ImportacaoService) {}

  @ExigirAcao('administrar_importacao')
  @Get('legado')
  legado(@Req() req: RequisicaoAutenticada) {
    return this.importacao.listarLegado(exigirSessao(req), ipRequisicao(req));
  }

  @ExigirAcao('administrar_importacao')
  @Post('legado/exportar')
  @HttpCode(200)
  async exportarLegado(@Body() corpo: unknown, @Req() req: RequisicaoAutenticada, @Res() resposta: ServerResponse) {
    const dados = z.strictObject({ loteId: z.uuid(), formato: z.enum(['csv', 'xlsx']) }).safeParse(corpo);
    if (!dados.success) throw new BadRequestException('Informe o lote legado e o formato csv/xlsx.');
    const arquivo = await this.importacao.exportarLegado(exigirSessao(req), ipRequisicao(req), dados.data.loteId, dados.data.formato);
    resposta.setHeader('Cache-Control', 'no-store');
    resposta.setHeader('Content-Type', dados.data.formato === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    resposta.setHeader('Content-Disposition', `attachment; filename="legado-${dados.data.loteId}.${dados.data.formato}"`);
    resposta.statusCode = 200;
    resposta.end(arquivo);
  }

  @ExigirAcao('administrar_importacao')
  @Post('exportar')
  @HttpCode(200)
  async exportar(@Body() corpo: unknown, @Req() req: RequisicaoAutenticada, @Res() resposta: ServerResponse) {
    const dados = exportarDadosSchema.safeParse(corpo);
    if (!dados.success) throw new BadRequestException('Informe tipo, origem, formato csv/xlsx e modalidade dos afastamentos.');
    const arquivo = await this.importacao.exportar(exigirSessao(req), ipRequisicao(req), dados.data);
    resposta.setHeader('Cache-Control', 'no-store');
    resposta.setHeader('Content-Type', dados.data.formato === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    resposta.setHeader('Content-Disposition', `attachment; filename="${dados.data.tipo}-${dados.data.origem}.${dados.data.formato}"`);
    resposta.statusCode = 200;
    resposta.end(arquivo);
  }

  @ExigirAcao('administrar_importacao')
  @Post()
  @HttpCode(200)
  async enviar(@Query() consulta: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = enviarImportacaoQuerySchema.safeParse(consulta);
    if (!dados.success) throw new BadRequestException('Informe tipo, origem (letras minúsculas, números, ponto, hífen ou sublinhado) e modo validar ou gravar.');
    const conteudo = await lerCorpoBruto(req);
    return this.importacao.enviar(exigirSessao(req), ipRequisicao(req), dados.data, conteudo);
  }

  @ExigirAcao('administrar_importacao')
  @Get()
  listar(@Query() consulta: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = paginaLotesImportacaoQuerySchema.safeParse(consulta);
    if (!dados.success) throw new BadRequestException('Paginação inválida; o limite máximo é 50.');
    return this.importacao.listar(exigirSessao(req), ipRequisicao(req), dados.data.limite, dados.data.cursor);
  }

  @ExigirAcao('administrar_importacao')
  @Get('conferencia')
  conferencia(@Req() req: RequisicaoAutenticada) {
    return this.importacao.conferencia(exigirSessao(req), ipRequisicao(req));
  }
}
