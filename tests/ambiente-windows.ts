import { z } from 'zod';

export const sidServicoTeste = z.enum(['S-1-5-19', 'S-1-5-20'])
  .parse(process.env.SISDOC_TEST_SID_SERVICO ?? 'S-1-5-19');
