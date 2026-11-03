# Decisão 031 — Serviços Windows e proxy Caddy local

## Escolha

A aplicação continua sendo um monólito local. A API NestJS permanece em HTTPS
na porta interna configurada, vinculada somente a `127.0.0.1`. Caddy termina o
HTTPS público da máquina em `https://localhost/`, vinculado somente a
`127.0.0.1`, e encaminha para a API por HTTPS com validação normal do
certificado upstream e nome TLS configurado.

A origem pública `https://localhost` é configurada explicitamente em
`proxy.origemPublica`. O proxy não reescreve `Origin`; não se confia em
cabeçalhos encaminhados para contornar CSRF. O cookie seguro e as validações
de origem continuam ativos.

WinSW pode envolver os processos da API e do Caddy como serviços Windows,
ambos sob `NT AUTHORITY\LocalService`, com permissões mínimas nos arquivos
necessários. A API inicia após o serviço PostgreSQL; o Caddy inicia após a API.
Configurações, certificados, logs e PDFs ficam fora do checkout, com ACLs
restritas.

Não configurar listener de rede, DNS público, regra de firewall ou acesso LAN
nesta decisão. IIS não é configurado; Caddy é a opção escolhida para a VM.

## Evidência e limite

Os arquivos de implantação no repositório são modelos, não evidência de
serviços instalados nem de proxy operacional. Antes de ativá-los, verificar
portas, certificado/SAN, CA confiável pelo serviço, ACLs e a origem pública;
validar HTTPS/health e CSRF localmente. Fazer backup e parar a API antes de
aplicar a migração de perfis ou trocar o processo ativo.
