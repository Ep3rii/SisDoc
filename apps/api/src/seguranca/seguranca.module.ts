import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { Configuracao } from '@sisdoc/contratos';
import type { Pool } from 'pg';
import { BANCO, CONFIGURACAO } from '../injecao';
import { AutenticacaoService } from './autenticacao';
import { AutenticacaoController } from './autenticacao.controller';
import { GuardaAcesso } from './guarda';
import { UsuariosService } from './usuarios';
import { UsuariosController } from './usuarios.controller';

/** Mantém autenticação e administração de usuários privadas; a guarda protege todas as rotas. */
@Module({
  controllers: [AutenticacaoController, UsuariosController],
  providers: [
    {
      provide: AutenticacaoService,
      useFactory: (banco: Pool, configuracao: Configuracao) => new AutenticacaoService(banco, configuracao),
      inject: [BANCO, CONFIGURACAO],
    },
    {
      provide: UsuariosService,
      useFactory: (banco: Pool, autenticacao: AutenticacaoService) => new UsuariosService(banco, autenticacao),
      inject: [BANCO, AutenticacaoService],
    },
    { provide: APP_GUARD, useClass: GuardaAcesso },
  ],
})
export class SegurancaModule {}
