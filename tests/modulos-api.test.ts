import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { configuracaoSchema } from '@sisdoc/contratos';
import { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

// O build é CommonJS: require mantém a identidade de símbolos/classes usada pelo container Nest.
const carregar = createRequire(import.meta.url);
const { NestFactory } = carregar('@nestjs/core') as typeof import('@nestjs/core');
const { ModulesContainer } = carregar('@nestjs/core/injector/modules-container') as typeof import('@nestjs/core/injector/modules-container');
const { AppModule } = carregar('../apps/api/dist/app.module.js') as typeof import('../apps/api/dist/app.module.js');
const { BANCO, CONFIGURACAO } = carregar('../apps/api/dist/injecao.js') as typeof import('../apps/api/dist/injecao.js');
const { CalculosModule } = carregar('../apps/api/dist/calculos/calculos.module.js') as typeof import('../apps/api/dist/calculos/calculos.module.js');
const { DocumentosModule } = carregar('../apps/api/dist/documentos/documentos.module.js') as typeof import('../apps/api/dist/documentos/documentos.module.js');
const { ImportacaoModule } = carregar('../apps/api/dist/importacao/importacao.module.js') as typeof import('../apps/api/dist/importacao/importacao.module.js');
const { InfraestruturaModule } = carregar('../apps/api/dist/infraestrutura/infraestrutura.module.js') as typeof import('../apps/api/dist/infraestrutura/infraestrutura.module.js');
const { HealthController } = carregar('../apps/api/dist/infraestrutura/saude.controller.js') as typeof import('../apps/api/dist/infraestrutura/saude.controller.js');
const { SegurancaModule } = carregar('../apps/api/dist/seguranca/seguranca.module.js') as typeof import('../apps/api/dist/seguranca/seguranca.module.js');
const { ServidoresModule } = carregar('../apps/api/dist/servidores/servidores.module.js') as typeof import('../apps/api/dist/servidores/servidores.module.js');
const { SincronizacaoModule } = carregar('../apps/api/dist/sincronizacao/sincronizacao.module.js') as typeof import('../apps/api/dist/sincronizacao/sincronizacao.module.js');
const { GuardaAcesso } = carregar('../apps/api/dist/seguranca/guarda.js') as typeof import('../apps/api/dist/seguranca/guarda.js');
const { WorkerPdfEmissao } = carregar('../apps/api/dist/documentos/worker-pdf-emissao.js') as typeof import('../apps/api/dist/documentos/worker-pdf-emissao.js');
const { SincronizacaoService } = carregar('../apps/api/dist/sincronizacao/sincronizacao.js') as typeof import('../apps/api/dist/sincronizacao/sincronizacao.js');

/** Cria configuração sintética sem PDF, integração externa ou arquivos da instalação. */
function configuracaoSintetica() {
  return configuracaoSchema.parse({
    porta: 3443,
    banco: { host: '127.0.0.1', porta: 5432, nome: 'nao_conectar', usuario: 'ficticio', senha: 'ficticia' },
    tls: { certificado: 'nao_ler.crt', chave: 'nao_ler.key', ca: 'nao_ler_ca.crt', nome: 'localhost' },
    chaves: { cifra: randomBytes(32).toString('base64'), hmac: randomBytes(32).toString('base64') },
  });
}

describe('Composição modular da API', () => {
  it('resolve todos os controllers, mantém uma guarda e encerra workers antes do pool', async () => {
    const banco = new Pool();
    const eventos: string[] = [];
    const fechar = vi.spyOn(banco, 'end').mockImplementation(async () => { eventos.push('banco'); });
    const configuracao = configuracaoSintetica();
    const app = await NestFactory.createApplicationContext(AppModule.registrar(banco, configuracao), {
      logger: false, abortOnError: false,
    });
    try {
      expect(app.get(BANCO)).toBe(banco);
      expect(app.get(CONFIGURACAO)).toBe(configuracao);
      expect(app.get(HealthController)).toBeInstanceOf(HealthController);
      const modulos = app.get(ModulesContainer);
      const controllers = [...modulos.values()].flatMap((modulo) =>
        [...modulo.controllers.values()].map((controller) => controller.instance.constructor.name));
      expect(controllers.sort()).toEqual([
        'AdminDocumentosController', 'AutenticacaoController', 'CalculosController', 'DtcController',
        'EmissoesController', 'HealthController', 'ImportacaoController', 'RascunhosController',
        'ServidoresController', 'SincronizacaoController', 'UsuariosController',
      ]);
      const guardas = [...modulos.values()].flatMap((modulo) =>
        [...modulo.providers.values()].filter((provider) => provider.instance instanceof GuardaAcesso));
      expect(guardas).toHaveLength(1);
      vi.spyOn(app.get(WorkerPdfEmissao), 'onModuleDestroy').mockImplementation(async () => { eventos.push('pdf'); });
      vi.spyOn(app.get(SincronizacaoService), 'onModuleDestroy').mockImplementation(async () => { eventos.push('sincronizacao'); });
    } finally {
      await app.close();
    }
    expect(fechar).toHaveBeenCalledTimes(1);
    expect(eventos).toContain('pdf');
    expect(eventos).toContain('sincronizacao');
    expect(eventos.at(-1)).toBe('banco');
  });

  it('exporta somente recursos de infraestrutura, sem tornar serviços de domínio globais', () => {
    const banco = new Pool();
    const infraestrutura = InfraestruturaModule.registrar(banco, configuracaoSintetica());
    expect(infraestrutura.exports).toEqual([BANCO, CONFIGURACAO]);
    for (const modulo of [
      SegurancaModule, ServidoresModule, CalculosModule, DocumentosModule, ImportacaoModule, SincronizacaoModule,
    ]) {
      expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, modulo) ?? []).toEqual([]);
      expect(Reflect.getMetadata('__module:global__', modulo)).not.toBe(true);
    }
    return banco.end();
  });

  it('mantém health público e comunica falha do banco sem detalhes sensíveis', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const health = new HealthController({ query });
    await expect(health.verificar()).resolves.toEqual({ status: 'ok' });
    expect(query).toHaveBeenCalledWith('SELECT 1');
    query.mockRejectedValue(new Error('detalhe interno fictício'));
    await expect(health.verificar()).rejects.toThrow('Banco de dados indisponível.');
  });
});
