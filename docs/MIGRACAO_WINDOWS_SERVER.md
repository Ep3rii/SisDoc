# Migração completa do SisDoc para Windows Server x64

## Escopo e limites

Preparado em 01/11/2026 para continuar a instalação atual, **preservando
dados, usuários, documentos, numeração e aprovações**. Não foi executada
exportação/restauração operacional nem homologado o servidor de destino.
O procedimento é manual, exige responsável autorizado e janela de manutenção.
Não implementa backup agendado, serviço Windows ou acesso por rede.

Use Windows Server com Desktop Experience, suporte vigente e NTFS local.
Mantenha PostgreSQL 16, Node 24 x64, HTTPS e banco somente em loopback.
`https://localhost:3443/` significa **o próprio servidor**, não a máquina
cliente. Acesso LAN/proxy é outra mudança, sujeita a projeto e autorização.

Não confunda:

- `npm run setup`: inicializa instalação **nova**; não serve para restauração.
- `npm run migrar`: aplica migrações **de schema**; não transfere dados.
- Importação/exportação CSV/XLSX: transfere cadastro; não preserva usuários,
  auditoria, documentos, números, aprovações ou identidade criptográfica.
- `npm run verificar-instalacao`: diagnóstico somente leitura; não é backup,
  teste destrutivo nem certificado de prontidão.

## 1. Preparar o destino e a janela

Antes de parar a origem, registre localmente o release/commit escolhido,
versão PostgreSQL, nome/porta do banco, nomes dos papéis e caminhos externos.
Não registre pessoas, segredos ou conteúdo de configuração no repositório.
Use o **mesmo commit** para exportar, restaurar e aceitar; não combine troca
de máquina, atualização de major e alteração das regras.

1. Instale Git, Node 24 x64 e PostgreSQL 16 x64 no Windows Server.
2. Configure PostgreSQL com UTF-8, `listen_addresses = '127.0.0.1'` e
   autenticação local SCRAM-SHA-256. Não abra portas de firewall.
3. Reserve checkout local fora de perfis pessoais, por exemplo `C:\SisDoc`.
4. Prepare diretórios externos protegidos para configuração/TLS/PDF,
   transporte e restauração. Use volume cifrado e canal institucional
   protegido; um dump PostgreSQL custom **não é cifrado por `-Fc`**.
5. Defina a conta Windows executora sem privilégios administrativos e a
   conta instaladora. Serviço automático da aplicação não está incluído.
6. Combine indisponibilidade e aceite. Na origem, suspenda uso da interface,
   importadores, sincronização, CLIs e qualquer escritor externo.

## 2. O que deve ser preservado em conjunto

| Item | Motivo |
|---|---|
| Dump completo do banco SisDoc | Núcleo, Legado, usuários, sessões, auditoria, rascunhos, snapshots, aprovações, numeração e jobs |
| Configuração original com `chaves.cifra` e `chaves.hmac` | Decifrar dados e manter pesquisas/provas; chaves novas tornam a restauração incompatível |
| Pasta inteira de PDFs configurada | Arquivos já emitidos e hashes do banco; não reemitir documentos para recriar histórico |
| TLS: certificado, chave e cadeia | HTTPS local; confiança Windows deve ser configurada novamente |
| Lista de senhas e licença | Login/trocas e política de senhas |
| Provisionamento do migrador | Atualizações futuras; manter inacessível à conta da aplicação |
| Credencial/configuração opcional da sincronização | Preservar apenas quando existir, sem habilitar integração como teste |
| Release do código e `package-lock.json` | Templates v1/v2 e dependências compatíveis com os snapshots |

O dump **não inclui papéis PostgreSQL globais** nem arquivos externos.
Não copie `PGDATA`, binários PostgreSQL, `node_modules`, builds antigos,
cache pessoal Chromium ou permissões de usuários da máquina antiga como
substituto da instalação. Imagens-modelo completas não são necessárias
para gerar PDFs: os templates/brasão público estão no código.

## 3. Capturar uma cópia consistente da origem

Esta fase escreve arquivos sensíveis: executar somente na janela autorizada.

1. Pare a API pelo terminal em que foi iniciada (`Ctrl+C`). Se houver outro
   processo, confira PID e linha de comando; pare somente esse PID conhecido.
   Aguarde o worker encerrar. Não pare PostgreSQL para usar `pg_dump`.
