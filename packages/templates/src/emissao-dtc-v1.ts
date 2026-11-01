import { escapar, data, campo } from './html';
import {
  ROTULOS_CATEGORIA_INSS,
  type ConteudoDtc,
  type FonteEmissaoDtc,
  type PreviaDtc,
  type ResultadoCalculoDtc,
  type SnapshotEmissaoDtc,
  type TipoDtc,
} from '@sisdoc/contratos';

export const CNPJ_SEMAD = '06.307102/0001-30';
export const TEXTO_SEM_EMENDAS = 'ESTA DECLARAÇÃO NÃO CONTÉM EMENDAS NEM RASURAS';
export const MARCA_INSS_PROVISORIO = 'MODELO PROVISÓRIO — TEXTOS OFICIAIS DO INSS PENDENTES DE APROVAÇÃO';

export type DadosDocumentoDtc = {
  classificacao: 'previa' | 'emissao';
  tipo: TipoDtc;
  numeroFormatado: string | null;
  dataEmissao: string | null;
  processo: string | null;
  fonte: FonteEmissaoDtc;
  conteudo: ConteudoDtc;
  resultado: ResultadoCalculoDtc;
  rodape: string | null;
};

const MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

/** Formata mês/ano em português para os períodos IPAM já validados pelo contrato. */
function mesAno(dataIso: string): string {
  return `${MESES[Number(dataIso.slice(5, 7)) - 1] ?? ''}/${dataIso.slice(0, 4)}`;
}

/** Formata e escapa data informada ou preserva célula vazia no modelo impresso. */
function dataCampo(valor: string | null | undefined): string {
  return valor ? escapar(data(valor)) : '&nbsp;';
}

/** Aplica máscara somente a CPF com onze dígitos, sem alterar valores já formatados. */
function cpfFormatado(cpf: string): string {
  return /^\d{11}$/.test(cpf) ? `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` : cpf;
}

/** Monta célula com rótulo escapado; o conteúdo deve vir previamente escapado pelos helpers de campo. */
function celula(rotulo: string, valor: string, colspan = 1): string {
  return `<td${colspan > 1 ? ` colspan="${colspan}"` : ''}><span class="rotulo">${escapar(rotulo)}</span>${valor}</td>`;
}

const TITULOS: Readonly<Record<TipoDtc, { anexo: string | null; titulo: string; subtitulo: string | null }>> = {
  DTC_IPAM: {
    anexo: 'ANEXO III',
    titulo: 'DECLARAÇÃO DE TEMPO DE CONTRIBUIÇÃO',
    subtitulo: 'Instituto de Previdência e Assistência do Município — IPAM',
  },
  DTC_COMISSIONADO: {
    anexo: 'ANEXO VIII',
    titulo: 'DECLARAÇÃO DE TEMPO DE CONTRIBUIÇÃO',
    subtitulo: 'Para fins de obtenção de benefício junto ao INSS',
  },
  DTC_INSS: {
    anexo: null,
    titulo: 'DECLARAÇÃO DE TEMPO DE CONTRIBUIÇÃO',
    subtitulo: 'Regime Geral de Previdência Social — INSS',
  },
};

/** Seleciona título/anexo por tipo, mantendo marcas de prévia e texto INSS provisório. */
function cabecalho(dados: DadosDocumentoDtc): string {
  const titulo = TITULOS[dados.tipo];
  const numero = dados.numeroFormatado
    ? `DECLARAÇÃO ${escapar(dados.numeroFormatado)}` : 'DECLARAÇÃO SEM NÚMERO (PRÉVIA)';
  return `
<header>
  ${dados.classificacao === 'previa' ? '<p class="marca">PRÉVIA — SEM VALIDADE OFICIAL</p>' : ''}
  ${dados.tipo === 'DTC_INSS' ? `<p class="marca">${escapar(MARCA_INSS_PROVISORIO)}</p>` : ''}
  <p class="orgao">PREFEITURA MUNICIPAL DE SÃO LUÍS — PMSL</p>
  <p class="orgao">SECRETARIA MUNICIPAL DE ADMINISTRAÇÃO — SEMAD</p>
  ${dados.tipo === 'DTC_COMISSIONADO' ? `<p>CNPJ ${escapar(CNPJ_SEMAD)}</p>` : ''}
  ${titulo.anexo ? `<p class="anexo">${escapar(titulo.anexo)}</p>` : ''}
  <h1>${escapar(titulo.titulo)}</h1>
  ${titulo.subtitulo ? `<p class="subtitulo">${escapar(titulo.subtitulo)}</p>` : ''}
  <p class="fundamento">Portaria MPS nº 154/2008-DOU de 16.05.2008</p>
  <p class="numero">${numero} — Processo nº ${dados.processo ? escapar(dados.processo) : 'não informado'}</p>
</header>`;
}

