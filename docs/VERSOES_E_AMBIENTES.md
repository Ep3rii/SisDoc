# Versões, Produção e Homologação

Este procedimento separa os artefatos e dados dos dois ambientes. Não é uma
evidência de que Homologação já esteja instalada ou disponível.

## Regras de versão

- Cada release publicado recebe uma tag Git imutável `vMAJOR.MINOR.PATCH`.
  Tag, commit e diretório de instalação devem identificar o mesmo código.
- Produção executa um diretório de release próprio, por exemplo
  `C:\ProgramData\SisDoc\releases\vX.Y.Z`; não atualize com `git pull` nem
  compile dentro de `C:\SisDoc`.
- Homologação usa checkout/build independentes, por exemplo
  `C:\SisDoc-Homologacao`. Use a branch de candidato ou o commit que será
  homologado; não compartilhe `dist` nem `node_modules` com Produção.
- Preserve o release anterior para rollback. Migrações de banco podem não ser
  reversíveis; o rollback do código não desfaz migrações.
- Primeiro release candidato: `v0.1.0`. A tag só deve ser criada para o
  commit validado que será publicado.

## Separação obrigatória

Homologação deve ter configuração externa, banco, papéis PostgreSQL, chaves
de cifra/HMAC, certificado, PDFs, logs e serviço/processo próprios. Não copie
configuração, chaves, usuários, PDFs ou dados de Produção. Não configure
sincronização nem importações reais no ambiente de homologação. Use apenas
fixtures fictícias autorizadas.

O endpoint recomendado é `https://127.0.0.1:3444/`, acessível somente nesta
máquina. A configuração de Homologação deve usar a porta HTTPS `3444`, TLS
com SAN `127.0.0.1`, origem direta correspondente e banco em `127.0.0.1` com
nome próprio (por exemplo, `sisdoc_homologacao`). Não configure proxy LAN,
listener Caddy público ou regra de firewall para Homologação. O endereço de
loopback usa um host diferente de `localhost` para evitar colisão do cookie
de sessão com o acesso direto da Produção em `https://localhost:3443/`.

Não reutilize a porta se já houver listener. Antes de disponibilizar o
endpoint, confirme a porta, a SAN/cadeia TLS, a configuração e o isolamento do
banco. A configuração e os segredos permanecem fora do repositório, com ACLs
restritas.

## Iniciar Produção

Na instalação atual, Produção é o serviço Windows `SisDoc`; o proxy LAN é
`SisDocCaddy`. Para apenas ligar serviços parados, em PowerShell elevado:

```powershell
Get-Service -Name 'SisDoc', 'SisDocCaddy'
Start-Service -Name 'SisDoc'
Start-Service -Name 'SisDocCaddy'
```

Se já estiverem ativos, não inicie outra cópia com `npm start`. Para
atualização, use o procedimento de release abaixo, que exige janela,
backup verificado e health check. Não execute build em `C:\SisDoc`: a
configuração WinSW atual usa esse diretório como `workingdirectory` e o
serviço pode servir os arquivos web ali compilados.

## Preparar e iniciar Homologação

O ambiente só pode ser iniciado depois de criar e validar o banco e a
configuração isolados conforme os procedimentos de instalação. Não use
`npm run setup` contra Produção e não restaure um dump de Produção em
Homologação.

Em checkout separado, no commit/candidato a validar:

```powershell
Set-Location 'C:\SisDoc-Homologacao'
npm ci
npm run build
$env:SISDOC_CONFIG = 'C:\ProgramData\SisDoc\homologacao\config\aplicacao.json'
npm run verificar-instalacao
if ($LASTEXITCODE -ne 0) { throw 'Corrija a instalação de Homologação antes de iniciar.' }
npm start
```

Confirme no log que o serviço iniciou HTTPS na porta `3444`; acesse
`https://127.0.0.1:3444/`. Mantenha esse terminal aberto. `Ctrl+C` encerra o
processo. Após validar, remova a variável da sessão:

```powershell
Remove-Item Env:SISDOC_CONFIG -ErrorAction SilentlyContinue
```

Este início manual não registra serviço Windows nem inicia Caddy. Para
transformar Homologação em serviço, configure um serviço independente,
identidade de menor privilégio, ACLs e ordem de inicialização próprios; não
reaproveite os serviços `SisDoc`/`SisDocCaddy`.

## Publicar um release em Produção

1. Feche as alterações no commit candidato e registre a tag/commit exatos.
2. Instale e compile esse commit em diretório novo de release, nunca no
   checkout ativo. Execute typecheck, testes e diagnóstico; valide primeiro
   em Homologação.
3. Na janela autorizada, suspenda gravações e siga o backup operacional
   aprovado. Confirme integridade e localização externa antes de prosseguir.
4. Se houver migração, pare a API e aplique-a uma única vez com o provisionamento
   autorizado. Não execute migração em banco de Homologação durante o deploy
   da Produção, nem use o papel restrito da aplicação.
5. Atualize o caminho de trabalho do serviço `SisDoc` para o diretório novo,
   mantendo configuração, banco, TLS, PDFs e chaves externos inalterados.
   Reinicie na ordem API e depois Caddy.
6. Verifique diagnóstico, HTTPS/health, rota privada sem sessão (401) e
   login/operação autorizados. Registre versão, commit e resultado em
   [Progresso](PROGRESSO.md).
7. Em falha, restaure o caminho do release anterior somente após avaliar a
   compatibilidade do schema. Não restaure nem reverta dados automaticamente.

Não publique alteração de código enquanto o worktree estiver sujo ou sem
release imutável. Não trate build web no diretório ativo como implantação
controlada: a interface estática pode mudar antes da troca/reinício da API.
