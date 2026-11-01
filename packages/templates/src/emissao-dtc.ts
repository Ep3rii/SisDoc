import { ROTULOS_CATEGORIA_INSS, type PreviaDtc, type SnapshotEmissaoDtc } from '@sisdoc/contratos';
import { BRASAO_MUNICIPAL } from './brasao';
import {
  CNPJ_SEMAD, TEXTO_SEM_EMENDAS, renderizarEmissaoDtcV1, type DadosDocumentoDtc,
} from './emissao-dtc-v1';
import { campo, data, escapar } from './html';
import { ESTILO_MODELOS_OFICIAIS, TEMPLATES_OFICIAIS } from './versoes';

export { CNPJ_SEMAD, TEXTO_SEM_EMENDAS, MARCA_INSS_PROVISORIO } from './emissao-dtc-v1';
export type { DadosDocumentoDtc } from './emissao-dtc-v1';
export const ESTILO_DOCUMENTO_DTC = ESTILO_MODELOS_OFICIAIS;
const MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

/** Mantém campos vazios e formata somente datas presentes na fonte validada. */
function dataCampo(valor: string | null | undefined): string {
  return valor ? campo(data(valor)) : '&nbsp;';
}

/** Monta célula com conteúdo já escapado e rótulo escapado, sem inserir valores em atributos dinâmicos. */
function celula(rotulo: string, valor: string, colspan = 1): string {
  return `<td colspan="${colspan}"><span class="rotulo">${escapar(rotulo)}</span><span class="valor">${valor}</span></td>`;
}

