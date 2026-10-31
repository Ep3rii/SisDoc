# Operação — fundação ainda não autorizada

Este documento descreve somente a fundação. O motor de referência foi
testado, mas **não há login, fluxo de cálculo na interface, emissão,
importação, backup ou serviço Windows implementados**. Não instalar ou usar
operacionalmente até a conclusão das demais fatias e autorização formal.

## Pré-requisitos para uma futura instalação

- Windows compatível e com suporte de segurança comprovado; Node 24.20.0 nesta
  máquina e PostgreSQL 16. O PostgreSQL usado pelos testes é descartável e não
  substitui uma instalação operacional.
- Banco PostgreSQL **novo e vazio**, escutando somente em loopback, e dois
  papéis já provisionados: proprietário para migração e login distinto para a
  aplicação, sem superusuário, privilégios administrativos ou associações a
  outros papéis. A autenticação local deve exigir senha.
- Diretório pai protegido e uma **nova** raiz externa ao checkout e ao perfil
  pessoal. A inicialização se recusa a sobrescrever raiz existente ou banco
  não vazio. Verificar previamente a segurança do diretório pai.
- Certificado, chave e cadeia de CA externos ao checkout, com nome DNS
  correspondente e permissão de leitura adequada à futura conta de serviço.
  A inicialização verifica cadeia e nome, mas não constitui aprovação da CA ou
  verificação completa das ACLs desses arquivos.
- SID de conta de serviço distinto da conta instaladora e sem privilégios
  administrativos, e lista local não vazia de senhas comuns, fora do checkout.
  A pertinência da conta e sua associação a grupos devem ser verificadas pelo
  responsável; o instalador não cria ou inicia serviços.

## Comandos

Após instalar dependências do lockfile com `npm ci`, `npm run setup` deve ser
executado por operador autorizado em terminal interativo. O comando solicita os
parâmetros acima, senhas sem eco e confirmação explícita `CRIAR`. Ele aplica a
estrutura versionada ao banco vazio, cria chaves próprias e um administrador
com troca de senha obrigatória. Não cria banco ou papéis PostgreSQL e não
importa dados. Se a transação ficar com estado incerto, preserve a raiz e
verifique o banco antes de qualquer nova tentativa.

O caminho da configuração externa aparece ao final do comando. Na mesma
sessão PowerShell, defina `SISDOC_CONFIG` com esse caminho e execute
`npm start`. O backend atende apenas em `127.0.0.1` por HTTPS. Proxy Caddy/IIS,
serviço, regras de rede e certificado operacional confiável ainda exigem
implementação e aprovação; não expor esta fundação à rede.

## Verificação de software

`npm test` usa PostgreSQL 16.15, contas, banco, certificados e arquivos
inteiramente descartáveis. Não usa a instalação configurada. O teste Windows
exige caminhos ASCII ou 8.3 para o checkout e a pasta temporária, mantendo o
banco em UTF-8. Se necessário, defina `SISDOC_TEST_TEMP` para um diretório
temporário existente, externo ao checkout e à instalação operacional. Não há
ambiente permanente de teste. `npm run typecheck` verifica os tipos.

Backup, restauração, atualização de instalações existentes e recuperação das
chaves ainda não estão implementados. A migração de uma fundação anterior foi
testada apenas em banco descartável; não há comando autorizado para executá-la
em instalação existente. Não há evidência de prontidão operacional.
