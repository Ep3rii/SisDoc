# Decisão 002 — Modelo de dados e proteção

## Migrações e privilégios

O setup aplica `000-fundacao` e `001-modelo` em uma única transação no banco
novo e vazio. A migração 001 exige uma transação do chamador, usa savepoint e
bloqueio de migração, registra a versão e recusa históricos desconhecidos.
Uma falha reverte suas alterações; a atualização a partir de uma cópia
descartável da fundação foi exercitada.

Não há comando autorizado para atualizar uma instalação existente: antes é
necessário implementar e verificar backup, restauração e procedimento de
recuperação. O setup continua recusando bancos não vazios.

`legado` existe, mas não contém tabelas: o mapeamento depende do esquema real
ainda não fornecido. O papel da aplicação possui leitura das tabelas criadas e
inserção na auditoria, sem escrita em usuários, documentos ou dados
funcionais. Novas concessões devem acompanhar as funcionalidades e seus
testes; não se presume autorização pela existência das tabelas.

## Proteção de conteúdo

Campos pessoais, entradas, ajustes, staging e snapshots que exigem proteção
são representados por `bytea`; conteúdo originalmente JSON deve ser
serializado, validado e cifrado antes da gravação, não pesquisado diretamente
como JSON no banco. Nome e nome de busca continuam em texto para a busca
prevista; disco, backup e acessos permanecem sujeitos aos controles do prompt.

O componente de proteção usa AES-256-GCM com nonce aleatório de 12 bytes,
tag de 16 bytes e envelope versionado. Schema, tabela, UUID do registro e
campo são autenticados como contexto: o UUID precisa ser definido antes da
cifra e o mesmo contexto é necessário para recuperação. CPF validado e
normalizado recebe HMAC-SHA-256 com chave separada, para lookup e unicidade.
As chaves são externas e não são intercambiáveis.

Os testes exercitam cifra, autenticação, HMAC e persistência com dados e chaves
sintéticos. O banco não consegue provar que um `bytea` contém uma cifra
válida: todos os futuros caminhos de escrita e leitura precisam usar o
componente e ser testados. Ainda não existem importação, consulta de pessoas,
escrita de rascunhos ou emissão pela aplicação.

## Integridade e imutabilidade

O banco valida as relações pessoa/vínculo e documento/template, formatos
anuais ou por intervalo, limites de períodos e cargos, sobreposição e
transições básicas. A alteração dos itens de um documento bloqueia a linha
do próprio documento, inclusive para escritas concorrentes.

Auditoria, emissão/snapshot, ajustes e versões são protegidos contra
`UPDATE`, `DELETE` e `TRUNCATE`; administradores do banco continuam capazes de
alterar permissões ou desabilitar gatilhos, portanto a custódia dessas contas
e a auditoria operacional continuam necessárias. Cancelar o documento não
altera seu snapshot.

A presença de regras e templates versionados não implica aprovação. Não há
rota de emissão nem privilégio de inserção de emissão pela aplicação.
A fatia de emissão deve implementar a aprovação explícita e a transação de
numeração, snapshot e job antes de habilitar qualquer fluxo.
