# Como ligar o SisDoc

Manual resumido para a instalação já configurada nesta máquina.

## 1. Abra o PowerShell

Execute:

```powershell
Set-Location 'C:\Users\Euzébio\Desktop\SisDoc'
$env:SISDOC_CONFIG = 'C:\ProgramData\SisDoc\instalacao\config\aplicacao.json'
npm start
```

Aguarde a mensagem de que o SisDoc está disponível em HTTPS na porta 3443.
**Mantenha essa janela aberta:** fechar o terminal ou pressionar `Ctrl+C`
encerra a aplicação iniciada nele.

## 2. Acesse a aplicação

Abra **https://localhost:3443/** no navegador e entre com sua conta.
Esse endereço funciona somente nesta máquina.

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

## Desligar e reiniciar

Para desligar a aplicação iniciada no seu terminal, pressione `Ctrl+C`.
Para ligar novamente, repita o passo 1.
A aplicação ainda **não inicia automaticamente após reiniciar o Windows**.

Na operação diária, não execute `npm run setup`, testes ou importações para
ligar o sistema. Build e migrações só são necessários após atualização do
código, conforme o [manual de operação](OPERACAO.md).
