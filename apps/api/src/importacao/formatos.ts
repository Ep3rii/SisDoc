import {
  cpfSchema, dataFuncionalSchema, mascararCpf, mascararMatricula, normalizarMatricula,
  type OcorrenciaImportacao, type TipoImportacao,
} from '@sisdoc/contratos';

export class ErroFormato extends Error {}

export type CamposPessoa = {
  nome: string;
  nascimento: string | null;
  mae: string | null;
  pis: string | null;
  rg: string | null;
  orgaoRg: string | null;
  expedicao: string | null;
  titulo: string | null;
  endereco: string | null;
};

export type CamposVinculo = {
  matricula: string;
  matriculaNorm: string;
  regime: string | null;
  cargo: string | null;
  referencia: string | null;
  setor: string | null;
  orgao: string | null;
  admissao: string | null;
  desligamento: string | null;
};

export type PessoaArquivo = { linha: number; cpf: string; campos: CamposPessoa };
export type VinculoArquivo = { linha: number; cpf: string; campos: CamposVinculo };

export type AfastamentoArquivo = {
  linha: number; matriculaNorm: string; idOrigem: string;
  tipo: 'falta' | 'licenca_ts' | 'licenca_pf' | 'licenca_ip' | 'outro';
  ano: number | null; dias: number | null; inicio: string | null; fim: string | null;
};
export type IncorporacaoArquivo = {
  linha: number; matriculaNorm: string; idOrigem: string; tipo: 'PB' | 'PV' | 'LIC_PREMIO'; inicio: string; fim: string;
};
export type PeriodoIpamArquivo = { linha: number; cpf: string; inicio: string; fim: string };
export type EventoArquivo = {
  linha: number; matriculaNorm: string; idOrigem: string; tipo: string; data: string | null;
  atoNumero: string | null; dataPublicacao: string | null; descricao: string | null;
};

export type Analise =
  | { tipo: 'dados_funcionais'; pessoas: PessoaArquivo[]; vinculos: VinculoArquivo[] }
  | { tipo: 'afastamentos'; registros: AfastamentoArquivo[] }
  | { tipo: 'incorporacoes'; registros: IncorporacaoArquivo[] }
  | { tipo: 'periodos_ipam'; registros: PeriodoIpamArquivo[] }
  | { tipo: 'eventos_funcionais'; registros: EventoArquivo[] };

export type ResultadoAnalise = {
  analise: Analise;
  lidos: number;
  validos: number;
  ocorrencias: OcorrenciaImportacao[];
  avisos: string[];
};

export const COLUNAS: Readonly<Record<TipoImportacao, readonly string[]>> = Object.freeze({
  dados_funcionais: [
    'MATRICULA', 'NOME', 'CPF', 'NASCIMENTO', 'MAE', 'ADMISSAO', 'REGIMEJUR', 'CARGO', 'REFERENCIA', 'SETOR', 'ORGAO',
    'DESLIGAMENTO', 'PISPASEP', 'NUMRG', 'NUMTITEL', 'ORGAORG', 'ENDERECO', 'EXPEDICAO',
  ],
  afastamentos: ['MATRICULA', 'ANO', 'FALTAS', 'TS', 'PF', 'IP', 'OUTROS'],
  incorporacoes: ['MATRICULA', 'TIPO', 'DT_INICIO', 'DT_FIM'],
  periodos_ipam: ['CPF', 'MES_INICIO', 'MES_FIM'],
  eventos_funcionais: ['MATRICULA', 'TIPO', 'DATA', 'ATO_NUMERO', 'DATA_PUBLICACAO', 'DESCRICAO'],
});

export const COLUNAS_AFASTAMENTO_INTERVALO = ['MATRICULA', 'TIPO', 'DT_INICIO', 'DT_FIM'] as const;

const OBRIGATORIAS: Readonly<Record<TipoImportacao, readonly string[]>> = Object.freeze({
  dados_funcionais: ['MATRICULA', 'NOME', 'CPF'],
  afastamentos: ['MATRICULA'],
  incorporacoes: ['MATRICULA', 'TIPO', 'DT_INICIO', 'DT_FIM'],
  periodos_ipam: ['CPF', 'MES_INICIO', 'MES_FIM'],
  eventos_funcionais: ['MATRICULA', 'TIPO'],
});

