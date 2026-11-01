import { z } from 'zod';
import { cpfSchema, dataFuncionalSchema } from './dominio';
import { normalizarMatricula, normalizarNomeBusca } from './identificadores';

export const origemSincronizacaoSchema = z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,62}$/);
export const idOrigemApiSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/);
export const tipoSincronizacaoSchema = z.enum(['completa', 'incremental', 'servidor']);
export const statusSincronizacaoSchema = z.enum(['processando', 'concluido', 'falhou']);

// Campos canônicos que podem ser renomeados pelo mapeamento da configuração (campo canônico -> nome na API).
export const CAMPOS_CANONICOS_SINCRONIZACAO = [
  'id', 'alterado_em', 'cpf', 'nome', 'nascimento', 'nome_mae', 'nome_pai', 'pis_pasep', 'rg_numero', 'rg_orgao',
  'rg_expedicao', 'titulo_eleitor', 'endereco', 'vinculos',
  'vinculo.id', 'vinculo.matricula', 'vinculo.regime_juridico', 'vinculo.cargo', 'vinculo.classe', 'vinculo.nivel',
  'vinculo.referencia', 'vinculo.setor', 'vinculo.orgao_codigo', 'vinculo.orgao_nome', 'vinculo.admissao',
  'vinculo.desligamento',
] as const;

export const campoCanonicoSincronizacaoSchema = z.enum(CAMPOS_CANONICOS_SINCRONIZACAO);

const nomeCampoApiSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,62}$/);

export const configuracaoSincronizacaoSchema = z.strictObject({
  origem: origemSincronizacaoSchema,
  url: z.url({ protocol: /^https?$/ }).max(2000).refine((valor) => {
    const endereco = new URL(valor);
    return endereco.username === '' && endereco.password === '' && endereco.hash === '';
  }, 'A URL da API não pode conter credenciais nem fragmento.'),
  credencialArquivo: z.string().min(1).optional(),
  avisoHoras: z.number().int().min(1).max(720).default(24),
  timeoutMs: z.number().int().min(100).max(60000).default(10000),
  limitePagina: z.number().int().min(1).max(50).default(50),
  intervaloMinutos: z.number().int().min(5).max(1440).optional(),
  pausaDisjuntorMinutos: z.number().int().min(1).max(1440).default(15),
  esperaRepeticaoMs: z.number().int().min(10).max(60000).default(1000),
  mapeamento: z.partialRecord(campoCanonicoSincronizacaoSchema, nomeCampoApiSchema).optional(),
});

const semControle = (valor: string) => !/[\u0000-\u001f\u007f]/.test(valor);

const textoOpcionalApi = (maximo: number) => z.string().trim().max(maximo).refine(semControle)
  .nullable().optional().transform((valor) => valor ? valor : null);

const dataOpcionalApi = z.union([dataFuncionalSchema, z.literal('')]).nullable().optional()
  .transform((valor) => valor ? valor : null);

export const vinculoApiSincronizacaoSchema = z.object({
  id: idOrigemApiSchema,
  matricula: z.string().trim().min(1).max(100).refine(semControle)
    .refine((valor) => normalizarMatricula(valor).length > 0),
  regime_juridico: textoOpcionalApi(200),
  cargo: textoOpcionalApi(300),
  classe: textoOpcionalApi(100),
  nivel: textoOpcionalApi(100),
  referencia: textoOpcionalApi(100),
  setor: textoOpcionalApi(300),
  orgao_codigo: textoOpcionalApi(100),
  orgao_nome: textoOpcionalApi(300),
  admissao: dataOpcionalApi,
  desligamento: dataOpcionalApi,
});

