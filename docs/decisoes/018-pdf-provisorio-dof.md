# Decisão 018 — Renderização experimental de PDF provisório da DOF

## Contexto e escolha

Sem modelo e regras aprovados, a aplicação continua sem emissão ou download de
PDF. Foi preparado um renderizador **experimental**, chamado apenas pelos
testes, que recebe uma cópia validada da prévia conferida e produz um PDF em
memória explicitamente marcado como provisório e sem validade oficial.
Não existe rota, botão, gravação em disco, reserva de número ou job para esse
renderizador.

A cópia inclui os dados exibidos e a revisão do documento, mas não inclui a
prova HMAC da fonte. A captura valida a identidade e separa os objetos da
prévia; alterações posteriores na entrada não alteram a cópia. Ela **não é
um snapshot persistido ou imutável de emissão**: usa a fonte atual da prévia
conferida, não guarda todos os dados necessários à cópia como rascunho e não
revalida aprovações. Se pessoa ou vínculo tiver mudado desde a conferência, o
aviso também aparece na prévia e no PDF.

O renderizador reutiliza o HTML escapado da prévia, abre um contexto isolado
do Chromium com JavaScript e downloads desabilitados, bloqueia requisições e
encerra o contexto mesmo em caso de falha. O HTML usa também CSP restritiva.
Cada página recebe indicação provisória e número de página; a tabela usa
cabeçalho repetido e evita quebra no interior das linhas. Não há log de dados
ou persistência do conteúdo nesse componente.

O chamador deve fornecer um navegador já iniciado. Os testes usam Playwright
1.64.1 e Chromium 156.0.8078.4 nesta máquina, mas não há inicialização de
worker nem configuração de `PLAYWRIGHT_BROWSERS_PATH` para produção. O HTML
usa fontes do sistema: sua autorização, disponibilidade e reprodução entre
instalações ainda precisam ser resolvidas antes de um PDF oficial. O leitor
PDF.js 6.4.299 é dependência apenas de desenvolvimento, para inspeção dos PDFs
sintéticos.

## Evidência e limites

Com dados inteiramente fictícios, os testes leem o PDF gerado e verificam
formato A4 com tolerância inferior a um ponto, margens, cabeçalhos, rodapés,
as 12 colunas de cada linha dos 45 anos e repetição do cabeçalho nas páginas
da tabela. Também verificam os 200 blocos e 20.000 caracteres permitidos,
texto longo, conteúdo escapado, ausência de requisições, isolamento entre
renderizações simultâneas e falhas de abertura/encerramento. A inspeção de
texto e geometria não substitui revisão visual ou aprovação do modelo.

Em uma execução direcionada com Chromium aquecido, 20 renderizações do caso
de 45 anos em memória tiveram mediana de 278,0 ms, p95 de 291,9 ms e máximo de
300,5 ms. Essa medição **não** inclui fila, transação, gravação, download,
partida fria ou carga operacional; não demonstra o gate de cinco segundos de
solicitação até disponibilidade.

A futura emissão deverá revalidar dados e aprovações, reservar número e
registrar snapshot completo e job na mesma transação; somente depois do
commit poderá gerar, gravar e verificar o PDF, reprocessando a mesma emissão e
o mesmo número. Permanecem pendentes idempotência, formato de número,
aprovação de fontes/template/regra, recuperação de falhas, histórico, cópia,
download auditado e testes integrados. O gate da fatia 5 continua não cumprido.
