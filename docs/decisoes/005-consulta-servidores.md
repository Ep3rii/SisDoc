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

A tela Buscar Servidores carrega previamente vínculos locais, sem exigir termo.
A listagem e a busca são ordenadas e paginadas no PostgreSQL por matrícula
natural crescente (2 antes de 10, inclusive sufixos numéricos), com desempate
por origem e UUID. Zeros à esquerda e texto são preservados na apresentação;
sequências numéricas equivalentes usam apenas origem/UUID como desempate.
A listagem solicita 50 vínculos por página. O cursor continua sendo o UUID
do último vínculo, cuja chave natural é resolvida no banco. Os vínculos dos
detalhes seguem a mesma ordem. Eventos continuam paginados por UUID.

Todos os perfis autenticados recebem CPF completo no resumo e nos detalhes;
o contrato `pessoa.cpf` substitui `pessoa.cpfMascarado`, e os itens da listagem
incluem `cpf`. Os demais dados pessoais completos permanecem nas referências.
As permissões de edição, cálculo e emissão não mudam. A consulta de eventos
confere que o vínculo pertence à pessoa solicitada. A sessão e o perfil são
revalidados na transação que lê e audita. A auditoria não recebe o termo
pesquisado nem o CPF retornado.

A migração `020-listagem-servidores` cria uma função imutável de chave natural
por segmentos de texto/dígitos e índices de ordem global e por pessoa.
Ela evita conversões numéricas limitadas por tamanho, serve também após
edições/importações e é exigida na inicialização. Atualizações existentes
devem seguir o procedimento de migração com backup e serviço parado.

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
