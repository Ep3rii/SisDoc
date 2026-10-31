# Progresso da construção

Fontes ativas: [prompt](../Modelos%20e%20Documentação/PROMPT_CONSTRUCAO_APLICACAO_DOF_DTC.md)
e [regras](../Modelos%20e%20Documentação/REGRAS_E_BASES_DE_CALCULO_DOF_DTC.md).

| Fatia | Estado | Evidência |
|---|---|---|
| 0 — fundação | gate técnico verificado | `npm run setup` e `npm start` em recursos descartáveis; HTTPS com CA e nome verificados; health e página inicial |
| 1 — dados e contratos | gate técnico verificado | migração no banco vazio e em cópia sintética da fundação; contratos, restrições, privilégios e concorrência testados |
| 2 — cálculo | gate técnico verificado | GT-01, GT-REF e GT-02 a GT-11 em JSON; propriedades, regras provisórias e bundle de navegador |
| 3 — autenticação e perfis | gate técnico verificado | matriz negativa nas rotas existentes e criação de administrador por setup; revisão humana e navegador integrado a HTTPS pendentes |
| 4 — consulta de servidores | gate técnico verificado | busca em HTTPS e PostgreSQL descartável com 17.700 vínculos fictícios; interface exercitada com API simulada |
| 5 — DOF | parcial | cálculo de referência por vínculo, com lançamento anual confirmado; rascunho, prévia, emissão e PDF ainda não implementados |
| 6 a 9 — demais documentos e operação | não iniciadas | — |

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

Na fatia 2, o motor puro calcula os perfis provisórios, preserva a diferença
entre aplicação anual e por período, gera textos condicionais e rejeita
entradas ambíguas de períodos parciais. `npm run typecheck` e `npm test`
passaram: 55 testes no total, incluindo os GT e propriedades com
`fast-check`. `npm audit` não apontou vulnerabilidades. A busca de GT-08 é
uma função pura com vínculos sintéticos, não uma consulta operacional.

Na fatia 3, a migração 002, sessões, limites, CSRF, perfis, auditoria e
administração foram exercitados com PostgreSQL e HTTPS descartáveis. Os
testes cobrem mensagens de login, bloqueio por matrícula/IP, expiração,
revogação, concorrência, matriz negativa para as rotas existentes, último
administrador, falhas de infraestrutura, setup e criação por comando.
O fluxo da interface foi exercitado no navegador com API simulada em
1366×768 e 375×812, incluindo troca inicial, criação/edição/redefinição,
auditoria, saída e foco inicial por teclado. Esse teste não valida o fluxo
integrado de navegador com CA operacional. `npm run typecheck`, `npm test`
(64 testes em sete arquivos) e `npm audit` passaram sem vulnerabilidades.
A revisão humana está pendente. A compilação da interface avisa que o bundle
principal excede 500 kB; ainda não foi feita aferição de carregamento em rede.

Na fatia 4, analista, coordenador e secretário adjunto podem consultar nome,
CPF ou matrícula, selecionar uma pessoa e percorrer vínculos e eventos
paginados. O administrador técnico não tem acesso funcional. As consultas são
autorizadas e auditadas, sem termo de busca no registro de auditoria; o CPF
aparece mascarado nos detalhes. A migração `003-consulta` adiciona índices
para vínculos e eventos. O setup a aplica somente em banco novo; não há
procedimento autorizado de atualização de instalação existente.

Em PostgreSQL 16.15 e HTTPS descartáveis, os testes inseriram 17.700 vínculos
exclusivamente fictícios e verificaram a matriz de acesso, CPF mascarado,
vínculos com sufixos, matrícula duplicada, paginação, erros e auditoria. Em
uma execução direcionada, os tempos máximos observados foram 25,2 ms para
nome, 6,2 ms para CPF, 6,5 ms para matrícula e 50,5 ms para páginas de nome
com muitos resultados; cada medição deve ficar abaixo de 1.000 ms. São
medições locais, não uma garantia de capacidade em produção.

A interface foi exercitada no navegador com API simulada e dados fictícios:
resultados vazios, falhas e retentativas, paginação de busca/vínculos/eventos,
sessão expirada, perfis, foco por teclado e larguras de 1366 e 375 pixels.
Foi usado o navegador integrado baseado em Electron 43.8.3 e Chromium
150.0.7871.250. `npm run typecheck`, `npm test` (67 testes em sete arquivos)
e `npm audit` passaram; a auditoria não apontou vulnerabilidades.
Esse teste não substitui navegador integrado ao serviço HTTPS com CA confiável,
revisão de acessibilidade ou revisão humana. O gerador atual atende à aferição
da consulta, mas ainda não cobre todos os cenários necessários à importação
e sincronização da fatia 7.

Na fatia 5, o cálculo interativo da DOF usa a admissão do vínculo local e o
motor de regra provisória no servidor. A interface permite informar deduções e
incorporações por ano, inclusive períodos com mais de 41 anos; exige confirmar
os valores e informa que os registros da fonte ainda não são carregados
automaticamente. Não grava documento nem modifica a fonte. Testes HTTPS e
PostgreSQL descartáveis verificaram 45 anos, totais, perfis, CSRF, erros,
auditoria e ausência de emissão; a interface foi exercitada separadamente com
API simulada, inclusive paginação e telas de 1366 e 375 pixels. `npm test`
passou com 69 testes, `npm run typecheck` passou e `npm audit` não apontou
vulnerabilidades. O gate da fatia 5 permanece **não cumprido**.

Nenhum banco, serviço, certificado ou dado real foi alterado. A aplicação não
possui rascunho, prévia de documento, emissão, importação ou instalação como
serviço; não está pronta para uso operacional. Requisitos de certificado,
conta de serviço, proxy, backup e suporte do sistema operacional permanecem
sem aceite.
Divergências e decisões estão em
[001-regras-e-estado-inicial.md](decisoes/001-regras-e-estado-inicial.md) e
[002-modelo-e-protecao.md](decisoes/002-modelo-e-protecao.md) e
[003-motor-calculo.md](decisoes/003-motor-calculo.md) e
[004-autenticacao.md](decisoes/004-autenticacao.md) e
[005-consulta-servidores.md](decisoes/005-consulta-servidores.md) e
[006-calculo-interativo-dof.md](decisoes/006-calculo-interativo-dof.md).
