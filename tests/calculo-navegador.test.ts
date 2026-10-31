import path from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { build } from 'vite';
import { expect, it } from 'vitest';

it('empacota o mesmo motor para execução sem APIs Node no navegador', async () => {
  const compilado = await build({
    configFile: false,
    root: process.cwd(),
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: path.join(process.cwd(), 'tests', 'entrada-navegador.ts'),
        name: 'SisdocCalculoTeste',
        formats: ['iife'],
      },
    },
  });
  const saidas = Array.isArray(compilado) ? compilado : [compilado];
  const chunk = saidas.flatMap((saida) => 'output' in saida ? saida.output : [])
    .find((item) => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('O pacote de navegador não foi gerado.');
  const contexto = createContext({});
  runInContext(chunk.code, contexto, { timeout: 5000 });
  const resultado: unknown = runInContext('SisdocCalculoTeste.amostra()', contexto);
  expect(resultado).toEqual({ anos: 3, meses: 7, dias: 6, diasBrutos: 366 });
});
