# Decisão 003 — Motor de referência e fronteiras

## Perfis e saídas

O pacote `@sisdoc/calculo` é puro: recebe datas, valores e `RegrasVersao`
explicitamente, sem banco, rede ou relógio. O perfil inicial está identificado
como provisório. DOF aplica os excessos acumulados ao exercício de cada ano;
IPAM aplica os excessos ao total do período e preserva as linhas anuais sem
esse abatimento. Comissionado e INSS usam o perfil por período como
inferência, com aviso. O pacote não aprova regras nem libera emissão.

Todos os anos são gerados, com datas civis inclusivas e conversão por bases
configuradas de 365/30. A contribuição não desconta T/S ou P/F; PB, PV e
licença-prêmio entram no total da DOF. As incorporações anuais de outros
documentos são rejeitadas até definição da regra: as referências mostram
campos na capa, mas as fórmulas estão quebradas. A calculadora de incorporação
recebe origem e convenção inclusiva/exclusiva e não alimenta totais sozinha.

O resumo preserva milhar, singular/plural e as omissões da seção 1.4. Zero
resulta em texto vazio; quando não há dias residuais, mantém-se a ausência de
ponto final da planilha. As quatro combinações de PB/PV e licença-prêmio e o
texto dos períodos são cobertos pelos casos dourados.

## Períodos parciais e entradas

Cada ano do intervalo efetivo exige valores explícitos. Dados de um ano civil
completo não são rateados para um ano parcial: se houver valor não nulo, a
entrada deve identificar que os valores foram conferidos para o intervalo
declarado. Intervalos de afastamento podem ser distribuídos por ano com suas
datas exatas; a função não os insere nem os associa automaticamente a um
documento.

Para escopo por vínculo com início posterior à posse, exige-se o acumulado
anterior de T/S e P/F com origem, inclusive quando ambos forem zero. O motor
recusa acumulados incompatíveis com o tempo decorrido e afastamentos que
superem os dias disponíveis; devolve erros/avisos, não valores negativos nem
rateio presumido. A definição administrativa sobre fronteiras e ocorrências
sobrepostas continua pendente.

Início anterior à posse é ajustado à posse e gera aviso que exigirá confirmação
no fluxo. O anexo A.4 aceita fim igual ao início, enquanto a validação antiga
da planilha descreve início estritamente anterior ao fim. Para o motor de
referência foi escolhido permitir um único dia inclusivo, com teste; a
decisão permanece provisória e deve ser confirmada antes da emissão.

## Verificação e limites

Os arquivos em `packages/calculo/casos/` contêm GT-01, GT-REF e GT-02 a
GT-11. Testes com `fast-check` verificam soma anual, conversão e relação entre
contribuição e exercício. Um bundle destinado ao navegador executa o mesmo
motor em contexto JavaScript isolado sem APIs Node; o pacote também é
carregado pelo Node. Isso não substitui testes em navegador real.

GT-08 verifica uma consulta pura de vínculos sintéticos, inclusive ligação
anterior, ausência e ambiguidade. Não é uma API de busca nem comprova a
consulta real, que pertence à fatia 4. Templates, campos obrigatórios,
confirmações, autorizações e aprovação de regras continuam sem implementação.