/** Monta dados completos do servidor; inclui nome do pai apenas no modelo INSS. */
function dadosPessoais(dados: DadosDocumentoDtc): string {
  const { fonte } = dados;
  const linhaPai = dados.tipo === 'DTC_INSS'
    ? `<tr>${celula('Nome do pai', campo(fonte.nomePai), 6)}</tr>` : '';
  return `
<h2>Dados do servidor</h2>
<table class="dados"><tbody>
<tr>${celula('Nome', campo(fonte.nome), 4)}${celula('Matrícula', campo(fonte.matricula), 2)}</tr>
<tr>${celula('RG', campo(fonte.rg), 2)}${celula('Órgão expedidor', campo(fonte.rgOrgao), 2)}${celula('Data de expedição', dataCampo(fonte.rgExpedicao), 2)}</tr>
<tr>${celula('CPF', escapar(cpfFormatado(fonte.cpf)), 2)}${celula('Título de eleitor', campo(fonte.tituloEleitor), 2)}${celula('PIS/PASEP', campo(fonte.pisPasep), 2)}</tr>
<tr>${celula('Data de nascimento', dataCampo(fonte.nascimento), 2)}${celula('Nome da mãe', campo(fonte.nomeMae), 4)}</tr>
${linhaPai}
<tr>${celula('Endereço', campo(fonte.endereco), 6)}</tr>
<tr>${celula('Cargo exercido', campo(fonte.cargo), 3)}${celula('Referência/Padrão', campo(fonte.referencia), 1)}${celula('Órgão', campo(fonte.orgao), 2)}</tr>
<tr>${celula('Regime jurídico', campo(fonte.regimeJuridico), 2)}${celula('Admissão', dataCampo(fonte.admissao), 2)}${celula('Processo nº', campo(dados.processo), 2)}</tr>
</tbody></table>`;
}

/** Monta atos de nomeação/exoneração apenas para DTC de cargos comissionados. */
function cargosComissionados(dados: DadosDocumentoDtc): string {
  if (dados.tipo !== 'DTC_COMISSIONADO') return '';
  const blocos = dados.conteudo.cargos.map((cargo, indice) => `
<table class="dados cargo"><tbody>
<tr>${celula(`${indice + 1}º cargo em comissão exercido`, campo(cargo.cargo), 6)}</tr>
<tr>${celula('Decreto de nomeação', campo(cargo.decretoNomeacao), 2)}${celula('Publicação no Diário Oficial', campo(cargo.publicacaoNomeacao), 2)}${celula('Data de entrada em exercício', dataCampo(cargo.dataEntradaExercicio), 2)}</tr>
<tr>${celula('Decreto de exoneração', campo(cargo.decretoExoneracao), 2)}${celula('Publicação no Diário Oficial', campo(cargo.publicacaoExoneracao), 2)}${celula('Data de encerramento/afastamento', dataCampo(cargo.dataEncerramento), 2)}</tr>
</tbody></table>`).join('');
  return `<h2>Cargos em comissão</h2>${blocos}`;
}

/** Renderiza períodos calculados e relaciona cargo/categoria INSS pela ordem validada. */
function periodos(dados: DadosDocumentoDtc): string {
  const inss = dados.tipo === 'DTC_INSS';
  const linhas = dados.resultado.periodos.map((periodo) => {
    const informado = dados.conteudo.periodos[periodo.ordem - 1];
    const categoria = inss && informado?.categoria ? ROTULOS_CATEGORIA_INSS[informado.categoria] : '';
    return `<tr><td>${escapar(periodo.ordem)}º período</td><td>${escapar(data(periodo.inicioEfetivo))}</td><td>A</td><td>${escapar(data(periodo.fim))}</td>${
      inss ? `<td class="texto-celula">${escapar(informado?.cargo ?? '')}</td><td class="texto-celula">${escapar(categoria)}</td>` : ''
    }<td>${escapar(periodo.totais.diasBrutos)}</td><td>${escapar(periodo.totais.contribuicaoMunicipio)}</td><td>${escapar(periodo.totais.efetivoExercicio)}</td></tr>`;
  }).join('');
  return `
<h2>Períodos compreendidos nesta declaração</h2>
<table class="periodos"><thead><tr><th>Período</th><th>Início</th><th></th><th>Fim</th>${inss ? '<th>Cargo/função</th><th>Categoria funcional</th>' : ''}<th>Dias</th><th>Contribuição</th><th>Efetivo exercício</th></tr></thead>
<tbody>${linhas}</tbody></table>
<p class="texto"><strong>Períodos:</strong> ${escapar(dados.resultado.textoPeriodos)}</p>
<p class="texto"><strong>Total:</strong> ${escapar(dados.resultado.textoTotal || '0 dias')}</p>`;
}

