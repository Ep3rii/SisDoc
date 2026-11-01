import { BadRequestException, Controller, Get, HttpCode, Post, PayloadTooLargeException, Query, Req, UnsupportedMediaTypeException } from '@nestjs/common';
import { enviarImportacaoQuerySchema, paginaLotesImportacaoQuerySchema } from '@sisdoc/contratos';
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
