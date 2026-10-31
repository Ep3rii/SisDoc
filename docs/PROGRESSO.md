# Progresso da construção

Fontes ativas: [prompt](../Modelos%20e%20Documentação/PROMPT_CONSTRUCAO_APLICACAO_DOF_DTC.md)
e [regras](../Modelos%20e%20Documentação/REGRAS_E_BASES_DE_CALCULO_DOF_DTC.md).

| Fatia | Estado | Evidência |
|---|---|---|
| 0 — fundação | gate técnico verificado | `npm run setup` e `npm start` em recursos descartáveis; HTTPS com CA e nome verificados; health e página inicial |
| 1 — dados e contratos | gate técnico verificado | migração no banco vazio e em cópia sintética da fundação; contratos, restrições, privilégios e concorrência testados |
| 2 — cálculo | não iniciada | — |
| 3 a 9 — fluxos e operação | não iniciadas | — |

O checkout inicial contém as referências e não contém a aplicação demonstrativa
citada no prompt. Node 24.20.0 e npm 11.19.0 foram encontrados; PostgreSQL e
Caddy operacionais não foram encontrados nas verificações iniciais.
`npm test` executou nove testes com PostgreSQL 16.15 descartável em UTF-8,
incluindo recusa de banco ocupado, rollback de ACL, senhas ocultas e HTTPS.
`npm run typecheck`, `npm run build` e `npm audit` passaram. A interface estática
foi aberta no navegador por servidor local temporário; a conexão HTTPS do
backend foi verificada separadamente com CA e nome, sem ignorar erros.

Na fatia 1, os schemas exigidos, a migração transacional, contratos de domínio
e componente de cifra/HMAC foram adicionados. As verificações usam apenas
recursos sintéticos: vínculos, períodos, retenção de staging, rollback,
restrições de acesso, snapshot/auditoria imutáveis e concorrência. `legado`
permanece sem tabelas até o fornecimento do mapeamento oficial. Os caminhos
funcionais que usarão esses componentes ainda não existem; o banco não valida
sozinho se um campo `bytea` foi cifrado. `npm run typecheck` passou e `npm test`
passou com 24 testes, incluindo a migração em PostgreSQL 16.15 descartável.

Nenhum banco, serviço, certificado ou dado real foi alterado. A fundação não
possui autenticação, cálculos, emissão ou instalação como serviço; não está
pronta para uso operacional. Requisitos de certificado, conta de serviço,
proxy, backup e suporte do sistema operacional permanecem sem aceite.
Divergências e decisões estão em
[001-regras-e-estado-inicial.md](decisoes/001-regras-e-estado-inicial.md) e
[002-modelo-e-protecao.md](decisoes/002-modelo-e-protecao.md).