/** Renderiza dados pessoais completos; INSS utiliza identificação conjunta e filiação no formulário próprio. */
function pessoais(dados: DadosDocumentoDtc): string {
  const f = dados.fonte;
  const cpf = campo(f.cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4'));
  const inss = dados.tipo === 'DTC_INSS';
  return `<h2 class="secao-titulo">DADOS PESSOAIS</h2><table class="dados-modelo"><tbody>
<tr>${celula('Nome do servidor', campo(f.nome), 4)}${celula('Matrícula nº', campo(f.matricula), 2)}</tr>
${inss ? `<tr>${celula('Documento de identificação/Órgão expedidor', campo([f.rg, f.rgOrgao].filter(Boolean).join(' / ')), 3)}${celula('CPF', cpf)}${celula('PIS/PASEP', campo(f.pisPasep), 2)}</tr>
<tr>${celula('Nome do pai / Nome da mãe', campo([f.nomePai, f.nomeMae].map(v => v ?? 'Não informado').join('\n')), 4)}${celula('Data de nascimento', dataCampo(f.nascimento), 2)}</tr>`
    : `<tr>${celula('RG', campo(f.rg), 2)}${celula('Órgão expedidor', campo(f.rgOrgao), 2)}${celula('Data de expedição', dataCampo(f.rgExpedicao), 2)}</tr>
<tr>${celula('CPF', cpf, 2)}${celula('Título de eleitor', campo(f.tituloEleitor), 2)}${celula('PIS/PASEP', campo(f.pisPasep), 2)}</tr>
<tr>${celula('Data de nascimento', dataCampo(f.nascimento), 2)}${celula('Nome da mãe', campo(f.nomeMae), 4)}</tr>
<tr>${celula('Endereço', campo(f.endereco), 6)}</tr>`}
</tbody></table>`;
}

/** Mantém três espaços de cargo no modelo comissionado sem limitar cargos adicionais informados. */
function cargos(dados: DadosDocumentoDtc): string {
  if (dados.tipo !== 'DTC_COMISSIONADO') return '';
  const quantidade = Math.max(3, dados.conteudo.cargos.length);
  return `<table class="dados-modelo cargo-modelo"><tbody>${Array.from({ length: quantidade }, (_, indice) => {
    const c = dados.conteudo.cargos[indice];
    return `<tr><td rowspan="2"><span class="rotulo">Cargo em Comissão Exercido:</span><span class="valor">${campo(c?.cargo)}</span></td>
${celula('Decreto de Nomeação', campo(c?.decretoNomeacao))}${celula('Publicação no Diário Oficial', campo(c?.publicacaoNomeacao))}${celula('Data de Entrada em Exercício', dataCampo(c?.dataEntradaExercicio))}</tr>
<tr>${celula('Decreto de Exoneração', campo(c?.decretoExoneracao))}${celula('Publicação no Diário Oficial', campo(c?.publicacaoExoneracao))}${celula('Data de Encerramento / Afastamento', dataCampo(c?.dataEncerramento))}</tr>`;
  }).join('')}</tbody></table>`;
}

/** Mostra os períodos calculados sem inventar datas nas linhas vazias de referência. */
function periodos(dados: DadosDocumentoDtc): string {
  const inss = dados.tipo === 'DTC_INSS';
  const quantidade = Math.max(inss || dados.tipo === 'DTC_COMISSIONADO' ? 4 : 1, dados.resultado.periodos.length);
  if (!inss) return `<table class="periodos-modelo"><colgroup><col class="rotulo-periodo"><col><col class="separador-periodo"><col></colgroup><tbody>` + Array.from({ length: quantidade }, (_, indice) => {
    const p = dados.resultado.periodos[indice];
    return `<tr><td><strong>${indice + 1}º PERÍODO COMPREENDIDO NESTA DECLARAÇÃO:</strong></td>
<td>${p ? escapar(data(p.inicioEfetivo)) : '____/____/______'}</td><td>A</td><td>${p ? escapar(data(p.fim)) : '____/____/______'}</td></tr>`;
  }).join('') + `</tbody></table><p class="texto-modelo"><strong>${escapar(dados.resultado.textoTotal || '0 dias')}</strong></p>`;
  return `<table class="inss-periodos"><thead><tr><th colspan="5">PERÍODO(S) DE TEMPO DE CONTRIBUIÇÃO</th></tr>
<tr><th>SEQ.</th><th>DATA INÍCIO<br>DD/MM/AAAA</th><th>DATA FIM<br>DD/MM/AAAA</th><th>CARGO/FUNÇÃO</th><th>CATEGORIA FUNCIONAL</th></tr></thead>
<tbody>${Array.from({ length: quantidade }, (_, indice) => {
    const p = dados.resultado.periodos[indice];
    const informado = p ? dados.conteudo.periodos[p.ordem - 1] : undefined;
    const categorias = Object.entries(ROTULOS_CATEGORIA_INSS).map(([codigo, rotulo]) =>
      `(${informado?.categoria === codigo ? 'X' : ' '}) ${escapar(rotulo)}`).join('\n');
    return `<tr><td>${indice + 1}</td><td>${p ? dataCampo(p.inicioEfetivo) : '&nbsp;'}</td><td>${p ? dataCampo(p.fim) : '&nbsp;'}</td><td>${campo(informado?.cargo)}</td><td class="categorias">${categorias}</td></tr>`;
  }).join('')}</tbody></table>`;
}

/** Preenche observações IPAM com os períodos da fonte, sem copiar períodos pessoais da imagem-modelo. */
function ipam(dados: DadosDocumentoDtc): string {
  return `<p><strong>INSTITUTO DE PREVIDÊNCIA E ASSISTÊNCIA DO MUNICÍPIO - IPAM:</strong></p>${
    dados.fonte.periodosIpam.length ? dados.fonte.periodosIpam.map(p =>
      `<p>${MESES[Number(p.inicio.slice(5, 7)) - 1]}/${escapar(p.inicio.slice(0, 4))} A ${MESES[Number(p.fim.slice(5, 7)) - 1]}/${escapar(p.fim.slice(0, 4))}</p>`
    ).join('') : '<p>Não há períodos de contribuição ao IPAM registrados na fonte.</p>'}`;
}

/** Formulário de informações adicionais INSS baseado nos campos confirmados pelo operador. */
function adicionaisInss(dados: DadosDocumentoDtc): string {
  const inss = dados.conteudo.inss;
  if (!inss) throw new Error('Documento INSS sem informações adicionais.');
  const d = inss.documentacao;
  return `<h2 class="secao-titulo">INFORMAÇÕES ADICIONAIS/OCORRÊNCIAS</h2>
<table class="adicionais-modelo"><tbody>
<tr><td>LICENÇAS/<br>AFASTAMENTO</td><td><div class="licencas-modelo">
<p>No(s) período(s) acima discriminado(s), houve licença não remunerada ou afastamento, que acarretasse na suspensão do contrato de trabalho?</p>
<p>(${inss.licencas.possui ? ' ' : 'X'}) NÃO</p><p>(${inss.licencas.possui ? 'X' : ' '}) SIM.</p>
<p class="texto-modelo">${campo(inss.licencas.descricao)}</p>
<p>(Obs: descrever que tipo de licença/afastamento e a qual vínculo/período se referem as informações).</p></div></td></tr>
<tr><td>DOCUMENTAÇÃO E<br>FONTE DAS<br>INFORMAÇÕES</td><td><div class="documentacao-modelo">
<p>Os seguintes documentos serviram de base à presente declaração:</p>
<p>(${d.nomeacao ? 'X' : ' '}) Atos de nomeação e exoneração.<br>
(${d.ctps ? 'X' : ' '}) Contrato de Trabalho, registros em CTPS ou ficha funcional contemporâneos.<br>
(${d.folha ? 'X' : ' '}) Folhas de pagamento ou ficha financeira.<br>
(${d.frequencia ? 'X' : ' '}) Registros de frequência.<br>Outros: ${campo(d.outros)}</p></div></td></tr>
<tr><td>OBSERVAÇÕES</td><td><p class="texto-modelo"><strong>${campo(inss.observacao)}</strong></p></td></tr>
</tbody></table>`;
}

/** Usa data efetiva de emissão; prévias deixam a data em branco e não simulam assinatura. */
function assinaturas(dados: DadosDocumentoDtc): string {
  const local = `São Luís - MA, ${dados.dataEmissao ? data(dados.dataEmissao) : '____/____/______'}`;
  if (dados.tipo === 'DTC_INSS') return `<h2 class="secao-titulo">ASSINATURA E RESPONSABILIDADE PELAS INFORMAÇÕES</h2>
<table class="assinaturas-modelo responsabilidade"><tbody>
<tr><td colspan="2">Declaro que os documentos que serviram de base para a emissão desta Declaração encontram-se à disposição do INSS para eventual consulta.</td></tr>
<tr><td>Lavrei a presente Declaração, que não contém emendas nem rasuras.<p class="local-modelo">${escapar(local)}</p><span class="linha-assinatura">Analista Técnico</span></td>
<td>Visto do Dirigente do Órgão competente.<p class="local-modelo">${escapar(local)}</p><span class="linha-assinatura">Coordenador (a) de Análise e Processos</span></td></tr></tbody></table>`;
  return `<table class="assinaturas-modelo"><tbody><tr>
<td>RESPONSÁVEL PELAS INFORMAÇÕES<span class="linha-assinatura">ASSINATURA DO SERVIDOR</span></td>
<td>VISTO<span class="linha-assinatura">ASSINATURA E CARIMBO DO SERVIDOR</span></td></tr>
<tr>${celula('LOCAL E DATA', campo(local), 2)}</tr></tbody></table>`;
}

/** Mantém o demonstrativo calculado disponível após o formulário, sem comprimir ou cortar períodos extensos. */
function demonstrativo(dados: DadosDocumentoDtc): string {
  return `<div class="pagina-modelo demonstrativo-modelo"><h2>Demonstrativo anual por período</h2>
${dados.resultado.periodos.map(p => `<h3>${p.ordem}º período — ${escapar(data(p.inicioEfetivo))} A ${escapar(data(p.fim))}</h3>
<table class="frequencia"><thead><tr><th>Ano</th><th>Dias</th><th>Faltas</th><th>T/S</th><th>P/F</th><th>I/P</th><th>Outros</th><th>Contribuição</th><th>Efetivo exercício</th></tr></thead>
<tbody>${p.linhas.map(l => `<tr>${[l.ano, l.diasBrutos, l.faltas, l.ts, l.pf, l.ip, l.outros, l.contribuicao, l.efetivoExercicio]
  .map(v => `<td>${escapar(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('')}
<h2>Totais calculados</h2><table><thead><tr><th>Tempo</th><th>Anos</th><th>Meses</th><th>Dias</th><th>Total em dias</th></tr></thead>
<tbody>${dados.resultado.linhasTotais.map(l => `<tr><th>${escapar(l.rotulo)}${l.provisoria ? ' *' : ''}</th><td>${l.anos}</td><td>${l.meses}</td><td>${l.diasRestantes}</td><td>${l.dias}</td></tr>`).join('')}</tbody></table>
<p class="sem-emendas">* Incorporações sem regra aprovada para este documento.</p></div>`;
}

/** Compõe o formulário local por tipo; a prévia não se torna emissão e o cálculo é um anexo separado. */
export function renderizarDocumentoDtc(dados: DadosDocumentoDtc): string {
  const inss = dados.tipo === 'DTC_INSS';
  const comissionado = dados.tipo === 'DTC_COMISSIONADO';
  const previa = dados.classificacao === 'previa';
  const titulo = inss ? 'DECLARAÇÃO DE TEMPO DE CONTRIBUIÇÃO AO RGPS – DTC' : 'DECLARAÇÃO DE TEMPO DE CONTRIBUIÇÃO';
  const aviso = previa ? `<p class="aviso-modelo">PRÉVIA — SEM VALIDADE OFICIAL. Não é conferência nem emissão.</p>${
    dados.resultado.avisos.map(a => `<p class="aviso-modelo">${escapar(a.mensagem)}</p>`).join('')}` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapar(titulo)} ${escapar(dados.numeroFormatado ?? '(prévia)')}</title>
<style>${ESTILO_DOCUMENTO_DTC}</style></head><body>
<div class="pagina-modelo ${inss ? 'inss-modelo' : 'dtc-formulario'}">
${aviso}<header class="cabecalho-modelo"><img class="brasao" src="${BRASAO_MUNICIPAL}" alt="Brasão de São Luís">
<p>PREFEITURA DE SÃO LUÍS</p><p>SECRETARIA MUNICIPAL DE ADMINISTRAÇÃO - SEMAD</p>
${!inss ? `<p>ANEXO ${comissionado ? 'VIII' : 'III'}</p>` : ''}<h1>${titulo}</h1>
${comissionado ? '<p class="fundamento">PARA FINS DE OBTENÇÃO DE BENEFÍCIO JUNTO AO INSS</p>' : ''}
<p>${escapar(dados.numeroFormatado ?? 'SEM NÚMERO (PRÉVIA)')}</p></header>
<table class="dados-modelo"><tr>${celula('Órgão emitente', campo('SECRETARIA MUNICIPAL DE ADMINISTRAÇÃO - SEMAD'), 4)}${celula('CNPJ', campo(CNPJ_SEMAD), 2)}</tr></table>
${pessoais(dados)}
<h2 class="secao-titulo">DADOS FUNCIONAIS &nbsp; PROCESSO Nº ${escapar(dados.processo ?? 'não informado')}</h2>
${inss ? periodos(dados) : comissionado ? cargos(dados) : `<table class="dados-modelo"><tbody>
<tr>${celula('Cargo exercido', campo(dados.fonte.cargo))}</tr><tr><td><span class="rotulo">PERÍODO COMPREENDIDO NESTA DECLARAÇÃO:</span>${periodos(dados)}</td></tr></tbody></table>`}
${inss ? '</div><div class="pagina-modelo inss-modelo">' + adicionaisInss(dados) + assinaturas(dados) : assinaturas(dados)
    + `<div class="observacoes-modelo"><h2>OBSERVAÇÕES E OCORRÊNCIAS:</h2>${comissionado ? periodos(dados) : ''}${ipam(dados)}</div>`}
<p class="sem-emendas">${escapar(TEXTO_SEM_EMENDAS)}</p>
${dados.rodape ? `<p class="prova-modelo">${escapar(dados.rodape)}</p>` : ''}
</div>${demonstrativo(dados)}</body></html>`;
}

/** Renderiza versões antigas pelo renderer congelado; nova versão exige aprovação específica fora deste pacote. */
export function renderizarEmissaoDtc(dados: SnapshotEmissaoDtc): string {
  const antigas = { DTC_IPAM: 'emissao-dtc-ipam-1', DTC_COMISSIONADO: 'emissao-dtc-comissionado-1', DTC_INSS: 'emissao-dtc-inss-provisorio-1' };
  if (dados.template.versao === antigas[dados.tipo]) return renderizarEmissaoDtcV1(dados);
  if (dados.template.versao !== TEMPLATES_OFICIAIS[dados.tipo]) throw new Error('Versão de template DTC não suportada.');
  return renderizarDocumentoDtc({
    ...dados, classificacao: 'emissao',
    rodape: `SEMAD — Emitida em ${data(dados.dataEmissao)}; regra ${dados.regra.codigo} ${dados.regra.versao}; modelo ${dados.template.versao}.`,
  });
}

/** Usa dados da revisão salva em formulário sem número, data ou assinatura simulados. */
export function renderizarPreviaDtc(previa: Pick<PreviaDtc, 'documento' | 'fonte'>): string {
  const { documentoId: _documentoId, revisao: _revisao, provaFonte: _prova, ...fonte } = previa.fonte;
  return renderizarDocumentoDtc({
    classificacao: 'previa', tipo: previa.documento.tipo, numeroFormatado: null, dataEmissao: null,
    processo: previa.documento.conteudo.processo, fonte, conteudo: previa.documento.conteudo,
    resultado: previa.documento.resultado,
    rodape: `Prévia da revisão ${previa.documento.revisao}; regra provisória ${previa.documento.resultado.regra.codigo} ${previa.documento.resultado.regra.versao}.`,
  });
}
