import { TITULOS_BLOCOS_DOF, type RascunhoDof } from '@sisdoc/contratos';

type DadosPreviaDof = Pick<RascunhoDof, 'nome' | 'matricula' | 'revisao' | 'resultado' | 'blocos' | 'processo'>;

function escapar(valor: string | number): string {
  return String(valor).replace(/[&<>"']/g, (caractere) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[caractere] ?? caractere);
}

function data(dataIso: string): string {
  const [ano, mes, dia] = dataIso.split('-');
  return `${dia}/${mes}/${ano}`;
}

export function renderizarPreviaDof(dados: DadosPreviaDof): string {
  const { resultado } = dados;
  const variaveis = new Map<string, string>([
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
  const ausentes = new Set<string>();
  const textoComVariaveis = (texto: string): string => {
    let inicio = 0;
    let html = '';
    for (const ocorrencia of texto.matchAll(/\{\{([^{}]*)\}\}/g)) {
      const posicao = ocorrencia.index;
      const nome = ocorrencia[1].trim();
      const valor = variaveis.get(nome);
      html += escapar(texto.slice(inicio, posicao));
      if (valor) {
        html += escapar(valor);
      } else {
        ausentes.add(nome || '(nome vazio)');
        html += `<mark>Variável não disponível: ${escapar(nome || '(nome vazio)')}</mark>`;
      }
      inicio = posicao + ocorrencia[0].length;
    }
    return html + escapar(texto.slice(inicio));
  };
  const blocos = dados.blocos.filter((bloco) => bloco.ativo).map((bloco) =>
    `<section><h2>${escapar(TITULOS_BLOCOS_DOF[bloco.codigo])}</h2><p class="texto">${textoComVariaveis(bloco.texto)}</p></section>`
  ).join('');
  const linhas = resultado.periodo.linhas.map((linha) => `<tr>${[
    linha.ano, linha.diasBrutos, linha.faltas, linha.ts, linha.pf, linha.ip, linha.outros,
    linha.contribuicao, linha.efetivoExercicio, linha.pb, linha.pv, linha.licencaPremio,
  ].map((valor) => `<td>${escapar(valor)}</td>`).join('')}</tr>`).join('');
  const avisos = resultado.avisos.map((aviso) => `<li>${escapar(aviso.mensagem)}</li>`).join('');
  const declaracao = resultado.declaracao.map((linha) => `<li>${escapar(linha)}</li>`).join('');
  const avisoVariaveis = ausentes.size
    ? `<p class="aviso">Variáveis não disponíveis nesta prévia: ${[...ausentes].map(escapar).join(', ')}.</p>` : '';

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prévia provisória de DOF</title>
<style>
body{font-family:system-ui,sans-serif;color:#172b3a;margin:1rem;line-height:1.45}
h1{font-size:1.25rem}h2{font-size:1rem;margin-top:1.4rem}
.aviso{font-weight:700;color:#7d1717}.texto{white-space:pre-wrap;overflow-wrap:anywhere}
.tabela{overflow-x:auto}table{border-collapse:collapse;font-size:.8rem}th,td{border:1px solid #627988;padding:.25rem;text-align:right}th{background:#e7eef2}
</style></head><body>
<h1>PRÉVIA PROVISÓRIA — SEM VALIDADE OFICIAL</h1>
<p class="aviso">Não é modelo aprovado, conferência nem emissão. Revisão salva de referência: ${escapar(dados.revisao)}.</p>
<p>Nome: ${escapar(dados.nome)}. Matrícula: ${escapar(dados.matricula)}.</p>
<p>Processo: ${dados.processo ? escapar(dados.processo) : 'não informado'}.</p>
<p>Admissão considerada: ${escapar(data(resultado.admissaoConsiderada))}. Período efetivo: ${escapar(data(resultado.periodo.inicioEfetivo))} a ${escapar(data(resultado.periodo.fim))}.</p>
<p>Regra provisória: ${escapar(resultado.regra.codigo)} — ${escapar(resultado.regra.versao)}.</p>
${avisos ? `<ul>${avisos}</ul>` : ''}
<h2>Cálculo de referência</h2>
<p>Dias do período: ${escapar(resultado.totais.diasBrutos)}. Tempo líquido de contribuição: ${escapar(resultado.totais.totalContribuicao)}. Efetivo exercício: ${escapar(resultado.totais.efetivoExercicio)}.</p>
<div class="tabela"><table><thead><tr><th>Ano</th><th>Dias</th><th>Faltas</th><th>T/S</th><th>P/F</th><th>I/P</th><th>Outros</th><th>Contribuição</th><th>Efetivo</th><th>PB</th><th>PV</th><th>Licença-prêmio</th></tr></thead><tbody>${linhas}</tbody></table></div>
${declaracao ? `<h2>Linhas condicionais de referência</h2><ul>${declaracao}</ul>` : ''}
${avisoVariaveis}${blocos}
</body></html>`;
}
