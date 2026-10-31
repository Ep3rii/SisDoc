# Decisão 014 — Dados da fonte na prévia de DOF

## Contexto e escolha

Para permitir futura conferência humana, a prévia provisória mostra os campos
da referência já disponíveis na fonte: nome, matrícula, CPF, nascimento,
nome da mãe, regime, cargo, nível, referência, órgão e admissão. O CPF é
exibido integralmente apenas nessa consulta funcional autorizada, pois é um
campo do documento; a busca e os detalhes da pessoa permanecem mascarados.
O nível usa o motor compartilhado e, quando a referência não tem hífen, fica
vazio com aviso. A prévia identifica também vínculo removido e divergência
entre a admissão atual e a utilizada no cálculo.

O autor ou o coordenador destinatário abre a prévia auditada; outros usuários
não recebem esses dados. A rota HTML e a rota JSON usada pela interface
validam a identidade protegida e mantêm bloqueios de leitura do documento e
da fonte até a conclusão da consulta. Se a fonte estiver sendo escrita ou a
identidade estiver inconsistente, a abertura retorna conflito explícito.
Nenhum CPF ou nome da mãe é incluído nos detalhes da auditoria ou na URL.
As respostas são `no-store`; a interface mantém os dados somente em memória,
rejeita uma resposta de outra revisão e fecha a prévia quando a revisão muda.

O mesmo resolvedor é usado pela prévia e pela verificação preliminar das
variáveis; dados e conteúdo dos blocos são escapados. O iframe permanece
isolado por `sandbox` e a prévia não representa layout oficial. A fonte é um
retrato pontual: alterações após a abertura não são atualizadas automaticamente.
A comparação das revisões da prévia com a verificação preliminar é descrita na
[decisão 016](016-revisao-fonte-previa-dof.md). Ela não comprova revisão humana
nem substitui a revalidação atômica da
[conferência provisória](017-conferencia-provisoria-dof.md).

## Evidência e limites

Testes com PostgreSQL/HTTPS descartáveis cobrem acesso por autor e
destinatário, negação aos demais perfis, identidade corrompida, fonte ocupada,
releitura após bloqueio concorrente e cifra. Os detalhes de auditoria não
contêm CPF ou filiação em texto. Testes de
Chromium com API sintética cobrem HTML escapado, ausência de
scripts e imagens injetadas, rejeição de resposta obsoleta e prévia interativa.
Os dados da fonte não são automaticamente confrontados com os lançamentos de
afastamentos ou incorporações. Não há PDF ou aprovação de modelo; a
conferência é provisória e a emissão operacional permanece bloqueada.
