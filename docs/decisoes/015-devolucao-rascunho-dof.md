# Decisão 015 — Devolução de rascunho DOF

## Contexto e escolha

O coordenador destinatário de um encaminhamento ativo pode devolver o
rascunho ao autor com motivo obrigatório. O documento permanece em
`rascunho`: esta operação não representa conferência, aprovação ou emissão.
A devolução fecha o encaminhamento, incrementa a revisão e libera a edição
para o autor. A transição posterior de `conferido` para `rascunho` é distinta,
conforme a [decisão 017](017-conferencia-provisoria-dof.md).

O motivo é cifrado com o contexto do registro de encaminhamento. A ação e a
leitura da última devolução são auditadas sem incluir o motivo nos detalhes.
Somente o autor pode consultar esse motivo; a interface o apresenta como
texto, sem interpretar HTML. A consulta inclui a revisão e a rejeita na
interface quando não corresponde ao rascunho aberto. Um motivo protegido
inválido retorna conflito explícito e registra a falha na auditoria.

Por compatibilidade com a migração anterior, as colunas históricas
`recolhido_por` e `recolhido_em` registram o encerramento tanto pelo autor
quanto pelo destinatário. O ator distingue recolhimento de devolução; o
registro encerrado permanece imutável. A migração
`010-devolucao-dof` permite o encerramento pelo coordenador destinatário
ativo, sem ampliar a edição de conteúdo. O setup aplica a migração apenas a
banco novo; ainda não existe procedimento aprovado de atualização de
instalações existentes.

A API bloqueia o documento antes de revalidar o encaminhamento, o perfil e a
revisão. Se um recolhimento concorrente vencer, o destinatário perde o acesso
e a devolução não é registrada. Após devolver, o coordenador deixa de ter
acesso ao encaminhamento; cópias já recebidas não podem ser recuperadas.
Falhas de comunicação exigem consulta ao estado antes de repetir a ação.

## Limites

A interface mostra apenas a última devolução ao autor, identificada por data e
coordenador. Histórico completo, conferência institucional, emissão e PDF
ainda não estão implementados. Testes usam banco e
HTTPS descartáveis ou navegador com API simulada; isso não autoriza operação.
Eles cobrem papéis, CSRF, retorno ao autor, conteúdo cifrado e corrompido,
auditoria, imutabilidade, revisão obsoleta e recolhimento concorrente.