/** Monta demonstrativo de cada período com somas e excedentes, sem recalcular as regras do domínio. */
function tabelasAnuais(dados: DadosDocumentoDtc): string {
  return dados.resultado.periodos.map((periodo) => {
    const linhas = periodo.linhas.map((linha) => `<tr>${[
      linha.ano, linha.diasBrutos, linha.faltas, linha.ts, linha.pf, linha.ip, linha.outros,
      linha.contribuicao, linha.efetivoExercicio,
    ].map((valor) => `<td>${escapar(valor)}</td>`).join('')}</tr>`).join('');
    /** Soma deduções anuais do resultado existente para a linha de total, sem alterar o cálculo. */
    const soma = (chave: 'faltas' | 'ts' | 'pf' | 'ip' | 'outros') =>
      periodo.linhas.reduce((total, linha) => total + linha[chave], 0);
    const total = `<tr class="total"><th>TOTAL</th>${[
      periodo.totais.diasBrutos, soma('faltas'), soma('ts'), soma('pf'), soma('ip'), soma('outros'),
      periodo.totais.contribuicaoMunicipio, periodo.totais.efetivoExercicio,
    ].map((valor) => `<td>${escapar(valor)}</td>`).join('')}</tr>`;
    const excesso = periodo.excessoTs + periodo.excessoPf > 0
      ? `<p class="nota">Excedentes deduzidos do efetivo exercício no período: T/S ${escapar(periodo.excessoTs)} dia(s); P/F ${escapar(periodo.excessoPf)} dia(s).</p>`
      : '';
    return `
<section class="periodo-anual">
<h3>${escapar(periodo.ordem)}º período — ${escapar(data(periodo.inicioEfetivo))} A ${escapar(data(periodo.fim))}</h3>
<table class="anual"><thead><tr><th>Ano</th><th>Dias</th><th>Faltas</th><th>T/S</th><th>P/F</th><th>I/P</th><th>Outros</th><th>Contribuição</th><th>Efetivo exercício</th></tr></thead>
<tbody>${linhas}${total}</tbody></table>${excesso}
</section>`;
  }).join('');
}

/** Apresenta totais calculados e identifica linhas provisórias ou inferidas do modelo. */
function totais(dados: DadosDocumentoDtc): string {
  const inferidas = dados.tipo !== 'DTC_IPAM';
  const linhas = dados.resultado.linhasTotais.map((linha) => `<tr><th class="rotulo-total">${escapar(linha.rotulo)}${
    linha.provisoria ? ' *' : ''
  }</th><td>${escapar(linha.anos)}</td><td>${escapar(linha.meses)}</td><td>${escapar(linha.diasRestantes)}</td><td>${escapar(linha.dias)}</td></tr>`).join('');
  return `
<h2>Totais</h2>
<table class="totais"><thead><tr><th>Tempo</th><th>Anos</th><th>Meses</th><th>Dias</th><th>Total em dias</th></tr></thead>
<tbody>${linhas}</tbody></table>
<p class="nota">* Linha provisória: ${inferidas ? 'estrutura inferida do modelo de referência e ' : ''}incorporações sem regra aprovada para este documento.</p>`;
}

/** Mostra contribuições IPAM nos tipos compatíveis, usando os períodos consultados da fonte. */
function periodosIpam(dados: DadosDocumentoDtc): string {
  if (dados.tipo === 'DTC_INSS') return '';
  const itens = dados.fonte.periodosIpam.map((periodo) => `<li>${escapar(mesAno(periodo.inicio))} A ${escapar(mesAno(periodo.fim))}</li>`).join('');
  return `
<h2>Períodos no IPAM</h2>
${itens ? `<ul class="ipam">${itens}</ul>` : '<p>Não há períodos de contribuição ao IPAM registrados na fonte.</p>'}`;
}

