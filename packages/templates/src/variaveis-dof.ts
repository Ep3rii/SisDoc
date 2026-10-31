import type { RascunhoDof } from '@sisdoc/contratos';

type DadosVariaveisDof = Pick<RascunhoDof, 'nome' | 'matricula' | 'resultado' | 'processo'>;
export type ParteTextoDof =
  | { tipo: 'texto'; conteudo: string }
  | { tipo: 'variavel'; conteudo: string; nome: string }
  | { tipo: 'malformada'; conteudo: string };

function data(dataIso: string): string {
  const [ano, mes, dia] = dataIso.split('-');
  return `${dia}/${mes}/${ano}`;
}

export function valoresVariaveisDof(dados: DadosVariaveisDof): ReadonlyMap<string, string> {
  const { resultado } = dados;
  return new Map<string, string>([
    ['nome', dados.nome],
    ['matricula', dados.matricula],
    ['processo', dados.processo ?? ''],
    ['admissao', data(resultado.admissaoConsiderada)],
    ['inicio', data(resultado.periodo.inicioEfetivo)],
    ['fim', data(resultado.periodo.fim)],
    ['dias_periodo', String(resultado.totais.diasBrutos)],
    ['tempo_contribuicao', String(resultado.totais.totalContribuicao)],
    ['efetivo_exercicio', String(resultado.totais.efetivoExercicio)],
  ]);
}

export function analisarTextoDof(texto: string): ParteTextoDof[] {
  const partes: ParteTextoDof[] = [];
  let inicio = 0;
  let cursor = 0;
  while (cursor < texto.length) {
    if (texto.startsWith('}}', cursor)) {
      if (cursor > inicio) partes.push({ tipo: 'texto', conteudo: texto.slice(inicio, cursor) });
      partes.push({ tipo: 'malformada', conteudo: '}}' });
      cursor += 2;
      inicio = cursor;
      continue;
    }
    if (!texto.startsWith('{{', cursor)) {
      cursor += 1;
      continue;
    }
    if (cursor > inicio) partes.push({ tipo: 'texto', conteudo: texto.slice(inicio, cursor) });
    const fechamento = texto.indexOf('}}', cursor + 2);
    if (fechamento < 0) {
      partes.push({ tipo: 'malformada', conteudo: texto.slice(cursor) });
      inicio = texto.length;
      break;
    }
    const chaveExtra = texto[fechamento + 2] === '}';
    const fim = fechamento + 2 + Number(chaveExtra);
    const conteudo = texto.slice(cursor, fim);
    const nome = texto.slice(cursor + 2, fechamento).trim();
    if (!chaveExtra && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(nome)) {
      partes.push({ tipo: 'variavel', conteudo, nome });
    } else {
      partes.push({ tipo: 'malformada', conteudo });
    }
    cursor = fim;
    inicio = cursor;
  }
  if (inicio < texto.length) partes.push({ tipo: 'texto', conteudo: texto.slice(inicio) });
  return partes;
}

export function verificarVariaveisDof(
  dados: DadosVariaveisDof & Pick<RascunhoDof, 'blocos'>,
): { indisponiveis: string[]; malformadas: boolean } {
  const valores = valoresVariaveisDof(dados);
  const indisponiveis = new Set<string>();
  let malformadas = false;
  for (const bloco of dados.blocos) {
    if (!bloco.ativo) continue;
    for (const parte of analisarTextoDof(bloco.texto)) {
      if (parte.tipo === 'malformada') malformadas = true;
      if (parte.tipo === 'variavel' && !valores.get(parte.nome)) indisponiveis.add(parte.nome);
    }
  }
  return { indisponiveis: [...indisponiveis].sort(), malformadas };
}