const SINONIMOS: Readonly<Record<string, string>> = Object.freeze({
  MATR: 'MATRICULA', NOMEMAE: 'MAE', NOMEDAMAE: 'MAE', DATANASCIMENTO: 'NASCIMENTO', DTNASCIMENTO: 'NASCIMENTO',
  DATAADMISSAO: 'ADMISSAO', DTADMISSAO: 'ADMISSAO', REGIME: 'REGIMEJUR', REGIMEJURIDICO: 'REGIMEJUR',
  DATADESLIGAMENTO: 'DESLIGAMENTO', DTDESLIGAMENTO: 'DESLIGAMENTO', PIS: 'PISPASEP', PASEP: 'PISPASEP', RG: 'NUMRG',
  TITULO: 'NUMTITEL', TITULOELEITOR: 'NUMTITEL', ORGAOEXPEDIDOR: 'ORGAORG', DATAEXPEDICAO: 'EXPEDICAO',
  DATAINICIO: 'DTINICIO', INICIO: 'DTINICIO', DATAFIM: 'DTFIM', FIM: 'DTFIM', FALTA: 'FALTAS', OUTRO: 'OUTROS',
  INICIOMES: 'MESINICIO', FIMMES: 'MESFIM', DATAEVENTO: 'DATA', ATO: 'ATONUMERO', NUMEROATO: 'ATONUMERO',
  DATAPUBLICACAO: 'DATAPUBLICACAO', PUBLICACAO: 'DATAPUBLICACAO',
});

function chaveCabecalho(valor: string): string {
  const chave = valor.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return SINONIMOS[chave] ?? chave;
}

function chaveCanonica(coluna: string): string {
  return coluna.replace(/_/g, '');
}

export function texto(valor: string | undefined): string | null {
  const limpo = (valor ?? '').replace(/\s+/g, ' ').trim();
  return limpo === '' ? null : limpo;
}

function semAcento(valor: string): string {
  return valor.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
}

const DIA_MS = 86_400_000;
const BASE_EXCEL = Date.UTC(1899, 11, 30);

export function lerData(valor: string | undefined): string | null | undefined {
  const bruto = texto(valor);
  if (bruto === null) return null;
  let iso: string | undefined;
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+Z?)?$/.exec(bruto);
  const brMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(bruto);
  if (isoMatch) iso = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  else if (brMatch) iso = `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`;
  else if (/^\d{1,7}(?:\.\d+)?$/.test(bruto)) {
    const serial = Math.floor(Number(bruto));
    if (serial >= 1 && serial <= 2_958_465) iso = new Date(BASE_EXCEL + serial * DIA_MS).toISOString().slice(0, 10);
  }
  if (!iso || !dataFuncionalSchema.safeParse(iso).success) return undefined;
  return iso;
}

function lerMes(valor: string | undefined): string | null | undefined {
  const bruto = texto(valor);
  if (bruto === null) return null;
  const mesAno = /^(\d{1,2})\/(\d{4})$/.exec(bruto);
  const anoMes = /^(\d{4})-(\d{2})$/.exec(bruto);
  let iso: string | null | undefined;
  if (mesAno) iso = `${mesAno[2]}-${mesAno[1].padStart(2, '0')}-01`;
  else if (anoMes) iso = `${anoMes[1]}-${anoMes[2]}-01`;
  else {
    iso = lerData(bruto);
    if (iso) iso = `${iso.slice(0, 7)}-01`;
  }
  if (!iso || !dataFuncionalSchema.safeParse(iso).success) return undefined;
  return iso;
}

function lerInteiro(valor: string | undefined, maximo: number): number | null | undefined {
  const bruto = texto(valor);
  if (bruto === null) return null;
  const numero = Number(bruto.replace(',', '.'));
  if (!Number.isInteger(numero) || numero < 0 || numero > maximo) return undefined;
  return numero;
}

