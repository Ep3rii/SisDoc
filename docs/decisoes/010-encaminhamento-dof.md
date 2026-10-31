# Decisão 010 — Encaminhamento de rascunho DOF

## Contexto e escolha

Até a decisão institucional sobre leitura e edição de rascunhos de terceiros,
a edição continua restrita ao autor. O autor pode encaminhar seu rascunho a um
coordenador ativo explicitamente escolhido. Somente esse destinatário pode
abrir o rascunho e sua prévia, sem editar. A lista de recebidos não concede
acesso a outros coordenadores, analistas, secretário ou administrador técnico.
O encaminhamento é para análise: não altera o status de `rascunho`, não
registra conferência e não autoriza emissão.

Enquanto o encaminhamento estiver ativo, o próprio autor também não pode
alterar cálculo, período, processo ou blocos. Antes de editar ou trocar o
destinatário, deve recolher o encaminhamento com um motivo. Há no máximo um
encaminhamento ativo por documento; revisões concorrentes são recusadas.
Gatilhos do banco complementam as validações da API e bloqueiam alteração do
conteúdo e dos itens enquanto houver encaminhamento ativo.

Envio e recolhimento incrementam a revisão e são auditados, com o identificador
do destinatário, sem texto do motivo. O motivo de recolhimento é cifrado e o
registro encerrado é imutável. A leitura do destinatário é revalidada depois de
obter o bloqueio de leitura do documento, para impedir que uma consulta em
espera aceite um encaminhamento já recolhido. Se o destinatário deixar de ser
coordenador ativo, perde o acesso; o autor recebe aviso e pode recolher.
Uma consulta ou cópia já entregue ao navegador antes do recolhimento não pode
ser recuperada pela aplicação.

O bloqueio do destinatário durante o envio é tentado sem espera: se outra
operação estiver usando essa conta, o usuário recebe conflito e pode tentar
novamente. Isso evita um ciclo de bloqueios entre usuários. A lista de
coordenadores é paginada e mostra apenas nome e matrícula.

## Evidência e limites

Testes em PostgreSQL e HTTPS descartáveis cobrem perfis, CSRF, destinatário,
revisão, cifra do motivo, imutabilidade, perda do perfil de coordenador,
consultas concorrentes ao recolhimento e escrita concorrente ao encaminhamento.
O navegador é testado separadamente com API simulada e dados fictícios.
A migração `007-encaminhamento-dof` só é aplicada pelo setup em banco novo;
não há procedimento aprovado para atualizar instalação existente.

Ainda faltam validação e transição de conferência, regra e modelo aprovados,
emissão, PDF e histórico. A interface e a API não tratam o envio como
aprovação. A concorrência futura com sincronização da fonte também continua
pendente, conforme a decisão 007.
