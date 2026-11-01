import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { cpfSchema, type Configuracao } from '@sisdoc/contratos';
import { z } from 'zod';

const contextoSchema = z.strictObject({
  schema: z.enum(['nucleo', 'documentos', 'legado', 'seguranca']),
  tabela: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  registroId: z.uuid(),
  campo: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
});

const revisaoFonteDofSchema = z.strictObject({
  documentoId: z.uuid(),
  documentoRevisao: z.number().int().min(1).max(2147483647),
  pessoaId: z.uuid(),
  pessoaRevisao: z.string().regex(/^[1-9][0-9]{0,18}$/),
  vinculoId: z.uuid(),
  vinculoRevisao: z.string().regex(/^[1-9][0-9]{0,18}$/),
});

export type ContextoCifra = z.input<typeof contextoSchema>;

const versao = 1;
const tamanhoNonce = 12;
const tamanhoTag = 16;
const tamanhoCabecalho = 1 + tamanhoNonce + tamanhoTag;

/** Exige chave de 256 bits em Base64 canônico, recusando truncamento e codificações ambíguas. */
function decodificarChave(valor: string): Buffer {
  const chave = Buffer.from(valor, 'base64');
  if (chave.length !== 32 || chave.toString('base64') !== valor) {
    throw new Error('A chave de proteção deve conter 32 bytes em Base64 canônico.');
  }
  return chave;
}

/** Vincula ciphertext ao schema, tabela, UUID e campo; a ordem é parte do formato persistido. */
function dadosAutenticados(contexto: ContextoCifra): Buffer {
  const valido = contextoSchema.parse(contexto);
  return Buffer.from(JSON.stringify([
    'sisdoc', versao, valido.schema, valido.tabela, valido.registroId.toLowerCase(), valido.campo,
  ]), 'utf8');
}

export class ProtetorDados {
  private readonly chaveCifra: Buffer;
  private readonly chaveHmac: Buffer;

  /** Carrega chaves distintas para cifra e HMAC sem persistir cópias em texto no protetor. */
  constructor(chaves: Configuracao['chaves']) {
    this.chaveCifra = decodificarChave(chaves.cifra);
    this.chaveHmac = decodificarChave(chaves.hmac);
    if (this.chaveCifra.equals(this.chaveHmac)) {
      throw new Error('As chaves de cifra e HMAC devem ser diferentes.');
    }
  }

  /** Produz envelope versionado AES-GCM com nonce aleatório e autenticação do contexto. */
  cifrar(valor: Buffer, contexto: ContextoCifra): Buffer {
    const autenticados = dadosAutenticados(contexto);
    const nonce = randomBytes(tamanhoNonce);
    const cifra = createCipheriv('aes-256-gcm', this.chaveCifra, nonce);
    cifra.setAAD(autenticados);
    const conteudo = Buffer.concat([cifra.update(valor), cifra.final()]);
    return Buffer.concat([Buffer.from([versao]), nonce, cifra.getAuthTag(), conteudo]);
  }

  /** Valida envelope e tag GCM antes de entregar bytes; falhas não revelam detalhes criptográficos. */
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

  /** Indexa CPF validado com HMAC separado por domínio, sem armazenar CPF em índice aberto. */
  hashCpf(valor: string): Buffer {
    const cpf = cpfSchema.parse(valor);
    return createHmac('sha256', this.chaveHmac).update('sisdoc/cpf/v1\0', 'utf8').update(cpf, 'ascii').digest();
  }

  /** Assina representação JSON da origem para detectar alterações sem expor seu conteúdo. */
  hashConteudo(dominio: 'importacao' | 'sincronizacao', tabela: string, dados: unknown): Buffer {
    return createHmac('sha256', this.chaveHmac).update(`sisdoc/${dominio}/${tabela}/v1\0`, 'utf8')
      .update(JSON.stringify(dados), 'utf8').digest();
  }

  /** Assina documento e revisões de pessoa/vínculo no formato usado pela prova DOF. */
  assinarRevisaoFonteDof(entrada: z.input<typeof revisaoFonteDofSchema>): Buffer {
    const dados = revisaoFonteDofSchema.parse(entrada);
    const revisoes = [
      dados.documentoId.toLowerCase(), dados.documentoRevisao,
      dados.pessoaId.toLowerCase(), dados.pessoaRevisao,
      dados.vinculoId.toLowerCase(), dados.vinculoRevisao,
    ];
    return createHmac('sha256', this.chaveHmac).update('sisdoc/dof/revisao-fonte/v1\0', 'utf8')
      .update(JSON.stringify(revisoes), 'utf8').digest();
  }

  /** Vincula relatório à sessão e ao conteúdo; assinatura não concede autorização por si só. */
  assinarRelatorioDof(hashSessao: Buffer, conteudo: Buffer): Buffer {
    if (hashSessao.length !== 32) throw new Error('Identificador de sessão inválido para o relatório.');
    return createHmac('sha256', this.chaveHmac).update('sisdoc/dof/relatorio/v1\0', 'utf8')
      .update(hashSessao).update(conteudo).digest();
  }

}

/** Decifra campo textual opcional do núcleo; validações semânticas pertencem ao consumidor. */
export function decifrarTexto(protetor: ProtetorDados, id: string, tabela: string, campo: string, valor: Buffer | null): string | null {
  if (valor === null) return null;
  return protetor.decifrar(valor, { schema: 'nucleo', tabela, registroId: id, campo }).toString('utf8');
}
