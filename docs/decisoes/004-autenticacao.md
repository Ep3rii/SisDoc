# Decisão 004 — Autenticação e perfis

## Preparação

A migração `002-autenticacao` cria armazenamento para limites de tentativas
por IP e matrícula, obriga unicidade de matrículas de usuários normalizadas
por espaço e caixa e concede apenas as colunas de usuário necessárias à
autenticação e administração. As sessões podem ser inseridas, atualizadas e
revogadas pelo papel da aplicação; dados funcionais e emissões continuam sem
privilégio de escrita. A migração é transacional e pode falhar sem apagar
usuários preexistentes.

A matriz separa permissões por ação, sem hierarquia implícita de administrador.
Para edição de rascunho, exige autoria; para conferir ou emitir documento de
terceiro, o coordenador precisa recebê-lo encaminhado. Cancelamento de
rascunho segue a regra do autor habilitado ou coordenador. Essa interpretação
conservadora é provisória até a decisão sobre autoria e encaminhamento.

A matriz e a migração foram testadas isoladamente. Neste estágio elas ainda
não constituem login, sessões funcionais, CSRF, controle de rotas ou
administração de usuários; esses fluxos permanecem em construção.
