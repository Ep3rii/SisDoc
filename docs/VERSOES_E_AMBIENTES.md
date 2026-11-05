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
- Primeiro release publicado: `v0.1.0`, tag local no commit `22f38b3`.
  Tag e commit identificam o build instalado em Produção.

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

Release atual: `v0.1.0`, em
`C:\ProgramData\SisDoc\instalacao\releases\v0.1.0`. O serviço SisDoc aponta
para esse diretório. A tag/commit foram criados localmente; o commit/tag não
foram enviados ao remoto nesta operação.

## Preparar e iniciar Homologação

**Homologação ainda não está instalada nem disponível.** A porta 3444 estava
livre, mas o papel de migração atual não pode criar bancos/papéis e não há
certificado/CA dedicado verificado para `127.0.0.1`. O setup inicial também
exige um operador interativo autorizado. Até esses pré-requisitos serem
providenciados, não execute `npm run setup`, não aponte Homologação para
Produção e não restaure dump produtivo nela.

Depois de provisionar banco/roles vazios, TLS confiável e configuração
externa separados, o ambiente pode ser iniciado como segue. Não configure o
arquivo de produção no processo abaixo.

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

## Evidência do release `v0.1.0`

Em 05/11/2026, `v0.1.0` foi implantado no serviço `SisDoc`; o serviço usa o
diretório imutável acima e `SisDocCaddy` permaneceu separado. Health HTTPS
retornou 200; rota administrativa sem sessão retornou 401; Caddy respondeu
200, e os assets servidos conferiram com o build por SHA-256. Nenhuma
migração ou aprovação de modelo foi aplicada.

Antes da troca foi criado um dump PostgreSQL custom, validado por
`pg_restore --list`, cifrado com DPAPI `CurrentUser` e conferido por hash
após decifragem em memória. Arquivo:
`C:\ProgramData\SisDoc\instalacao\backup\release-v0.1.0-20261105\sisdoc.dump.dpapi`.
Esse é um backup **somente do banco**, local e vinculado à conta/máquina; não
é backup completo dos PDFs/TLS/configuração nem ensaio de restauração. O
backup completo anterior permanece preservado separadamente.

A primeira tentativa de iniciar o release falhou por falta de ACL de leitura
nos diretórios pais; o serviço foi restaurado ao build de rollback, os
direitos mínimos de leitura/travessia foram corrigidos e a troca foi repetida.
O build de rollback permanece em
`C:\ProgramData\SisDoc\instalacao\releases\v0.0.0-rollback` para contingência.
