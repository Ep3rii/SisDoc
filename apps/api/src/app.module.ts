import { Controller, DynamicModule, Get, Inject, Module, ServiceUnavailableException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { Configuracao } from '@sisdoc/contratos';
import type { Pool } from 'pg';
import { BANCO, CONFIGURACAO } from './injecao';
import { CalculosController } from './calculos/calculos.controller';
import { CalculosService } from './calculos/calculos';
import { AutenticacaoService } from './seguranca/autenticacao';
import { AutenticacaoController } from './seguranca/autenticacao.controller';
import { GuardaAcesso, Publica } from './seguranca/guarda';
import { UsuariosService } from './seguranca/usuarios';
import { UsuariosController } from './seguranca/usuarios.controller';
import { ServidoresController } from './servidores/servidores.controller';
import { ServidoresService } from './servidores/servidores';

export interface BancoSaude {
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}

@Controller('health')
export class HealthController {
  constructor(@Inject(BANCO) private readonly banco: BancoSaude) {}

  @Publica()
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
  static registrar(banco: Pool, configuracao: Configuracao): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, AutenticacaoController, UsuariosController, ServidoresController, CalculosController],
      providers: [
        { provide: BANCO, useValue: banco },
        { provide: CONFIGURACAO, useValue: configuracao },
        {
          provide: AutenticacaoService,
          useFactory: (pool: Pool, config: Configuracao) => new AutenticacaoService(pool, config),
          inject: [BANCO, CONFIGURACAO],
        },
        {
          provide: UsuariosService,
          useFactory: (pool: Pool, autenticacao: AutenticacaoService) => new UsuariosService(pool, autenticacao),
          inject: [BANCO, AutenticacaoService],
        },
        {
          provide: ServidoresService,
          useFactory: (pool: Pool, config: Configuracao) => new ServidoresService(pool, config),
          inject: [BANCO, CONFIGURACAO],
        },
        {
          provide: CalculosService,
          useFactory: (pool: Pool) => new CalculosService(pool),
          inject: [BANCO],
        },
        { provide: APP_GUARD, useClass: GuardaAcesso },
        { provide: 'ENCERRAR_BANCO', useValue: { onApplicationShutdown: () => banco.end() } },
      ],
    };
  }
}
