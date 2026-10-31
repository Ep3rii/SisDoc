# Decisão 019 — Gravação experimental de PDF

## Contexto e escolha

Para preparar o futuro worker sem autorizar emissão, foi criado um componente
de armazenamento chamado apenas por testes sintéticos. Ele recebe uma pasta
absoluta previamente controlada, um UUID de artefato e bytes de PDF. O nome
interno é `<uuid>.pdf`: não usa caminho, CPF ou matrícula fornecidos pelo
usuário. Essa identificação interna não substitui a futura reserva do nome
de download descrita na [decisão 018](018-pdf-provisorio-dof.md).

O componente rejeita raízes de volume e junções na pasta ou no arquivo
consultado. Cria um temporário exclusivo na mesma pasta, grava e sincroniza
seu conteúdo, fecha o arquivo, relê e compara SHA-256 e tamanho. Publica com
hard link sem sobrescrever o destino e remove o temporário. Leituras exigem
um SHA-256 esperado e rejeitam divergência. O controle reconhece apenas
cabeçalho e terminador de PDF; ele não substitui um leitor ou a revisão do
conteúdo. Os testes também abrem o arquivo gerado usando PDF.js.

Uma nova tentativa com o mesmo UUID de artefato e **bytes iguais** reconhece o arquivo
existente; bytes diferentes produzem erro, sem sobrescrita. A limpeza que
falha depois da publicação informa que o resultado pode já estar gravado.
Isso não demonstra recuperação completa do worker: renderizações repetidas
podem produzir bytes diferentes mesmo a partir do mesmo conteúdo. Após uma
falha incerta, o futuro worker precisará reconciliar o artefato e o hash
confiável do banco, sem reservar outra emissão ou número.

O arquivo não é cifrado por este componente nem se torna imutável perante
outros processos com permissão de escrita; o hash permite detectar alterações.
A pasta deve ter ACL restrita e ser controlada pelo serviço. A verificação de
junções usa `lstat` e não é atômica em relação a alterações por outro processo
com acesso de escrita à pasta; ela não substitui essa ACL. Hard links e os
testes foram verificados em NTFS local. A sincronização cobre o arquivo, mas
a persistência do nome após perda de energia e outros sistemas de arquivos
não foram validados. Temporários órfãos após interrupção abrupta também
precisam de procedimento de recuperação.

## Evidência e limites

Em diretórios temporários próprios, os testes verificam gravação e releitura,
SHA-256, rejeição de caminho e junção, concorrência com bytes iguais e
diferentes, arquivo alterado, escrita parcial, falha de sincronização,
falha de publicação e falhas de limpeza. Não há uso de diretórios ou dados
operacionais. Uma medição direcionada de 20 renderizações aquecidas de 45
anos, incluindo gravação e verificação local, observou mediana de 302,6 ms,
p95 de 317,2 ms e máximo de 317,7 ms.

O processador da [decisão 020](020-processamento-pdf-provisorio.md) registra
artefatos apenas em banco descartável. Não há worker iniciado, reserva de
nome, download auditado ou integração com a transação de emissão. A medição
acima não inclui fila, transação ou partida fria e não comprova o limite ponta
a ponta de cinco segundos. Aprovações, snapshot oficial e numeração permanecem
pendentes; o gate da fatia 5 continua não cumprido.
