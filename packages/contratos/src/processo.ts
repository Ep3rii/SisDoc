import { z } from 'zod';

export const mascaraProcessoSchema = z.string().trim().min(1).max(100)
  .regex(/^[A-Za-z0-9#@* ./-]+$/)
  .refine((valor) => /[#@*]/.test(valor), 'A máscara deve conter ao menos um marcador.');

export const configuracaoProcessosSchema = z.strictObject({
  mascaras: z.array(mascaraProcessoSchema).min(1).max(10),
});

export const numeroProcessoSchema = z.string().trim().min(1).max(100)
  .regex(/^[A-Za-z0-9 ./-]+$/)
  .transform((valor) => valor.toUpperCase());

/** Valida comprimento e marcadores: # dígito, @ letra, * alfanumérico; demais caracteres são literais. */
export function processoCorrespondeMascara(numero: string, mascara: string): boolean {
  const normalizado = numeroProcessoSchema.safeParse(numero);
  const formato = mascaraProcessoSchema.safeParse(mascara);
  if (!normalizado.success || !formato.success || normalizado.data.length !== formato.data.length) return false;
  return [...formato.data.toUpperCase()].every((marcador, indice) => {
    const caractere = normalizado.data[indice];
    if (marcador === '#') return /^[0-9]$/.test(caractere);
    if (marcador === '@') return /^[A-Z]$/.test(caractere);
    if (marcador === '*') return /^[A-Z0-9]$/.test(caractere);
    return marcador === caractere;
  });
}
