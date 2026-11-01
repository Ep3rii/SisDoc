import {
  type TipoBuscaServidor
} from '@sisdoc/contratos';


export type Props = { onErro: (erro: unknown) => void; onLimpar: () => void };

export type ProtecaoEdicao = { onPendente: (valor: boolean) => void; confirmarSaida: () => boolean };

export type Consulta = { q: string; tipo: TipoBuscaServidor };
