import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { BANCO } from '../injecao';
import { CalculosService } from './calculos';
import { CalculosController } from './calculos.controller';

/** Expõe cálculo pela API; o motor puro compartilhado permanece em @sisdoc/calculo. */
@Module({
  controllers: [CalculosController],
  providers: [{
    provide: CalculosService,
    useFactory: (banco: Pool) => new CalculosService(banco),
    inject: [BANCO],
  }],
})
export class CalculosModule {}