type Leitor = {
  linhas: string[][];
  indices: Map<string, number>;
  valor: (linha: string[], coluna: string) => string | undefined;
};

function mapearCabecalho(tipo: TipoImportacao, linhas: string[][], avisos: string[]): Leitor {
  const indiceCabecalho = linhas.findIndex((linha) => linha.some((valor) => valor.trim() !== ''));
  if (indiceCabecalho < 0) throw new ErroFormato('O arquivo não possui cabeçalho.');
  const cabecalho = linhas[indiceCabecalho];
  const conhecidas = new Set([...COLUNAS[tipo], ...(tipo === 'afastamentos' ? COLUNAS_AFASTAMENTO_INTERVALO : [])].map(chaveCanonica));
  const indices = new Map<string, number>();
  const ignoradas: string[] = [];
  cabecalho.forEach((nome, indice) => {
    let chave = chaveCabecalho(nome);
    if (chave === '') return;
    if (tipo === 'dados_funcionais' && chave === 'ADMISSAO' && indices.has('ADMISSAO') && !cabecalho.some((outro) => chaveCabecalho(outro) === 'EXPEDICAO')) {
      chave = 'EXPEDICAO';
      avisos.push('A segunda coluna ADMISSAO foi tratada como EXPEDICAO (data de expedição do RG).');
    }
    if (!conhecidas.has(chave)) {
      ignoradas.push(nome.trim());
      return;
    }
    if (indices.has(chave)) throw new ErroFormato(`A coluna ${nome.trim()} aparece mais de uma vez no cabeçalho.`);
    indices.set(chave, indice);
  });
  if (ignoradas.length > 0) avisos.push(`Colunas ignoradas: ${ignoradas.slice(0, 20).join(', ')}.`);
  const faltantes = OBRIGATORIAS[tipo].filter((coluna) => !indices.has(chaveCanonica(coluna)));
  if (faltantes.length > 0) {
    throw new ErroFormato(`Faltam colunas obrigatórias para ${tipo}: ${faltantes.join(', ')}. Use os modelos de referencias/modelos-importacao.`);
  }
  return {
    linhas: linhas.slice(indiceCabecalho + 1),
    indices,
    valor: (linha, coluna) => {
      const indice = indices.get(chaveCanonica(coluna));
      return indice === undefined ? undefined : linha[indice];
    },
  };
}

class Coletor {
  readonly ocorrencias: OcorrenciaImportacao[] = [];
  validos = 0;

  registrar(linha: number, tipo: OcorrenciaImportacao['tipo'], motivo: string, referencia: string): void {
    this.ocorrencias.push({ linha, tipo, motivo, referencia });
  }
}

function referencia(cpf: string | null, matricula: string | null): string {
  const partes: string[] = [];
  if (matricula) partes.push(`matrícula ${mascararMatricula(matricula)}`);
  if (cpf) partes.push(`CPF ${mascararCpf(cpf)}`);
  return partes.join(' / ') || 'sem identificação';
}

const REGIMES_CONHECIDOS = new Set(['ESTATUTARIO', 'SERVICO PRESTADO']);
const ROTULOS_PESSOA: Readonly<Record<keyof CamposPessoa, string>> = {
  nome: 'NOME', nascimento: 'NASCIMENTO', mae: 'MAE', pis: 'PISPASEP', rg: 'NUMRG', orgaoRg: 'ORGAORG',
  expedicao: 'EXPEDICAO', titulo: 'NUMTITEL', endereco: 'ENDERECO',
};

