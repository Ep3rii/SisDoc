import { crc32, inflateRawSync } from 'node:zlib';

export const LIMITE_ARQUIVO_BYTES = 64 * 1024 * 1024;
const LIMITE_DESCOMPACTADO_BYTES = 256 * 1024 * 1024;
const LIMITE_LINHAS = 500_000;

export type Planilha = { linhas: string[][] };

export class ErroPlanilha extends Error {}

function ehXlsx(conteudo: Buffer): boolean {
  return conteudo.length >= 4 && conteudo.readUInt32LE(0) === 0x04034b50;
}

export function lerPlanilha(conteudo: Buffer): Planilha {
  if (conteudo.length === 0) throw new ErroPlanilha('O arquivo está vazio.');
  if (conteudo.length > LIMITE_ARQUIVO_BYTES) throw new ErroPlanilha('O arquivo excede o limite de 64 MB.');
  return ehXlsx(conteudo) ? lerXlsx(conteudo) : lerCsv(conteudo);
}

function detectarDelimitador(texto: string): string {
  let pontoVirgula = 0;
  let virgula = 0;
  let aspas = false;
  for (const caractere of texto) {
    if (caractere === '"') aspas = !aspas;
    else if (!aspas && (caractere === '\n' || caractere === '\r')) break;
    else if (!aspas && caractere === ';') pontoVirgula += 1;
    else if (!aspas && caractere === ',') virgula += 1;
  }
  return pontoVirgula >= virgula ? ';' : ',';
}

export function lerCsv(conteudo: Buffer): Planilha {
  let texto: string;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(conteudo);
  } catch {
    throw new ErroPlanilha('O CSV deve estar codificado em UTF-8.');
  }
  texto = texto.replace(/^\uFEFF/, '');
  const delimitador = detectarDelimitador(texto);
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let aspas = false;
  let indice = 0;
  const fecharLinha = () => {
    linha.push(campo);
    campo = '';
    if (linha.length > 1 || linha[0] !== '') linhas.push(linha);
    if (linhas.length > LIMITE_LINHAS) throw new ErroPlanilha('O arquivo excede o limite de 500 mil linhas.');
    linha = [];
  };
  while (indice < texto.length) {
    const caractere = texto[indice];
    if (aspas) {
      if (caractere === '"') {
        if (texto[indice + 1] === '"') {
          campo += '"';
          indice += 1;
        } else {
          aspas = false;
        }
      } else {
        campo += caractere;
      }
    } else if (caractere === '"' && campo === '') {
      aspas = true;
    } else if (caractere === delimitador) {
      linha.push(campo);
      campo = '';
    } else if (caractere === '\r') {
      if (texto[indice + 1] === '\n') indice += 1;
      fecharLinha();
    } else if (caractere === '\n') {
      fecharLinha();
    } else {
      campo += caractere;
    }
    indice += 1;
  }
  if (aspas) throw new ErroPlanilha('O CSV possui aspas não fechadas.');
  if (campo !== '' || linha.length > 0) fecharLinha();
  return { linhas };
}

type EntradaZip = { metodo: number; compactado: number; tamanho: number; deslocamento: number };

function lerZip(conteudo: Buffer): Map<string, EntradaZip> {
  const minimo = Math.max(0, conteudo.length - 65557);
  let fim = -1;
  for (let posicao = conteudo.length - 22; posicao >= minimo; posicao -= 1) {
    if (conteudo.readUInt32LE(posicao) === 0x06054b50) {
      fim = posicao;
      break;
    }
  }
  if (fim < 0) throw new ErroPlanilha('O arquivo XLSX está corrompido.');
  const total = conteudo.readUInt16LE(fim + 10);
  let posicao = conteudo.readUInt32LE(fim + 16);
  const entradas = new Map<string, EntradaZip>();
  for (let item = 0; item < total; item += 1) {
    if (posicao + 46 > conteudo.length || conteudo.readUInt32LE(posicao) !== 0x02014b50) {
      throw new ErroPlanilha('O arquivo XLSX está corrompido.');
    }
    const tamanhoNome = conteudo.readUInt16LE(posicao + 28);
    const nome = conteudo.toString('utf8', posicao + 46, posicao + 46 + tamanhoNome);
    entradas.set(nome, {
      metodo: conteudo.readUInt16LE(posicao + 10),
      compactado: conteudo.readUInt32LE(posicao + 20),
      tamanho: conteudo.readUInt32LE(posicao + 24),
      deslocamento: conteudo.readUInt32LE(posicao + 42),
    });
    posicao += 46 + tamanhoNome + conteudo.readUInt16LE(posicao + 30) + conteudo.readUInt16LE(posicao + 32);
  }
  return entradas;
}

