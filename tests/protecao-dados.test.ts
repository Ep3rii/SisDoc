import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ProtetorDados, type ContextoCifra } from '../apps/api/dist/seguranca/protecao-dados.js';
import { cpfSintetico } from './dados-sinteticos.js';

function chavesFicticias(): { cifra: string; hmac: string } {
  return { cifra: randomBytes(32).toString('base64'), hmac: randomBytes(32).toString('base64') };
}

describe('proteção de dados pessoais', () => {
  it('cifra com nonce aleatório e recupera apenas no contexto original', () => {
    const protetor = new ProtetorDados(chavesFicticias());
    const contexto: ContextoCifra = {
      schema: 'nucleo', tabela: 'pessoa', registroId: randomUUID(), campo: 'cpf_cifrado',
    };
    const original = Buffer.from('conteúdo sintético protegido', 'utf8');
    const primeiro = protetor.cifrar(original, contexto);
    const segundo = protetor.cifrar(original, contexto);
    expect(primeiro).not.toEqual(segundo);
    expect(primeiro.includes(original)).toBe(false);
    expect(protetor.decifrar(primeiro, contexto)).toEqual(original);
    expect(protetor.decifrar(segundo, { ...contexto, registroId: contexto.registroId.toUpperCase() })).toEqual(original);
    expect(protetor.decifrar(protetor.cifrar(Buffer.alloc(0), contexto), contexto)).toEqual(Buffer.alloc(0));
    expect(() => protetor.decifrar(primeiro, { ...contexto, registroId: randomUUID() }))
      .toThrow('inválido ou corrompido');
    expect(() => protetor.decifrar(primeiro, { ...contexto, campo: 'endereco_cifrado' }))
      .toThrow('inválido ou corrompido');
  });

  it('rejeita corrupção, formato desconhecido e chave incorreta', () => {
    const protetor = new ProtetorDados(chavesFicticias());
    const outro = new ProtetorDados(chavesFicticias());
    const contexto: ContextoCifra = {
      schema: 'documentos', tabela: 'emissao', registroId: randomUUID(), campo: 'snapshot_cifrado',
    };
    const valor = protetor.cifrar(Buffer.from('snapshot sintético'), contexto);
    const adulterado = Buffer.from(valor);
    adulterado[adulterado.length - 1] ^= 1;
    const versaoInvalida = Buffer.from(valor);
    versaoInvalida[0] = 2;
    for (const invalido of [adulterado, versaoInvalida, valor.subarray(0, 10)]) {
      expect(() => protetor.decifrar(invalido, contexto)).toThrow('inválido ou corrompido');
    }
    expect(() => outro.decifrar(valor, contexto)).toThrow('inválido ou corrompido');
    expect(() => protetor.cifrar(Buffer.alloc(0), { ...contexto, campo: 'campo inválido' })).toThrow();
  });

  it('normaliza o CPF antes do HMAC e separa as chaves de cifra e busca', () => {
    const chaves = chavesFicticias();
    const protetor = new ProtetorDados(chaves);
    const cpf = cpfSintetico();
    const formatado = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
    expect(protetor.hashCpf(formatado)).toEqual(protetor.hashCpf(cpf));
    expect(protetor.hashCpf(cpf)).toHaveLength(32);
    expect(protetor.hashCpf(cpf)).not.toEqual(new ProtetorDados(chavesFicticias()).hashCpf(cpf));
    expect(() => protetor.hashCpf('000.000.000-00')).toThrow();
    expect(() => new ProtetorDados({ cifra: chaves.cifra, hmac: chaves.cifra })).toThrow('devem ser diferentes');
    expect(() => new ProtetorDados({ cifra: 'inválida', hmac: chaves.hmac })).toThrow('32 bytes');
  });

  it('assina as revisões da fonte vinculadas ao documento sem expor seus dados', () => {
    const protetor = new ProtetorDados(chavesFicticias());
    const revisoes = {
      documentoId: randomUUID(), documentoRevisao: 7,
      pessoaId: randomUUID(), pessoaRevisao: '9223372036854775807',
      vinculoId: randomUUID(), vinculoRevisao: '10',
    };
    const assinatura = protetor.assinarRevisaoFonteDof(revisoes);
    expect(assinatura).toHaveLength(32);
    expect(assinatura).toEqual(protetor.assinarRevisaoFonteDof({
      ...revisoes, documentoId: revisoes.documentoId.toUpperCase(),
    }));
    for (const alterada of [
      { ...revisoes, documentoId: randomUUID() },
      { ...revisoes, documentoRevisao: 8 },
      { ...revisoes, pessoaId: randomUUID() },
      { ...revisoes, pessoaRevisao: '9' },
      { ...revisoes, vinculoId: randomUUID() },
      { ...revisoes, vinculoRevisao: '11' },
    ]) expect(protetor.assinarRevisaoFonteDof(alterada)).not.toEqual(assinatura);
    expect(new ProtetorDados(chavesFicticias()).assinarRevisaoFonteDof(revisoes)).not.toEqual(assinatura);
    expect(() => protetor.assinarRevisaoFonteDof({ ...revisoes, pessoaRevisao: '01' })).toThrow();
    expect(() => protetor.assinarRevisaoFonteDof({ ...revisoes, documentoRevisao: 0 })).toThrow();
  });
});
