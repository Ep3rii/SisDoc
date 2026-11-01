import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { BANCO } from '../injecao';
import { Publica } from '../seguranca/guarda';

export interface BancoSaude {
  query(sql: string): Promise<unknown>;
}

@Controller('health')
export class HealthController {
  /** Recebe apenas a capacidade de consulta necessária ao diagnóstico. */
  constructor(@Inject(BANCO) private readonly banco: BancoSaude) {}

  /** Verifica a conectividade sem expor configuração, credenciais ou dados funcionais. */
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
