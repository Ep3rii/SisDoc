import { Module } from '@nestjs/common';
import type { Configuracao } from '@sisdoc/contratos';
import type { Pool } from 'pg';
import { BANCO, CONFIGURACAO } from '../injecao';
import { AdminDocumentosService } from './admin-documentos';
import { AdminDocumentosController } from './admin-documentos.controller';
import { DtcService } from './dtcs';
import { DtcController } from './dtcs.controller';
import { EmissoesService } from './emissoes';
import { EmissoesController } from './emissoes.controller';
import { RascunhosService } from './rascunhos';
import { RascunhosController } from './rascunhos.controller';
import { WorkerPdfEmissao } from './worker-pdf-emissao';

/** Mantém rascunhos, DTC, emissões e worker no mesmo limite transacional e de ciclo de vida. */
@Module({
  controllers: [RascunhosController, EmissoesController, DtcController, AdminDocumentosController],
  providers: [
    {
      provide: RascunhosService,
      useFactory: (banco: Pool, configuracao: Configuracao) => new RascunhosService(banco, configuracao),
      inject: [BANCO, CONFIGURACAO],
    },
    {
      provide: EmissoesService,
      useFactory: (banco: Pool, configuracao: Configuracao) => new EmissoesService(banco, configuracao),
      inject: [BANCO, CONFIGURACAO],
    },
    {
      provide: AdminDocumentosService,
      useFactory: (banco: Pool, configuracao: Configuracao) => new AdminDocumentosService(banco, configuracao),
      inject: [BANCO, CONFIGURACAO],
    },
    {
      provide: DtcService,
      useFactory: (banco: Pool, configuracao: Configuracao) => new DtcService(banco, configuracao),
      inject: [BANCO, CONFIGURACAO],
    },
    {
      provide: WorkerPdfEmissao,
      useFactory: (banco: Pool, configuracao: Configuracao) => new WorkerPdfEmissao(banco, configuracao),
      inject: [BANCO, CONFIGURACAO],
    },
  ],
})
export class DocumentosModule {}
