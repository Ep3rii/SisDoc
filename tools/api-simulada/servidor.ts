import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// API externa simulada, 100% fictícia, apenas para testes locais em loopback (127.0.0.1, porta aleatória).

export type RegraFalhaSimulada =
  | { tipo: 'status'; status: number; retryAfter?: string }
  | { tipo: 'travar' }
  | { tipo: 'reset' }
  | { tipo: 'json_invalido' };

export interface PedidoSimulado {
  numero: number;
  cursor: string | null;
  limite: number;
  alteradoDesde: string | null;
  autorizado: boolean;
}

export interface ApiSimulada {
  url: string;
  requisicoes: PedidoSimulado[];
  filaFalhas: RegraFalhaSimulada[];
  regraFalha: ((pedido: PedidoSimulado) => RegraFalhaSimulada | null) | null;
  itens(): unknown[];
  inserir(item: Record<string, unknown>, chave?: string): void;
  alterar(id: string, mudancas: Record<string, unknown>): void;
  remover(id: string): void;
  encerrar(): Promise<void>;
}

export interface OpcoesApiSimulada {
  token?: string;
  itens?: Record<string, unknown>[];
}

function chaveDoItem(item: Record<string, unknown>, reserva: string): string {
  return typeof item.id === 'string' && item.id ? item.id : reserva;
}

function responderJson(resposta: ServerResponse, status: number, corpo: unknown, cabecalhos: Record<string, string> = {}) {
  resposta.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...cabecalhos });
  resposta.end(JSON.stringify(corpo));
}

