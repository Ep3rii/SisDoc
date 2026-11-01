import { randomUUID } from 'node:crypto';
import type { Configuracao } from '@sisdoc/contratos';
import { atualizarServidorSchema } from '@sisdoc/contratos';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { ServidoresService } from '../apps/api/dist/servidores/servidores.js';
import { perfilPermiteAcao } from '../apps/api/dist/seguranca/permissoes.js';
import { ProtetorDados } from '../apps/api/dist/seguranca/protecao-dados.js';
import { cpfSintetico } from './dados-sinteticos.js';

type Consulta = { sql: string; valores: unknown[] };

class BancoCadastroFake {
  readonly pessoaId = randomUUID();
  readonly vinculoId = randomUUID();
  readonly usuarioId = randomUUID();
  readonly consultas: Consulta[] = [];
  revisaoPessoa = '1';
  revisaoVinculo = '1';
  readonly pessoa: Record<string, unknown>;
  readonly vinculo: Record<string, unknown>;
  private readonly protetor: ProtetorDados;

  constructor(configuracao: Configuracao) {
    this.protetor = new ProtetorDados(configuracao.chaves);
    this.pessoa = {
      nome: 'Pessoa Sintética',
      cpf_cifrado: this.cifrar('cpf_cifrado', cpfSintetico(901)),
      nascimento: '1980-01-02',
      nome_mae_cifrado: this.cifrar('nome_mae_cifrado', 'Mãe Sintética'),
      nome_pai_cifrado: this.cifrar('nome_pai_cifrado', 'Pai Sintético'),
      pis_pasep_cifrado: this.cifrar('pis_pasep_cifrado', '12345678901'),
      rg_numero_cifrado: this.cifrar('rg_numero_cifrado', 'RG-SINTETICO'),
      rg_orgao: 'SSP',
      rg_expedicao: '2000-02-03',
      titulo_eleitor_cifrado: this.cifrar('titulo_eleitor_cifrado', '123456789012'),
      endereco_cifrado: this.cifrar('endereco_cifrado', 'Rua Sintética, 1'),
    };
    this.vinculo = {
      matricula: 'MAT-901',
      regime_juridico: 'Estatutário',
      cargo: 'Cargo sintético',
      classe: 'A',
      nivel: '1',
      referencia: 'A-1',
      setor: 'Setor sintético',
      orgao_codigo: 'ORG-1',
      orgao_nome: 'Órgão sintético',
      admissao: '2001-02-03',
      desligamento: null,
    };
  }

  private cifrar(campo: string, valor: string): Buffer {
    return this.protetor.cifrar(Buffer.from(valor, 'utf8'), {
      schema: 'nucleo', tabela: 'pessoa', registroId: this.pessoaId, campo,
    });
  }

