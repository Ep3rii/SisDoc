const fs = require('node:fs');
const path = require('node:path');

function estaDentro(caminho, diretorio) {
  const relativo = path.relative(diretorio, caminho);
  return relativo === '' || (!relativo.startsWith(`..${path.sep}`) && relativo !== '..' && !path.isAbsolute(relativo));
}

function validarDestinos(repositorio, temporario, configuracao) {
  const repositorioReal = fs.realpathSync.native(repositorio);
  const temporarioReal = fs.realpathSync.native(temporario);
  if (temporarioReal === path.parse(temporarioReal).root || estaDentro(temporarioReal, repositorioReal)) {
    throw new Error('A pasta temporária de testes deve ficar fora do checkout e não pode ser a raiz de uma unidade.');
  }
  if (configuracao) {
    let raizOperacional;
    try {
      raizOperacional = path.dirname(path.dirname(fs.realpathSync.native(configuracao)));
    } catch {
      throw new Error('Não foi possível verificar SISDOC_CONFIG antes de isolar os recursos de teste.');
    }
    if (estaDentro(temporarioReal, raizOperacional) || estaDentro(raizOperacional, temporarioReal)) {
      throw new Error('A pasta temporária de testes não pode sobrepor a instalação configurada.');
    }
  }
}

module.exports = { validarDestinos };