2. Confirme que a porta HTTPS não tem listener e que todos os escritores
   estão suspensos. Não reinicie a origem durante captura/cópia.
3. Execute o dump com o **papel proprietário/migrador da origem**, não o
   login restrito da aplicação. Exemplo para os nomes da instalação local:

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\16\bin'
$dump = 'D:\SisDocTransferencia\origem\sisdoc.dump'
& "$pgBin\pg_dump.exe" --host=127.0.0.1 --port=5432 --username=sisdoc_migracao --dbname=sisdoc --format=custom --file=$dump --password
if ($LASTEXITCODE -ne 0) { throw 'Dump não concluído; não prosseguir.' }
& "$pgBin\pg_restore.exe" --list $dump > 'D:\SisDocTransferencia\origem\conteudo-dump.txt'
if ($LASTEXITCODE -ne 0) { throw 'Arquivo de dump não reconhecido.' }
Get-FileHash -LiteralPath $dump -Algorithm SHA256
```

Confirme nomes e caminhos nos JSONs externos antes de usar os exemplos;
a pasta protegida deve existir e o nome do dump deve ser novo.
Informe senhas **somente no prompt** (`--password`), não em comandos,
`PGPASSWORD`, chat ou logs. Use `--file` no dump binário: não redirecione
os bytes com `>` no Windows PowerShell. A listagem textual é apenas uma
conferência estrutural; **não prova restaurabilidade**.

4. Copie configuração/chaves, PDF, TLS, lista/licença e provisionamento para
   a área protegida da mesma captura. Confirme `pdf.diretorio`; sem essa
   propriedade, o destino padrão é a pasta `pdf` irmã de `config`.
5. Registre localmente quantidades, tamanhos e SHA-256 do dump e dos arquivos
   transferidos. Compare os hashes no destino antes de restaurar. Listagens
   e cópias contendo dados/segredos ficam fora do Git.

Copie os arquivos **sem importar ACLs/SIDs da origem** para o destino.
Não use `robocopy /MIR`, `/PURGE`, `/COPYALL` ou comandos que apaguem uma
instalação existente. Um arquivo cifrado/compactado com senha não substitui
controle de acesso e canal protegido. Se a captura falhar, preserve a origem
intacta e corrija antes de tentar de novo.

## 4. Instalar o mesmo código e Chromium

No destino, use o commit registrado na captura, não `main` móvel:

```powershell
git clone https://github.com/Ep3rii/SisDoc.git C:\SisDoc
Set-Location 'C:\SisDoc'
git checkout --detach <COMMIT_DA_CAPTURA>
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Dependências não instaladas.' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build não concluído.' }
```

`<COMMIT_DA_CAPTURA>` é um marcador: substitua pelo hash escolhido antes de
executar. Se já existir checkout no destino, confira suas alterações e
não sobrescreva arquivos. Não transfira dependências/builds da origem.

Para não depender do cache do perfil da conta instaladora, escolha cache
local protegido. Instale sob conta autorizada e use o **mesmo valor** sob
a conta executora no diagnóstico e no início:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = 'C:\ProgramData\SisDoc\instalacao\chromium'
npx playwright install chromium
if ($LASTEXITCODE -ne 0) { throw 'Chromium não instalado.' }
```

O download é do navegador, não de dados operacionais. O caminho não é
consumido de `aplicacao.json`: depende da variável de ambiente.
Conceda à conta executora leitura/execução desse cache e do checkout.
Se usar cache padrão, instale Chromium na própria conta executora.

## 5. Recriar papéis e restaurar banco novo no destino

**Destino sem instalação operacional existente.** Não restaurar na origem,
num banco em uso ou sobre dados que não podem ser descartados. Se o destino
já possui instalação, interrompa o procedimento e defina reconciliação.

Como administrador PostgreSQL local, abra `psql` interativo:

```powershell
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' --host=127.0.0.1 --port=5432 --username=postgres --dbname=postgres --password
```

Use os **mesmos nomes de papéis da origem**. Exemplo:

