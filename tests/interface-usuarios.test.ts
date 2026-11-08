import os from 'node:os';
import path from 'node:path';
import { criarUsuarioSchema, type CriarUsuario, type UsuarioAdministrativo } from '@sisdoc/contratos';
import { chromium, type Browser, type Page } from 'playwright';
import { preview, type PreviewServer } from 'vite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CSP_APLICACAO } from '../apps/api/dist/aplicacao.js';

const csrf = 'a'.repeat(43);
const usuarioInicial: UsuarioAdministrativo = {
  id: '11111111-1111-4111-8111-111111111111', matricula: 'FICTICIO-01', nome: 'Usuário fictício',
  email: null, papel: 'analista', ativo: true, trocaSenhaObrigatoria: true,
};

describe('administração de usuários com API fictícia', () => {
  let navegador: Browser;
  let servidor: PreviewServer;
  let endereco: string;
  let pagina: Page;
  let usuarios: UsuarioAdministrativo[];
  let falha: boolean;
  let pedido: CriarUsuario | null;
  let erros: string[];

  beforeAll(async () => {
    servidor = await preview({
      configFile: false, root: path.join(process.cwd(), 'apps', 'web'), logLevel: 'silent',
      preview: { host: '127.0.0.1', port: 0, strictPort: true, headers: { 'Content-Security-Policy': CSP_APLICACAO } },
    });
    const porta = servidor.httpServer.address();
    if (!porta || typeof porta === 'string') throw new Error('Prévia fictícia não iniciou.');
    endereco = `http://127.0.0.1:${porta.port}/`;
    navegador = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    if (navegador) await navegador.close();
    if (servidor) await new Promise<void>((resolve, reject) =>
      servidor.httpServer.close((erro) => erro ? reject(erro) : resolve()));
  });
  beforeEach(async () => {
    pagina = await navegador.newPage({ viewport: { width: 1366, height: 900 } });
    usuarios = [usuarioInicial]; falha = false; pedido = null; erros = [];
    pagina.on('pageerror', (erro) => erros.push(erro.message));
    await pagina.route('**/api/v1/**', async (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      let resposta: unknown;
      if (url.pathname === '/api/v1/auth/me') {
        resposta = { usuario: { id: '22222222-2222-4222-8222-222222222222', matricula: 'ADMIN-FICTICIO',
          nome: 'Administrador fictício', papel: 'admin', trocaSenhaObrigatoria: false }, csrf };
      } else if (url.pathname === '/api/v1/sincronizacao/situacao') {
        resposta = { configurada: false, ultimaSincronizacaoEm: null, horasDesdeUltima: null,
          limiteHoras: 24, avisoAtraso: false, disjuntorAberto: false };
      } else if (url.pathname === '/api/v1/admin/usuarios' && req.method() === 'GET') {
        resposta = { itens: usuarios, proximoCursor: null };
      } else if (url.pathname === '/api/v1/admin/usuarios' && req.method() === 'POST') {
        expect(req.headers()['x-csrf-token']).toBe(csrf);
        pedido = criarUsuarioSchema.parse(req.postDataJSON());
        if (falha) return rota.fulfill({ status: 409, contentType: 'application/json',
          body: JSON.stringify({ detail: 'Já existe um usuário com essa matrícula.' }) });
        const { senha: _senha, ...dados } = pedido;
        const usuario: UsuarioAdministrativo = { ...dados, email: dados.email ?? null,
          id: '33333333-3333-4333-8333-333333333333', ativo: true, trocaSenhaObrigatoria: true };
        usuarios.push(usuario); resposta = usuario;
      } else {
        erros.push(`${req.method()} ${url.pathname}`);
        return rota.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"Rota fictícia ausente"}' });
      }
      return rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resposta) });
    });
    await pagina.goto(`${endereco}#/administracao/usuarios`);
    await pagina.getByRole('heading', { name: 'Usuários cadastrados', exact: true }).waitFor();
    await pagina.getByRole('button', { name: 'Editar Usuário fictício' }).waitFor();
  });
  afterEach(async () => {
    await pagina.close({ runBeforeUnload: false });
    expect(erros).toEqual([]);
  });

  it('mostra lista primeiro e abre formulário acessível em duas colunas até 640px', async () => {
    expect(await pagina.getByLabel('Senha inicial', { exact: true }).count()).toBe(0);
    expect(await pagina.getByRole('dialog').count()).toBe(0);
    await pagina.getByRole('button', { name: 'Editar Usuário fictício' }).click();
    await pagina.getByRole('heading', { name: 'Editar Usuário fictício' }).waitFor();
    await pagina.getByRole('button', { name: 'Novo usuário', exact: true }).click();
    const modal = pagina.getByRole('dialog', { name: 'Novo usuário', exact: true });
    await modal.waitFor();
    expect(await modal.getByLabel('Matrícula', { exact: true }).evaluate((el) => el === document.activeElement)).toBe(true);
    expect(await modal.getByRole('checkbox', { name: 'Exigir troca de senha no primeiro acesso' }).isChecked()).toBe(true);
    expect(await modal.getByRole('checkbox', { name: 'Exigir troca de senha no primeiro acesso' }).isDisabled()).toBe(true);
    expect(await modal.locator('#regras-senha-inicial').textContent()).toContain('Entre 10 e 1024 caracteres');
    expect(await modal.locator('#regras-senha-inicial').textContent()).toContain('lista local de senhas comuns');
    expect(await modal.getByLabel('Senha inicial', { exact: true }).getAttribute('aria-describedby')).toBe('regras-senha-inicial');
    for (const largura of [1366, 768, 390]) {
      await pagina.setViewportSize({ width: largura, height: 900 });
      const caixa = await modal.boundingBox();
      if (!caixa) throw new Error('Modal não visível.');
      expect(caixa.width).toBeLessThanOrEqual(640);
      expect(caixa.x).toBeGreaterThanOrEqual(0);
      expect(caixa.x + caixa.width).toBeLessThanOrEqual(largura);
      const colunas = await modal.locator('.formulario-usuario').evaluate((el) =>
        getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(colunas).toBe(largura <= 600 ? 1 : 2);
      expect(await pagina.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(largura);
      await pagina.screenshot({ path: path.join(os.tmpdir(), `sisdoc-usuarios-${largura}.png`), fullPage: true });
    }
    await pagina.keyboard.press('Escape');
    await expect.poll(() => pagina.getByRole('dialog').count()).toBe(0);
    expect(await pagina.getByRole('button', { name: 'Novo usuário', exact: true }).evaluate((el) => el === document.activeElement)).toBe(true);
  });

  async function preencher() {
    await pagina.getByRole('button', { name: 'Novo usuário', exact: true }).click();
    const modal = pagina.getByRole('dialog', { name: 'Novo usuário', exact: true });
    await modal.getByLabel('Matrícula', { exact: true }).fill('NOVO-FICTICIO');
    await modal.getByLabel('Nome', { exact: true }).fill('Novo usuário fictício');
    await modal.getByLabel('Senha inicial', { exact: true }).fill('SenhaFicticiaLonga!12345');
    return modal;
  }

  it('preserva dados em falha e exige confirmação para descartar cadastro por Escape', async () => {
    const modal = await preencher();
    falha = true;
    await modal.getByRole('button', { name: 'Criar usuário', exact: true }).click();
    await modal.getByRole('alert').getByText('Já existe um usuário com essa matrícula.').waitFor();
    expect(await modal.getByLabel('Senha inicial', { exact: true }).inputValue()).toBe('SenhaFicticiaLonga!12345');
    pagina.once('dialog', (dialogo) => void dialogo.dismiss());
    await pagina.keyboard.press('Escape');
    expect(await modal.isVisible()).toBe(true);
    expect(await modal.getByLabel('Matrícula', { exact: true }).inputValue()).toBe('NOVO-FICTICIO');
    pagina.once('dialog', (dialogo) => void dialogo.accept());
    await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect.poll(() => pagina.getByRole('dialog').count()).toBe(0);
    await pagina.getByRole('button', { name: 'Novo usuário', exact: true }).click();
    expect(await modal.getByLabel('Senha inicial', { exact: true }).inputValue()).toBe('');
  });

  it('cria com contrato atual, fecha modal e atualiza lista sem persistir senha no navegador', async () => {
    const modal = await preencher();
    await modal.getByLabel('Perfil', { exact: true }).selectOption('coordenador');
    await modal.getByRole('button', { name: 'Criar usuário', exact: true }).click();
    await pagina.getByRole('button', { name: 'Editar Novo usuário fictício' }).waitFor();
    expect(pedido).toEqual({ matricula: 'NOVO-FICTICIO', nome: 'Novo usuário fictício', email: null,
      papel: 'coordenador', senha: 'SenhaFicticiaLonga!12345' });
    expect(await pagina.getByRole('dialog').count()).toBe(0);
    expect(await pagina.getByText('Há alterações não salvas.', { exact: true }).count()).toBe(0);
    expect(await pagina.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    await pagina.getByRole('button', { name: 'Novo usuário', exact: true }).click();
    expect(await modal.getByLabel('Senha inicial', { exact: true }).inputValue()).toBe('');
    await pagina.keyboard.press('Escape');
  });
});
