import { TITULOS_BLOCOS_DOF, type SnapshotEmissaoDof } from '@sisdoc/contratos';
import { analisarTextoDof, valoresVariaveisDof } from './variaveis-dof';

function escapar(valor: string | number): string {
  return String(valor).replace(/[&<>"']/g, (caractere) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[caractere] ?? caractere);
}

function data(dataIso: string): string {
  const [ano, mes, dia] = dataIso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function campo(valor: string | null | undefined): string {
  return valor?.trim() ? escapar(valor) : '&nbsp;';
}

export function renderizarEmissaoDof(dados: SnapshotEmissaoDof): string {
  const { resultado, fonte } = dados;
  const variaveis = valoresVariaveisDof(dados);
  const textoComVariaveis = (texto: string): string => analisarTextoDof(texto).map((parte) => {
    if (parte.tipo === 'texto') return escapar(parte.conteudo);
    const valor = parte.tipo === 'variavel' ? variaveis.get(parte.nome) : undefined;
    if (!valor?.trim()) throw new Error('O snapshot contém variável indisponível ou malformada nos blocos ativos.');
    return escapar(valor);
  }).join('');
  const blocos = dados.blocos.filter((bloco) => bloco.ativo).map((bloco) => `
<section class="bloco"><h3>${escapar(TITULOS_BLOCOS_DOF[bloco.codigo])}</h3><p class="texto">${textoComVariaveis(bloco.texto)}</p></section>`)
    .join('');
  const linhas = resultado.periodo.linhas.map((linha) => `<tr>${[
    linha.ano, linha.diasBrutos, linha.faltas, linha.ts, linha.pf, linha.ip, linha.outros,
    linha.efetivoExercicio, linha.contribuicao, linha.pb, linha.pv, linha.licencaPremio,
  ].map((valor) => `<td>${escapar(valor)}</td>`).join('')}</tr>`).join('');
  const soma = (chave: 'faltas' | 'ts' | 'pf' | 'ip' | 'outros') =>
    resultado.periodo.linhas.reduce((total, linha) => total + linha[chave], 0);
  const totais = `<tr class="total"><th>TOTAL</th>${[
    resultado.totais.diasBrutos, soma('faltas'), soma('ts'), soma('pf'), soma('ip'), soma('outros'),
    resultado.totais.efetivoExercicio, resultado.totais.contribuicaoMunicipio,
    resultado.totais.pb, resultado.totais.pv, resultado.totais.licencaPremio,
  ].map((valor) => `<td>${escapar(valor)}</td>`).join('')}</tr>`;
  const declaracao = resultado.declaracao.map((linha) => `<p class="linha-declaracao">${escapar(linha)}</p>`).join('');
  const local = `São Luís - MA, ${escapar(data(resultado.periodo.fim))}`;
  const cpf = variaveis.get('cpf') ?? '';
  const cabecalho = `
<header>
  <p class="orgao">PREFEITURA MUNICIPAL DE SÃO LUÍS — PMSL</p>
  <p class="orgao">SECRETARIA MUNICIPAL DE ADMINISTRAÇÃO — SEMAD</p>
  <p>Coordenação de Análise de Processos</p>
  <h1>DECLARAÇÃO DE OCORRÊNCIAS FUNCIONAIS</h1>
  <p class="fundamento">Portaria MPS nº 154/2008-DOU de 16.05.2008</p>
  <p class="numero">DECLARAÇÃO ${escapar(dados.numeroFormatado)} — Processo nº ${escapar(dados.processo)}</p>
</header>`;

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>DOF ${escapar(dados.numeroFormatado)}</title>
<style>
@page{size:A4;margin:14mm 12mm 16mm 12mm}
body{font-family:"Times New Roman",Times,serif;color:#000;font-size:10pt;line-height:1.3;margin:0;overflow-wrap:anywhere}
header{text-align:center;margin-bottom:6pt}header p{margin:0}.orgao{font-weight:700}
h1{font-size:12pt;margin:6pt 0 2pt}h2{font-size:10.5pt;margin:8pt 0 4pt;text-transform:uppercase}h3{font-size:10pt;margin:6pt 0 2pt}
.fundamento{font-style:italic;font-size:9pt}.numero{font-weight:700;margin-top:4pt}
table{border-collapse:collapse;width:100%}
.dados td{border:1px solid #000;padding:2pt 3pt;vertical-align:top}.dados .rotulo{display:block;font-size:7pt;text-transform:uppercase}
.anual{table-layout:fixed;font-size:7.5pt}.anual th,.anual td{border:1px solid #000;padding:1pt 2pt;text-align:right}
.anual thead th{text-align:center;background:#eee}.anual .total td,.anual .total th{font-weight:700}
thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}
.pagina2{break-before:page;page-break-before:always}
.texto{white-space:pre-wrap;text-align:justify;margin:0}
.declaro{font-weight:700;margin-top:10pt}.linha-declaracao{margin:2pt 0 2pt 12pt}
.local{text-align:right;margin:18pt 0 28pt}
.assinaturas{display:grid;grid-template-columns:repeat(3,1fr);gap:14pt;text-align:center;break-inside:avoid}
.assinatura{border-top:1px solid #000;padding-top:3pt;font-size:9pt}
.servidor{margin:36pt auto 0;width:60%;text-align:center;border-top:1px solid #000;padding-top:3pt;font-size:9pt;break-inside:avoid}
.rodape{font-size:7pt;margin-top:12pt;text-align:center}
</style></head><body>
${cabecalho}
<table class="dados"><tbody>
<tr><td colspan="3"><span class="rotulo">Nome do servidor</span>${campo(fonte.nome)}</td><td><span class="rotulo">Posse/Exercício</span>${fonte.admissao ? escapar(data(fonte.admissao)) : '&nbsp;'}</td><td><span class="rotulo">Regime jurídico</span>${campo(fonte.regimeJuridico)}</td></tr>
<tr><td><span class="rotulo">CPF</span>${campo(cpf)}</td><td><span class="rotulo">Data de nascimento</span>${fonte.nascimento ? escapar(data(fonte.nascimento)) : '&nbsp;'}</td><td colspan="3"><span class="rotulo">Nome da mãe</span>${campo(fonte.nomeMae)}</td></tr>
<tr><td><span class="rotulo">Matrícula</span>${campo(fonte.matricula)}</td><td colspan="2"><span class="rotulo">Cargo/função/atividade</span>${campo(fonte.cargo)}</td><td><span class="rotulo">Nível</span>${campo(fonte.nivel)}</td><td><span class="rotulo">Referência/Padrão</span>${campo(fonte.referencia)}</td></tr>
<tr><td><span class="rotulo">Início do período</span>${escapar(data(resultado.periodo.inicioEfetivo))}</td><td><span class="rotulo">Fim do período</span>${escapar(data(resultado.periodo.fim))}</td><td colspan="3"><span class="rotulo">Órgão de origem</span>${campo(fonte.orgao)}</td></tr>
<tr><td colspan="3"><span class="rotulo">Processo nº</span>${escapar(dados.processo)}</td><td colspan="2"><span class="rotulo">Declaração nº</span>${escapar(dados.numeroFormatado)}</td></tr>
</tbody></table>
<h2>Período compreendido</h2>
<p>De ${escapar(data(resultado.periodo.inicioEfetivo))} a ${escapar(data(resultado.periodo.fim))}: ${escapar(resultado.totais.diasBrutos)} dias.</p>
<table class="anual"><thead><tr><th>Ano</th><th>Dias</th><th>Faltas</th><th>T/S</th><th>P/F</th><th>I/P</th><th>Outros</th><th>Efetivo exercício</th><th>Contribuição município</th><th>PB</th><th>PV</th><th>LIC/PRE</th></tr></thead>
<tbody>${linhas}${totais}</tbody></table>
<div class="pagina2">
${blocos}
<p class="declaro">DECLARO, em face ao apurado, que o (a) interessado (a) conta com:</p>
${declaracao}
<p class="local">${local}</p>
<div class="assinaturas">
<div class="assinatura">Analista</div>
<div class="assinatura">Coordenador(a) de Análise de Processos</div>
<div class="assinatura">Secretário(a) Adjunto(a) Municipal de Administração</div>
</div>
<div class="servidor">Assinatura do (a) Servidor (a)</div>
<p class="rodape">SEMAD — Coordenação de Análise de Processos. Emitida em ${escapar(data(dados.dataEmissao))}; regra ${escapar(dados.regra.codigo)} ${escapar(dados.regra.versao)}; modelo ${escapar(dados.template.versao)}.</p>
</div>
</body></html>`;
}
