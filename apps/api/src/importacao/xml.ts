import { SaxesParser } from 'saxes';

export class ErroXmlImportacao extends Error {}

export function lerXmlImportacao(conteudo: Buffer): { linhas: string[][] } {
  if (!conteudo.length || conteudo.length > 64 * 1024 * 1024) throw new ErroXmlImportacao('O XML deve ter conteúdo e no máximo 64 MB.');
  let texto: string;
  try { texto = new TextDecoder('utf-8', { fatal: true }).decode(conteudo); }
  catch { throw new ErroXmlImportacao('O XML deve estar codificado em UTF-8.'); }
  if (/<!DOCTYPE|<!ENTITY/i.test(texto)) throw new ErroXmlImportacao('DTD e entidades externas não são permitidas no XML.');
  const parser = new SaxesParser({ xmlns: true });
  const campos: string[] = [];
  const registros: Array<Map<string, string>> = [];
  let profundidade = 0;
  let registro: Map<string, string> | null = null;
  let campo = '';
  let valor = '';
  let raiz = false;
  parser.on('error', () => { throw new ErroXmlImportacao('XML malformado. Confira a estrutura SisDoc versão 1.'); });
  parser.on('doctype', () => { throw new ErroXmlImportacao('DTD não é permitido.'); });
  parser.on('processinginstruction', () => { throw new ErroXmlImportacao('Instruções de processamento não são permitidas.'); });
  parser.on('xmldecl', (declaracao) => {
    if (declaracao.encoding && declaracao.encoding.toUpperCase() !== 'UTF-8') throw new ErroXmlImportacao('Use XML UTF-8.');
  });
  parser.on('opentag', (tag) => {
    profundidade++;
    if (profundidade > 3) throw new ErroXmlImportacao('Use campos simples dentro de registro; profundidade máxima 3.');
    if (tag.uri && tag.uri !== 'urn:sisdoc:importacao:1') throw new ErroXmlImportacao('Namespace XML não suportado.');
    const atributos = Object.values(tag.attributes).filter((atributo) => atributo.uri !== 'http://www.w3.org/2000/xmlns/');
    if (profundidade === 1) {
      if (raiz || tag.local !== 'sisdoc' || atributos.length !== 1 || atributos[0].local !== 'versao' || atributos[0].value !== '1') {
        throw new ErroXmlImportacao('Use a raiz <sisdoc versao="1">.');
      }
      raiz = true;
    } else if (profundidade === 2) {
      if (tag.local !== 'registro' || atributos.length) throw new ErroXmlImportacao('A raiz deve conter somente elementos registro sem atributos.');
      registro = new Map();
    } else {
      if (!registro || atributos.length || !/^[A-Za-z_][A-Za-z0-9_.-]{0,199}$/.test(tag.local) || registro.has(tag.local)) {
        throw new ErroXmlImportacao('Campos devem ter nomes únicos e não possuir atributos.');
      }
      campo = tag.local; valor = '';
      if (!campos.includes(campo)) campos.push(campo);
      if (campos.length > 256) throw new ErroXmlImportacao('O XML excede 256 campos.');
    }
  });
  const lerTexto = (parte: string) => {
    if (profundidade === 3) {
      valor += parte;
      if (valor.length > 8000) throw new ErroXmlImportacao('Um campo XML excede 8.000 caracteres.');
    } else if (parte.trim()) throw new ErroXmlImportacao('Texto só é permitido nos campos dos registros.');
  };
  parser.on('text', lerTexto);
  parser.on('cdata', lerTexto);
  parser.on('closetag', () => {
    if (profundidade === 3 && registro) registro.set(campo, valor);
    if (profundidade === 2 && registro) {
      if (!registro.size) throw new ErroXmlImportacao('Registro XML vazio.');
      registros.push(registro); registro = null;
      if (registros.length > 100000) throw new ErroXmlImportacao('O XML excede 100 mil registros.');
    }
    profundidade--;
  });
  parser.write(texto.replace(/^\uFEFF/, '')).close();
  if (!raiz || !registros.length || profundidade !== 0) throw new ErroXmlImportacao('O XML deve conter ao menos um registro.');
  return { linhas: [campos, ...registros.map((item) => campos.map((nome) => item.get(nome) ?? ''))] };
}
