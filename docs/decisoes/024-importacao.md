# Decisão 024 — Importação de dados reais

## Contexto

A fatia 7 exige importação por linha de comando e por tela, idempotente,
auditada e reversível, dos arquivos das planilhas DOF/DTC e de uma base
legada em PostgreSQL cujo esquema ainda não foi recebido (prompt §6.2–6.3 e
anexo A.7). A aplicação não tem `DELETE` em dados pessoais e os dados
sensíveis são cifrados (AES-GCM) com `cpf_hash` HMAC.

## Decisão

- **Migração `015-importacao`**: amplia `nucleo.importacao_lote` (tipo,
  `sistema_origem`, canal, contagens, conclusão, status `processando`,
  `concluido`, `falhou`, `desfeito`) e cria `nucleo.importacao_registro`
  (tabela, chave, ação e estado anterior em JSON de cada linha gravada). O
  papel da aplicação tem só INSERT nessa tabela; leitura e rollback exigem o
  papel de migração.
- **Núcleo único** (`apps/api/src/importacao/`): `planilhas.ts` lê CSV e XLSX
  sem dependências novas; `formatos.ts` mapeia cabeçalhos (sinônimos,
  `ADMISSAO` duplicada como `EXPEDICAO`), valida, normaliza e classifica as
  ocorrências; `importador.ts` grava em transação única, sob bloqueio
  consultivo, e é usado pela CLI, pela tela e pelo legado.
- **Dry-run por padrão**: a validação executa a gravação dentro da
  transação e faz `ROLLBACK`, para que as contagens (inseridos, atualizados,
  inalterados, matrícula inexistente) sejam as reais.
- **Idempotência** em dois níveis: SHA-256 do arquivo por (tipo, origem) e
  `hash_conteudo` HMAC por registro.
- **Consolidação**: pessoa por CPF; vínculo por (origem, matrícula); dados
  divergentes do mesmo CPF mantêm a primeira linha e são reportados.
- **Rollback LIFO** com o estado anterior gravado, recusado quando há lote
  posterior, emissão para servidor afetado ou referência por chave
  estrangeira (inclusive auditoria).
- **Legado**: mapeamento JSON (campo canônico → coluna), senha por variável
  de ambiente ou arquivo fora do repositório, leitura `REPEATABLE READ READ
  ONLY` e verificação prévia das colunas em `information_schema`. YAML não
  foi adotado para não acrescentar dependência; JSON atende ao requisito.
- **Tela**: `admin/importacoes` com corpo `application/octet-stream` (até
  64 MB), ação `administrar_importacao` (perfil admin); a gravação só é
  liberada depois da validação do mesmo arquivo.

## Pendências

1. O esquema real da base legada não foi recebido; o mapeamento de exemplo
   é ilustrativo.
2. Corte de 2019, matrículas reaproveitadas e totais anuais em períodos
   parciais dependem de decisão da área responsável.
3. A importação não remove registros ausentes do arquivo (só a
   sincronização faz exclusão lógica, após reconciliação completa).

## Consequências

- Instalações existentes precisam de `npm run build` e `npm run migrar`
  (aplica `015-importacao`); a API recusa iniciar sem ela.
- `tests/importacao.test.ts` cobre CSV/XLSX, BOM, `ADMISSAO` duplicada,
  dry-run, gravação, idempotência, consolidação por CPF, rollback LIFO e
  recusas, demais tipos, conferência, rotas e perfis, legado com coluna
  faltante e 20 mil vínculos.
