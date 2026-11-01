# Como ligar o SisDoc

Manual resumido para uma instalação já configurada ou restaurada e aceita.
Para outra máquina, conclua primeiro a
[migração Windows Server](MIGRACAO_WINDOWS_SERVER.md). Não execute setup para
ligar uma instalação existente.

## 1. Abra o PowerShell

Abra na pasta do checkout. Exemplo para o destino `C:\SisDoc` (na origem,
use a pasta atual do repositório):

```powershell
Set-Location 'C:\SisDoc'
$env:SISDOC_CONFIG = 'C:\ProgramData\SisDoc\instalacao\config\aplicacao.json'
# Somente se Chromium foi instalado nesse cache compartilhado:
# $env:PLAYWRIGHT_BROWSERS_PATH = 'C:\ProgramData\SisDoc\instalacao\chromium'
npm run verificar-instalacao
if ($LASTEXITCODE -ne 0) { throw 'Corrija a etapa indicada antes de iniciar.' }
npm start
```

Aguarde a mensagem de que o SisDoc está disponível em HTTPS na porta 3443.
**Mantenha essa janela aberta:** fechar o terminal ou pressionar `Ctrl+C`
encerra a aplicação iniciada nele.

## 2. Acesse a aplicação

Abra **https://localhost:3443/** no navegador e entre com sua conta.
Esse endereço funciona somente na máquina em que a aplicação está ligada,
inclusive quando for um Windows Server. Não é um endereço de acesso LAN.
Se configurar outra porta/nome TLS, use os valores da configuração aceita.

## 3. Se não abrir

- **Já está ligado:** se o endereço abrir, não execute outra cópia.
  Erro `EADDRINUSE` indica que a porta já está ocupada; não encerre processos
  desconhecidos.
- **Banco indisponível:** o PostgreSQL deve iniciar automaticamente com o
  Windows. Confira no PowerShell:

  ```powershell
  Get-Service -Name 'postgresql-x64-16'
  ```

  Se estiver parado, abra um PowerShell **como administrador** e execute:

  ```powershell
  Start-Service -Name 'postgresql-x64-16'
  ```

  Depois, repita o passo 1 no terminal da aplicação.
- **Erro de configuração ou certificado:** solicite revisão à Informática.
  Não apague configurações nem ignore avisos de segurança do navegador.
- **Chromium indisponível:** use a mesma conta/cache da instalação; o worker
  PDF precisa dele mesmo que a interface abra. Veja o guia de migração.
- **Emissão bloqueada:** confira processo, conferência e aprovação específica
  da regra/template v2. Ligar a aplicação não concede aprovação.

## Desligar e reiniciar

Para desligar a aplicação iniciada no seu terminal, pressione `Ctrl+C`.
Para ligar novamente, repita o passo 1.
A aplicação ainda **não inicia automaticamente após reiniciar o Windows**.

Na operação diária, não execute `npm run setup`, testes ou importações para
ligar o sistema. Build e migrações só são necessários após atualização do
código, conforme o [manual de operação](OPERACAO.md).
