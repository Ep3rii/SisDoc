import { TITULOS_BLOCOS_DOF, type DadosFontePreviaDof, type RascunhoDof } from '@sisdoc/contratos';
import { BRASAO_MUNICIPAL } from './brasao';
import { campo, data, escapar } from './html';
import { analisarTextoDof, valoresVariaveisDof } from './variaveis-dof';
import { ESTILO_MODELOS_OFICIAIS } from './versoes';

export type DadosModeloDof = Pick<RascunhoDof, 'nome' | 'matricula' | 'revisao' | 'resultado' | 'blocos' | 'processo'> & {
  classificacao: 'previa' | 'emissao';
  numeroFormatado?: string;
  dataEmissao?: string;
  fonte?: Omit<DadosFontePreviaDof, 'documentoId' | 'revisao' | 'provaFonte'>;
  fonteSelecionadaAlterada?: boolean;
  rodape?: string;
};

/** Monta célula do formulário com rótulo escapado; o conteúdo recebido já deve estar escapado. */
function celula(rotulo: string, valor: string, colspan = 1): string {
  return `<td colspan="${colspan}"><span class="rotulo">${escapar(rotulo)}</span><span class="valor">${valor}</span></td>`;
}

/** Reproduz o formulário DOF em duas seções paginadas sem copiar dados ou textos individuais do modelo. */
export function renderizarModeloDof(dados: DadosModeloDof): string {
  const { resultado, fonte } = dados;
  const previa = dados.classificacao === 'previa';
  const variaveis = valoresVariaveisDof(dados);
  const ausentes = new Set<string>();
  let malformadas = false;
  /** Na prévia sinaliza variável inválida; na emissão recusa snapshot incompleto em vez de gerar documento aparente. */
  const textoComVariaveis = (texto: string): string => analisarTextoDof(texto).map((parte) => {
    if (parte.tipo === 'texto') return escapar(parte.conteudo);
    if (parte.tipo === 'malformada') {
      if (!previa) throw new Error('O snapshot contém variável indisponível ou malformada nos blocos ativos.');
      malformadas = true;
      return `<mark>Expressão malformada: ${escapar(parte.conteudo)}</mark>`;
    }
    const valor = variaveis.get(parte.nome);
    if (valor?.trim()) return escapar(valor);
    if (!previa) throw new Error('O snapshot contém variável indisponível ou malformada nos blocos ativos.');
    ausentes.add(parte.nome);
    return `<mark>Variável não disponível: ${escapar(parte.nome)}</mark>`;
  }).join('');
  const blocos = dados.blocos.filter((bloco) => bloco.ativo).map((bloco) =>
    `<section><h3>${escapar(TITULOS_BLOCOS_DOF[bloco.codigo])}:</h3><p class="texto-modelo">${textoComVariaveis(bloco.texto)}</p></section>`
  ).join('');
  const linhas = resultado.periodo.linhas.map((linha) => `<tr>${[
    linha.ano, linha.faltas, linha.ts, linha.pf, linha.ip, linha.outros, linha.deducaoContribuicao,
    linha.pb, linha.pv, linha.licencaPremio, linha.efetivoExercicio, linha.contribuicao,
  ].map((valor) => `<td>${escapar(valor)}</td>`).join('')}</tr>`).join('');
  /** Soma somente valores calculados por ano; não altera deduções nem incorporações da regra. */
  const soma = (chave: 'faltas' | 'ts' | 'pf' | 'ip' | 'outros' | 'deducaoContribuicao') =>
    resultado.periodo.linhas.reduce((total, linha) => total + linha[chave], 0);
  const totais = [soma('faltas'), soma('ts'), soma('pf'), soma('ip'), soma('outros'), soma('deducaoContribuicao'),
    resultado.totais.pb, resultado.totais.pv, resultado.totais.licencaPremio,
    resultado.totais.efetivoExercicio, resultado.totais.contribuicaoMunicipio];
  const local = dados.dataEmissao ? `São Luís - MA, ${data(dados.dataEmissao)}` : 'São Luís - MA, ____/____/______';
  const avisos = previa ? [
    ...resultado.avisos.map((aviso) => aviso.mensagem),
    ...(!fonte ? ['Os demais dados da fonte não estão disponíveis nesta prévia.'] : []),
    ...(fonte?.removidoNaFonte ? ['O vínculo está marcado como removido na fonte.'] : []),
    ...(fonte?.avisoNivel ? [fonte.avisoNivel] : []),
    ...(dados.fonteSelecionadaAlterada ? ['A pessoa ou o vínculo mudou após a conferência.'] : []),
    ...(fonte && fonte.admissao !== resultado.admissaoConsiderada
      ? ['A admissão atual difere da utilizada no cálculo; reabra e confira o rascunho.'] : []),
    ...(ausentes.size ? [`Variáveis não disponíveis nesta prévia: ${[...ausentes].join(', ')}.`] : []),
    ...(malformadas ? ['Há expressões de variáveis malformadas nos blocos ativos.'] : []),
  ] : [];
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${previa ? 'Prévia provisória de DOF' : `DOF ${escapar(dados.numeroFormatado ?? '')}`}</title>
<style>${ESTILO_MODELOS_OFICIAIS}</style></head><body>
<div class="pagina-modelo dof-modelo">
${previa ? `<p class="aviso-modelo">PRÉVIA PROVISÓRIA — SEM VALIDADE OFICIAL. Revisão salva de referência: ${escapar(dados.revisao)}. Não é conferência nem emissão.</p>` : ''}
<header class="cabecalho-modelo"><img class="brasao" src="${BRASAO_MUNICIPAL}" alt="Brasão de São Luís">
<p>PREFEITURA DE SÃO LUÍS</p><p>SECRETARIA MUNICIPAL DE ADMINISTRAÇÃO - SEMAD</p>
<h1>DECLARAÇÃO DE OCORRÊNCIAS FUNCIONAIS</h1></header>
<p class="fundamento">De acordo com a Portaria MPS nº 154/2008-DOU de 16.05.2008</p>
<table class="dados-modelo"><tbody>
<tr><th colspan="12">ÓRGÃO EXPEDIDOR: SECRETARIA MUNICIPAL DE ADMINISTRAÇÃO - SEMAD</th></tr>
<tr>${celula('Nome do servidor', campo(fonte?.nome ?? dados.nome), 6)}${celula('Posse/Exercício', campo(data(resultado.admissaoConsiderada)), 3)}${celula('Regime jurídico', campo(fonte?.regimeJuridico), 3)}</tr>
<tr>${celula('CPF', campo(variaveis.get('cpf')), 2)}${celula('Data/Nasc.', fonte?.nascimento ? campo(data(fonte.nascimento)) : '&nbsp;', 2)}${celula('Nome da mãe', campo(fonte?.nomeMae), 8)}</tr>
<tr>${celula('Matrícula', campo(fonte?.matricula ?? dados.matricula), 2)}${celula('Cargo/Função/Atividade', campo(fonte?.cargo), 5)}${celula('Classe', '&nbsp;')}${celula('Nível', campo(fonte?.nivel), 2)}${celula('Referência/Padrão', campo(fonte?.referencia), 2)}</tr>
<tr><th colspan="5">PERÍODO COMPREENDIDO NESTA DECLARAÇÃO</th>${celula('Órgão de origem', campo(fonte?.orgao), 7)}</tr>
<tr>${celula('Início', campo(data(resultado.periodo.inicioEfetivo)), 2)}${celula('Fim', campo(data(resultado.periodo.fim)), 3)}<td colspan="7" rowspan="2"><p class="fundamento">FONTE DE INFORMAÇÃO - SEMAD - COORDENAÇÃO DE ANÁLISE DE PROCESSOS</p></td></tr>
<tr>${celula('Processo nº', campo(dados.processo), 2)}${celula('Declaração', campo(dados.numeroFormatado ?? 'SEM NÚMERO (PRÉVIA)'), 3)}</tr>
</tbody></table>
<table class="frequencia"><thead>
<tr><th rowspan="4">ANO</th><th colspan="11">FREQUÊNCIA</th></tr>
<tr><th colspan="6">DEDUÇÕES</th><th colspan="5">TEMPO EM DIAS</th></tr>
<tr><th rowspan="2">FALTAS</th><th colspan="3">LICENÇAS</th><th rowspan="2">OUTROS</th><th rowspan="2">SOMA DEDUÇÕES</th><th colspan="3">INCORPORADO</th><th colspan="2">TEMPO</th></tr>
<tr><th>T/S</th><th>P/F</th><th>I/P</th><th>PB</th><th>PV</th><th>LIC/PRE</th><th>EFETIVO EXERCÍCIO</th><th>CONTRIBUIÇÃO</th></tr>
</thead><tbody>${linhas}<tr><th>TOTAL</th>${totais.map((valor) => `<td><strong>${escapar(valor)}</strong></td>`).join('')}</tr></tbody></table>
<div class="nota">NOTA &nbsp; T / S - TRATAMENTO DE SAÚDE<br>P / F - DOENÇA EM PESSOA DE FAMÍLIA<br>I / P - INTERESSE PARTICULAR</div>
${avisos.map((aviso) => `<p class="aviso-modelo">${escapar(aviso)}</p>`).join('')}
${previa && fonte ? `<p class="prova-modelo">Fonte consultada em ${escapar(new Date(fonte.consultadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}. Para consultar mudanças posteriores, use Atualizar prévia.</p>` : ''}
</div>
<div class="pagina-modelo">
<table><tr><th>DESCRIÇÃO DAS OCORRÊNCIAS FUNCIONAIS<br>(ACESSO, AVERBAÇÕES, CARGOS, CONTRIBUIÇÃO PREVIDENCIÁRIA,<br>DESIGNAÇÕES, FALTAS, INCORPORAÇÕES, LICENÇAS, NOMEAÇÕES, PENALIDADES, PROMOÇÕES, ETC.)</th></tr></table>
<div class="ocorrencias">${blocos}</div>
<div class="declaracao-modelo"><p>DECLARO, em face ao apurado, que o (a) interessado (a) conta com:</p>
${resultado.declaracao.map((linha) => `<p>${escapar(linha)}</p>`).join('')}</div>
<table class="assinaturas-modelo"><tr>
<td>Analista<p class="local-modelo">${escapar(local)}</p><span class="linha-assinatura">Assinatura do (a) Servidor (a)</span></td>
<td>LAVREI A DECLARAÇÃO que não contém emendas, nem rasuras.<p class="local-modelo">${escapar(local)}</p><span class="linha-assinatura">Coordenador (a) de Análise de Processos</span></td>
<td>RATIFICO a presente Declaração.<p class="local-modelo">${escapar(local)}</p><span class="linha-assinatura">Secretário (a) Adjunto (a) Municipal de Administração</span></td>
</tr></table>
${dados.rodape ? `<p class="prova-modelo">${escapar(dados.rodape)}</p>` : ''}
</div></body></html>`;
}