function analisarDadosFuncionais(leitor: Leitor, coletor: Coletor): Analise {
  const pessoas = new Map<string, PessoaArquivo>();
  const vinculos: VinculoArquivo[] = [];
  const matriculas = new Map<string, number>();
  const hoje = new Date().toISOString().slice(0, 10);
  leitor.linhas.forEach((linha, posicao) => {
    const numero = posicao + 2;
    const matricula = texto(leitor.valor(linha, 'MATRICULA'));
    const cpfBruto = texto(leitor.valor(linha, 'CPF'));
    const cpf = cpfBruto ? cpfSchema.safeParse(cpfBruto.replace(/\s/g, '')) : null;
    const nome = texto(leitor.valor(linha, 'NOME'));
    if (!cpf?.success) {
      coletor.registrar(numero, 'quarentena', cpfBruto ? 'CPF inválido; linha em quarentena.' : 'CPF ausente; linha em quarentena.', referencia(null, matricula));
      return;
    }
    if (!matricula || matricula.length > 40) {
      coletor.registrar(numero, 'rejeitada', matricula ? 'Matrícula com mais de 40 caracteres.' : 'Matrícula ausente.', referencia(cpf.data, null));
      return;
    }
    if (!nome || nome.length > 200) {
      coletor.registrar(numero, 'rejeitada', nome ? 'Nome com mais de 200 caracteres.' : 'Nome ausente.', referencia(cpf.data, matricula));
      return;
    }
    const matriculaNorm = normalizarMatricula(matricula);
    const anterior = matriculas.get(matriculaNorm);
    if (anterior !== undefined) {
      coletor.registrar(numero, 'duplicada', `Matrícula repetida no arquivo (primeira ocorrência na linha ${anterior}); linha rejeitada.`, referencia(cpf.data, matricula));
      return;
    }
    matriculas.set(matriculaNorm, numero);
    const ref = referencia(cpf.data, matricula);
    const data = (coluna: string): string | null => {
      const valor = lerData(leitor.valor(linha, coluna));
      if (valor === undefined) {
        coletor.registrar(numero, 'anomalia', `Data inválida em ${coluna}; campo ignorado.`, ref);
        return null;
      }
      return valor;
    };
    const campos: CamposPessoa = {
      nome,
      nascimento: data('NASCIMENTO'),
      mae: texto(leitor.valor(linha, 'MAE')),
      pis: texto(leitor.valor(linha, 'PISPASEP')),
      rg: texto(leitor.valor(linha, 'NUMRG')),
      orgaoRg: texto(leitor.valor(linha, 'ORGAORG')),
      expedicao: data('EXPEDICAO'),
      titulo: texto(leitor.valor(linha, 'NUMTITEL')),
      endereco: texto(leitor.valor(linha, 'ENDERECO')),
    };
    const vinculo: CamposVinculo = {
      matricula,
      matriculaNorm,
      regime: texto(leitor.valor(linha, 'REGIMEJUR')),
      cargo: texto(leitor.valor(linha, 'CARGO')),
      referencia: texto(leitor.valor(linha, 'REFERENCIA')),
      setor: texto(leitor.valor(linha, 'SETOR')),
      orgao: texto(leitor.valor(linha, 'ORGAO')),
      admissao: data('ADMISSAO'),
      desligamento: data('DESLIGAMENTO'),
    };
    if (vinculo.referencia && !vinculo.referencia.includes('-')) coletor.registrar(numero, 'anomalia', 'Referência sem hífen.', ref);
    if (vinculo.admissao && vinculo.desligamento && vinculo.desligamento < vinculo.admissao) {
      coletor.registrar(numero, 'anomalia', 'Desligamento anterior à admissão.', ref);
    }
    if (vinculo.regime && !REGIMES_CONHECIDOS.has(semAcento(vinculo.regime))) coletor.registrar(numero, 'anomalia', 'Regime jurídico desconhecido.', ref);
    if (campos.nascimento && (campos.nascimento < '1900-01-01' || campos.nascimento > hoje
      || (vinculo.admissao !== null && Number(vinculo.admissao.slice(0, 4)) - Number(campos.nascimento.slice(0, 4)) < 14))) {
      coletor.registrar(numero, 'anomalia', 'Data de nascimento improvável.', ref);
    }
    if (!campos.mae) coletor.registrar(numero, 'anomalia', 'Nome da mãe ausente.', ref);
    if (!campos.endereco) coletor.registrar(numero, 'anomalia', 'Endereço ausente.', ref);

    const existente = pessoas.get(cpf.data);
    if (!existente) {
      pessoas.set(cpf.data, { linha: numero, cpf: cpf.data, campos });
    } else {
      const divergentes: string[] = [];
      for (const chave of Object.keys(campos) as Array<keyof CamposPessoa>) {
        const atual = existente.campos[chave];
        const novo = campos[chave];
        if (novo === null) continue;
        if (atual === null) (existente.campos as Record<keyof CamposPessoa, string | null>)[chave] = novo;
        else if (atual !== novo) divergentes.push(ROTULOS_PESSOA[chave]);
      }
      if (divergentes.length > 0) {
        coletor.registrar(numero, 'divergencia', `Mesmo CPF da linha ${existente.linha} com dados diferentes (${divergentes.join(', ')}); mantidos os da primeira linha.`, ref);
      }
    }
    vinculos.push({ linha: numero, cpf: cpf.data, campos: vinculo });
    coletor.validos += 1;
  });
  return { tipo: 'dados_funcionais', pessoas: [...pessoas.values()], vinculos };
}