/** Apresenta licenças, documentação e observações INSS escapadas, preservando indicação provisória. */
function blocosInss(dados: DadosDocumentoDtc): string {
  const inss = dados.conteudo.inss;
  if (dados.tipo !== 'DTC_INSS' || !inss) return '';
  const documentos = [
    inss.documentacao.nomeacao ? 'Ato de nomeação' : null,
    inss.documentacao.ctps ? 'Carteira de Trabalho e Previdência Social (CTPS)' : null,
    inss.documentacao.folha ? 'Folhas de pagamento' : null,
    inss.documentacao.frequencia ? 'Registros de frequência' : null,
    inss.documentacao.outros ? `Outros: ${inss.documentacao.outros}` : null,
  ].filter((item): item is string => item !== null);
  return `
<section class="bloco-inss">
<h2>Licenças e afastamentos <span class="provisorio">(texto provisório)</span></h2>
<p class="texto">${inss.licencas.possui ? 'SIM' : 'NÃO'}${inss.licencas.descricao ? ` — ${escapar(inss.licencas.descricao)}` : ''}</p>
<h2>Documentação-base <span class="provisorio">(texto provisório)</span></h2>
<ul>${documentos.map((item) => `<li>${escapar(item)}</li>`).join('')}</ul>
<h2>Observações <span class="provisorio">(texto provisório)</span></h2>
<p class="texto">${inss.observacao ? escapar(inss.observacao) : '&nbsp;'}</p>
</section>`;
}

/** Monta áreas de assinatura por tipo sem preencher assinaturas efetivas. */
function assinaturas(dados: DadosDocumentoDtc): string {
  const local = `SÃO LUÍS - MA: ${dados.dataEmissao ? escapar(data(dados.dataEmissao)) : '____/____/______'}`;
  if (dados.tipo === 'DTC_INSS') {
    return `
<section class="fechamento">
<p class="local">${local}</p>
<div class="assinaturas duas"><div class="assinatura">Analista técnico</div><div class="assinatura">Coordenador(a)</div></div>
<p class="sem-emendas">${escapar(TEXTO_SEM_EMENDAS)}</p>
</section>`;
  }
  return `
<section class="fechamento">
<p class="local">${local}</p>
<div class="assinaturas"><div class="assinatura">Responsável pelas informações</div><div class="assinatura">Visto</div></div>
<div class="assinaturas"><div class="assinatura">Assinatura do servidor</div><div class="assinatura">Assinatura e carimbo</div></div>
${dados.tipo === 'DTC_COMISSIONADO' ? '<div class="area-ipam"><p>INSTITUTO DE PREVIDÊNCIA E ASSISTÊNCIA DO MUNICÍPIO – IPAM</p><p class="nota">Área de uso do IPAM</p></div>' : ''}
<p class="sem-emendas">${escapar(TEXTO_SEM_EMENDAS)}</p>
</section>`;
}