function extrair(conteudo: Buffer, entradas: Map<string, EntradaZip>, nome: string, consumido: { bytes: number }): string | null {
  const entrada = entradas.get(nome);
  if (!entrada) return null;
  const local = entrada.deslocamento;
  if (local + 30 > conteudo.length || conteudo.readUInt32LE(local) !== 0x04034b50) {
    throw new ErroPlanilha('O arquivo XLSX está corrompido.');
  }
  const inicio = local + 30 + conteudo.readUInt16LE(local + 26) + conteudo.readUInt16LE(local + 28);
  const dados = conteudo.subarray(inicio, inicio + entrada.compactado);
  if (entrada.tamanho > LIMITE_DESCOMPACTADO_BYTES - consumido.bytes) {
    throw new ErroPlanilha('O conteúdo descompactado do XLSX excede o limite permitido.');
  }
  let bruto: Buffer;
  if (entrada.metodo === 0) bruto = Buffer.from(dados);
  else if (entrada.metodo === 8) {
    try {
      bruto = inflateRawSync(dados, { maxOutputLength: Math.max(entrada.tamanho, 1) });
    } catch {
      throw new ErroPlanilha('O arquivo XLSX está corrompido ou excede o limite permitido.');
    }
  } else throw new ErroPlanilha('O arquivo XLSX usa compactação não suportada.');
  consumido.bytes += bruto.length;
  return bruto.toString('utf8');
}

function decodificarXml(valor: string): string {
  return valor.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, entidade: string) => {
    if (entidade === 'amp') return '&';
    if (entidade === 'lt') return '<';
    if (entidade === 'gt') return '>';
    if (entidade === 'quot') return '"';
    if (entidade === 'apos') return "'";
    const codigo = entidade.startsWith('#x') ? Number.parseInt(entidade.slice(2), 16) : Number.parseInt(entidade.slice(1), 10);
    return codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : '';
  });
}

function textoRico(xml: string): string {
  const semFonetica = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let texto = '';
  for (const parte of semFonetica.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) texto += decodificarXml(parte[1]);
  return texto;
}

function indiceColuna(referencia: string): number {
  let indice = 0;
  for (const letra of referencia) indice = indice * 26 + (letra.charCodeAt(0) - 64);
  return indice - 1;
}

function caminhoPrimeiraPlanilha(conteudo: Buffer, entradas: Map<string, EntradaZip>, consumido: { bytes: number }): string {
  const livro = extrair(conteudo, entradas, 'xl/workbook.xml', consumido);
  const relacoes = extrair(conteudo, entradas, 'xl/_rels/workbook.xml.rels', consumido);
  const idRelacao = livro ? /<sheet\b[^>]*\br:id="([^"]+)"/.exec(livro)?.[1] : undefined;
  if (idRelacao && relacoes) {
    for (const relacao of relacoes.matchAll(/<Relationship\b[^>]*>/g)) {
      if (relacao[0].includes(`Id="${idRelacao}"`)) {
        const alvo = /Target="([^"]+)"/.exec(relacao[0])?.[1];
        if (alvo) return alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo.replace(/^\.\//, '')}`;
      }
    }
  }
  return 'xl/worksheets/sheet1.xml';
}

