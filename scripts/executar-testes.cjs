const { execFileSync, spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { validarDestinos } = require('./isolar-testes.cjs');

function caminhoCurto(diretorio) {
  try {
    return execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:SISDOC_PASTA_CURTA).ShortPath',
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, SISDOC_PASTA_CURTA: diretorio },
      },
    ).trim();
  } catch {
    throw new Error('Não foi possível obter o caminho curto Windows para os testes.');
  }
}

try {
  if (process.platform !== 'win32') {
    throw new Error('As verificações de instalação e ACL desta etapa exigem Windows.');
  }
  const repositorio = caminhoCurto(process.cwd());
  const temporario = caminhoCurto(process.env.SISDOC_TEST_TEMP || os.tmpdir());
  if ([repositorio, temporario].some((item) => !path.isAbsolute(item) || /[^\x00-\x7f]/.test(item))) {
    throw new Error(
      'Os testes de PostgreSQL exigem caminhos ASCII ou 8.3 para o checkout e a pasta temporária. ' +
      'Se 8.3 não estiver disponível, escolha explicitamente uma raiz compatível e defina SISDOC_TEST_TEMP.',
    );
  }
  const env = { ...process.env };
  validarDestinos(repositorio, temporario, env.SISDOC_CONFIG);
  delete env.SISDOC_CONFIG;
  for (const nome of Object.keys(env)) {
    if (/^PG[A-Z_]/i.test(nome)) delete env[nome];
  }
  const resultado = spawnSync(
    process.execPath,
    [path.join(repositorio, 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...process.argv.slice(2)],
    {
      cwd: repositorio,
      env: {
        ...env,
        SISDOC_TEST_TEMP: temporario,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--preserve-symlinks'].filter(Boolean).join(' '),
      },
      stdio: 'inherit',
    },
  );
  if (resultado.error) throw resultado.error;
  process.exitCode = resultado.status === null ? 1 : resultado.status;
} catch (erro) {
  process.stderr.write(`${erro instanceof Error ? erro.message : 'Falha ao iniciar os testes.'}\n`);
  process.exitCode = 1;
}
