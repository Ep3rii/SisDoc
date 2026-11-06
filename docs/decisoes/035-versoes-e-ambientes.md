# Decisão 035 — Instalação única editável em Produção

## Decisão

Há uma única instalação editável do SisDoc, denominada Produção, mantida
diretamente no checkout `C:\SisDoc`. O serviço, o build web servido e as
alterações de código usam esse checkout. Não criar ambientes de homologação
ou staging, cópias de projeto, bancos operacionais paralelos ou fluxos de
promoção entre instalações.

Dados operacionais permanecem na base local existente. Código pode ser
alterado diretamente; operações destrutivas/irreversíveis no banco exigem
commit prévio e backup verificado da base/tabelas afetadas. Segredos,
configuração, TLS, PDFs e logs permanecem fora do Git por proteção, não como
ambientes separados.

Testes automatizados que precisem de banco ou arquivos usam recursos
descartáveis, não dados nem serviços operacionais. Verificações de saúde
somente leitura podem ser feitas na instalação única; não se aplicam seeds
ou dados fictícios à base real.

## Situação da aplicação

O primeiro release `v0.1.0` foi criado no commit `22f38b3` e permanece como
histórico Git, não como instalação separada para promoção. A referência
operacional passa a ser o checkout único `C:\SisDoc`. Os serviços Windows
SisDoc/Caddy e o PostgreSQL existentes são mantidos.

Esta decisão simplifica o procedimento anterior de dois ambientes. Não
autoriza exclusão de dados, migração de schema ou alteração de regras
funcionais; cada mudança de banco segue as salvaguardas descritas acima e em
[Invariantes](../ia/INVARIANTES.md).

Procedimento: [Ambiente único — Produção](../AMBIENTE_PRODUCAO.md).
