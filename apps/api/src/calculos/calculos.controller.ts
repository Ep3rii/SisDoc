import { BadRequestException, Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { solicitarCalculoDofSchema } from '@sisdoc/contratos';
import { ExigirAcao, exigirSessao, ipRequisicao, type RequisicaoAutenticada } from '../seguranca/guarda';
import { CalculosService } from './calculos';

@Controller('calculos')
export class CalculosController {
  constructor(private readonly calculos: CalculosService) {}

  @ExigirAcao('calcular')
  @Post()
  @HttpCode(200)
  calcular(@Body() corpo: unknown, @Req() req: RequisicaoAutenticada) {
    const dados = solicitarCalculoDofSchema.safeParse(corpo);
    if (!dados.success) {
      throw new BadRequestException('Confira pessoa, vínculo, datas e valores anuais; confirme os dados informados.');
    }
    return this.calculos.calcularDof(exigirSessao(req), ipRequisicao(req), dados.data);
  }
}
