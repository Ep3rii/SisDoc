# Decisão 007 — Rascunhos provisórios de DOF

## Contexto e escolha

O cálculo pode ser salvo por analista ou coordenador somente como rascunho
próprio. A restrição de autoria é provisória; um coordenador destinatário pode
consultar um rascunho explicitamente encaminhado, sem editá-lo. Secretário
adjunto pode calcular, mas não listar, criar ou editar rascunhos. O
administrador técnico não tem acesso funcional por hierarquia.

O servidor recalcula no salvamento e persiste a entrada e o resultado cifrados.
Os lançamentos iniciais e cada alteração são registrados por período, ano ou
acumulado anterior, com valores e motivo cifrados; os valores da fonte não são
presumidos, pois as ocorrências ainda não são carregadas. Um UUID e o contexto
do campo são autenticados na cifra. A aplicação não altera a fonte.

A revisão otimista e o bloqueio transacional da linha impedem sobrescrita por
duas edições concorrentes. Pessoa e vínculo não podem ser substituídos. Ao
reduzir o período, o servidor exige confirmação explícita dos anos removidos
e mantém os valores anteriores no registro de ajustes. A interface também
avisa antes de descartar edições e orienta a reabrir após erro de comunicação.

A admissão considerada integra o resultado protegido. O cliente informa a
admissão que conferiu como pré-condição, nunca como escolha da regra; o
servidor a compara à fonte e calcula com a admissão da fonte. Se a admissão
atual diferir da salva, é necessário preparar e confirmar a tabela novamente.
Caso apenas a admissão tenha mudado, essa reconfirmação também cria ajuste
justificado, sem modificar a fonte. Versão ou configuração de regra antiga
bloqueia a edição, em vez de recalcular sob versão diferente e conservar uma
referência incorreta.

A migração `004-rascunho-dof` cria a revisão e referências técnicas
provisórias para regra e template. O template é somente um marcador de que
não existe modelo oficial aprovado; ele não constitui modelo para emissão. A conta
da aplicação recebe privilégios de colunas para rascunhos e inserção de
ajustes, mas não para alterar status ou inserir emissões. O setup aplica a
migração em banco vazio; não há procedimento autorizado para atualizar uma
instalação existente.

## Evidência e limites

Testes HTTPS e PostgreSQL descartáveis verificam 45 anos, autoria, perfis,
CSRF, cifra, ajustes, confirmação de anos removidos, regra incompatível,
admissão alterada e duas edições concorrentes. Testes Playwright executam a
interface em Chromium com API simulada: salvamento, reabertura, conflito,
falha de comunicação, alterações não salvas, permissões e tela estreita.
A simulação não substitui navegador integrado ao HTTPS real e CA confiável.

Ainda não há sincronização. A criação e a edição tentam obter o bloqueio
advisory compartilhado da [decisão 011](011-preconferencia-dof.md) antes de
ler e recalcular a fonte, mantendo-o até o fim da transação. A edição relê o
documento e a fonte após obter o bloqueio. Uma escrita já iniciada em pessoa ou
vínculo causa conflito explícito; uma escrita iniciada depois aguarda o
salvamento. A aplicação continua sem privilégios de alteração da fonte.
Alterações posteriores podem tornar o resultado defasado e exigem nova
conferência. Testes HTTPS e PostgreSQL descartáveis cobrem as duas ordens de
concorrência e a admissão efetivamente salva.

O bloqueio é global, não protege outras tabelas de fonte e pode afetar
registros não relacionados. Antes de implementar importação ou sincronização,
é necessário reavaliar desempenho, tratamento de falhas e ordenação dos
bloqueios, além de proteger as demais fontes utilizadas.

O editor e a prévia provisória posteriores estão descritos na
[decisão 008](008-blocos-e-previa-dof.md); eles não alteram a condição do
template. Faltam conferência, numeração, snapshot, worker/PDF e histórico.
A fatia 5 não cumpriu seu gate e nenhuma funcionalidade está autorizada para
uso operacional.
