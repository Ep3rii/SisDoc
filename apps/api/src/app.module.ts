import { Controller, DynamicModule, Get, Inject, Module, ServiceUnavailableException } from '@nestjs/common';

export interface BancoSaude {
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}

const BANCO = Symbol('BANCO');

@Controller('health')
export class HealthController {
  constructor(@Inject(BANCO) private readonly banco: BancoSaude) {}

  @Get()
  async verificar(): Promise<{ status: 'ok' }> {
    try {
      await this.banco.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException('Banco de dados indisponível.');
    }
    return { status: 'ok' };
  }
}

@Module({})
export class AppModule {
  static registrar(banco: BancoSaude): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [
        { provide: BANCO, useValue: banco },
        { provide: 'ENCERRAR_BANCO', useValue: { onApplicationShutdown: () => banco.end() } },
      ],
    };
  }
}
