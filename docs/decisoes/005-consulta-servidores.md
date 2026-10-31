# Decisão 005 — Consulta de servidores

## Contexto e alternativas

A consulta precisa preservar sufixos e distinguir matrículas iguais em fontes
diferentes, sem carregar dados de teste em um banco operacional. A busca por
CPF não deve percorrer ou devolver o valor cifrado. Nomes podem conter acentos
e caracteres especiais de padrões SQL. As referências não definem uma ordem
de apresentação ou uma escolha automática de vínculo duplicado.

## Escolha

A pesquisa por nome usa a coluna normalizada e trata `%`, `_` e o caractere
de escape como literais; matrícula usa igualdade após remoção de espaços nas
bordas e normalização de caixa, sem alterar pontuação ou sufixo. CPF válido
é normalizado e buscado por HMAC. Quando não há tipo explícito, a API combina
os critérios aplicáveis; a interface exige que o usuário escolha o tipo.
Todas as correspondências são exibidas com sua origem, sem seleção implícita.

A paginação usa UUID de vínculo ou evento e limite máximo 50; a interface
solicita 25. O detalhe revela somente CPF mascarado. A consulta de eventos
confere que o vínculo pertence à pessoa solicitada. A sessão e o perfil são
revalidados na transação que lê e audita, e o administrador técnico não tem
permissão de consulta funcional. A auditoria não recebe o termo pesquisado.

A migração `003-consulta` adiciona índices por pessoa/vínculo e
vínculo/evento: sem o primeiro, a busca ampla excedeu um segundo no teste
inicial. A migração foi aplicada somente em bancos descartáveis e pelo setup
em banco novo. Ela não é um procedimento autorizado de atualização.

## Evidência e pendências

O teste HTTPS com PostgreSQL temporário insere 17.700 vínculos fictícios e
verifica buscas, paginação, duplicidade, autorização e auditoria abaixo do
limite local de um segundo. O fluxo de navegador foi testado separadamente com
API simulada, inclusive estados de erro, perfis e telas estreitas. Faltam
revisão humana, navegador integrado com CA confiável, caracterização de carga
em instalação aprovada e teste de logs de qualquer futuro proxy. As URLs
consultadas podem conter CPF ou matrícula: qualquer componente intermediário
deve suprimir parâmetros sensíveis nos logs antes de publicação.

O gerador ainda não representa todas as anomalias de importação e a API de
sincronização simulada. A consulta não importa dados, não altera dados
funcionais e não autoriza emissão operacional.
