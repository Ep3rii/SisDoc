import { TITULOS_BLOCOS_DOF, type DadosFontePreviaDof, type RascunhoDof } from '@sisdoc/contratos';
import { analisarTextoDof, valoresVariaveisDof } from './variaveis-dof';

export { analisarTextoDof, valoresVariaveisDof, verificarVariaveisDof } from './variaveis-dof';
export { renderizarEmissaoDof } from './emissao-dof';
export { CNPJ_SEMAD, MARCA_INSS_PROVISORIO, TEXTO_SEM_EMENDAS, ESTILO_DOCUMENTO_DTC, renderizarDocumentoDtc, renderizarEmissaoDtc, renderizarPreviaDtc } from './emissao-dtc';
export type { DadosDocumentoDtc } from './emissao-dtc';
export type { ParteTextoDof } from './variaveis-dof';

type DadosPreviaDof = Pick<RascunhoDof, 'nome' | 'matricula' | 'revisao' | 'resultado' | 'blocos' | 'processo'> & {
  fonte?: Omit<DadosFontePreviaDof, 'documentoId' | 'revisao' | 'provaFonte'>;
  fonteSelecionadaAlterada?: boolean;
};

export const ESTILO_PREVIA_DOF = `
body{font-family:system-ui,sans-serif;color:#172b3a;margin:1rem;line-height:1.45;overflow-wrap:anywhere}
h1{font-size:1.25rem}h2{font-size:1rem;margin-top:1.4rem}
.aviso{font-weight:700;color:#7d1717}.texto{white-space:pre-wrap;overflow-wrap:anywhere}
.tabela{overflow-x:auto}table{border-collapse:collapse;font-size:.8rem}th,td{border:1px solid #627988;padding:.25rem;text-align:right}th{background:#e7eef2}
@media print{
body{margin:0;font-size:9pt}.tabela{overflow:visible}
table{width:100%;table-layout:fixed;font-size:6.5pt}th,td{padding:1pt;overflow-wrap:anywhere}
thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}
}
`;

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
  const variaveis = valoresVariaveisDof(dados);
  const ausentes = new Set<string>();
  let malformadas = false;
  const textoComVariaveis = (texto: string): string => {
    let html = '';
    for (const parte of analisarTextoDof(texto)) {
      if (parte.tipo === 'texto') {
        html += escapar(parte.conteudo);
      } else if (parte.tipo === 'malformada') {
        malformadas = true;
        html += `<mark>Expressão malformada: ${escapar(parte.conteudo)}</mark>`;
      } else {
        const valor = variaveis.get(parte.nome);
        if (valor?.trim()) {
          html += escapar(valor);
        } else {
          ausentes.add(parte.nome);
          html += `<mark>Variável não disponível: ${escapar(parte.nome)}</mark>`;
        }
      }
    }
    return html;
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
  const avisoMalformadas = malformadas ? '<p class="aviso">Há expressões de variáveis malformadas nos blocos ativos.</p>' : '';
  const campoFonte = (nome: string): string => {
    const valor = variaveis.get(nome);
    return valor?.trim() ? escapar(valor) : 'não informado';
  };
  const fonte = dados.fonte;
  const dadosFonte = fonte ? `
<p>CPF: ${campoFonte('cpf')}. Nascimento: ${campoFonte('nascimento')}. Nome da mãe: ${campoFonte('nome_mae')}.</p>
<p>Regime jurídico: ${campoFonte('regime_juridico')}. Cargo: ${campoFonte('cargo')}. Nível: ${campoFonte('nivel')}. Referência/padrão: ${campoFonte('referencia')}. Órgão de origem: ${campoFonte('orgao')}.</p>
<p>Admissão atual na fonte: ${fonte.admissao ? escapar(data(fonte.admissao)) : 'não informada'}.</p>
${fonte.avisoNivel ? `<p class="aviso">${escapar(fonte.avisoNivel)}</p>` : ''}
${fonte.removidoNaFonte ? '<p class="aviso">O vínculo está marcado como removido na fonte.</p>' : ''}
${dados.fonteSelecionadaAlterada ? '<p class="aviso">A pessoa ou o vínculo mudou após a conferência.</p>' : ''}
${fonte.admissao !== resultado.admissaoConsiderada ? '<p class="aviso">A admissão atual difere da utilizada no cálculo; reabra e confira o rascunho.</p>' : ''}
<p>Fonte consultada em ${escapar(new Date(fonte.consultadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}. Para consultar mudanças posteriores, use Atualizar prévia.</p>
` : '<p class="aviso">Os demais dados da fonte não estão disponíveis nesta prévia.</p>';

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prévia provisória de DOF</title>
<style>${ESTILO_PREVIA_DOF}</style></head><body>
<h1>PRÉVIA PROVISÓRIA — SEM VALIDADE OFICIAL</h1>
<p class="aviso">Não é modelo aprovado, conferência nem emissão. Revisão salva de referência: ${escapar(dados.revisao)}.</p>
<p>Nome: ${escapar(fonte?.nome ?? dados.nome)}. Matrícula: ${escapar(fonte?.matricula ?? dados.matricula)}.</p>
${dadosFonte}
<p>Processo: ${dados.processo ? escapar(dados.processo) : 'não informado'}.</p>
<p>Admissão considerada: ${escapar(data(resultado.admissaoConsiderada))}. Período efetivo: ${escapar(data(resultado.periodo.inicioEfetivo))} a ${escapar(data(resultado.periodo.fim))}.</p>
<p>Regra provisória: ${escapar(resultado.regra.codigo)} — ${escapar(resultado.regra.versao)}.</p>
${avisos ? `<ul>${avisos}</ul>` : ''}
<h2>Cálculo de referência</h2>
<p>Dias do período: ${escapar(resultado.totais.diasBrutos)}. Tempo líquido de contribuição: ${escapar(resultado.totais.totalContribuicao)}. Efetivo exercício: ${escapar(resultado.totais.efetivoExercicio)}.</p>
<div class="tabela"><table><thead><tr><th>Ano</th><th>Dias</th><th>Faltas</th><th>T/S</th><th>P/F</th><th>I/P</th><th>Outros</th><th>Contribuição</th><th>Efetivo</th><th>PB</th><th>PV</th><th>Licença-prêmio</th></tr></thead><tbody>${linhas}</tbody></table></div>
${declaracao ? `<h2>Linhas condicionais de referência</h2><ul>${declaracao}</ul>` : ''}
${avisoVariaveis}${avisoMalformadas}${blocos}
</body></html>`;
}
