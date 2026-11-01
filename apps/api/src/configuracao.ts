import { realpath } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { configuracaoSchema, type Configuracao } from '@sisdoc/contratos';

export function estaDentro(caminho: string, diretorio: string): boolean {
  const relativo = path.relative(diretorio, caminho);
  return relativo === '' || (!relativo.startsWith(`..${path.sep}`) && relativo !== '..' && !path.isAbsolute(relativo));
}

export function caminhoReal(arquivo: string): Promise<string> {
  return new Promise((resolve, reject) => {
    realpath.native(arquivo, { encoding: 'utf8' }, (erro, resolvido) => {
      if (erro) reject(erro);
      else resolve(resolvido);
    });
  });
}

export async function raizRepositorio(): Promise<string> {
  return caminhoReal(path.resolve(__dirname, '..', '..', '..'));
}

export async function carregarConfiguracao(arquivo: string | undefined): Promise<Configuracao> {
  if (!arquivo || !path.isAbsolute(arquivo)) {
    throw new Error('Defina SISDOC_CONFIG com o caminho absoluto da configuração externa.');
  }
  const repositorio = await raizRepositorio();
  let arquivoReal: string;
  try {
    arquivoReal = await caminhoReal(arquivo);
  } catch {
    throw new Error('Não foi possível localizar a configuração externa.');
  }
  if (estaDentro(arquivoReal, repositorio)) {
    throw new Error('A configuração deve ficar fora do repositório.');
  }

  let conteudo: string;
  try {
    conteudo = await readFile(arquivoReal, 'utf8');
  } catch {
    throw new Error('Não foi possível ler a configuração externa.');
  }

  let dados: unknown;
  try {
    dados = JSON.parse(conteudo);
  } catch {
    throw new Error('A configuração externa não contém JSON válido.');
  }
  const resultado = configuracaoSchema.safeParse(dados);
  if (!resultado.success) {
    throw new Error('A configuração externa está incompleta ou inválida.');
  }
  for (const arquivoTls of [resultado.data.tls.certificado, resultado.data.tls.chave, resultado.data.tls.ca]) {
    if (!path.isAbsolute(arquivoTls)) {
      throw new Error('Os arquivos TLS devem usar caminhos absolutos fora do repositório.');
    }
    let arquivoRealTls: string;
    try {
      arquivoRealTls = await caminhoReal(arquivoTls);
    } catch {
      throw new Error('Não foi possível localizar os arquivos TLS configurados.');
    }
    if (estaDentro(arquivoRealTls, repositorio)) {
      throw new Error('Os arquivos TLS devem usar caminhos absolutos fora do repositório.');
    }
  }
  if (resultado.data.seguranca) {
    const lista = resultado.data.seguranca.listaSenhas;
    if (!path.isAbsolute(lista)) {
      throw new Error('A lista de senhas deve usar caminho absoluto fora do repositório.');
    }
    let listaReal: string;
    try {
      listaReal = await caminhoReal(lista);
    } catch {
      throw new Error('Não foi possível localizar a lista local de senhas comuns.');
    }
    if (estaDentro(listaReal, repositorio)) {
      throw new Error('A lista de senhas deve ficar fora do repositório.');
    }
  }
  const credencialSincronizacao = resultado.data.sincronizacao?.credencialArquivo;
  if (credencialSincronizacao !== undefined) {
    if (!path.isAbsolute(credencialSincronizacao)) {
      throw new Error('A credencial da sincronização deve usar caminho absoluto fora do repositório.');
    }
    let credencialReal: string;
    try {
      credencialReal = await caminhoReal(credencialSincronizacao);
    } catch {
      throw new Error('Não foi possível localizar o arquivo de credencial da sincronização.');
    }
    if (estaDentro(credencialReal, repositorio)) {
      throw new Error('A credencial da sincronização deve ficar fora do repositório.');
    }
  }
  const diretorioPdf = resultado.data.pdf?.diretorio
    ?? path.join(path.dirname(path.dirname(arquivoReal)), 'pdf');
  if (!path.isAbsolute(diretorioPdf) || estaDentro(path.resolve(diretorioPdf), repositorio)) {
    throw new Error('O diretório de PDF deve usar caminho absoluto fora do repositório.');
  }
  return { ...resultado.data, pdf: { diretorio: path.resolve(diretorioPdf) } };
}

export function diretorioPdf(configuracao: Configuracao): string {
  if (!configuracao.pdf) throw new Error('Diretório de PDF não configurado.');
  return configuracao.pdf.diretorio;
}
