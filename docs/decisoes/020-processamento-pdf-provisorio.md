# Decisão 020 — Processamento experimental de PDF provisório

## Contexto e escolha

Foi preparado um processador pós-commit para exercitar a futura fila de PDF,
sem habilitar emissão. Ele não está registrado na aplicação, não inicia um
worker e não possui rota ou botão. Os testes usam apenas diretório e
PostgreSQL descartáveis, conectando-se como proprietário da migração para
criar emissões e jobs inteiramente sintéticos. O papel da aplicação não tem
privilégios para processar jobs ou inserir artefatos. Isso não é uma
instrução para conceder esses privilégios em uma instalação operacional.

O snapshot dos testes é a cópia **provisória** da prévia descrita na
[decisão 018](018-pdf-provisorio-dof.md), cifrada com chave efêmera. Não é o
snapshot completo e aprovado exigido para emissão oficial. A inserção direta
de emissão, número e job pelos testes não implementa reserva transacional,
idempotência, autorização ou auditoria de emissão.

## Processamento e falhas

- Uma transação reivindica um job pendente ou com posse expirada usando
  `FOR UPDATE SKIP LOCKED`, incrementa as tentativas e associa um UUID de
  posse e um prazo. `sem_trabalho` significa que não havia job elegível e
  desbloqueado naquele instante; não prova que toda a fila terminou.
- Após o commit da posse, o processador decifra o snapshot autenticado,
  valida seu contrato e identidade do documento, renderiza e grava o PDF
  conforme a [decisão 019](019-armazenamento-pdf.md).
- O UUID da posse identifica também o arquivo e o artefato daquela tentativa.
  Outra transação bloqueia o job e verifica a mesma posse ainda vigente antes
  de inserir caminho e SHA-256 e concluir o job atomicamente. Uma tentativa
  que perdeu a posse não pode concluir nem sobrescrever a tentativa nova.
- Uma falha só marca o job como `falhou` enquanto a posse continua válida.
  O banco recebe mensagem genérica; a exceção original é propagada ao
  chamador e não pode ser registrada em log sem sanitização. Estado de posse
  inconsistente é informado como erro, não corrigido silenciosamente.
- A perda da resposta de um commit é informada explicitamente. O chamador
  precisa consultar o estado antes de repetir: o commit pode ter concluído o
  job ou deixado uma posse que só será retomada depois de expirar. Os testes
  também cobrem a reversão da transação e retomada do mesmo job e emissão.

`falhou` não é reencaminhado automaticamente; a retomada desse estado foi
simulada por SQL apenas no banco descartável. Não há procedimento operacional
de reprocessamento, observabilidade ou escalonador. A posse não é renovada:
um prazo insuficiente pode provocar trabalho repetido e arquivos órfãos.
Após falha, prazo expirado ou confirmação incerta, pode existir arquivo sem
registro no banco; uma tentativa antiga pode terminar mesmo após perder a
posse. Não há coleta segura de órfãos nem procedimento de recuperação abrupta.
Não se deve apagar arquivos com base apenas na ausência momentânea de
metadados. As limitações de ACL, cifragem, integridade e sistema de arquivos
da decisão 019 continuam válidas.

O processador experimental aceita job de emissão sintética cujo documento já
foi cancelado, preservando seu estado. A aceitação administrativa de PDF
pendente ou cancelamento ainda depende de decisão externa e não foi aprovada.

## Evidência e limites

Os testes verificam invisibilidade antes do commit, snapshot inalterável e
adulterado, identidade divergente, concorrência, expiração da posse, falha de
renderização, falha após publicação e rollback entre inserir artefato e
concluir o job. Também simulam resultado incerto tanto na reivindicação
quanto na conclusão, nos casos em que o commit ocorreu ou foi revertido.
Verificam número e emissão preservados, mensagens sanitizadas e ausência de
privilégios do papel da aplicação. A suíte completa passou com 130 testes em
17 arquivos; a verificação de tipos e `npm audit` também passaram.

Em uma execução direcionada, 20 jobs sintéticos de 45 anos com Chromium
aquecido levaram mediana de 289,3 ms, p95 de 309,5 ms e máximo de 322,6 ms,
da chamada ao processador até o commit do artefato. A medição inclui
reivindicação, renderização, gravação e transação de conclusão, mas não
inclui solicitação HTTP, espera em fila real, partida fria, download ou carga
concorrente. Não comprova o limite ponta a ponta de cinco segundos.

Permanecem pendentes: emissão transacional com número, snapshot completo e
job, idempotência e aprovações; worker operacional com permissões mínimas,
recuperação e limpeza seguras; reserva de nome, download auditado, histórico,
cópia e teste integrado do fluxo. O gate da fatia 5 continua não cumprido e a
aplicação não está autorizada para uso operacional.
