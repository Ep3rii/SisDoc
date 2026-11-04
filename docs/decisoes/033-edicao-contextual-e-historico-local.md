# Decisão 033 — Edição contextual, notificações e histórico local

## Escolha autorizada

O responsável aprovou a execução do [plano de evolução](../PLANO_EVOLUCAO_NUCLEO.md),
com dois escopos distintos:

- **Ajustar nesta declaração:** padrão nos editores DOF/DTC, persistido na
  entrada cifrada da declaração, com revisão/motivo/auditoria. Não escreve
  no cadastro nem em fontes externas. Remover o ajuste restaura a referência
  canônica. Analista, coordenador e administrador respeitam o estado e os
  bloqueios existentes; encaminhamento DOF ativo continua impedindo edição.
- **Corrigir cadastro local:** ação separada, somente do administrador
  conforme decisão 027. Requer revisão, motivo e confirmação do alcance.

O cadastro apresenta sugestões derivadas dos ajustes salvos na declaração,
identificadas por vínculo, documento e revisão. Apenas divergências com o
cadastro atual são exibidas. A sugestão não é aplicada automaticamente,
continua consultável após emissão/cancelamento e desaparece quando deixa de
divergir ou quando o ajuste é removido. Exclusão física autorizada do
documento também remove sua sugestão derivada; não existe cópia independente.

Os valores efetivos participam de cálculo, prévia, conferência e snapshot.
CPF/matrícula ajustados não trocam a identidade pessoa/vínculo e não
reconciliam duplicidades. Fonte íntegra e provas de revisão continuam exigidas.
Snapshots/PDFs emitidos permanecem imutáveis.

## Prévias e notificações

O motor puro e os templates são compartilhados entre API e navegador.
A prévia de edição reage ao formulário, sem gravar a cada tecla; entradas
inválidas mostram pendências, não totais antigos. A prova de conferência é
obtida da revisão/fonte salvas, nunca do HTML local. Não há dados pessoais
em storage do navegador. Zoom, proporção e ampliação não alteram a emissão.

Os círculos nas abas **Encaminhados** e **Retornos** contam declarações
pendentes de ação, não visualizações não lidas. Abrir a lista não zera o
contador. Encaminhados respeitam destinatário/coordenador e acesso global do
administrador. Retornos pertencem ao autor (todos para administrador), após
devolução por terceiro ou devolução de conferido DOF/DTC, sem encaminhamento
ativo ou exclusão pendente. Uma nova gravação do documento atende o retorno.
Contagem não se limita à página carregada; atualiza após escritas, foco e
a cada 30 segundos. Falha de consulta é visível, não substituída por zero.

## Importação e histórico

- Núcleo reutiliza recepção protegida/mapeamento/promoção do Legado no mesmo
  assistente. CSV/XLSX continuam aceitos; XLSX admite seleção explícita de aba.
- XML aceito é o perfil SisDoc versão 1, não qualquer XML de folha.
  Estrutura e limites em [Dados e importação](../DADOS_E_IMPORTACAO.md).
- Histórico por pessoa/vínculo separa fatos funcionais (férias, licenças,
  abono pecuniário, abono de permanência e outros) de lançamentos financeiros.
  Não calcula direitos, tributos, saldos legais ou folha.
- Valores são strings decimais exatas; somas usam centavos inteiros.
  Previsto/informado/pago/estornado são estados distintos. Estorno exige
  pagamento do mesmo vínculo, mesmo valor/natureza e não pode ser duplicado;
  pagamento estornado não admite alteração incompatível.
- Conteúdo/revisões são cifrados; revisões append-only guardam antes/depois,
  motivo, autoria e data. Importações preservam lote/linha e origem/id;
  divergências não sobrescrevem correções manuais. Relações usam IDs de
  registros já existentes do mesmo vínculo, sem associação heurística.
- Consulta segue `consultar_pessoa`; escrita/importação/exportação de
  histórico permanecem administrativas. XLSX exportado inclui metadados de
  rastreabilidade; não é modelo de reimportação direta.

A migração `025-historico-servidor` é obrigatória para o novo backend.
Instalação limpa e atualização usam a mesma sequência de migrações.
Publicação operacional exige backup verificado e autorização própria;
aprovação de templates v2 continua independente.