const TIPOS_AFASTAMENTO: Readonly<Record<string, AfastamentoArquivo['tipo']>> = Object.freeze({
  FALTA: 'falta', FALTAS: 'falta', TS: 'licenca_ts', LICENCATS: 'licenca_ts', PF: 'licenca_pf', LICENCAPF: 'licenca_pf',
  IP: 'licenca_ip', LICENCAIP: 'licenca_ip', OUTRO: 'outro', OUTROS: 'outro',
});
const COLUNAS_ANUAIS: ReadonlyArray<[string, AfastamentoArquivo['tipo']]> = [
  ['FALTAS', 'falta'], ['TS', 'licenca_ts'], ['PF', 'licenca_pf'], ['IP', 'licenca_ip'], ['OUTROS', 'outro'],
];

function registrarUnico<T extends { idOrigem: string; linha: number }>(
  registros: T[], vistos: Map<string, number>, registro: T, coletor: Coletor, ref: string,
): boolean {
  const anterior = vistos.get(registro.idOrigem);
  if (anterior !== undefined) {
    coletor.registrar(registro.linha, 'duplicada', `Registro repetido no arquivo (primeira ocorrência na linha ${anterior}); linha rejeitada.`, ref);
    return false;
  }
  vistos.set(registro.idOrigem, registro.linha);
  registros.push(registro);
  return true;
}

function analisarAfastamentos(leitor: Leitor, coletor: Coletor): Analise {
  const anual = leitor.indices.has('ANO');
  if (!anual && !['TIPO', 'DTINICIO', 'DTFIM'].every((coluna) => leitor.indices.has(coluna))) {
    throw new ErroFormato('Afastamentos exigem as colunas MATRICULA, ANO, FALTAS, TS, PF, IP, OUTROS ou MATRICULA, TIPO, DT_INICIO, DT_FIM.');
  }
  const registros: AfastamentoArquivo[] = [];
  const vistos = new Map<string, number>();
  leitor.linhas.forEach((linha, posicao) => {
    const numero = posicao + 2;
    const matricula = texto(leitor.valor(linha, 'MATRICULA'));
    const ref = referencia(null, matricula);
    if (!matricula) {
      coletor.registrar(numero, 'rejeitada', 'Matrícula ausente.', ref);
      return;
    }
    const matriculaNorm = normalizarMatricula(matricula);
    if (anual) {
      const ano = lerInteiro(leitor.valor(linha, 'ANO'), 9999);
      if (!ano) {
        coletor.registrar(numero, 'rejeitada', 'Ano ausente ou inválido.', ref);
        return;
      }
      let aceitos = 0;
      for (const [coluna, tipo] of COLUNAS_ANUAIS) {
        const dias = lerInteiro(leitor.valor(linha, coluna), 366);
        if (dias === null) continue;
        if (dias === undefined) {
          coletor.registrar(numero, 'rejeitada', `Quantidade de dias inválida em ${coluna} (0 a 366).`, ref);
          continue;
        }
        const idOrigem = `${matriculaNorm}|${ano}|${tipo}`;
        if (registrarUnico(registros, vistos, { linha: numero, matriculaNorm, idOrigem, tipo, ano, dias, inicio: null, fim: null }, coletor, ref)) aceitos += 1;
      }
      if (aceitos > 0) coletor.validos += 1;
      return;
    }
    const tipo = TIPOS_AFASTAMENTO[chaveCabecalho(leitor.valor(linha, 'TIPO') ?? '')];
    const inicio = lerData(leitor.valor(linha, 'DT_INICIO'));
    const fim = lerData(leitor.valor(linha, 'DT_FIM'));
    if (!tipo) {
      coletor.registrar(numero, 'rejeitada', 'Tipo de afastamento inválido (use FALTA, TS, PF, IP ou OUTRO).', ref);
      return;
    }
    if (!inicio || !fim || fim < inicio) {
      coletor.registrar(numero, 'rejeitada', 'Intervalo de datas ausente ou inválido.', ref);
      return;
    }
    const idOrigem = `${matriculaNorm}|${tipo}|${inicio}|${fim}`;
    if (registrarUnico(registros, vistos, { linha: numero, matriculaNorm, idOrigem, tipo, ano: null, dias: null, inicio, fim }, coletor, ref)) {
      coletor.validos += 1;
    }
  });
  return { tipo: 'afastamentos', registros };
}

