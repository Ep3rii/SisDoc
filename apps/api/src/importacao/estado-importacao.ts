import {
  type OcorrenciaImportacao,
  type TipoImportacao
} from '@sisdoc/contratos';
import { createHash } from 'node:crypto';
import { type ClientBase } from 'pg';
import type { ProtetorDados } from '../seguranca/protecao-dados';


export const CHAVE_BLOQUEIO_IMPORTACAO = [1936286851, 3001] as const;

export type CanalImportacao = 'cli' | 'tela' | 'legado';

export type OpcoesImportacao = {
  tipo: TipoImportacao;
  origem: string;
  canal: CanalImportacao;
  usuarioId: string;
  gravar: boolean;
  hashArquivo: Buffer;
  progresso?: (feitos: number, total: number) => void;
  antes?: (cliente: ClientBase) => Promise<void>;
  ip?: string | null;
  preservarExistentes?: boolean;
  referenciasCompletas?: boolean;
  preparar?: (cliente: ClientBase) => Promise<void>;
  loteLegadoId?: string;
  limiteOcorrencias?: number;
  revalidarExistente?: boolean;
};

/** Falha esperada de domínio que pode ser apresentada sem detalhes internos do banco. */
export class ErroImportacao extends Error {}

/** Estado transacional incerto: conexões de pool devem ser descartadas pelo chamador. */
export class ErroTransacaoImportacao extends AggregateError {}

/** Identifica os bytes exatos do arquivo por SHA-256; não substitui autorização ou validação. */
export function hashArquivo(conteudo: Buffer): Buffer {
  return createHash('sha256').update(conteudo).digest();
}

export type Estado = {
  cliente: ClientBase;
  protetor: ProtetorDados;
  loteId: string;
  origem: string;
  ocorrencias: OcorrenciaImportacao[];
  contagens: { inseridos: number; atualizados: number; inalterados: number; rejeitadosBanco: number };
  progresso: (avanco: number) => void;
  preservarExistentes: boolean;
};
