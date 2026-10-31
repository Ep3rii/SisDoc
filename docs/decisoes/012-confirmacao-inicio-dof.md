# Decisão 012 — Confirmação do início ajustado à admissão

## Contexto e escolha

Quando o início solicitado precede a admissão, o cálculo usa a admissão como
início efetivo. Além do aviso de cálculo, o autor do rascunho deve confirmar
explicitamente esse ajuste antes de uma futura conferência. O coordenador
destinatário pode ler a confirmação, mas não alterá-la; um rascunho
encaminhado precisa ser recolhido antes de qualquer confirmação.

A confirmação armazena cifrados o início informado, a admissão utilizada, o
identificador do autor e o instante. A operação incrementa a revisão e é
auditada sem gravar as datas no detalhe de auditoria. Somente a confirmação
referente ao início e à admissão do resultado salvo é considerada válida, e
apenas enquanto a admissão da fonte coincidir com a utilizada no cálculo.
Toda edição do cálculo remove a confirmação, exigindo nova manifestação;
alterações de processo ou blocos não a removem. A pré-conferência reavalia a
fonte, pois a confirmação não reserva os dados contra mudanças posteriores.

O documento é bloqueado antes da operação e a leitura da fonte é protegida pelo
bloqueio transacional da decisão 011. Se uma escrita da fonte já estiver em
curso, a API retorna conflito sem confirmar. O banco também rejeita alteração
da confirmação enquanto o documento estiver encaminhado ou fora de
`rascunho`. A migração `009-confirmacao-inicio-dof` é aplicada apenas pelo
setup em banco novo; não existe procedimento aprovado de atualização de
instalação existente.

## Evidência e limites

Testes em PostgreSQL e HTTPS descartáveis cobrem CSRF, perfis, autoria,
revisões concorrentes, fonte ocupada ou divergente, cifra e invalidação após
edição. A interface foi exercitada em navegador com API simulada e dados
fictícios. A confirmação não valida o restante do documento, não constitui
conferência nem aprovação institucional e não habilita emissão.