export function lerXlsx(conteudo: Buffer): Planilha {
  const entradas = lerZip(conteudo);
  const consumido = { bytes: 0 };
  const compartilhadas: string[] = [];
  const textos = extrair(conteudo, entradas, 'xl/sharedStrings.xml', consumido);
  if (textos) {
    for (const item of textos.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) compartilhadas.push(textoRico(item[1] ?? ''));
  }
  const planilha = extrair(conteudo, entradas, caminhoPrimeiraPlanilha(conteudo, entradas, consumido), consumido);
  if (!planilha) throw new ErroPlanilha('O arquivo XLSX não contém planilha legível.');
  const linhas: string[][] = [];
  for (const linhaXml of planilha.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const linha: string[] = [];
    let proxima = 0;
    for (const celula of (linhaXml[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const atributos = celula[1];
      const referencia = /\br="([A-Z]+)\d*"/.exec(atributos)?.[1];
      const coluna = referencia ? indiceColuna(referencia) : proxima;
      proxima = coluna + 1;
      if (coluna > 16383) throw new ErroPlanilha('O arquivo XLSX possui colunas além do limite.');
      const tipo = /\bt="([^"]+)"/.exec(atributos)?.[1];
      const corpo = celula[2] ?? '';
      const valor = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1];
      let texto = '';
      if (tipo === 's') texto = compartilhadas[Number(valor)] ?? '';
      else if (tipo === 'inlineStr') texto = textoRico(corpo);
      else if (valor !== undefined) texto = decodificarXml(valor);
      while (linha.length < coluna) linha.push('');
      linha[coluna] = texto;
    }
    if (linha.some((valor) => valor.trim() !== '')) linhas.push(linha);
    if (linhas.length > LIMITE_LINHAS) throw new ErroPlanilha('O arquivo excede o limite de 500 mil linhas.');
  }
  return { linhas };
}

function codificarXml(valor: string): string {
  return valor.replace(/[&<>"]/g, (caractere) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[caractere] ?? caractere);
}

function referenciaColuna(indice: number): string {
  let texto = '';
  let valor = indice + 1;
  while (valor > 0) {
    const resto = (valor - 1) % 26;
    texto = String.fromCharCode(65 + resto) + texto;
    valor = Math.floor((valor - 1) / 26);
  }
  return texto;
}

export function escreverXlsx(linhas: readonly (readonly string[])[], nomeAba = 'Dados'): Buffer {
  const linhasXml = linhas.map((linha, indiceLinha) => `<row r="${indiceLinha + 1}">${linha.map((valor, indice) =>
    `<c r="${referenciaColuna(indice)}${indiceLinha + 1}" t="inlineStr"><is><t xml:space="preserve">${codificarXml(valor)}</t></is></c>`,
  ).join('')}</row>`).join('');
  const arquivos: Array<[string, string]> = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${codificarXml(nomeAba)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${linhasXml}</sheetData></worksheet>`],
  ];
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let deslocamento = 0;
  for (const [nome, texto] of arquivos) {
    const nomeBytes = Buffer.from(nome, 'utf8');
    const dados = Buffer.from(texto, 'utf8');
    const verificador = crc32(dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(verificador, 14);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nomeBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(verificador, 16);
    central.writeUInt32LE(dados.length, 20);
    central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(nomeBytes.length, 28);
    central.writeUInt32LE(deslocamento, 42);
    locais.push(local, nomeBytes, dados);
    centrais.push(central, nomeBytes);
    deslocamento += local.length + nomeBytes.length + dados.length;
  }
  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, diretorio, fim]);
}

export function escreverCsv(linhas: readonly (readonly string[])[]): Buffer {
  const texto = linhas.map((linha) => linha.map((valor) =>
    /[;"\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor,
  ).join(';')).join('\r\n');
  return Buffer.from(`\uFEFF${texto}\r\n`, 'utf8');
}
