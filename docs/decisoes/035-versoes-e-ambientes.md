# Decisão 035 — Releases separados e ambiente de Homologação

## Decisão

Produção e Homologação usam versões identificáveis por tags Git
`vMAJOR.MINOR.PATCH`, commits fixos e diretórios/builds independentes.
Produção executa um release imutável; Homologação executa somente o candidato
que será avaliado. Não compilar ou atualizar o checkout ativo de Produção.

Homologação deve manter banco, papéis, configuração, chaves, TLS, PDFs e logs
próprios, sem copiar dados ou segredos operacionais. O acesso inicial é
restrito a loopback em `https://127.0.0.1:3444/`, com certificado válido para
o IP de loopback, e sem Caddy LAN/firewall. O uso de um host diferente de
`localhost` evita conflito do cookie `__Host-sisdoc` entre portas.

Produção continua no endpoint operacional já configurado. Alterar caminho do
serviço, aplicar migração ou trocar versão requer janela autorizada, backup
verificado, aceite do candidato e verificação posterior. Rollback de código
não reverte automaticamente schema/dados.

## Estado e limites

Esta decisão define o procedimento; não instala, inicia ou publica Homologação
nem troca o serviço ativo. No estado observado em 05/11/2026, `SisDoc` e
`SisDocCaddy` estavam registrados/ativos e o XML do serviço SisDoc apontava
para `C:\SisDoc`. O candidato `v0.1.0` foi compilado em diretório separado
(`C:\ProgramData\SisDoc\instalacao\releases\v0.1.0-candidate`), com
`npm ci`, build e 42 testes direcionados aprovados. O typecheck completo do
candidato também deve passar antes da tag. A publicação e o provisionamento
de Homologação continuam separados e pendentes até validação operacional.

O build web existente em `C:\SisDoc\apps\web\dist` tinha timestamp
05/11/2026 11:26, e a página compartilhada de Produção mostrava apenas o
login. Como o serviço usa `C:\SisDoc` como diretório de trabalho, a interface
estática pode já refletir esse build; não foi possível confirmar a versão de
todas as telas sem autenticar. Tratar a exposição dos arquivos web como
potencialmente atualizada e verificar em janela autorizada antes de novo build
ou troca de versão.

A criação de banco/configuração e a disponibilização de Homologação dependem
de provisionamento isolado e validação de TLS/porta/ACLs. A tag `v0.1.0` e
qualquer troca do serviço permanecem pendentes até concluir o typecheck,
fechar o commit, validar backup e confirmar o health check.

Procedimento: [Versões, Produção e Homologação](../VERSOES_E_AMBIENTES.md).
