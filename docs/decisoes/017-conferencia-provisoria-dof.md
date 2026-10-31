# Decisão 017 — Conferência provisória e devolução de DOF

## Contexto e escolha

Analista ou coordenador pode conferir um rascunho próprio; o coordenador
destinatário também pode conferir o rascunho encaminhado a ele. A conferência
é **provisória**: registra a revisão humana dos dados e avisos disponíveis,
mas não aprova regras, campos obrigatórios ou modelo institucional e não
autoriza emissão. Não existe chave para transformar a regra provisória em
oficial.

Como a obrigatoriedade institucional ainda não foi definida, a conferência
provisória adota um bloqueio conservador para nascimento, nome da mãe, regime
jurídico, cargo, referência/padrão e órgão ausentes na fonte. CPF, matrícula,
admissão, período, processo, cálculo e variáveis ativas também são verificados
conforme a [decisão 011](011-preconferencia-dof.md). Esses bloqueios não
comprovam que todos os campos do futuro modelo aprovado estejam presentes.
É necessária conferência humana de afastamentos e incorporações, pois seus
registros ainda não são automaticamente confrontados com os lançamentos.

O usuário abre a prévia salva, consulta as pendências e confirma expressamente
que revisou prévia, dados, lançamentos e avisos. A pré-conferência vinculada à
prévia retorna uma prova HMAC do relatório, associada à sessão, à prova da
fonte, à revisão, aos bloqueios e aos avisos. Essa prova não demonstra, por si
só, revisão humana. A API bloqueia o documento, obtém o bloqueio compartilhado
da fonte, compara a prova da prévia, recalcula a verificação e compara a prova
do relatório na mesma transação. Divergência ou bloqueio impede a transição.
Uma falha de comunicação deixa o resultado incerto; a interface orienta
consultar as DOFs conferidas antes de tentar novamente.

A migração `012-conferencia-dof` registra evento imutável com usuário,
instante, revisão do documento, revisões da pessoa e do vínculo e códigos dos
avisos; a transição para `conferido` exige evento correspondente. A conta da
aplicação não pode alterar ou apagar esses eventos, escrever na fonte ou inserir
emissão. A auditoria não inclui CPF, provas ou conteúdo da devolução em texto.
Como nas migrações anteriores, o setup aplica a migração somente a banco novo;
não há procedimento aprovado para atualizar instalações existentes.

O coordenador autor ou destinatário pode devolver a DOF conferida a rascunho
com motivo obrigatório cifrado. A transição incrementa a revisão, preserva a
conferência anterior e encerra eventual encaminhamento. O autor pode ler a
última devolução; após o encerramento o destinatário perde o acesso. Falha de
comunicação exige verificar o estado antes de repetir. Cópias já recebidas não
podem ser recuperadas remotamente.

## Limites e verificação

A lista e a abertura da prévia sinalizam mudanças nas revisões da pessoa ou do
vínculo selecionados em cada consulta. Elas não cobrem todas as tabelas da fonte. A prévia de uma DOF conferida usa a
fonte **atual**, não um snapshot da conferência, e informa essa diferença. A
interface rejeita resposta de outra revisão, apresenta falhas de carregamento e
permite nova tentativa. O HTML usa o renderizador compartilhado, escape de
conteúdo, CSP e iframe sem permissões.

Testes usam exclusivamente PostgreSQL e HTTPS descartáveis, ou navegador com
API simulada e dados sintéticos. Cobrem um rascunho de 45 anos, bloqueios para
cada campo de referência, perfis, CSRF, fontes e relatórios obsoletos,
concorrência, repetição, imutabilidade, cifra do motivo, auditoria, erro de
comunicação e prévia. O navegador ainda não foi integrado ao serviço com CA
operacional confiável e não houve revisão humana.

Emissão, reserva de número, snapshot, PDF de emissão e histórico não estão implementados.
Uma futura emissão deverá revalidar a fonte, todos os dados aplicáveis, as
aprovações e a autorização; não poderá depender somente desta conferência.
O gate da fatia 5 permanece não cumprido e a aplicação não está autorizada
para uso operacional.
