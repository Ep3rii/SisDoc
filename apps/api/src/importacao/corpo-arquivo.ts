import { PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import type { RequisicaoAutenticada } from '../seguranca/guarda';
import { LIMITE_ARQUIVO_BYTES } from './planilhas';

export async function lerCorpoBruto(req: RequisicaoAutenticada): Promise<Buffer> {
  const tipo = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (tipo !== 'application/octet-stream') throw new UnsupportedMediaTypeException('Envie o arquivo como application/octet-stream.');
  if (Number(req.headers['content-length'] ?? '0') > LIMITE_ARQUIVO_BYTES) throw new PayloadTooLargeException('O arquivo excede o limite de 64 MB.');
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of req as AsyncIterable<Buffer>) {
    total += parte.length;
    if (total > LIMITE_ARQUIVO_BYTES) {
      req.destroy();
      throw new PayloadTooLargeException('O arquivo excede o limite de 64 MB.');
    }
    partes.push(parte);
  }
  return Buffer.concat(partes, total);
}
