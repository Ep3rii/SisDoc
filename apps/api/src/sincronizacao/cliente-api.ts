import { readFile } from 'node:fs/promises';
import {
  paginaApiSincronizacaoSchema,
  type ConfiguracaoSincronizacao,
  type PaginaApiSincronizacao,
} from '@sisdoc/contratos';

export const MAXIMO_REPETICOES_API = 3;
const LIMITE_RETRY_AFTER_MS = 60000;
const LIMITE_CORPO_BYTES = 10 * 1024 * 1024;

// Mensagens fixas e sanitizadas: nunca repetem corpo, cabeçalhos ou dados pessoais vindos da API.
export class ErroApiExterna extends Error {
  constructor(message: string, readonly repetivel: boolean, readonly esperaSugeridaMs?: number) {
    super(message);
    this.name = 'ErroApiExterna';
  }
}

export interface OpcoesClienteApi {
  esperar?: (ms: number) => Promise<void>;
  lerCredencial?: (arquivo: string) => Promise<string>;
}

export interface PedidoPagina {
  cursor?: string | null;
  alteradoDesde?: string | null;
}

const esperarPadrao = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function interpretarRetryAfter(valor: string | null, agora = Date.now()): number | null {
  if (!valor) return null;
  const texto = valor.trim();
  if (/^\d{1,6}$/.test(texto)) return Number(texto) * 1000;
  const data = Date.parse(texto);
  if (Number.isNaN(data)) return null;
  return Math.max(0, data - agora);
}

async function lerCorpoLimitado(resposta: Response): Promise<string> {
  if (!resposta.body) return '';
  const leitor = resposta.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > LIMITE_CORPO_BYTES) {
      await leitor.cancel().catch(() => undefined);
      throw new ErroApiExterna('A API externa devolveu uma página maior que o limite aceito.', false);
    }
    partes.push(value);
  }
  return Buffer.concat(partes).toString('utf8');
}

export class ClienteApiSincronizacao {
  private readonly esperar: (ms: number) => Promise<void>;
  private readonly lerCredencial: (arquivo: string) => Promise<string>;
  private token: string | null | undefined;

  constructor(private readonly configuracao: ConfiguracaoSincronizacao, opcoes: OpcoesClienteApi = {}) {
    this.esperar = opcoes.esperar ?? esperarPadrao;
    this.lerCredencial = opcoes.lerCredencial ?? ((arquivo) => readFile(arquivo, 'utf8'));
  }

  private async credencial(): Promise<string | null> {
    if (this.token !== undefined) return this.token;
    const arquivo = this.configuracao.credencialArquivo;
    if (!arquivo) {
      this.token = null;
      return null;
    }
    let conteudo: string;
    try {
      conteudo = await this.lerCredencial(arquivo);
    } catch {
      throw new ErroApiExterna('Não foi possível ler o arquivo de credencial da sincronização.', false);
    }
    const token = conteudo.trim();
    if (!/^[\x21-\x7e]{8,4096}$/.test(token)) {
      throw new ErroApiExterna('O arquivo de credencial da sincronização não contém um token válido.', false);
    }
    this.token = token;
    return token;
  }

  private endereco(pedido: PedidoPagina): URL {
    const endereco = new URL(this.configuracao.url);
    endereco.searchParams.set('limite', String(Math.min(this.configuracao.limitePagina, 50)));
    if (pedido.cursor) endereco.searchParams.set('cursor', pedido.cursor);
    if (pedido.alteradoDesde) endereco.searchParams.set('alterado_desde', pedido.alteradoDesde);
    return endereco;
  }

  private async tentar(pedido: PedidoPagina): Promise<PaginaApiSincronizacao> {
    const token = await this.credencial();
    const cabecalhos: Record<string, string> = { Accept: 'application/json' };
    if (token) cabecalhos.Authorization = `Bearer ${token}`;
    let corpo: string;
    try {
      const resposta = await fetch(this.endereco(pedido), {
        method: 'GET', headers: cabecalhos, redirect: 'error', signal: AbortSignal.timeout(this.configuracao.timeoutMs),
      });
      if (resposta.status !== 200) {
        await resposta.body?.cancel().catch(() => undefined);
        if (resposta.status === 429) {
          const espera = interpretarRetryAfter(resposta.headers.get('retry-after'));
          throw new ErroApiExterna('A API externa limitou a taxa de requisições (429).', true, espera ?? undefined);
        }
        if (resposta.status === 401 || resposta.status === 403) {
          throw new ErroApiExterna('A API externa recusou a credencial configurada; revise o arquivo de token.', false);
        }
        if (resposta.status >= 500) {
          throw new ErroApiExterna(`A API externa respondeu com falha temporária (${resposta.status}).`, true);
        }
        throw new ErroApiExterna(`A API externa respondeu com status inesperado (${resposta.status}).`, false);
      }
      corpo = await lerCorpoLimitado(resposta);
    } catch (erro) {
      if (erro instanceof ErroApiExterna) throw erro;
      if (erro instanceof Error && (erro.name === 'TimeoutError' || erro.name === 'AbortError')) {
        throw new ErroApiExterna('A API externa não respondeu dentro do tempo limite.', true);
      }
      throw new ErroApiExterna('Não foi possível conectar à API externa.', true);
    }
    let dados: unknown;
    try {
      dados = JSON.parse(corpo);
    } catch {
      throw new ErroApiExterna('A API externa devolveu uma página que não é JSON válido.', false);
    }
    const pagina = paginaApiSincronizacaoSchema.safeParse(dados);
    if (!pagina.success) {
      throw new ErroApiExterna('A API externa devolveu uma página fora do contrato esperado.', false);
    }
    if (pagina.data.itens.length > this.configuracao.limitePagina) {
      throw new ErroApiExterna('A API externa devolveu mais itens que o limite solicitado.', false);
    }
    return pagina.data;
  }

  async buscarPagina(pedido: PedidoPagina = {}): Promise<PaginaApiSincronizacao> {
    for (let tentativa = 0; ; tentativa += 1) {
      try {
        return await this.tentar(pedido);
      } catch (erro) {
        const falha = erro instanceof ErroApiExterna
          ? erro
          : new ErroApiExterna('Falha inesperada ao consultar a API externa.', false);
        if (!falha.repetivel || tentativa >= MAXIMO_REPETICOES_API) throw falha;
        const espera = falha.esperaSugeridaMs ?? this.configuracao.esperaRepeticaoMs * 2 ** tentativa;
        if (espera > LIMITE_RETRY_AFTER_MS) {
          throw new ErroApiExterna('A API externa pediu uma pausa maior que o limite aceito; tente mais tarde.', false);
        }
        await this.esperar(espera);
      }
    }
  }
}