// Contrato de um servidor devolvido pela API externa (amostras fictícias em referencias/api-simulada).
export const servidorApiSincronizacaoSchema = z.object({
  id: idOrigemApiSchema,
  alterado_em: z.iso.datetime({ offset: true }),
  cpf: cpfSchema,
  nome: z.string().trim().min(1).max(300).refine(semControle)
    .refine((valor) => normalizarNomeBusca(valor).length > 0),
  nascimento: dataOpcionalApi,
  nome_mae: textoOpcionalApi(300),
  nome_pai: textoOpcionalApi(300),
  pis_pasep: textoOpcionalApi(30),
  rg_numero: textoOpcionalApi(30),
  rg_orgao: textoOpcionalApi(50),
  rg_expedicao: dataOpcionalApi,
  titulo_eleitor: textoOpcionalApi(30),
  endereco: textoOpcionalApi(500),
  vinculos: z.array(vinculoApiSincronizacaoSchema).min(1).max(20),
}).superRefine((servidor, contexto) => {
  const ids = new Set<string>();
  const matriculas = new Set<string>();
  for (const [indice, vinculo] of servidor.vinculos.entries()) {
    const matricula = normalizarMatricula(vinculo.matricula);
    if (ids.has(vinculo.id) || matriculas.has(matricula)) {
      contexto.addIssue({ code: 'custom', path: ['vinculos', indice], message: 'Vínculo repetido no mesmo servidor.' });
    }
    ids.add(vinculo.id);
    matriculas.add(matricula);
  }
});

// Envelope de página: os itens são validados um a um para que um item inválido não descarte a página inteira.
export const paginaApiSincronizacaoSchema = z.object({
  itens: z.array(z.unknown()).max(50),
  proximo_cursor: z.string().min(1).max(500).regex(/^[\x21-\x7e]+$/).nullable(),
  gerado_em: z.iso.datetime({ offset: true }),
});

export const iniciarSincronizacaoSchema = z.strictObject({
  tipo: z.enum(['completa', 'incremental']),
});

export const situacaoSincronizacaoSchema = z.strictObject({
  configurada: z.boolean(),
  ultimaSincronizacaoEm: z.iso.datetime().nullable(),
  horasDesdeUltima: z.number().nonnegative().nullable(),
  limiteHoras: z.number().int().positive(),
  avisoAtraso: z.boolean(),
  disjuntorAberto: z.boolean(),
});

export const erroSincronizacaoSchema = z.strictObject({
  posicao: z.number().int().min(1).nullable(),
  referencia: z.string().regex(/^[0-9a-f]{16}$/).nullable(),
  motivo: z.string().min(1).max(300),
});

export const loteSincronizacaoSchema = z.strictObject({
  id: z.uuid(),
  origem: z.string(),
  tipo: tipoSincronizacaoSchema,
  status: statusSincronizacaoSchema,
  iniciadoEm: z.iso.datetime(),
  concluidoEm: z.iso.datetime().nullable(),
  lidos: z.number().int().nonnegative(),
  inseridos: z.number().int().nonnegative(),
  atualizados: z.number().int().nonnegative(),
  removidos: z.number().int().nonnegative(),
  totalErros: z.number().int().nonnegative(),
  erros: z.array(erroSincronizacaoSchema).max(200),
});

export const paginaSincronizacoesSchema = z.strictObject({
  situacao: situacaoSincronizacaoSchema,
  falhasConsecutivas: z.number().int().nonnegative(),
  disjuntorAbertoAte: z.iso.datetime().nullable(),
  itens: z.array(loteSincronizacaoSchema).max(50),
  proximoCursor: z.uuid().nullable(),
});

export type ConfiguracaoSincronizacao = z.infer<typeof configuracaoSincronizacaoSchema>;
export type CampoCanonicoSincronizacao = z.infer<typeof campoCanonicoSincronizacaoSchema>;
export type ServidorApiSincronizacao = z.infer<typeof servidorApiSincronizacaoSchema>;
export type PaginaApiSincronizacao = z.infer<typeof paginaApiSincronizacaoSchema>;
export type IniciarSincronizacao = z.infer<typeof iniciarSincronizacaoSchema>;
export type SituacaoSincronizacao = z.infer<typeof situacaoSincronizacaoSchema>;
export type ErroSincronizacao = z.infer<typeof erroSincronizacaoSchema>;
export type LoteSincronizacao = z.infer<typeof loteSincronizacaoSchema>;
export type PaginaSincronizacoes = z.infer<typeof paginaSincronizacoesSchema>;
