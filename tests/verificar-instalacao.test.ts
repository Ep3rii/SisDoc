import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
type Papel = {
  rolcanlogin: boolean; rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean;
  rolreplication: boolean; rolbypassrls: boolean; membro: boolean; dono: boolean;
};
const { verificarHistorico, verificarPapel, verificarBanco } = require('../scripts/verificar-instalacao.cjs') as {
  verificarHistorico: (versoes: string[], sequencia: { versao: string }[]) => string;
  verificarPapel: (papel: Papel | undefined) => void;
  verificarBanco: (
    cliente: { query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }> },
    sequencia: { versao: string }[],
  ) => Promise<string>;
};
const sequencia = [{ versao: '001-modelo' }, { versao: '002-autenticacao' }];
const papel: Papel = {
  rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false,
  rolreplication: false, rolbypassrls: false, membro: false, dono: false,
};

describe('verificação de instalação somente leitura', () => {
  it('aceita somente a sequência completa e ordenada deste release', () => {
    expect(verificarHistorico(['000-fundacao', '001-modelo', '002-autenticacao'], sequencia)).toBe('002-autenticacao');
    for (const versoes of [
      [], ['000-fundacao'], ['000-fundacao', '002-autenticacao'],
      ['000-fundacao', '002-autenticacao', '001-modelo'],
      ['000-fundacao', '001-modelo', '002-autenticacao', '003-desconhecida'],
      ['000-fundacao', '001-modelo', '001-modelo'],
    ]) {
      expect(() => verificarHistorico(versoes, sequencia)).toThrow('Histórico de migrações incompleto');
    }
  });

  it('recusa conta administrativa, proprietária, associada ou sem login', () => {
    expect(() => verificarPapel(papel)).not.toThrow();
    expect(() => verificarPapel(undefined)).toThrow('login da aplicação');
    for (const chave of ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls', 'membro', 'dono'] as const) {
      expect(() => verificarPapel({ ...papel, [chave]: true })).toThrow('login da aplicação');
    }
    expect(() => verificarPapel({ ...papel, rolcanlogin: false })).toThrow('login da aplicação');
  });

  it('consulta somente metadados, sem migrar ou ler conteúdo operacional', async () => {
    const query = vi.fn<(sql: string) => Promise<{ rows: Record<string, unknown>[] }>>()
      .mockResolvedValueOnce({ rows: [{ server_version_num: '160015' }] })
      .mockResolvedValueOnce({ rows: [{ listen_addresses: '127.0.0.1, ::1' }] })
      .mockResolvedValueOnce({ rows: [papel] })
      .mockResolvedValueOnce({ rows: [{ versao: '000-fundacao' }, ...sequencia] });
    expect(await verificarBanco({ query }, sequencia)).toBe('002-autenticacao');
    expect(query).toHaveBeenCalledTimes(4);
    for (const [sql] of query.mock.calls) {
      expect(sql.trim()).toMatch(/^(SHOW|SELECT)\b/);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/);
    }
  });

  it('recusa PostgreSQL de outro major e escuta ampla antes de consultar o histórico', async () => {
    const versaoIncorreta = vi.fn().mockResolvedValue({ rows: [{ server_version_num: '170001' }] });
    await expect(verificarBanco({ query: versaoIncorreta }, sequencia)).rejects.toThrow('PostgreSQL 16');
    expect(versaoIncorreta).toHaveBeenCalledTimes(1);
    for (const escuta of ['*', '0.0.0.0', '127.0.0.1, 192.0.2.1', '']) {
      const query = vi.fn()
        .mockResolvedValueOnce({ rows: [{ server_version_num: '160015' }] })
        .mockResolvedValueOnce({ rows: [{ listen_addresses: escuta }] });
      await expect(verificarBanco({ query }, sequencia)).rejects.toThrow('loopback');
      expect(query).toHaveBeenCalledTimes(2);
    }
  });

  it('falha explicitamente sem configuração, sem imprimir caminho privado ou resultado de sucesso', () => {
    const caminhoFicticio = 'C:\\SisDocVerificacaoAusente\\MARCADOR-PRIVADO-FICTICIO\\config.json';
    const resultado = spawnSync(process.execPath, [path.resolve('scripts', 'verificar-instalacao.cjs')], {
      env: { ...process.env, SISDOC_CONFIG: caminhoFicticio },
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    expect(resultado.error).toBeUndefined();
    expect(resultado.status).toBe(1);
    expect(resultado.stderr).toContain('Verificação não concluída na etapa: configuração externa SISDOC_CONFIG.');
    expect(resultado.stderr).not.toContain('MARCADOR-PRIVADO-FICTICIO');
    expect(resultado.stdout).not.toContain('OK:');
  });
});
