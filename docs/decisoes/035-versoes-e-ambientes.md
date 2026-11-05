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

O primeiro release `v0.1.0` foi criado no commit `22f38b3`, compilado em
checkout isolado, aprovado no typecheck e em 42 testes focados e implantado
em `C:\ProgramData\SisDoc\instalacao\releases\v0.1.0`. A API e o proxy estão
ativos; health HTTPS 200, rota privada sem sessão 401 e os assets do frontend
foram comparados por SHA-256. Não houve migração de banco nem alteração das
aprovações de modelos. O Git commit/tag permanecem locais, sem push ao remoto.

Backup pré-deploy do banco foi validado e cifrado localmente com DPAPI
CurrentUser; limitações descritas no
[guia de ambientes](../VERSOES_E_AMBIENTES.md). Build de rollback `0529dc3`
preservado em `v0.0.0-rollback`. A primeira partida falhou por ACL ausente
nos diretórios pais; após conceder leitura/travessia limitada, o release
iniciou e passou as verificações. Ambos os serviços Windows estão Running.

**Homologação continua pendente:** porta 3444 livre, mas o papel PostgreSQL
conhecido não tem `CREATEDB`/`CREATEROLE`; não há configuração/banco/roles ou
TLS dedicado a `127.0.0.1`. O bootstrap exige credencial privilegiada e
operador interativo autorizado. Não compartilhar banco, configuração, chaves,
certificado ou PDFs de Produção, e não iniciar uma segunda instância com a
configuração produtiva.

Procedimento: [Versões, Produção e Homologação](../VERSOES_E_AMBIENTES.md).
