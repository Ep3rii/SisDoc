import { z } from 'zod';
import { cpfSchema } from './dominio';
import { normalizarNomeBusca } from './identificadores';
import { limitePaginaSchema } from './paginacao';

const tipoBuscaSchema = z.enum(['nome', 'cpf', 'matricula']);

export const buscarServidoresQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/).optional(),
  tipo: tipoBuscaSchema.optional(),
  cursor: z.uuid().optional(),
  limite: limitePaginaSchema.prefault('50'),
}).superRefine((dados, contexto) => {
  if (!dados.q) {
    if (dados.tipo) contexto.addIssue({ code: 'custom', path: ['q'], message: 'Informe o termo de busca.' });
    return;
  }
  if (dados.tipo === 'nome' && normalizarNomeBusca(dados.q).length < 3) {
    contexto.addIssue({ code: 'custom', path: ['q'], message: 'Informe ao menos três caracteres para buscar por nome.' });
  }
  if (dados.tipo === 'cpf' && !cpfSchema.safeParse(dados.q).success) {
    contexto.addIssue({ code: 'custom', path: ['q'], message: 'Informe um CPF válido.' });
  }
  if (dados.tipo === 'matricula' && dados.q.length > 100) {
    contexto.addIssue({ code: 'custom', path: ['q'], message: 'Matrícula excede o limite permitido.' });
  }
});

export const eventosServidorQuerySchema = z.strictObject({
  vinculoId: z.uuid(),
  cursor: z.uuid().optional(),
  limite: limitePaginaSchema,
});

const dataOpcional = z.iso.date().nullable();
const textoOpcionalCadastro = (maximo = 200) => z.string().trim().max(maximo)
  .regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*$/).nullable().transform((valor) => valor || null);
const textoCadastro = (maximo: number) => z.string().trim().min(1).max(maximo).regex(/^[^\x00-\x1f\x7f]+$/);

export const paginaBuscaServidoresSchema = z.strictObject({
  itens: z.array(z.strictObject({
    pessoaId: z.uuid(),
    vinculoId: z.uuid(),
    nome: z.string(),
    cpf: cpfSchema,
    matricula: z.string(),
    orgao: z.string().nullable(),
    sistemaOrigem: z.string(),
    removidoNaFonte: z.boolean(),
  })),
  proximoCursor: z.uuid().nullable(),
});

export const detalheServidorSchema = z.strictObject({
  pessoa: z.strictObject({ id: z.uuid(), nome: z.string(), cpf: cpfSchema }),
  vinculos: z.array(z.strictObject({
    id: z.uuid(),
    matricula: z.string(),
    sistemaOrigem: z.string(),
    matriculaAnteriorId: z.uuid().nullable(),
    regimeJuridico: z.string().nullable(),
    cargo: z.string().nullable(),
    classe: z.string().nullable(),
    nivel: z.string().nullable(),
    referencia: z.string().nullable(),
    setor: z.string().nullable(),
    orgao: z.string().nullable(),
    admissao: dataOpcional,
    desligamento: dataOpcional,
    removidoNaFonte: z.boolean(),
  })),
  proximoCursor: z.uuid().nullable(),
});

export const paginaEventosServidorSchema = z.strictObject({
  itens: z.array(z.strictObject({
    id: z.uuid(),
    tipo: z.string(),
    dataEvento: dataOpcional,
    dataPublicacao: dataOpcional,
    atoTipo: z.string().nullable(),
    atoNumero: z.string().nullable(),
    fonte: z.string(),
    removidoNaFonte: z.boolean(),
  })),
  proximoCursor: z.uuid().nullable(),
});

export type BuscarServidoresQuery = z.infer<typeof buscarServidoresQuerySchema>;
export type TipoBuscaServidor = z.infer<typeof tipoBuscaSchema>;
export type PaginaBuscaServidores = z.infer<typeof paginaBuscaServidoresSchema>;
export type DetalheServidor = z.infer<typeof detalheServidorSchema>;
export type PaginaEventosServidor = z.infer<typeof paginaEventosServidorSchema>;