export async function iniciarApiSimulada(opcoes: OpcoesApiSimulada = {}): Promise<ApiSimulada> {
  const registros = new Map<string, Record<string, unknown>>();
  let sequencia = 0;
  const inserir = (item: Record<string, unknown>, chave?: string) => {
    sequencia += 1;
    registros.set(chave ?? chaveDoItem(item, `~sem-id-${String(sequencia).padStart(6, '0')}`), structuredClone(item));
  };
  for (const item of opcoes.itens ?? []) inserir(item);

  const api: ApiSimulada = {
    url: '',
    requisicoes: [],
    filaFalhas: [],
    regraFalha: null,
    itens: () => [...registros.values()].map((item) => structuredClone(item)),
    inserir,
    alterar(id, mudancas) {
      const atual = registros.get(id);
      if (!atual) throw new Error('Item fictício inexistente na API simulada.');
      registros.set(id, { ...atual, ...structuredClone(mudancas), alterado_em: new Date().toISOString() });
    },
    remover(id) {
      registros.delete(id);
    },
    encerrar: async () => undefined,
  };

  const tratar = (requisicao: IncomingMessage, resposta: ServerResponse) => {
    const endereco = new URL(requisicao.url ?? '/', 'http://127.0.0.1');
    if (requisicao.method !== 'GET' || endereco.pathname !== '/servidores') {
      responderJson(resposta, 404, { erro: 'rota inexistente' });
      return;
    }
    const limiteTexto = endereco.searchParams.get('limite') ?? '50';
    const limite = /^\d{1,3}$/.test(limiteTexto) ? Number(limiteTexto) : NaN;
    const pedido: PedidoSimulado = {
      numero: api.requisicoes.length + 1,
      cursor: endereco.searchParams.get('cursor'),
      limite,
      alteradoDesde: endereco.searchParams.get('alterado_desde'),
      autorizado: !opcoes.token || requisicao.headers.authorization === `Bearer ${opcoes.token}`,
    };
    api.requisicoes.push(pedido);
    const falha = api.filaFalhas.shift() ?? api.regraFalha?.(pedido) ?? null;
    if (falha?.tipo === 'travar') return;
    if (falha?.tipo === 'reset') {
      requisicao.socket.destroy();
      return;
    }
    if (falha?.tipo === 'json_invalido') {
      resposta.writeHead(200, { 'Content-Type': 'application/json' });
      resposta.end('{"itens": [');
      return;
    }
    if (falha?.tipo === 'status') {
      responderJson(resposta, falha.status, { erro: 'falha simulada' },
        falha.retryAfter === undefined ? {} : { 'Retry-After': falha.retryAfter });
      return;
    }
    if (!pedido.autorizado) {
      responderJson(resposta, 401, { erro: 'token ausente ou inválido' });
      return;
    }
    if (!Number.isInteger(limite) || limite < 1 || limite > 50) {
      responderJson(resposta, 400, { erro: 'limite deve estar entre 1 e 50' });
      return;
    }
    let depoisDe: string | null = null;
    if (pedido.cursor) {
      try {
        depoisDe = Buffer.from(pedido.cursor, 'base64url').toString('utf8');
      } catch {
        responderJson(resposta, 400, { erro: 'cursor inválido' });
        return;
      }
    }
    const desde = pedido.alteradoDesde ? Date.parse(pedido.alteradoDesde) : null;
    if (desde !== null && Number.isNaN(desde)) {
      responderJson(resposta, 400, { erro: 'alterado_desde inválido' });
      return;
    }
    const geradoEm = new Date().toISOString();
    const candidatos = [...registros.entries()]
      .filter(([chave]) => depoisDe === null || chave > depoisDe)
      .filter(([, item]) => {
        if (desde === null) return true;
        const alterado = typeof item.alterado_em === 'string' ? Date.parse(item.alterado_em) : NaN;
        return !Number.isNaN(alterado) && alterado >= desde;
      })
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const pagina = candidatos.slice(0, limite);
    const ultima = pagina[pagina.length - 1];
    responderJson(resposta, 200, {
      itens: pagina.map(([, item]) => item),
      proximo_cursor: candidatos.length > limite && ultima ? Buffer.from(ultima[0], 'utf8').toString('base64url') : null,
      gerado_em: geradoEm,
    });
  };

  const servidor = createServer(tratar);
  await new Promise<void>((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = servidor.address() as AddressInfo;
  api.url = `http://127.0.0.1:${port}/servidores`;
  api.encerrar = () => new Promise<void>((resolve) => {
    servidor.closeAllConnections();
    servidor.close(() => resolve());
  });
  return api;
}

export function cpfFicticioSimulado(indice: number): string {
  const digitos = String(indice).padStart(9, '0').split('').map(Number);
  for (let posicao = 9; posicao <= 10; posicao += 1) {
    const soma = digitos.reduce((total, digito, i) => total + digito * (posicao + 1 - i), 0);
    const verificador = (soma * 10) % 11;
    digitos.push(verificador === 10 ? 0 : verificador);
  }
  return digitos.join('');
}

export function servidorFicticio(indice: number, alteradoEm = '2024-01-01T00:00:00.000Z'): Record<string, unknown> {
  const numero = String(indice).padStart(4, '0');
  return {
    id: `SRV-${numero}`,
    alterado_em: alteradoEm,
    cpf: cpfFicticioSimulado(700000000 + indice),
    nome: `Servidor Ficticio API ${numero}`,
    nascimento: '1960-01-01',
    nome_mae: `Mae Ficticia API ${numero}`,
    nome_pai: null,
    pis_pasep: null,
    rg_numero: `RG-FIC-${numero}`,
    rg_orgao: 'SSP-FIC',
    rg_expedicao: null,
    titulo_eleitor: null,
    endereco: `Rua Ficticia ${numero}`,
    vinculos: [{
      id: `VIN-${numero}-1`,
      matricula: `API-${numero}-1`,
      regime_juridico: 'ESTATUTARIO',
      cargo: 'Cargo ficticio',
      classe: null,
      nivel: null,
      referencia: 'UNICA',
      setor: 'Setor ficticio',
      orgao_codigo: 'ORG-FIC',
      orgao_nome: 'Orgao ficticio',
      admissao: '1979-01-01',
      desligamento: null,
    }],
  };
}
