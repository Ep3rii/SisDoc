import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { cpfSchema, type Configuracao } from '@sisdoc/contratos';
import { z } from 'zod';

const contextoSchema = z.strictObject({
  schema: z.enum(['nucleo', 'documentos', 'legado', 'seguranca']),
  tabela: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  registroId: z.uuid(),
  campo: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
});

export type ContextoCifra = z.input<typeof contextoSchema>;

const versao = 1;
const tamanhoNonce = 12;
const tamanhoTag = 16;
const tamanhoCabecalho = 1 + tamanhoNonce + tamanhoTag;

function decodificarChave(valor: string): Buffer {
  const chave = Buffer.from(valor, 'base64');
  if (chave.length !== 32 || chave.toString('base64') !== valor) {
    throw new Error('A chave de proteção deve conter 32 bytes em Base64 canônico.');
  }
  return chave;
}

function dadosAutenticados(contexto: ContextoCifra): Buffer {
  const valido = contextoSchema.parse(contexto);
  return Buffer.from(JSON.stringify([
    'sisdoc', versao, valido.schema, valido.tabela, valido.registroId.toLowerCase(), valido.campo,
  ]), 'utf8');
}

export class ProtetorDados {
  private readonly chaveCifra: Buffer;
  private readonly chaveHmac: Buffer;

  constructor(chaves: Configuracao['chaves']) {
    this.chaveCifra = decodificarChave(chaves.cifra);
    this.chaveHmac = decodificarChave(chaves.hmac);
    if (this.chaveCifra.equals(this.chaveHmac)) {
      throw new Error('As chaves de cifra e HMAC devem ser diferentes.');
    }
  }

  cifrar(valor: Buffer, contexto: ContextoCifra): Buffer {
    const autenticados = dadosAutenticados(contexto);
    const nonce = randomBytes(tamanhoNonce);
    const cifra = createCipheriv('aes-256-gcm', this.chaveCifra, nonce);
    cifra.setAAD(autenticados);
    const conteudo = Buffer.concat([cifra.update(valor), cifra.final()]);
    return Buffer.concat([Buffer.from([versao]), nonce, cifra.getAuthTag(), conteudo]);
  }

  decifrar(valor: Buffer, contexto: ContextoCifra): Buffer {
    const autenticados = dadosAutenticados(contexto);
    if (valor.length < tamanhoCabecalho || valor[0] !== versao) {
      throw new Error('Dado protegido inválido ou corrompido.');
    }
    const nonce = valor.subarray(1, 1 + tamanhoNonce);
    const tag = valor.subarray(1 + tamanhoNonce, tamanhoCabecalho);
    const conteudo = valor.subarray(tamanhoCabecalho);
    try {
      const cifra = createDecipheriv('aes-256-gcm', this.chaveCifra, nonce);
      cifra.setAAD(autenticados);
      cifra.setAuthTag(tag);
      return Buffer.concat([cifra.update(conteudo), cifra.final()]);
    } catch {
      throw new Error('Dado protegido inválido ou corrompido.');
    }
  }

  hashCpf(valor: string): Buffer {
    const cpf = cpfSchema.parse(valor);
    return createHmac('sha256', this.chaveHmac).update('sisdoc/cpf/v1\0', 'utf8').update(cpf, 'ascii').digest();
  }
}
