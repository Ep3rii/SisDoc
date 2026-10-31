import { randomBytes } from 'node:crypto';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { Configuracao } from '@sisdoc/contratos';
import {
  cookieExpirado,
  cookieSessao,
  csrfValido,
  hashSessao,
  novoTokenSessao,
  origemValida,
  tokenCsrf,
  tokenDoCookie,
} from '../apps/api/dist/seguranca/tokens.js';

describe('tokens de sessão e CSRF', () => {
  it('gera um cookie opaco __Host e armazena somente hash', () => {
    const token = novoTokenSessao();
    const outro = novoTokenSessao();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toBe(outro);
    expect(hashSessao(token)).toHaveLength(32);
    expect(hashSessao(token)).not.toEqual(Buffer.from(token, 'base64url'));
    expect(cookieSessao(token)).toContain('__Host-sisdoc=');
    expect(cookieSessao(token)).toContain('Path=/; HttpOnly; Secure; SameSite=Lax');
    expect(cookieSessao(token)).not.toContain('Domain=');
    expect(cookieExpirado()).toContain('Max-Age=0');
    const req = new IncomingMessage(new Socket());
    req.headers.cookie = `outro=valor; __Host-sisdoc=${token}`;
    expect(tokenDoCookie(req)).toBe(token);
    req.headers.cookie = `__Host-sisdoc=${token}; __Host-sisdoc=${outro}`;
    expect(tokenDoCookie(req)).toBeUndefined();
    req.headers.cookie = '__Host-sisdoc=invalido';
    expect(tokenDoCookie(req)).toBeUndefined();
  });

  it('vincula o CSRF à sessão e à chave e rejeita tokens malformados', () => {
    const chave = randomBytes(32).toString('base64');
    const outraChave = randomBytes(32).toString('base64');
    const token = novoTokenSessao();
    const csrf = tokenCsrf(token, chave);
    expect(csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(csrfValido(token, csrf, chave)).toBe(true);
    expect(csrfValido(novoTokenSessao(), csrf, chave)).toBe(false);
    expect(csrfValido(token, csrf, outraChave)).toBe(false);
    expect(csrfValido(token, 'invalido', chave)).toBe(false);
    expect(csrfValido(token, undefined, chave)).toBe(false);
  });

  it('aceita somente a origem HTTPS explicitamente configurada', () => {
    const config: Configuracao = {
      porta: 8443,
      banco: { host: '127.0.0.1', porta: 5432, nome: 'teste', usuario: 'teste', senha: 'sintetica' },
      tls: { certificado: 'cert', chave: 'chave', ca: 'ca', nome: 'sisdoc.local' },
      chaves: { cifra: randomBytes(32).toString('base64'), hmac: randomBytes(32).toString('base64') },
    };
    const req = new IncomingMessage(new Socket());
    req.headers.origin = 'https://sisdoc.local:8443';
    expect(origemValida(req, config)).toBe(true);
    for (const origem of ['http://sisdoc.local:8443', 'https://sisdoc.local', 'https://outro.local:8443', 'null']) {
      req.headers.origin = origem;
      expect(origemValida(req, config)).toBe(false);
    }
    delete req.headers.origin;
    expect(origemValida(req, config)).toBe(false);
  });
});
