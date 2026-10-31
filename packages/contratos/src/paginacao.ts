import { z } from 'zod';

export const limitePaginaSchema = z.string().regex(/^(?:[1-9]|[1-4]\d|50)$/)
  .transform(Number).optional().transform((valor) => valor ?? 25);

export const paginaUuidQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  limite: limitePaginaSchema,
});