```sql
\set ON_ERROR_STOP on
CREATE ROLE sisdoc_migracao LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\password sisdoc_migracao
CREATE ROLE sisdoc_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\password sisdoc_app
CREATE DATABASE sisdoc OWNER sisdoc_migracao ENCODING 'UTF8' TEMPLATE template0;
\q
```

Escolha senhas de banco fortes (mínimo 12 caracteres no setup), sem eco no
prompt. Elas podem ser novas, mas atualize **localmente** `banco.senha` em
`aplicacao.json` e as credenciais correspondentes em `banco.json`.
Isso não muda senhas dos usuários SisDoc armazenadas no dump.
Não associe o login da aplicação a papéis administrativos/proprietário.

Restaure no banco novo com o migrador, preservando proprietários e GRANTs:

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\16\bin'
& "$pgBin\pg_restore.exe" --host=127.0.0.1 --port=5432 --username=sisdoc_migracao --dbname=sisdoc --single-transaction --exit-on-error --password 'D:\SisDocTransferencia\origem\sisdoc.dump'
if ($LASTEXITCODE -ne 0) { throw 'Restauração não concluída; não iniciar SisDoc.' }
```

Não usar `--clean`, `--create`, `--no-acl`, `--no-owner` ou `pg_dumpall`
indiscriminadamente: preservação de proprietários/privilégios depende de
recriar os nomes corretos. Se houver outro proprietário/papel referenciado,
conferir o dump e provisioná-lo sob autorização antes da restauração.
Não restaurar como superusuário para esconder falhas de privilégio.
`--single-transaction` desfaz a restauração se ela falhar; preserve o dump.
Não há necessidade de aplicar migrations se banco e código são do mesmo
release e o histórico está completo.

## 6. Restaurar arquivos externos, ACLs e HTTPS

1. Reponha os arquivos na raiz externa protegida, preferencialmente mantendo
   `C:\ProgramData\SisDoc` para reduzir alterações de caminhos.
2. Preserve **exatamente** `chaves.cifra` e `chaves.hmac`. Não executar setup,
   não editar chaves, não recifrar/importar dados como atalho.
3. Ajuste só os caminhos/portas/credenciais que mudaram. Inclua TLS,
   `seguranca.listaSenhas`, `pdf.diretorio` e credencial de sincronização
   quando houver. Mantenha `banco.host = "127.0.0.1"`.
4. Reaplique ACLs com os SIDs **do destino**, sem herança ampla:
   instalador autorizado/SYSTEM administram a instalação; executor lê
   configuração/TLS/lista e executa código/Chromium, modifica apenas PDF/logs.
   Provisionamento e transporte são exclusivos do instalador/SYSTEM.
   Não conceda leitura de segredos a Users, Everyone ou Authenticated Users.
   `npm run verificar-instalacao` não certifica essas ACLs.
5. Se mantiver o certificado local ainda válido para `localhost`/`127.0.0.1`,
   compare sua impressão digital com a origem e instale **apenas o certificado
   público correto** na confiança do destino, por operador autorizado:

```powershell
Import-Certificate -FilePath 'C:\ProgramData\SisDoc\tls\localhost.cer' -CertStoreLocation 'Cert:\LocalMachine\Root'
```

O exemplo supõe o certificado local público da origem, conferido e válido.
Não importe chaves privadas no repositório nem raízes não verificadas.
Em caso de substituição TLS, configure novo certificado/chave/CA e confiança
compatíveis, sem alterar cifra/HMAC. Não ignore erros com `--insecure`.
Hostname do servidor não precisa ser usado para acesso em loopback.

## 7. Validar antes da entrada operacional

Com a conta executora, na raiz do checkout:

```powershell
$env:SISDOC_CONFIG = 'C:\ProgramData\SisDoc\instalacao\config\aplicacao.json'
$env:PLAYWRIGHT_BROWSERS_PATH = 'C:\ProgramData\SisDoc\instalacao\chromium'
npm run verificar-instalacao
if ($LASTEXITCODE -ne 0) { throw 'Verificação falhou; não iniciar a aplicação.' }
```

Confirme com o responsável, localmente e sem anexar dados ao chat/Git:

- [ ] Dump/arquivos transferidos com hashes iguais; restauração sem erros.
- [ ] Mesmos números de registros por tabela antes de permitir novas escritas;
      nenhuma tabela histórica/auditoria/template foi omitida.
- [ ] Configuração correta; cifra/HMAC iguais à captura; papéis e ACLs revisados.
- [ ] PDFs referenciados existem e seus SHA-256 conferem com
      `documentos.artefato_pdf`. Não basta pasta vazia nem gerar novos números.
- [ ] Máscaras de processo preservadas; aprovações por regra/template preservadas.
- [ ] Sincronização e worker não iniciam duas cópias de operações em paralelo.

A primeira partida pode reprocessar jobs PDF ou iniciar sincronização
configurada. Para o aceite inicial do destino, mantenha a **origem parada**,
desabilite temporariamente sincronização em sua configuração copiada quando
existir e use o worker desligado:

```powershell
$env:SISDOC_WORKER_PDF = 'desligado'
npm start
```

Isso não torna toda a API somente leitura: login/consultas são auditados.
O login cria sessões; não espere igualdade de contagens de auditoria/sessões
após começar o aceite. Não crie dados fictícios ou emissões de teste no
banco restaurado. Testes automatizados usam seus próprios recursos descartáveis.

Em outro PowerShell, verifique HTTPS e escutas:

```powershell
curl.exe --fail https://localhost:3443/api/v1/health
if ($LASTEXITCODE -ne 0) { throw 'Health HTTPS inválido.' }
Get-NetTCPConnection -State Listen -LocalPort 3443,5432 |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

