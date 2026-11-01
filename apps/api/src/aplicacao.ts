import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerOptions } from 'node:https';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Configuracao } from '@sisdoc/contratos';
import { ESTILO_DOCUMENTO_DTC, ESTILO_PREVIA_DOF } from '@sisdoc/templates';
import type { Pool } from 'pg';
import { AppModule } from './app.module';
import { FiltroProblemas } from './problemas';

/** Autoriza apenas os estilos fixos dos templates; srcDoc herda esta política, sem liberar CSS arbitrário. */
export const CSP_APLICACAO = `default-src 'self'; style-src 'self' ${[ESTILO_PREVIA_DOF, ESTILO_DOCUMENTO_DTC]
  .map((estilo) => `'sha256-${createHash('sha256').update(estilo).digest('base64')}'`).join(' ')}; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'`;

/** Compõe a API HTTPS e os assets locais sem abrir outro pool ou iniciar migrações. */
export async function criarAplicacao(configuracao: Configuracao, banco: Pool): Promise<NestExpressApplication> {
  let key: Buffer;
  let cert: Buffer;
  try {
    [key, cert] = await Promise.all([
      readFile(configuracao.tls.chave),
      readFile(configuracao.tls.certificado),
    ]);
  } catch {
    throw new Error('Não foi possível ler o certificado e a chave TLS configurados.');
  }
  const httpsOptions = { key, cert, minVersion: 'TLSv1.2' } satisfies Pick<
    ServerOptions,
    'key' | 'cert' | 'minVersion'
  >;
  const app = await NestFactory.create<NestExpressApplication>(AppModule.registrar(banco, configuracao), {
    httpsOptions,
    abortOnError: false,
    logger: ['error', 'warn'],
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new FiltroProblemas());
  app.use((_req: IncomingMessage, res: ServerResponse, next: () => void) => {
    res.setHeader('Content-Security-Policy', CSP_APLICACAO);
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.useStaticAssets(path.resolve(__dirname, '..', '..', 'web', 'dist'), {
    index: 'index.html',
    redirect: false,
  });
  app.enableShutdownHooks();
  return app;
}
