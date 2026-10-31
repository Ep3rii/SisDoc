# Decisão 006 — Cálculo interativo de referência da DOF

## Contexto e escolha

O cálculo puro já foi verificado, mas ainda não há importação nem editor de
documentos. Para expor a parte independente sem simular uma emissão, a API
calcula somente para uma pessoa e vínculo locais relacionados. A admissão é
lida da fonte e a data de referência é a data atual em `America/Sao_Paulo`;
nenhuma delas, nem a versão da regra, é escolhida pelo cliente. Uma admissão
ausente impede o cálculo com mensagem explícita. Esta decisão descreve a
primeira entrega do cálculo; o salvamento posterior está em
[007-rascunhos-dof.md](007-rascunhos-dof.md).

A interface não presume que registros de afastamento ou incorporação estejam
ausentes: informa que eles ainda não são carregados e exige conferência dos
anos e intervalos. Campos vazios só são convertidos em zero após confirmação
expressa; a confirmação é desfeita quando os dados são alterados. Em início
posterior à admissão, acumulados anteriores e origem são obrigatórios. As
entradas e o resultado existem apenas em memória durante a consulta: não criam
documento, ajuste, snapshot, número ou PDF.

O servidor aplica a matriz de cálculo, exige sessão e CSRF, revalida o perfil
na transação e registra a solicitação na auditoria sem os valores enviados.
Erro de cálculo não apaga esse registro. A regra permanece identificada como
provisória e não há opção que a torne oficial.

## Evidência e limites

Testes em banco e HTTPS descartáveis cobrem cálculo de 45 anos, valores,
autorizações negativas, CSRF, admissão ausente, início anterior à posse,
acumulado anterior e não alteração da fonte. A interface foi exercitada com
API simulada; isso não é um teste integrado de navegador com CA confiável.
Faltam carregar e reconciliar ocorrências da fonte, salvar rascunhos e
justificativas, editor de blocos, prévia, conferência, snapshot, PDF,
histórico e aprovação das regras e modelos. O gate da fatia 5 não está verde.
