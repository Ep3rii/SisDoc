export class ErroApi extends Error {
  /** Preserva o status HTTP para distinguir sessão expirada, conflito e falha de comunicação. */
  constructor(readonly status: number, mensagem: string) {
    super(mensagem);
  }
}

/** Faz requisição autenticada sem cache e comunica falhas de rede, JSON ou resposta HTTP. */
export async function requisitar(
  rota: string,
  metodo: 'GET' | 'POST' | 'PATCH' = 'GET',
  corpo?: unknown,
  csrf?: string,
  provaFonte?: string,
  extras: Record<string, string> = {},
): Promise<unknown> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api/v1/${rota}`, {
      method: metodo,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(provaFonte === undefined ? {} : { 'X-Sisdoc-Fonte-Dof': provaFonte }),
        ...extras,
      },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
  } catch {
    throw new ErroApi(0, 'Não foi possível conectar ao SisDoc. Verifique a conexão e tente novamente.');
  }
  let dados: unknown;
  try {
    dados = await resposta.json();
  } catch {
    throw new ErroApi(resposta.status, 'O servidor retornou uma resposta inválida. Contate o administrador.');
  }
  if (!resposta.ok) {
    const detalhe = typeof dados === 'object' && dados !== null && 'detail' in dados && typeof dados.detail === 'string'
      ? dados.detail : 'Não foi possível concluir a operação. Contate o administrador.';
    throw new ErroApi(resposta.status, detalhe);
  }
  return dados;
}

/** Valida o contrato recebido antes de expor dados do servidor aos componentes. */
export function validar<T>(
  esquema: { safeParse: (entrada: unknown) => { success: true; data: T } | { success: false } },
  entrada: unknown,
): T {
  const resultado = esquema.safeParse(entrada);
  if (!resultado.success) throw new ErroApi(0, 'O servidor retornou dados inválidos. Contate o administrador.');
  return resultado.data;
}

/** Exige confirmação booleana explícita; uma resposta HTTP bem-sucedida sozinha não prova a gravação. */
export function confirmar(entrada: unknown, campo: string): void {
  if (typeof entrada !== 'object' || entrada === null || !(campo in entrada)
      || Reflect.get(entrada, campo) !== true) {
    throw new ErroApi(0, 'O servidor não confirmou a operação. Contate o administrador.');
  }
}

/** Monta paginação padrão de 25 itens sem alterar o cursor opaco recebido da API. */
export function parametros(cursor?: string): string {
  const consulta = new URLSearchParams({ limite: '25' });
  if (cursor) consulta.set('cursor', cursor);
  return consulta.toString();
}
