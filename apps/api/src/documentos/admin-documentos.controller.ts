import { BadRequestException, Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { ExigirAcao, exigirSessao, type RequisicaoAutenticada } from '../seguranca/guarda';
import { AdminDocumentosService, entradaExclusaoSchema } from './admin-documentos';

@Controller('admin/documentos')
export class AdminDocumentosController {
  constructor(private readonly documentos: AdminDocumentosService) {}

  @ExigirAcao('administrar_documentos')
  @Post(':id/excluir')
  @HttpCode(200)
  excluir(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const documentoId = z.uuid().safeParse(id);
    if (!documentoId.success) throw new BadRequestException('Identificador de documento inválido.');
    const dados = entradaExclusaoSchema.safeParse(corpo);
    if (!dados.success) {
      throw new BadRequestException('Informe a revisão, o motivo e a confirmação exata para excluir o documento.');
    }
    return this.documentos.excluir(exigirSessao(req), documentoId.data, dados.data);
  }
}
