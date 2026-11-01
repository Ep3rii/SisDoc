import {
  type RascunhoDof
} from '@sisdoc/contratos';

export type Props = {
  pessoaId: string;
  vinculoId: string;
  nome: string;
  matricula: string;
  admissao: string | null;
  csrf: string;
  podeSalvar: boolean;
  somenteLeitura?: boolean;
  rascunhoInicial?: RascunhoDof;
  onFechar: (mensagem?: string) => void;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
  onPendente: (valor: boolean) => void;
  confirmarSaida: () => boolean;
};
export const campos = [
  ['faltas', 'Faltas'], ['ts', 'T/S'], ['pf', 'P/F'], ['ip', 'I/P'],
  ['outros', 'Outros'], ['pb', 'PB'], ['pv', 'PV'], ['licencaPremio', 'Licença-prêmio'],
] as const;
export type Campo = typeof campos[number][0];
export type ValoresAno = Partial<Record<Campo, string>>;
export type Tabela = { inicio: string; fim: string; anos: number[] };
export const tamanhoPagina = 20;
export const abas = [
  ['dados', 'Dados do servidor'], ['periodo', 'Período'], ['tabela', 'Tabela ano a ano'],
  ['blocos', 'Blocos de texto'], ['conferencia', 'Conferência'],
] as const;
export type Aba = typeof abas[number][0];
