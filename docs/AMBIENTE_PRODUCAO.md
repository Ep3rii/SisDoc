# Ambiente único — Produção

O projeto possui uma única instalação editável, chamada Produção, no checkout
`C:\SisDoc`. Código, build servido e serviço SisDoc usam esse mesmo diretório.
Não há Homologação, staging, promoção entre instalações nem banco operacional
duplicado.

## Desenvolvimento direto

Altere o código em `C:\SisDoc`. Depois de um lote de mudanças coeso:

```powershell
Set-Location 'C:\SisDoc'
npm run typecheck
npm run build
```

O build atualiza os arquivos servidos pela instalação única. Faça uma
verificação de saúde HTTPS e confira os fluxos diretamente na aplicação,
sem inserir exemplos fictícios ou dados de teste no banco real. Os testes
automatizados existentes usam recursos descartáveis e não devem ser
redirecionados à base operacional.

O backend e o PostgreSQL permanecem em loopback; acesso de usuários é via
Caddy HTTPS conforme a configuração vigente. Configuração, segredos, TLS,
PDFs, Chromium e logs ficam fora do checkout com ACLs restritas. Essa
separação protege arquivos sensíveis, não representa um segundo ambiente.

## Iniciar a instalação

Nesta máquina, use os serviços Windows existentes:

```powershell
Get-Service -Name 'SisDoc', 'SisDocCaddy'
Start-Service -Name 'SisDoc'
Start-Service -Name 'SisDocCaddy'
```

Se já estiverem ativos, não inicie outra cópia. Para execução manual em uma
instalação sem serviços, use o mesmo checkout/configuração/banco, após
confirmar que os serviços não estão ativos:

```powershell
Set-Location 'C:\SisDoc'
$env:SISDOC_CONFIG = 'C:\ProgramData\SisDoc\instalacao\config\aplicacao.json'
$env:PLAYWRIGHT_BROWSERS_PATH = 'C:\ProgramData\SisDoc\chromium'
npm run verificar-instalacao
if ($LASTEXITCODE -ne 0) { throw 'Corrija a etapa indicada antes de iniciar.' }
npm start
```

A aplicação fica em HTTPS na porta configurada, atualmente `3443`; acesso
LAN continua no endereço Caddy autorizado. Não inicie uma instância manual
enquanto o serviço estiver ativo.

## Alterações de banco

Mudanças em schema/dados reais exigem, antes da operação:

1. Commit do estado atual do código e das migrações.
2. Backup verificado do banco ou das tabelas afetadas, armazenado fora do Git.

Só então faça a migração/manutenção diretamente na instalação única, com
janela e serviços parados quando necessário. Não use `npm run setup` em uma
instalação existente; `npm run migrar` aplica migrações, não transfere nem
recria a base. Confira a sequência de migrações e health após a operação.

Não execute DROP, UPDATE/DELETE em massa, restauração ou migrações que alterem
colunas existentes sem essas duas salvaguardas. Não aplique seeds ou
importações sintéticas no banco real.

## Histórico e Git

Use commits para registrar o histórico da única versão editável em `main`.
Não crie branches de staging, tags para promoção, cópias do projeto ou
procedimentos para promover mudanças entre ambientes. Tags/release antigos
permanecem apenas como histórico Git; não representam ambientes ativos.

Consulte [Operação](OPERACAO.md), [Progresso](PROGRESSO.md) e
[Invariantes](ia/INVARIANTES.md) para detalhes do sistema e do estado
operacional.
