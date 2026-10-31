# Regras de cálculo

A evidência detalhada, inclusive a distinção entre `[FÓRMULA]`, `[ESTRUTURA]`
e `[INFERIDO]`, está no [documento de regras](../../Modelos%20e%20Documentação/REGRAS_E_BASES_DE_CALCULO_DOF_DTC.md).
As decisões do prompt não tornam as inferências oficiais.

- Períodos principais usam contagem inclusiva pelo calendário; conversão
  inteira usa ano de 365 e mês de 30 dias. Gerar todos os anos, sem limite fixo.
- Faltas, I/P e outros reduzem contribuição e efetivo exercício. Excessos
  de T/S acima de 730 e P/F acima de 180 reduzem somente efetivo exercício.
- Perfis provisórios: DOF acumula limites no vínculo; IPAM por período;
  Comissionado e INSS usam o perfil IPAM por inferência até decisão.
  A distribuição anual de excesso no IPAM deve preservar o total da planilha,
  que aplica o excesso no total do período.
- A fronteira de afastamentos anteriores a um período parcial no DOF e o uso
  de totais anuais em frações de ano precisam de decisão explícita; não reiniciar
  acumuladores nem ratear silenciosamente.
- DOF soma PB, PV e licença-prêmio à contribuição total. A calculadora auxiliar
  de incorporação da planilha usa fim menos início, sem inclusão do dia inicial,
  e não alimenta automaticamente os totais. Convenção e origem são explícitas.
- O cabeçalho do DOF usa dias brutos e a declaração usa tempo líquido. Referência
  sem hífen produz nível vazio e aviso, sem erro.
- O texto de tempo usa milhar com ponto, plural/singular e omissões conforme
  seção 1.4; zero retorna texto vazio. O ponto final só aparece com dias não
  nulos, salvo decisão e teste de padronização.
- O bloco `DECLARO` segue a ordem e as quatro combinações PB/PV e licença-prêmio
  da seção 2.7. Total de contribuição é a última linha quando aplicável.
- Não reproduzir `7300`, soma limitada à linha 69, erro após admissão em 31/12,
  `#REF!` ou valores de exemplo das planilhas.

Os casos GT-01, GT-REF e GT-02 a GT-11, mais propriedades de soma,
conversão e contribuição maior ou igual ao efetivo exercício, são obrigatórios
conforme a seção 5 do prompt. Nenhuma regra ou template provisório autoriza
emissão operacional.
