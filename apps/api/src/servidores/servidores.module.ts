import { Module } from '@nestjs/common';
import type { Configuracao } from '@sisdoc/contratos';
import type { Pool } from 'pg';
import { BANCO, CONFIGURACAO } from '../injecao';
import { ServidoresService } from './servidores';
import { ServidoresController } from './servidores.controller';
import { HistoricoServidorService } from './historico-servidor';
import { HistoricoServidorController } from './historico-servidor.controller';

/** Encapsula consulta e edição do cadastro local sem exportar serviços de escrita. */
@Module({
  controllers: [ServidoresController, HistoricoServidorController],
  providers: [{
    provide: HistoricoServidorService,
    useFactory: (banco: Pool, configuracao: Configuracao) => new HistoricoServidorService(banco, configuracao),
    inject: [BANCO, CONFIGURACAO],
  }, {
    provide: ServidoresService,
    useFactory: (banco: Pool, configuracao: Configuracao) => new ServidoresService(banco, configuracao),
    inject: [BANCO, CONFIGURACAO],
  }],
})
export class ServidoresModule {}