function analisarIncorporacoes(leitor: Leitor, coletor: Coletor): Analise {
  const registros: IncorporacaoArquivo[] = [];
  const vistos = new Map<string, number>();
  leitor.linhas.forEach((linha, posicao) => {
    const numero = posicao + 2;
    const matricula = texto(leitor.valor(linha, 'MATRICULA'));
    const ref = referencia(null, matricula);
    if (!matricula) {
      coletor.registrar(numero, 'rejeitada', 'Matrícula ausente.', ref);
      return;
    }
    const tipoBruto = chaveCabecalho(leitor.valor(linha, 'TIPO') ?? '');
    const tipo = tipoBruto === 'PB' ? 'PB' : tipoBruto === 'PV' ? 'PV' : tipoBruto === 'LICPREMIO' ? 'LIC_PREMIO' : null;
    const inicio = lerData(leitor.valor(linha, 'DT_INICIO'));
    const fim = lerData(leitor.valor(linha, 'DT_FIM'));
    if (!tipo) {
      coletor.registrar(numero, 'rejeitada', 'Tipo de incorporação inválido (use PB, PV ou LIC_PREMIO).', ref);
      return;
    }
    if (!inicio || !fim || fim < inicio) {
      coletor.registrar(numero, 'rejeitada', 'Intervalo de datas ausente ou inválido.', ref);
      return;
    }
    const matriculaNorm = normalizarMatricula(matricula);
    if (registrarUnico(registros, vistos, { linha: numero, matriculaNorm, idOrigem: `${matriculaNorm}|${tipo}|${inicio}`, tipo, inicio, fim }, coletor, ref)) {
      coletor.validos += 1;
    }
  });
  return { tipo: 'incorporacoes', registros };
}

function analisarPeriodosIpam(leitor: Leitor, coletor: Coletor): Analise {
  const registros: PeriodoIpamArquivo[] = [];
  const vistos = new Map<string, number>();
  leitor.linhas.forEach((linha, posicao) => {
    const numero = posicao + 2;
    const cpfBruto = texto(leitor.valor(linha, 'CPF'));
    const cpf = cpfBruto ? cpfSchema.safeParse(cpfBruto.replace(/\s/g, '')) : null;
    if (!cpf?.success) {
      coletor.registrar(numero, 'quarentena', cpfBruto ? 'CPF inválido; linha em quarentena.' : 'CPF ausente; linha em quarentena.', 'sem identificação');
      return;
    }
    const ref = referencia(cpf.data, null);
    const inicio = lerMes(leitor.valor(linha, 'MES_INICIO'));
    const fim = lerMes(leitor.valor(linha, 'MES_FIM'));
    if (!inicio || !fim || fim < inicio) {
      coletor.registrar(numero, 'rejeitada', 'Meses ausentes ou inválidos (use MM/AAAA).', ref);
      return;
    }
    const chave = `${cpf.data}|${inicio}`;
    const anterior = vistos.get(chave);
    if (anterior !== undefined) {
      coletor.registrar(numero, 'duplicada', `Período repetido no arquivo (primeira ocorrência na linha ${anterior}); linha rejeitada.`, ref);
      return;
    }
    vistos.set(chave, numero);
    registros.push({ linha: numero, cpf: cpf.data, inicio, fim });
    coletor.validos += 1;
  });
  return { tipo: 'periodos_ipam', registros };
}

