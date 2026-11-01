# API externa simulada (amostras 100% fictícias)

Amostras do contrato esperado da API de servidores usada pela sincronização (fatia 7). Nenhum dado é real:
nomes, matrículas e documentos são inventados; os CPFs são gerados com dígitos verificadores válidos a partir de
índices sintéticos (mesmo algoritmo de `tools/anonimizar/fixtures.ts`).

- `pagina-exemplo.json`: uma página com `itens`, `proximo_cursor` (opaco; `null` na última página) e `gerado_em`.
  O terceiro item é **propositalmente inválido** (CPF com dígito verificador errado e nenhum vínculo) para mostrar que
  um item rejeitado vira erro sanitizado sem abortar os demais.

Contrato (validado por `servidorApiSincronizacaoSchema` e `paginaApiSincronizacaoSchema` em `@sisdoc/contratos`):

- `GET <url>?limite=1..50[&cursor=<opaco>][&alterado_desde=<ISO 8601>]`, com `Authorization: Bearer <token>`.
- `alterado_desde` é inclusivo e é enviado apenas na sincronização incremental.
- Nomes de campos diferentes podem ser traduzidos por `sincronizacao.mapeamento` na configuração externa.

O servidor simulado usado nos testes fica em `tools/api-simulada/servidor.ts` e só escuta em `127.0.0.1`.
