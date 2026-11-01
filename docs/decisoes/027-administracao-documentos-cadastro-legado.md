# Decisão 027 — Administração de documentos, Cadastro e planilhas legadas

## Alteração autorizada

Em 31/10/2026 o responsável alterou o uso do administrador:

- Não criar DOF/DTC nem reabrir emissões como cópia. Continua autorizado a
  visualizar, editar, conferir e emitir documentos existentes.
- Apagar fisicamente documentos e PDFs, inclusive emitidos, com confirmação
  explícita. A auditoria permanece e a numeração não volta a ficar disponível.
  Exclusão física não é cancelamento e não deve ser usada como substituto
  da anulação administrativa de uma declaração já entregue.
  Cópias já baixadas, impressas ou presentes em backups não são removidas
  por essa ação.
- Editar dados de servidores no núcleo local, independentemente da origem,
  com motivo e auditoria, sem atualizar diretamente o banco externo.
- Sincronização volta a tratar apenas da API. Importação e exportação ficam
  juntas na tela Importação.

As regras de acesso anteriores da decisão 026 ficam superadas somente nesses
pontos. A aprovação formal por modelo, revisão, sessão e CSRF continuam
necessárias.

A migração `017-documentos-admin` introduz a exclusão controlada e a fila
persistente de retentativas. O usuário administrador deve informar motivo
de ao menos 15 caracteres, revisão atual e confirmação
`EXCLUIR DOCUMENTO <UUID>`. O PDF é removido por helpers de armazenamento
protegido antes da remoção dos registros. Falhas ficam pendentes para o
worker; cópias dependentes impedem a exclusão.

A migração `018-edicao-cadastro` habilita a edição local de pessoa/vínculo
com revisão concorrente, CPF validado/cifrado e motivo em auditoria cifrada.

## XLSX para o legado

A recepção descrita abaixo foi complementada pela
[decisão 028](028-legado-operacional-e-conferencia.md): lotes guardados
podem ser mapeados, validados e aplicados ao Núcleo por confirmação na tela.
Guardar um lote, isoladamente, continua sem alimentar as declarações.

O responsável solicitou preservar os cabeçalhos da planilha já pronta, sem
fornecer DDL ou nomes de tabelas. Por isso a migração `019-planilhas-legado`
cria uma área de recepção no schema **legado**, não tabelas arbitrárias
inferidas a partir do arquivo:

- `legado.planilha_lote`: origem, cabeçalhos, contagem, hash SHA-256 do arquivo,
  usuário e data.
- `legado.planilha_linha`: número e valores por posição, cifrados com as
  chaves da instalação. Os dados não entram em logs ou no Git.
- Os cabeçalhos e valores textuais lidos do CSV/XLSX são preservados. Não se
  preservam fórmulas, estilos, macros, múltiplas abas ou o arquivo Excel em si;
  a leitura continua usando a primeira aba.
- Cabeçalhos vazios, repetidos, muito longos e células adicionais sem
  cabeçalho são rejeitados, sem descartar dados silenciosamente.
- Limites: 64 MB, 100 mil linhas e 256 colunas. A gravação é atômica e repetir
  o mesmo arquivo/origem não cria outro lote.
- A validação não grava. O relatório informa cabeçalhos e número de linhas;
  a gravação pela tela exige validar o mesmo arquivo/schema/origem antes.
- A exportação do legado escolhe o lote e reproduz os cabeçalhos/valores em
  CSV ou XLSX. CSV com células interpretáveis como fórmulas é recusado.
- **Importar no legado não disponibiliza automaticamente os servidores na
  busca, edição ou declarações.** Isso exige converter/mapeá-los para o
  núcleo; armazenar uma planilha não prova que seu schema real foi mapeado.

Os seletores são de **schema dentro do banco local**, não de conexão externa.
O destino Núcleo mantém as regras canônicas (CPF, matrícula, consolidação,
quarentena, anomalias e formatos existentes).

## Teste pela interface com a planilha real

1. Abra `https://localhost:3443/` e entre como administrador.
2. Vá a **Importação** e selecione **Schema de destino → Legado**.
3. Informe uma origem técnica, como `planilha-cadastro`.
4. Escolha seu XLSX local. Não envie o arquivo pelo chat nem faça commit.
5. Clique **Validar arquivo** e confira cabeçalhos, linhas e eventuais erros.
6. Se a leitura estiver correta, clique **Gravar importação** e confirme o
   destino. Registre o identificador do lote.
7. Na mesma tela, use **Exportação → Legado**, selecione o lote e baixe em
   XLSX para conferir os valores em ambiente autorizado.

Não foi aberto nem importado automaticamente qualquer arquivo pessoal do
responsável. Os testes automatizados usam apenas planilhas fictícias.
