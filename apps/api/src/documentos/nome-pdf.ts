import { tipoDocumentoSchema } from '@sisdoc/contratos';
import { z } from 'zod';
import { dataEmSaoPaulo } from '../data';

export const LIMITE_NOME_PDF = 80;

const entradaNomePdfSchema = z.strictObject({
  nome: z.string().min(1),
  tipo: tipoDocumentoSchema,
  emitidoEm: z.date(),
  colisao: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});

export type EntradaNomePdf = z.input<typeof entradaNomePdfSchema>;

const nomesTipo: Record<z.infer<typeof tipoDocumentoSchema>, string> = {
  DOF: 'DOF',
  DTC_IPAM: 'DTC-IPAM',
  DTC_COMISSIONADO: 'DTC-COMISSIONADO',
  DTC_INSS: 'DTC-INSS',
};

export function nomePdf(entrada: EntradaNomePdf): string {
  const validacao = entradaNomePdfSchema.safeParse(entrada);
  if (!validacao.success) throw new Error('Dados inválidos para nomear o PDF.');
  const { nome, tipo, emitidoEm, colisao } = validacao.data;
  const normalizado = nome.normalize('NFKD').toUpperCase()
    .replace(/\p{M}+/gu, '')
    .replace(/[^A-Z]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalizado) throw new Error('O nome não contém letras que possam compor o nome do PDF.');
  const sufixo = `_${nomesTipo[tipo]}_${dataEmSaoPaulo(emitidoEm)}${colisao === 1 ? '' : `_${colisao}`}.pdf`;
  const parteNome = normalizado.slice(0, LIMITE_NOME_PDF - sufixo.length).replace(/_+$/g, '');
  if (!parteNome) throw new Error('Não há espaço para o nome no arquivo PDF.');
  return parteNome + sufixo;
}
