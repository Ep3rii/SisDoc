import { DynamicModule, Module } from '@nestjs/common';
import type { Configuracao } from '@sisdoc/contratos';
import type { Pool } from 'pg';
import { CalculosModule } from './calculos/calculos.module';
import { DocumentosModule } from './documentos/documentos.module';
import { ImportacaoModule } from './importacao/importacao.module';
import { InfraestruturaModule } from './infraestrutura/infraestrutura.module';
import { SegurancaModule } from './seguranca/seguranca.module';
import { ServidoresModule } from './servidores/servidores.module';
import { SincronizacaoModule } from './sincronizacao/sincronizacao.module';

@Module({})
export class AppModule {
  /** Compõe os domínios do monólito sobre um pool e uma configuração já validados pelo bootstrap. */
  static registrar(banco: Pool, configuracao: Configuracao): DynamicModule {
    return {
      module: AppModule,
      imports: [
        InfraestruturaModule.registrar(banco, configuracao),
        SegurancaModule,
        ServidoresModule,
        CalculosModule,
        DocumentosModule,
        ImportacaoModule,
        SincronizacaoModule,
      ],
    };
  }
}
