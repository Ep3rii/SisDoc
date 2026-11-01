import {
  OBSERVACAO_PADRAO_INSS,
  type CargoComissionado,
  type ConteudoDtc,
  type DadosInss,
  type PeriodoDtc,
  type RespostaSessao,
  type TipoDtc
} from '@sisdoc/contratos';


export type Papel = RespostaSessao['usuario']['papel'];

export type Servidor = { pessoaId: string; vinculoId: string; nome: string; matricula: string };

export type Props = {
  tipo: TipoDtc;
  csrf: string;
  papel: Papel;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
  onPendente: (valor: boolean) => void;
  confirmarSaida: () => boolean;
};

export type Modo =
  | { tela: 'lista' }
  | { tela: 'busca' }
  | { tela: 'novo'; servidor: Servidor }
  | { tela: 'documento'; id: string };

export const DESCRICOES: Record<TipoDtc, string> = {
  DTC_IPAM: 'Anexo III · Portaria MPS nº 154/2008 · até 4 períodos e 6 linhas de totais.',
  DTC_COMISSIONADO: 'Anexo VIII · CNPJ 06.307102/0001-30 · até 3 cargos em comissão; totais inferidos (provisórios).',
  DTC_INSS: 'RGPS · até 4 períodos com categoria funcional. Modelo PROVISÓRIO: textos oficiais do INSS pendentes.',
};

/** Obtém a duração civil do ano sem alterar as regras de contribuição. */
export function diasNoAno(ano: number): number {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0 ? 366 : 365;
}

/** Inicia período ainda não validado com categoria padrão apenas no formulário INSS. */
export function periodoVazio(tipo: TipoDtc): PeriodoDtc {
  return { inicio: '', fim: '', anos: [], categoria: tipo === 'DTC_INSS' ? 'efetivo' : null, cargo: tipo === 'DTC_INSS' ? '' : null };
}

/** Cria campos independentes de nomeação e exoneração para um cargo em comissão. */
export function cargoVazio(): CargoComissionado {
  return {
    cargo: '', decretoNomeacao: '', publicacaoNomeacao: '', dataEntradaExercicio: '',
    decretoExoneracao: null, publicacaoExoneracao: null, dataEncerramento: null,
  };
}

/** Preenche a documentação-base inicial sem afirmar sua conferência pelo operador. */
export function inssPadrao(): DadosInss {
  return {
    licencas: { possui: false, descricao: null },
    documentacao: { nomeacao: true, ctps: false, folha: true, frequencia: true, outros: null },
    observacao: OBSERVACAO_PADRAO_INSS,
  };
}

/** Prepara conteúdo de formulário sem salvar documento ou confirmar ajuste de admissão. */
export function conteudoInicial(tipo: TipoDtc): ConteudoDtc {
  return {
    periodos: [periodoVazio(tipo)],
    cargos: tipo === 'DTC_COMISSIONADO' ? [cargoVazio()] : [],
    inss: tipo === 'DTC_INSS' ? inssPadrao() : null,
    processo: null,
    confirmarInicioAjustado: false,
  };
}

/** Representa campo opcional vazio como null, preservando o texto não vazio informado. */
export function textoOuNulo(valor: string): string | null {
  return valor.trim() ? valor : null;
}

/** Formata data ISO já validada para exibição, sinalizando ausência com travessão. */
export function dataBr(valor: string | null): string {
  return valor ? valor.split('-').reverse().join('/') : '—';
}