const TIPOS_EVENTO = new Set([
  'contratacao', 'nomeacao', 'transposicao', 'enquadramento', 'reenquadramento', 'progressao', 'designacao',
  'exoneracao', 'mudanca_matricula', 'outro',
]);

function analisarEventos(leitor: Leitor, coletor: Coletor): Analise {
  const registros: EventoArquivo[] = [];
  const vistos = new Map<string, number>();
  leitor.linhas.forEach((linha, posicao) => {
    const numero = posicao + 2;
    const matricula = texto(leitor.valor(linha, 'MATRICULA'));
    const ref = referencia(null, matricula);
    if (!matricula) {
      coletor.registrar(numero, 'rejeitada', 'Matrícula ausente.', ref);
      return;
    }
    const tipoBruto = texto(leitor.valor(linha, 'TIPO'));
    if (!tipoBruto) {
      coletor.registrar(numero, 'rejeitada', 'Tipo de evento ausente.', ref);
      return;
    }
    let tipo = semAcento(tipoBruto).toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '').replace(/_de_/g, '_');
    if (!TIPOS_EVENTO.has(tipo)) {
      coletor.registrar(numero, 'anomalia', 'Tipo de evento desconhecido; registrado como "outro".', ref);
      tipo = 'outro';
    }
    const data = lerData(leitor.valor(linha, 'DATA'));
    const dataPublicacao = lerData(leitor.valor(linha, 'DATA_PUBLICACAO'));
    if (data === undefined || dataPublicacao === undefined) {
      coletor.registrar(numero, 'rejeitada', 'Data do evento ou da publicação inválida.', ref);
      return;
    }
    const atoNumero = texto(leitor.valor(linha, 'ATO_NUMERO'));
    const descricao = texto(leitor.valor(linha, 'DESCRICAO'));
    if ((atoNumero?.length ?? 0) > 100 || (descricao?.length ?? 0) > 2000) {
      coletor.registrar(numero, 'rejeitada', 'Número do ato ou descrição excede o tamanho permitido.', ref);
      return;
    }
    const matriculaNorm = normalizarMatricula(matricula);
    const idOrigem = `${matriculaNorm}|${tipo}|${data ?? ''}|${atoNumero ?? ''}`;
    if (registrarUnico(registros, vistos, { linha: numero, matriculaNorm, idOrigem, tipo, data, atoNumero, dataPublicacao, descricao }, coletor, ref)) {
      coletor.validos += 1;
    }
  });
  return { tipo: 'eventos_funcionais', registros };
}

export function analisarLinhas(tipo: TipoImportacao, linhas: string[][]): ResultadoAnalise {
  const avisos: string[] = [];
  const leitor = mapearCabecalho(tipo, linhas, avisos);
  const coletor = new Coletor();
  const analise = tipo === 'dados_funcionais' ? analisarDadosFuncionais(leitor, coletor)
    : tipo === 'afastamentos' ? analisarAfastamentos(leitor, coletor)
      : tipo === 'incorporacoes' ? analisarIncorporacoes(leitor, coletor)
        : tipo === 'periodos_ipam' ? analisarPeriodosIpam(leitor, coletor)
          : analisarEventos(leitor, coletor);
  return { analise, lidos: leitor.linhas.length, validos: coletor.validos, ocorrencias: coletor.ocorrencias, avisos };
}
