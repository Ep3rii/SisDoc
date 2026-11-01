import { BadRequestException, Controller, Get, Param, Query, Req } from '@nestjs/common';
import { buscarServidoresQuerySchema, eventosServidorQuerySchema, paginaUuidQuerySchema, referenciaServidorQuerySchema } from '@sisdoc/contratos';
import { z } from 'zod';
import { ExigirAcao, exigirSessao, ipRequisicao, type RequisicaoAutenticada } from '../seguranca/guarda';
import { ServidoresService } from './servidores';

function pessoaId(valor: string): string {
  const resultado = z.uuid().safeParse(valor);
  if (!resultado.success) throw new BadRequestException('Identificador de pessoa inválido.');
  return resultado.data;
}

@Controller('servidores')
export class ServidoresController {
  constructor(private readonly servidores: ServidoresService) {}

  @ExigirAcao('consultar_pessoa')
  @Get(':id/referencias')
  referencia(@Param('id') id: string, @Query() consulta: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = referenciaServidorQuerySchema.safeParse(consulta);
    if (!dados.success) throw new BadRequestException('Informe vínculo, tipo de referência e paginação válida (máximo 50).');
    return this.servidores.referencia(exigirSessao(req), ipRequisicao(req), pessoaId(id), dados.data);
  }

  @ExigirAcao('consultar_pessoa')
  @Get()
  buscar(@Query() consulta: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = buscarServidoresQuerySchema.safeParse(consulta);
    if (!dados.success) {
      throw new BadRequestException('Confira a busca: nome com ao menos três caracteres, CPF válido ou matrícula exata; limite máximo 50.');
    }
    return this.servidores.buscar(exigirSessao(req), ipRequisicao(req), dados.data);
  }

  @ExigirAcao('consultar_pessoa')
  @Get(':id')
  detalhar(@Param('id') id: string, @Query() consulta: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = paginaUuidQuerySchema.safeParse(consulta);
    if (!dados.success) throw new BadRequestException('Paginação inválida; o limite máximo é 50.');
    return this.servidores.detalhar(exigirSessao(req), ipRequisicao(req), pessoaId(id), dados.data.limite, dados.data.cursor);
  }

  @ExigirAcao('consultar_pessoa')
  @Get(':id/eventos')
  eventos(@Param('id') id: string, @Query() consulta: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = eventosServidorQuerySchema.safeParse(consulta);
    if (!dados.success) throw new BadRequestException('Informe o vínculo e uma paginação válida; o limite máximo é 50.');
    return this.servidores.eventos(
      exigirSessao(req), ipRequisicao(req), pessoaId(id), dados.data.vinculoId, dados.data.limite, dados.data.cursor,
    );
  }
}
