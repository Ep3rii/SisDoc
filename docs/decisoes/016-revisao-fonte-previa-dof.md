# Decisão 016 — Comparação da fonte da prévia DOF

## Contexto e escolha

A prévia é pontual: o usuário pode abri-la e verificar as pendências depois
de uma alteração na fonte. A migração `011-revisao-fonte-dof` acrescenta
revisões positivas à pessoa e ao vínculo. Gatilhos iniciam cada revisão em 1
e a incrementam em toda atualização, inclusive sem mudança de valor. Quando
um valor é alterado e depois restaurado, a revisão anterior não é recuperada.
O setup aplica a migração em banco novo; não há procedimento aprovado para
atualizar instalações existentes.

A rota JSON da prévia devolve uma prova HMAC das identidades e revisões do
documento, da pessoa e do vínculo selecionados. A prova é mantida apenas em
memória pelo navegador, não aparece no HTML da prévia nem é incluída na URL ou
nos detalhes da auditoria. Com a prévia aberta, a interface a envia no
cabeçalho `X-Sisdoc-Fonte-Dof` ao consultar a pré-conferência. Cabeçalho
malformado retorna erro 400; uma prova divergente retorna conflito 409
auditado, sem registrar a prova ou dados funcionais em texto. A ausência do
cabeçalho mantém a consulta disponível e resulta em
`fontePreviaValidada: false`; uma comparação bem-sucedida resulta em `true`.

O documento é bloqueado e a fonte é relida sob o bloqueio compartilhado
descrito na [decisão 011](011-preconferencia-dof.md). A consulta retorna
conflito se já houver escrita da fonte em curso. A interface descarta o
resultado quando o documento ou a prova exibida muda, ou quando existem
alterações locais. Fechar a prévia remove a prova da memória da interface.

## Evidência e limites

Testes sintéticos em PostgreSQL/HTTPS descartáveis cobrem provas válidas,
adulteradas, malformadas, de outro documento e obsoletas; alterações e
restauração de valores; atualização sem mudança; fonte ocupada; acesso do
autor e destinatário; auditoria sem CPF nem prova em texto. Em Chromium com API
simulada são exercitados fechamento da prévia e respostas atrasadas.

A comparação vincula somente as revisões da pessoa e do vínculo selecionados e
a revisão do documento. Não cobre outras tabelas da fonte nem comprova que
alguém revisou a prévia. Ela não reserva os dados depois da consulta e não
registra conferência, aprovação ou emissão. Uma futura transição de conferência
deverá revalidar a fonte, os demais dados aplicáveis e o relatório na mesma
transação. As regras e o modelo continuam provisórios.
