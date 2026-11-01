import { Module } from '@nestjs/common';
import type { Configuracao } from '@sisdoc/contratos';
import type { Pool } from 'pg';
import { BANCO, CONFIGURACAO } from '../injecao';
import { SincronizacaoService } from './sincronizacao';
import { SincronizacaoController } from './sincronizacao.controller';

/** Isola integração externa e seu agendamento; ausência de configuração não cria tarefas. */
@Module({
  controllers: [SincronizacaoController],
  providers: [{
    provide: SincronizacaoService,
    useFactory: (banco: Pool, configuracao: Configuracao) => new SincronizacaoService(banco, configuracao),
    inject: [BANCO, CONFIGURACAO],
  }],
})
export class SincronizacaoModule {}
