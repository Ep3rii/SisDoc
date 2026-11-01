import { Module } from '@nestjs/common';
import type { Configuracao } from '@sisdoc/contratos';
import type { Pool } from 'pg';
import { BANCO, CONFIGURACAO } from '../injecao';
import { ImportacaoService } from './importacao';
import { ImportacaoController } from './importacao.controller';

/** Encapsula transferência por arquivos e promoção do Legado, sem agendar acesso externo. */
@Module({
  controllers: [ImportacaoController],
  providers: [{
    provide: ImportacaoService,
    useFactory: (banco: Pool, configuracao: Configuracao) => new ImportacaoService(banco, configuracao),
    inject: [BANCO, CONFIGURACAO],
  }],
})
export class ImportacaoModule {}