Depois abra `https://localhost:3443/`: confirme login de usuário existente,
papéis/permissões, consulta e prévia de documento existente, decifração de
dados e download de PDF histórico, sem criar/cancelar/excluir documentos.
Valide Chromium/renderização com fixtures **fora da base restaurada**.
Health não prova funcionamento da cifra/HMAC ou dos PDFs.

**Pendências atuais preservadas:** quatro modelos v2 aguardam aprovação
formal; a migração não os aprova. A numeração/sufixo institucional das DTCs
continua decisão separada; Classe DOF não possui fonte.

## 8. Entrada, retorno e limpeza

Após aceite, pare o destino (`Ctrl+C`), remova `SISDOC_WORKER_PDF` do ambiente
(`Remove-Item Env:\SISDOC_WORKER_PDF` se definida), restaure a configuração
de sincronização apenas se já autorizada e inicie novamente com as mesmas
variáveis de configuração/cache. Monitore jobs PDF, erros e consultas.
Não mantenha origem e destino recebendo escritas simultaneamente.

**Retorno antes de qualquer escrita no destino:** pare o destino e retome
a origem preservada, assumindo que nenhuma integração/worker a alterou.
**Depois de escritas, inclusive auditoria do aceite:** não faça retorno cego; reconcilie diferenças com
responsável para não perder números, documentos, alterações ou auditoria.

Guarde a captura protegida até o prazo institucional e uma restauração
aceita. Não apague a origem para liberar espaço antes do aceite.
Revise credenciais/contas antigas após a transição; não exclua dados ou
certificados de confiança amplamente. Backup recorrente, serviço automático,
renovação TLS e certificação de carga no servidor continuam pendentes.

## Diagnóstico de falhas

| Falha | Conferir |
|---|---|
| Build/dependências | Node 24, mesmo commit, `npm ci`, workspaces compilados |
| Configuração externa | `SISDOC_CONFIG` absoluto, JSON válido, fora do checkout e acessível |
| TLS | Par certificado/chave, nome, validade, CA e confiança Windows |
| Chromium | Mesmo `PLAYWRIGHT_BROWSERS_PATH`/conta, download, leitura/execução |
| Banco/privilégios | PostgreSQL 16 local, senhas locais correspondentes, papéis/GRANTs e restore |
| Histórico incompleto | Dump/código incompatíveis; não executar setup para “corrigir” |
| Dados protegidos inválidos | Chaves originais, dump íntegro e arquivos de mesma captura |
| PDF ausente/divergente | Pasta original, `pdf.diretorio`, hashes e ACL; não reemitir |
| Emissão bloqueada | Conferência, processo, regra/template e aprovação v2, não infraestrutura apenas |

Estado e evidências: [Instalação](INSTALACAO_LOCAL.md),
[Progresso](PROGRESSO.md) e [Operação](OPERACAO.md).
