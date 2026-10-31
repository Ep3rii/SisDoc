# Decisão 008 — Blocos e prévia provisória de DOF

## Contexto e escolha

O modelo oficial limpo e aprovado ainda não está disponível. Em vez de
inventar texto institucional, a migração `005-blocos-dof` registra versões
técnicas **vazias** para contratação/nomeação, transposição/enquadramento,
progressão e complementares. O editor permite adicionar várias ocorrências,
ordenar, ativar/desativar e escrever texto livre. Não existe ainda
administração de versões ou catálogo oficial aprovado.

Os blocos pertencem ao rascunho próprio. Seu texto é cifrado com contexto do
registro; o ajuste registra antes/depois e motivo cifrados. A gravação exige
revisão e bloqueio transacional do documento; leitura da revisão e dos blocos
usa bloqueio compartilhado. A ordem é única ao final da transação, permitindo
trocas. Blocos já salvos não podem ser apagados: podem ser desativados e
permanecem no registro de ajustes. A conta da aplicação não pode modificar
versões ou apagar blocos. A transição de estado posteriormente acrescentada
exige evento correspondente, conforme a [decisão 017](017-conferencia-provisoria-dof.md).

Os limites técnicos são 200 blocos, 8.000 caracteres por bloco e 20.000 no
total. Esses limites não representam validação de modelo oficial. O servidor
valida o mesmo contrato, exige motivo, não aceita identificadores duplicados
ou alteração de tipo de bloco já salvo e rejeita alterações obsoletas.

`GET documentos/:id/previa` devolve HTML da revisão salva, com autenticação,
autoria ou encaminhamento, auditoria, `no-store` e CSP que proíbe recursos
externos e aplica `sandbox`. A interface consulta os dados da fonte pela rota
auditada `GET documentos/:id/dados-previa`, confere a revisão e usa o mesmo
renderizador puro para refletir imediatamente os blocos locais em `iframe
sandbox` sem permissões. A abertura é auditada; cada tecla na prévia local não
é um evento de auditoria, e alterações só são registradas ao salvar. O cálculo
exibido é sempre o resultado salvo, não um cálculo pendente. Os cuidados com
identidade e leitura da fonte estão na
[decisão 014](014-dados-fonte-previa-dof.md).

Conteúdo e valores são escapados como texto. São substituídas apenas as
variáveis exibidas pela interface; nomes não disponíveis são destacados. O
renderizador não fornece todos os campos e formatos previstos no prompt. A
verificação preliminar detecta variáveis ausentes ou malformadas e a
conferência provisória posterior bloqueia essas pendências. A prévia tem indicação de ausência
de validade e não é template institucional, aprovação, conferência ou emissão.

## Evidência e limites

Os testes de software usam dados e infraestrutura descartáveis. A cobertura
inclui permissões, CSRF, autoria, cifra, alterações auditadas, concorrência,
troca de ordem, leitura durante bloqueio de escrita, entrada no limite,
HTML escapado e variáveis desconhecidas. Em Chromium com API simulada, a
medição de edição até o conteúdo aparecer no iframe inclui atualização React e
renderização do documento de 45 anos; não há debounce ou transporte na edição
local. A abertura HTTPS auditada é aferida separadamente. Os resultados são
locais e não garantem desempenho sob carga ou em produção.

Na execução completa, a abertura auditada de 45 anos por HTTPS descartável
levou 7,5 ms, e a maior das cinco edições no limite de 200 blocos e 20.000
caracteres até aparecer no iframe levou 84,7 ms. O navegador simulado não
comprova integração à CA operacional. Numeração, snapshot, PDF, histórico, edição administrativa
de modelos e reconhecimento de todas as variáveis continuam pendentes. Não
existe autorização para emissão ou uso operacional.
