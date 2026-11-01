# Decisão 025 — Sincronização com a API externa

## Contexto

A fatia 7 (§6.2 item 10 e Anexo A.7 do prompt de construção) exige carga
inicial completa e incremental a partir da API interna de servidores, com
staging cifrado, UPSERT idempotente, remoção lógica segura, disjuntor, aviso
offline e independência total da emissão. A migração `015-importacao` (já
existente) criou `nucleo.sincronizacao_estado` e as permissões mínimas do papel
do aplicativo: sem `DELETE` em dados pessoais, `DELETE` em staging só para
expurgo permitido pelo trigger `staging_retencao`.

## Decisão

### Contrato e configuração

- `packages/contratos/src/sincronizacao.ts` define o contrato fictício da API
  (página `{itens, proximo_cursor, gerado_em}` com até 50 itens; servidor com
  `id`, `alterado_em`, CPF validado, dados pessoais e 1–20 vínculos com
  identificadores e matrículas únicos) e os contratos internos: situação, lote,
  erro sanitizado e pedido de início.
- O bloco opcional `sincronizacao` na configuração externa traz origem, URL,
  arquivo de token (caminho absoluto fora do repositório, validado como
  `listaSenhas`), limites (aviso 24 h, timeout 10 s, página ≤ 50), intervalo
  periódico opcional, pausa do disjuntor e mapeamento de nomes de campos. A URL
  real e o token nunca entram no Git.

### Cliente HTTP

- `fetch` com `AbortSignal.timeout`, sem seguir redirecionamentos, corpo
  limitado a 10 MB, token Bearer lido do arquivo e validado.
- Até 3 repetições para rede, tempo limite, 5xx e 429, com espera crescente
  (`esperaRepeticaoMs · 2ⁿ`) ou `Retry-After` (recusado acima de 60 s).
  401/403, outros 4xx, JSON inválido e violação do contrato não são repetidos.
- Erros são mensagens fixas; nada da resposta é ecoado.

### Processamento

- Cada item é gravado cifrado em `nucleo.staging_api` (AAD com o id da linha)
  e aplicado numa transação curta por servidor, com `SAVEPOINT`: um item
  inválido vira erro `{posição, referência HMAC de 16 hex, motivo}` sem dados
  pessoais e não aborta os demais.
- UPSERT por `(sistema_origem, id_origem)` comparando `hash_conteudo` (HMAC de
  `hashConteudo('sincronizacao', …)`): sem mudança, nada é gravado e
  `revisao_fonte` não muda. Pessoa sem origem conhecida é associada pelo
  `cpf_hash` (a fonte prevalece) ou inserida com campos pessoais cifrados.
  Divergência de CPF, vínculo pertencente a outro servidor ou mudança de
  matrícula de vínculo existente são erros do item (o papel não altera
  `cpf_*` nem `matricula_norm`).
- O lote guarda o cursor `{proximo, marco, desde, fim}` após cada página. Um
  lote que falhou é retomado pela próxima execução do mesmo tipo em até 24 h.
  O `marco` (o `gerado_em` da primeira página) vira `cursor_incremental` ao
  concluir e é enviado como `alterado_desde` na incremental.
- Remoção lógica só na carga completa, depois de todas as páginas lidas: a
  reconciliação decifra o staging do lote e marca `removido_na_fonte_em` em
  origens e vínculos não vistos. Ela é suspensa (com motivo no lote) se houver
  item sem identificador, nenhum servidor, ou ausências acima de 10 registros
  e 20% dos ativos. Vínculos de servidores cujo item veio inválido são
  preservados. Reaparecimento na fonte desfaz a marca. Nada é apagado.
- Execução exclusiva por origem: verificação em memória e
  `pg_try_advisory_lock` de sessão. Lotes órfãos em `processando` são marcados
  como `falhou` (retomáveis) na próxima preparação.
- Disjuntor persistido em `nucleo.sincronizacao_estado`: 5 execuções
  consecutivas com falha abrem o disjuntor; durante a pausa (padrão 15 min) o
  início é recusado com 409 acionável e auditado; depois, uma tentativa
  (meia-abertura); sucesso zera o contador. Interrupção por encerramento do
  serviço não conta como falha.
- Expurgo do staging após cada conclusão: apenas linhas processadas há mais
  de 30 dias de lotes concluídos (o trigger reforça a regra).

### API e interface

- `POST /api/v1/admin/sincronizacoes` (202) e `GET /api/v1/admin/sincronizacoes`
  exigem a ação `administrar_sincronizacao` (admin); `GET
  /api/v1/sincronizacao/situacao` usa `consultar_situacao_sincronizacao` (todos
  os perfis). Início, recusa, conclusão, falha e consulta são auditados com
  detalhes mínimos (tipo, retomada, agendada).
- Execução periódica incremental apenas com `intervaloMinutos`, desativável por
  `SISDOC_SINCRONIZACAO_AGENDADA=desligado`.
- A web mostra a última sincronização no cabeçalho dos perfis funcionais, um
  aviso não bloqueante nos painéis após o limite e a tela administrativa
  "Sincronização" com lotes, erros e início confirmado.

### Testes

`tests/sincronizacao.test.ts` usa PostgreSQL embarcado descartável e a API
simulada `tools/api-simulada/servidor.ts` (loopback, porta aleatória, dados
100% fictícios). Cobre carga completa, idempotência, incremental, 429,
timeout e repetições, remoção só após reconciliação completa e retomada,
erros sanitizados, staging cifrado e expurgo, disjuntor, permissões,
configuração ausente e a emissão de DTC com a API bloqueada.

## Consequências e limitações

- Afastamentos, incorporações, eventos funcionais e períodos IPAM não são
  sincronizados; não há sincronização individual (`tipo = 'servidor'`).
- `sincronizado_em` reflete a última mudança aplicada, não a última verificação;
  a pré-conferência pode avisar dados antigos mesmo com sincronização em dia.
- Até 200 erros por lote são guardados; ao retomar uma página, `lidos` pode
  contar itens repetidos.
- O staging de lotes que falharam e foram abandonados não é expurgado
  automaticamente.