export const ESTILO_DOCUMENTO_DTC = `
@page{size:A4;margin:14mm 12mm 16mm 12mm}
body{font-family:"Times New Roman",Times,serif;color:#000;background:#fff;font-size:10pt;line-height:1.3;margin:0;overflow-wrap:anywhere}
header{text-align:center;margin-bottom:6pt}header p{margin:0}.orgao{font-weight:700}.anexo{font-weight:700;margin-top:4pt}
.marca{font-weight:700;border:1px solid #000;padding:2pt;margin-bottom:4pt!important}
h1{font-size:12pt;margin:4pt 0 2pt}h2{font-size:10pt;margin:8pt 0 3pt;text-transform:uppercase}h3{font-size:9.5pt;margin:6pt 0 2pt}
.subtitulo{font-weight:700}.fundamento{font-style:italic;font-size:9pt}.numero{font-weight:700;margin-top:4pt}
table{border-collapse:collapse;width:100%;table-layout:fixed}
.dados td{border:1px solid #000;padding:2pt 3pt;vertical-align:top}.dados .rotulo{display:block;font-size:7pt;text-transform:uppercase}
.cargo{margin-bottom:4pt}
.periodos,.totais,.anual{font-size:8pt}.periodos th,.periodos td,.totais th,.totais td,.anual th,.anual td{border:1px solid #000;padding:1pt 2pt;text-align:right}
.periodos thead th,.totais thead th,.anual thead th{text-align:center;background:#eee}
.periodos .texto-celula,.totais .rotulo-total{text-align:left}
.totais thead th:first-child,.totais .rotulo-total{width:46%}
.anual{font-size:7.5pt}.anual .total td,.anual .total th{font-weight:700}
thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}
.texto{white-space:pre-wrap;text-align:justify;margin:3pt 0}
.nota{font-size:7.5pt;margin:2pt 0}.provisorio{font-weight:400;font-size:8pt;text-transform:none}
.ipam{margin:2pt 0 2pt 14pt;padding:0}
.fechamento{break-inside:avoid;page-break-inside:avoid}
.local{text-align:right;margin:14pt 0 26pt}
.assinaturas{display:grid;grid-template-columns:repeat(2,1fr);gap:24pt;text-align:center;margin-bottom:26pt}
.assinatura{border-top:1px solid #000;padding-top:3pt;font-size:9pt}
.area-ipam{border:1px solid #000;padding:4pt;text-align:center;min-height:40pt;font-size:9pt}
.area-ipam p{margin:0}
.sem-emendas{text-align:center;font-weight:700;margin-top:10pt}
.avisos{border:1px solid #7d1717;padding:2pt 6pt;margin-top:6pt}
.rodape{font-size:7pt;margin-top:8pt;text-align:center}
`;

/** Compõe HTML DTC sem scripts e com CSS fixo compartilhado entre prévia e emissão. */
export function renderizarDocumentoDtc(dados: DadosDocumentoDtc): string {
  const titulo = `${TITULOS[dados.tipo].titulo} ${dados.numeroFormatado ?? '(prévia)'}`;
  const avisos = dados.classificacao === 'previa' && dados.resultado.avisos.length > 0
    ? `<section class="avisos"><h2>Avisos da prévia</h2><ul>${dados.resultado.avisos.map((aviso) => `<li>${escapar(aviso.mensagem)}</li>`).join('')}</ul></section>`
    : '';
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapar(titulo)}</title>
<style>${ESTILO_DOCUMENTO_DTC}</style></head><body>
${cabecalho(dados)}
${avisos}
${dadosPessoais(dados)}
${cargosComissionados(dados)}
${periodos(dados)}
${totais(dados)}
${periodosIpam(dados)}
${blocosInss(dados)}
${assinaturas(dados)}
${dados.rodape ? `<p class="rodape">${escapar(dados.rodape)}</p>` : ''}
<h2 class="quebra">Demonstrativo anual por período</h2>
${tabelasAnuais(dados)}
</body></html>`;
}

/** Renderiza exclusivamente o snapshot salvo, sem consultar ou incorporar mudanças posteriores da fonte. */
export function renderizarEmissaoDtcV1(dados: SnapshotEmissaoDtc): string {
  return renderizarDocumentoDtc({
    classificacao: 'emissao',
    tipo: dados.tipo,
    numeroFormatado: dados.numeroFormatado,
    dataEmissao: dados.dataEmissao,
    processo: dados.processo,
    fonte: dados.fonte,
    conteudo: dados.conteudo,
    resultado: dados.resultado,
    rodape: `SEMAD — Emitida em ${data(dados.dataEmissao)}; regra ${dados.regra.codigo} ${dados.regra.versao}; modelo ${dados.template.versao}.`,
  });
}

/** Renderiza revisão salva como prévia sem número/validade oficial, removendo a prova de fonte do corpo. */
export function renderizarPreviaDtc(previa: Pick<PreviaDtc, 'documento' | 'fonte'>): string {
  const { documentoId: _documentoId, revisao: _revisao, provaFonte: _prova, ...fonte } = previa.fonte;
  return renderizarDocumentoDtc({
    classificacao: 'previa',
    tipo: previa.documento.tipo,
    numeroFormatado: null,
    dataEmissao: null,
    processo: previa.documento.conteudo.processo,
    fonte,
    conteudo: previa.documento.conteudo,
    resultado: previa.documento.resultado,
    rodape: `Prévia da revisão ${previa.documento.revisao}; regra provisória ${previa.documento.resultado.regra.codigo} ${previa.documento.resultado.regra.versao}.`,
  });
}
