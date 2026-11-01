# Decisão 028 — Legado operacional e conferência de importação

## Escopo aprovado

O responsável aprovou o fluxo Legado → prévia/mapeamento → validação →
confirmação → Núcleo. A carga de dados reais permanece sujeita a confirmação
posterior, após a conferência do relatório; a autorização de implementação
não é autorização de carga.

Todos os perfis autenticados consultam dados de trabalho completos, sem
mascaramento por perfil. Login, cifra em repouso, auditoria, CSRF e permissões
de alteração, emissão, exportação e exclusão permanecem independentes.
Dados completos não são gravados em logs ou metadados de auditoria.

## Mapeamento e limites

A base cadastral DOF/DTC possui 18 campos canônicos, documentados em
[dados e importação](../DADOS_E_IMPORTACAO.md#dados_funcionais).
Colunas extras permanecem na planilha original, sem inferência automática de
significado. As 18 colunas não substituem frequência, atos funcionais,
incorporações nem períodos contributivos.

O assistente oferece os cinco tipos existentes, sugestão de mapeamento com
os sinônimos já aceitos, prévia das primeiras 20 linhas com valores completos,
validação das colunas obrigatórias e rejeição de posições repetidas/ausentes.
Campos não mapeados não são inventados. Afastamentos podem usar ano ou intervalo.

## Consolidação e conflitos

O lote original permanece cifrado no schema Legado. A conversão usa o
importador canônico e mantém pessoa por CPF e vínculo por origem/matrícula.
Preenche campos cadastrais vazios e conserva os valores existentes, inclusive
edições manuais. Divergências são indicadas por linha/campo/referência para
conferência e revisão no cadastro local, com motivo e auditoria; não existe
uma fila de resolução automática de conflitos. Referências complementares
existentes são preservadas integralmente quando divergem.

Validação simula a gravação em transação e desfaz tudo. Aplicação exige uma
assinatura HMAC vinculada à sessão, lote, mapeamento e estado das pessoas/vínculos
sob locks. Alteração entre validar e aplicar exige nova validação.
Períodos IPAM usam digest com identificadores/datas/`xmin` e lock protegido,
pois suas alterações não incrementam a revisão cadastral da pessoa.
Linhas rejeitadas e em quarentena não são aplicadas; a confirmação informa
isso expressamente. As demais linhas são aplicadas atomicamente.

O hash da conversão considera lote original, tipo, mapeamento e política;
repetir uma aplicação concluída não cria duplicados. A auditoria registra o
identificador do lote Legado no lote canônico, sem valores pessoais.
Documentos emitidos mantêm seus snapshots.

O relatório da tela é limitado a mil ocorrências e informa a quantidade fora
da prévia. **Baixar todas as ocorrências em XLSX** revalida sem gravar e inclui
o relatório completo, com referências pessoais; o arquivo deve ficar protegido.
Não serve como backup. Downloads excedendo 64 MB são recusados explicitamente.

## Operação pela tela

1. Faça backup antes da primeira carga real da origem.
2. Em **Importação**, selecione **Legado**, escolha arquivo e origem,
   valide e confira os cabeçalhos antes de guardar o lote.
3. Em **Disponibilizar Legado para DOF e DTC**, selecione lote e conteúdo.
4. Confira a prévia e o mapeamento; colunas não usadas permanecem no Legado.
5. Clique **Validar conversão**. Confira válidos, quarentena, rejeições,
   divergências e baixe todas as ocorrências quando necessário.
6. Somente após autorização da carga real, clique **Aplicar no Núcleo**
   e confirme a aplicação das linhas aceitas.
7. Confira os servidores por matrícula e os dados completos antes de criar
   documentos. Corrija divergências na fonte ou no cadastro local com motivo.

Os seletores continuam escolhendo schemas do banco local, não conexões externas.
Esta etapa não abre acesso pela rede nem instala serviço automático.