export const referenciaServidorQuerySchema = z.strictObject({
  vinculoId: z.uuid(),
  tipo: z.enum(['eventos_funcionais', 'afastamentos', 'incorporacoes', 'periodos_ipam']).default('eventos_funcionais'),
  limite: limitePaginaSchema,
  cursor: z.uuid().optional(),
});
export const referenciaServidorSchema = z.strictObject({
  pessoaId: z.uuid(),
  vinculoId: z.uuid(),
  revisaoPessoa: z.string().regex(/^[1-9][0-9]{0,18}$/),
  revisaoVinculo: z.string().regex(/^[1-9][0-9]{0,18}$/),
  cadastro: z.strictObject({
    nome: textoCadastro(200),
    cpf: cpfSchema,
    nascimento: dataOpcional,
    nomeMae: textoOpcionalCadastro(),
    nomePai: textoOpcionalCadastro(),
    pisPasep: textoOpcionalCadastro(),
    rgNumero: textoOpcionalCadastro(),
    rgOrgao: textoOpcionalCadastro(100),
    rgExpedicao: dataOpcional,
    tituloEleitor: textoOpcionalCadastro(),
    endereco: textoOpcionalCadastro(500),
    matricula: textoCadastro(100),
    regimeJuridico: textoOpcionalCadastro(),
    cargo: textoOpcionalCadastro(),
    classe: textoOpcionalCadastro(),
    nivel: textoOpcionalCadastro(),
    referencia: textoOpcionalCadastro(),
    setor: textoOpcionalCadastro(),
    orgaoCodigo: textoOpcionalCadastro(100),
    orgao: textoOpcionalCadastro(),
    admissao: dataOpcional,
    desligamento: dataOpcional,
  }).superRefine((dados, contexto) => {
    if (normalizarNomeBusca(dados.nome).length === 0) {
      contexto.addIssue({ code: 'custom', path: ['nome'], message: 'Informe um nome com caracteres pesquisáveis.' });
    }
    if (dados.admissao && dados.desligamento && dados.desligamento < dados.admissao) {
      contexto.addIssue({ code: 'custom', path: ['desligamento'], message: 'Desligamento não pode ser anterior à admissão.' });
    }
  }),
  pessoa: z.record(z.string(), z.string().nullable()),
  registros: z.array(z.strictObject({
    id: z.uuid(),
    campos: z.record(z.string(), z.string().nullable()),
  })),
  proximoCursor: z.uuid().nullable(),
});
export const cadastroServidorSchema = referenciaServidorSchema.shape.cadastro;
export const atualizarServidorSchema = z.strictObject({
  pessoaId: z.uuid(),
  vinculoId: z.uuid(),
  revisaoPessoa: z.string().regex(/^[1-9][0-9]{0,18}$/),
  revisaoVinculo: z.string().regex(/^[1-9][0-9]{0,18}$/),
  cadastro: cadastroServidorSchema,
  motivo: z.string().trim().min(5).max(2000).regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+$/),
});
export const resultadoEdicaoServidorSchema = z.strictObject({
  atualizado: z.literal(true),
  revisaoPessoa: z.string().regex(/^[1-9][0-9]{0,18}$/),
  revisaoVinculo: z.string().regex(/^[1-9][0-9]{0,18}$/),
});
export type ReferenciaServidorQuery = z.infer<typeof referenciaServidorQuerySchema>;
export type ReferenciaServidor = z.infer<typeof referenciaServidorSchema>;
export type CadastroServidor = z.infer<typeof cadastroServidorSchema>;
export type AtualizarServidor = z.infer<typeof atualizarServidorSchema>;
export type ResultadoEdicaoServidor = z.infer<typeof resultadoEdicaoServidorSchema>;
