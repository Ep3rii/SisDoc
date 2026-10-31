import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  atualizarDtcSchema,
  chaveIdempotenciaSchema,
  conferirDtcSchema,
  consultaDtcSchema,
  copiarEmitidoSchema,
  criarDtcSchema,
  devolverDtcSchema,
  emitirDtcSchema,
} from '@sisdoc/contratos';
import { z } from 'zod';
import { ExigirAcao, exigirSessao, ipRequisicao, type RequisicaoAutenticada } from '../seguranca/guarda';
import { DtcService } from './dtcs';

function identificador(valor: string): string {
  const resultado = z.uuid().safeParse(valor);
  if (!resultado.success) throw new BadRequestException('Identificador de DTC inválido.');
  return resultado.data;
}

function mensagemValidacao(erro: z.ZodError, padrao: string): string {
  const personalizada = erro.issues.find((problema) => problema.code === 'custom')?.message;
  return personalizada ?? padrao;
}

@Controller('dtc')
export class DtcController {
  constructor(private readonly dtc: DtcService) {}

  @ExigirAcao('criar_rascunho')
  @Get()
  listar(@Query() consulta: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = consultaDtcSchema.safeParse(consulta);
    if (!dados.success) throw new BadRequestException('Consulta de DTC inválida.');
    return this.dtc.listar(exigirSessao(req), ipRequisicao(req), dados.data);
  }

  @ExigirAcao('criar_rascunho')
  @Post()
  criar(@Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = criarDtcSchema.safeParse(corpo);
    if (!dados.success) {
      throw new BadRequestException(mensagemValidacao(dados.error, 'Confira os períodos, os dados do tipo de DTC e a confirmação dos dados.'));
    }
    return this.dtc.criar(exigirSessao(req), ipRequisicao(req), dados.data);
  }

  @ExigirAcao('criar_rascunho')
  @Get(':id')
  obter(@Param('id') id: string, @Req() req: RequisicaoAutenticada) {
    return this.dtc.obter(exigirSessao(req), ipRequisicao(req), identificador(id));
  }

  @ExigirAcao('editar_rascunho')
  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const documentoId = identificador(id);
    const dados = atualizarDtcSchema.safeParse(corpo);
    if (!dados.success) {
      throw new BadRequestException(mensagemValidacao(dados.error, 'Confira os períodos, a revisão e o motivo da alteração.'));
    }
    return this.dtc.atualizar(exigirSessao(req), ipRequisicao(req), documentoId, dados.data);
  }

  @ExigirAcao('criar_rascunho')
  @Get(':id/previa')
  previa(@Param('id') id: string, @Req() req: RequisicaoAutenticada) {
    return this.dtc.previa(exigirSessao(req), ipRequisicao(req), identificador(id));
  }

  @ExigirAcao('conferir')
  @Post(':id/conferir')
  @HttpCode(200)
  conferir(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const documentoId = identificador(id);
    const dados = conferirDtcSchema.safeParse(corpo);
    if (!dados.success) throw new BadRequestException('Reabra a prévia e confirme a conferência.');
    return this.dtc.conferir(exigirSessao(req), ipRequisicao(req), documentoId, dados.data);
  }

  @ExigirAcao('receber_encaminhamento')
  @Post(':id/devolver')
  @HttpCode(200)
  devolver(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const documentoId = identificador(id);
    const dados = devolverDtcSchema.safeParse(corpo);
    if (!dados.success) throw new BadRequestException('Informe a revisão e o motivo da devolução.');
    return this.dtc.devolver(exigirSessao(req), ipRequisicao(req), documentoId, dados.data);
  }

  @ExigirAcao('emitir')
  @Post(':id/emitir')
  @HttpCode(200)
  emitir(
    @Param('id') id: string, @Headers('idempotency-key') chave: unknown, @Body() corpo: unknown,
    @Req() req: RequisicaoAutenticada,
  ) {
    const documentoId = identificador(id);
    const chaveValida = chaveIdempotenciaSchema.safeParse(chave);
    if (!chaveValida.success) {
      throw new BadRequestException('Informe o cabeçalho Idempotency-Key (16 a 200 caracteres) para emitir.');
    }
    const dados = emitirDtcSchema.safeParse(corpo);
    if (!dados.success) throw new BadRequestException('Confira a revisão e reabra a prévia antes de emitir.');
    return this.dtc.emitir(exigirSessao(req), ipRequisicao(req), documentoId, chaveValida.data, dados.data);
  }

  @ExigirAcao('criar_rascunho')
  @Post(':id/copia')
  copiar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const documentoId = identificador(id);
    if (!copiarEmitidoSchema.safeParse(corpo).success) {
      throw new BadRequestException('Confirme a criação do novo rascunho a partir da emissão.');
    }
    return this.dtc.copiar(exigirSessao(req), ipRequisicao(req), documentoId);
  }
}
