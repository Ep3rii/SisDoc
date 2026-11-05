# Decisão 034 — Emissão em lote e motivos condicionais

## Emissão em lote

A emissão em lote é uma conveniência da interface, não uma nova transição
de domínio. A DOF usa a página atual da lista de conferidas; a DTC usa os
documentos conferidos carregados para o tipo selecionado. O escopo carregado
e filtrado é indicado ao operador, sem sugerir emissão de itens não exibidos.

Cada item exige prévia atual, prova de fonte compatível com documento/revisão,
fonte explicitamente válida e revisão individual pelo operador. DTC com
estado de fonte desconhecido (`null`) não é elegível. A tela chama a emissão
individual existente, com chave de idempotência própria por documento, e
processa sequencialmente. Aprovação formal, autorização, conferência,
auditoria, numeração e snapshot continuam validados no servidor.

Não há transação global nem rollback do lote: cada número/snapshot é atômico
por documento. Falha de um item é apresentada sem ocultar as emissões já
concluídas. A repetição de um item com resultado incerto preserva sua chave
enquanto a página permanece aberta; recarregar e resolver um resultado
incerto deve ser feito pelo Histórico, não por uma nova emissão presumida.

## Motivos e prévias

Motivos de edição do cálculo, processo e blocos da DOF e do conteúdo da DTC
são apresentados e exigidos somente quando há diferença em relação ao estado
persistido. Restaurar os valores originais remove o motivo e a pendência.
Dados preenchidos na criação de novo documento constituem lançamento e
continuam sujeitos à justificativa quando a regra correspondente a exigir.
Motivos próprios de devolução ou transição não são alterados.

As telas de leitura DOF/DTC reutilizam o visualizador compartilhado; a prévia
de edição permanece local, automática e sem gravar a cada tecla. Ajustes de
largura, espaçamento, tabelas, abas e ampliação são responsivos, sem alterar
o conteúdo ou a versão do documento emitido.

## Extração automática dos blocos da página 2

**Extração parcial implementada; classificação e cálculo automáticos pendentes.**
A tela permite carregar eventos funcionais e copiar campos de um evento
selecionado para um bloco inativo. O operador escolhe manualmente o destino;
a sugestão contém os campos disponíveis, não classifica eventos, não calcula
períodos/direitos e não é texto oficial. O bloco precisa ser revisado e editado
antes de ser ativado. Eventos sem os campos necessários não são completados
por inferência.

A fonte importável tem tipo textual e campos de data, ato/publicação e
descrição. Ainda não há mapeamento aprovado desses eventos para contratação,
transposição/enquadramento, progressão e complementares, nem fórmulas
aprovadas para os cálculos citados nos blocos. Antes de automatizar
classificação ou cálculo, a área responsável deve validar categorias,
precedência, tratamento de eventos incompletos/conflitantes, dados necessários
e fórmulas aplicáveis. Até lá, manter a escolha manual, a sugestão inativa e
a revisão humana; não gerar texto oficial nem cálculo presumido.

## Verificação e limites

Os testes de interface usam API sintética e dados fictícios. Eles cobrem
elegibilidade da fonte, revisão individual, emissão sequencial, falha parcial,
reuso idempotente no retry e motivos condicionais. Não representam aprovação
institucional dos modelos/regras nem autorizam publicação em produção.