  async query(sql: string, valores: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    const consulta = sql.replace(/\s+/g, ' ').trim();
    this.consultas.push({ sql: consulta, valores });
    if (consulta.includes('FROM seguranca.sessao')) return { rows: [{}], rowCount: 1 };
    if (consulta.includes('FOR UPDATE OF p, v')) {
      return {
        rows: [{
          pessoa_id: this.pessoaId, vinculo_id: this.vinculoId,
          revisao_pessoa: this.revisaoPessoa, revisao_vinculo: this.revisaoVinculo,
        }],
        rowCount: 1,
      };
    }
    if (consulta.startsWith('SELECT p.nome, p.cpf_cifrado')) {
      return { rows: [{ ...this.pessoa, ...this.vinculo }], rowCount: 1 };
    }
    if (consulta.startsWith('UPDATE nucleo.pessoa')) {
      this.revisaoPessoa = String(Number(this.revisaoPessoa) + 1);
      return { rows: [{ revisao_fonte: this.revisaoPessoa }], rowCount: 1 };
    }
    if (consulta.startsWith('UPDATE nucleo.vinculo')) {
      this.revisaoVinculo = String(Number(this.revisaoVinculo) + 1);
      return { rows: [{ revisao_fonte: this.revisaoVinculo }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  }

  connect() {
    return Promise.resolve({
      query: (sql: string, valores?: unknown[]) => this.query(sql, valores),
      release: () => undefined,
    });
  }
}

function configuracao(): Configuracao {
  return {
    chaves: { cifra: Buffer.alloc(32, 1).toString('base64'), hmac: Buffer.alloc(32, 2).toString('base64') },
  } as Configuracao;
}

describe('Edição local de cadastro de servidores', () => {
  it('limita a ação ao administrador e valida CPF, motivo e intervalos', () => {
    expect(perfilPermiteAcao('admin', 'editar_servidor')).toBe(true);
    expect(perfilPermiteAcao('analista', 'editar_servidor')).toBe(false);
    const cpf = cpfSintetico(902);
    const base = {
      pessoaId: randomUUID(),
      vinculoId: randomUUID(),
      revisaoPessoa: '1',
      revisaoVinculo: '1',
      cadastro: {
        nome: 'Pessoa Sintética', cpf, nascimento: '1980-01-02', nomeMae: 'Mãe Sintética', nomePai: 'Pai Sintético',
        pisPasep: '12345678901', rgNumero: 'RG-SINTETICO', rgOrgao: 'SSP', rgExpedicao: '2000-02-03',
        tituloEleitor: '123456789012', endereco: 'Rua Sintética, 1', matricula: 'MAT-901',
        regimeJuridico: 'Estatutário', cargo: 'Cargo sintético', classe: 'A', nivel: '1',
        referencia: 'A-1', setor: 'Setor sintético', orgaoCodigo: 'ORG-1', orgao: 'Órgão sintético',
        admissao: '2001-02-03', desligamento: null,
      },
      motivo: 'Correção cadastral sintética',
    };
    expect(atualizarServidorSchema.safeParse({ ...base, motivo: '' }).success).toBe(false);
    expect(atualizarServidorSchema.safeParse({
      ...base, cadastro: { ...base.cadastro, cpf: '11111111111' },
    }).success).toBe(false);
    expect(atualizarServidorSchema.safeParse({
      ...base, cadastro: { ...base.cadastro, desligamento: '2000-01-01' },
    }).success).toBe(false);
  });

  it('atualiza campos pessoais e um vínculo com CPF protegido, revisões e motivo cifrado', async () => {
    const configuracaoTeste = configuracao();
    const banco = new BancoCadastroFake(configuracaoTeste);
    const servico = new ServidoresService(banco as unknown as Pool, configuracaoTeste);
    const sessao = {
      usuario: { id: banco.usuarioId, papel: 'admin' },
      hash: Buffer.alloc(32),
      csrf: 'token-sintetico',
    } as never;
    const cpfNovo = cpfSintetico(903);
    const cadastro = {
      nome: 'Nome Atualizado Sintético',
      cpf: cpfNovo,
      nascimento: '1981-03-04',
      nomeMae: 'Mãe Atualizada Sintética',
      nomePai: 'Pai Atualizado Sintético',
      pisPasep: '98765432109',
      rgNumero: 'RG-ATUALIZADO',
      rgOrgao: 'SSP-X',
      rgExpedicao: '2001-04-05',
      tituloEleitor: '987654321098',
      endereco: 'Avenida Sintética, 2',
      matricula: 'MAT-902',
      regimeJuridico: 'Regime atualizado',
      cargo: 'Cargo atualizado',
      classe: 'B',
      nivel: '2',
      referencia: 'B-2',
      setor: 'Setor atualizado',
      orgaoCodigo: 'ORG-2',
      orgao: 'Órgão atualizado',
      admissao: '2002-03-04',
      desligamento: '2020-05-06',
    };
    const dados = atualizarServidorSchema.parse({
      pessoaId: banco.pessoaId, vinculoId: banco.vinculoId,
      revisaoPessoa: '1', revisaoVinculo: '1', cadastro, motivo: 'Correção aprovada por documento sintético',
    });

    await expect(servico.atualizar(sessao, '127.0.0.1', dados)).resolves.toEqual({
      atualizado: true, revisaoPessoa: '2', revisaoVinculo: '2',
    });
    const pessoaUpdate = banco.consultas.find((consulta) => consulta.sql.startsWith('UPDATE nucleo.pessoa'));
    const vinculoUpdate = banco.consultas.find((consulta) => consulta.sql.startsWith('UPDATE nucleo.vinculo'));
    expect(pessoaUpdate?.sql).toContain('cpf_cifrado');
    expect(pessoaUpdate?.sql).toContain('cpf_hash');
    expect(pessoaUpdate?.sql).toContain('nome_mae_cifrado = $');
    expect(pessoaUpdate?.sql).not.toContain('hash_conteudo');
    expect(vinculoUpdate?.sql).toContain('matricula_norm');
    expect(vinculoUpdate?.sql).not.toContain('sistema_origem');
    expect(vinculoUpdate?.sql).not.toContain('id_origem');
    expect(vinculoUpdate?.sql).not.toContain('matricula_anterior_id');
    const protetor = new ProtetorDados(configuracaoTeste.chaves);
    const cpfHashParametro = Number(pessoaUpdate?.sql.match(/cpf_hash = \$(\d+)/)?.[1]);
    expect(pessoaUpdate?.valores[cpfHashParametro - 1]).toEqual(protetor.hashCpf(cpfNovo));
    const cpfCifradoParametro = Number(pessoaUpdate?.sql.match(/cpf_cifrado = \$(\d+)/)?.[1]);
    expect(protetor.decifrar(pessoaUpdate?.valores[cpfCifradoParametro - 1] as Buffer, {
      schema: 'nucleo', tabela: 'pessoa', registroId: banco.pessoaId, campo: 'cpf_cifrado',
    }).toString('ascii')).toBe(cpfNovo);
    const maeCifradaParametro = Number(pessoaUpdate?.sql.match(/nome_mae_cifrado = \$(\d+)/)?.[1]);
    expect(protetor.decifrar(pessoaUpdate?.valores[maeCifradaParametro - 1] as Buffer, {
      schema: 'nucleo', tabela: 'pessoa', registroId: banco.pessoaId, campo: 'nome_mae_cifrado',
    }).toString('utf8')).toBe(cadastro.nomeMae);
    expect(pessoaUpdate?.valores).not.toContain(cpfNovo);
    expect(pessoaUpdate?.valores).not.toContain(cadastro.nomeMae);
    const auditoria = banco.consultas.find((consulta) => consulta.sql.startsWith('INSERT INTO nucleo.edicao_servidor_auditoria'));
    expect(auditoria).toBeDefined();
    const motivoCifrado = auditoria?.valores[5];
    expect(Buffer.isBuffer(motivoCifrado)).toBe(true);
    expect(protetor.decifrar(motivoCifrado as Buffer, {
      schema: 'nucleo', tabela: 'edicao_servidor_auditoria',
      registroId: auditoria?.valores[0] as string, campo: 'motivo_cifrado',
    }).toString('utf8')).toBe(dados.motivo);
    const auditoriaComum = banco.consultas.find((consulta) => consulta.sql.includes("VALUES ($1, 'cadastro_servidor_editado'"));
    expect(auditoriaComum?.sql).toContain("'cadastro_servidor_editado'");
    expect(auditoriaComum?.valores).not.toContain(dados.motivo);
    expect(auditoriaComum?.valores).not.toContain(cpfNovo);
  });

  it('recusa revisão desatualizada sem gravar alterações', async () => {
    const configuracaoTeste = configuracao();
    const banco = new BancoCadastroFake(configuracaoTeste);
    banco.revisaoPessoa = '2';
    const servico = new ServidoresService(banco as unknown as Pool, configuracaoTeste);
    const sessao = {
      usuario: { id: banco.usuarioId, papel: 'admin' },
      hash: Buffer.alloc(32),
      csrf: 'token-sintetico',
    } as never;
    const dados = atualizarServidorSchema.parse({
      pessoaId: banco.pessoaId,
      vinculoId: banco.vinculoId,
      revisaoPessoa: '1',
      revisaoVinculo: '1',
      cadastro: {
        nome: 'Nome Sintético', cpf: cpfSintetico(904), nascimento: null, nomeMae: null, nomePai: null,
        pisPasep: null, rgNumero: null, rgOrgao: null, rgExpedicao: null, tituloEleitor: null, endereco: null,
        matricula: 'MAT-904', regimeJuridico: null, cargo: null, classe: null, nivel: null, referencia: null,
        setor: null, orgaoCodigo: null, orgao: null, admissao: null, desligamento: null,
      },
      motivo: 'Correção sintética',
    });
    await expect(servico.atualizar(sessao, '127.0.0.1', dados)).rejects.toMatchObject({ status: 409 });
    expect(banco.consultas.some((consulta) => consulta.sql.startsWith('UPDATE nucleo.'))).toBe(false);
    expect(banco.consultas.some((consulta) => consulta.sql.startsWith('INSERT INTO nucleo.edicao_servidor_auditoria'))).toBe(false);
  });
});
