# Decisão 007 — Rascunhos provisórios de DOF

## Contexto e escolha

O cálculo pode ser salvo por analista ou coordenador somente como rascunho
próprio. A restrição de autoria é provisória; o encaminhamento para conferência
por coordenador ainda precisa ser implementado. Secretário adjunto pode
calcular, mas não listar, criar ou editar rascunhos. O administrador técnico
não tem acesso funcional por hierarquia.

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
não existe modelo oficial aprovado; ele não permite prévia ou emissão. A conta
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

Ainda não há sincronização. A leitura da admissão e a gravação do rascunho
ocorrem na mesma transação, mas não bloqueiam uma alteração concorrente da
fonte; o resultado preserva a admissão usada e a divergência fica visível ao
reabrir. Antes de implementar sincronização concorrente, é necessária uma
estratégia transacional testada que evite gravar um resultado já defasado sem
conceder ao aplicativo privilégios de alteração da fonte.

Faltam editor de blocos, prévia segura, conferência, numeração, snapshot,
worker/PDF e histórico. A fatia 5 não cumpriu seu gate e nenhuma funcionalidade
está autorizada para uso operacional.
