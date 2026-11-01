import { DynamicModule, Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Configuracao } from '@sisdoc/contratos';
import type { Pool } from 'pg';
import { BANCO, CONFIGURACAO } from '../injecao';
import { HealthController } from './saude.controller';

@Injectable()
export class EncerramentoBanco implements OnApplicationShutdown {
  /** Recebe o pool único da aplicação; não cria conexões ou outro pool. */
  constructor(@Inject(BANCO) private readonly banco: Pool) {}

  /** Fecha o pool após os hooks de destruição dos workers e demais módulos. */
  async onApplicationShutdown(): Promise<void> {
    await this.banco.end();
  }
}

@Global()
@Module({})
export class InfraestruturaModule {
  /** Registra uma única vez recursos externos, compartilhando somente pool e configuração. */
  static registrar(banco: Pool, configuracao: Configuracao): DynamicModule {
    return {
      module: InfraestruturaModule,
      controllers: [HealthController],
      providers: [
        { provide: BANCO, useValue: banco },
        { provide: CONFIGURACAO, useValue: configuracao },
        EncerramentoBanco,
      ],
      exports: [BANCO, CONFIGURACAO],
    };
  }
}
