import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Configuracao } from '@sisdoc/contratos';

export const NOME_COOKIE = '__Host-sisdoc';

function decodificar(valor: string | undefined): Buffer | undefined {
  if (!valor || !/^[A-Za-z0-9_-]{43}$/.test(valor)) return undefined;
  const bytes = Buffer.from(valor, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== valor) return undefined;
  return bytes;
}

export function novoTokenSessao(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenDoCookie(req: IncomingMessage): string | undefined {
  const encontrados = (req.headers.cookie ?? '').split(';').map((item) => item.trim())
    .filter((item) => item.startsWith(`${NOME_COOKIE}=`))
    .map((item) => item.slice(NOME_COOKIE.length + 1));
  return encontrados.length === 1 && decodificar(encontrados[0]) ? encontrados[0] : undefined;
}

export function hashSessao(token: string): Buffer {
  const bytes = decodificar(token);
  if (!bytes) throw new Error('Token de sessão inválido.');
  return createHash('sha256').update(bytes).digest();
}

export function tokenCsrf(token: string, chave: string): string {
  const bytes = decodificar(token);
  if (!bytes) throw new Error('Token de sessão inválido.');
  return createHmac('sha256', Buffer.from(chave, 'base64'))
    .update('sisdoc/csrf/v1\0', 'utf8').update(bytes).digest('base64url');
}

export function csrfValido(token: string, recebido: string | undefined, chave: string): boolean {
  const informado = decodificar(recebido);
  const esperado = decodificar(tokenCsrf(token, chave));
  return Boolean(informado && esperado && timingSafeEqual(informado, esperado));
}

export function origemValida(req: IncomingMessage, config: Configuracao): boolean {
  const esperada = new URL(`https://${config.tls.nome}:${config.porta}`).origin;
  return req.headers.origin === esperada;
}

export function cookieSessao(token: string): string {
  if (!decodificar(token)) throw new Error('Token de sessão inválido.');
  return `${NOME_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`;
}

export function cookieExpirado(): string {
  return `${NOME_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
