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
| 5 — DOF | parcial | cálculo, rascunhos cifrados, processo, blocos, prévia provisória, encaminhamento e verificação preliminar; conferência, emissão e PDF ainda não implementados |
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

Na primeira entrega da fatia 5, o cálculo interativo da DOF usa a admissão do vínculo local e o
motor de regra provisória no servidor. A interface permite informar deduções e
incorporações por ano, inclusive períodos com mais de 41 anos; exige confirmar
os valores e informa que os registros da fonte ainda não são carregados
automaticamente. Não grava documento nem modifica a fonte. Testes HTTPS e
PostgreSQL descartáveis verificaram 45 anos, totais, perfis, CSRF, erros,
auditoria e ausência de emissão; a interface foi exercitada separadamente com
API simulada, inclusive paginação e telas de 1366 e 375 pixels. `npm test`
passou com 69 testes, `npm run typecheck` passou e `npm audit` não apontou
vulnerabilidades. O gate da fatia 5 permanece **não cumprido**.

Na continuação da fatia 5, analista e coordenador podem salvar, listar,
reabrir e editar seus próprios rascunhos de DOF. Entradas, resultados,
valores de ajustes e motivos são cifrados; a fonte não é alterada. A revisão
impede sobrescritas concorrentes, a remoção de anos exige confirmação, e a
interface avisa antes de descartar alterações. Mudança da admissão é sinalizada
e uma regra incompatível bloqueia a edição. A migração `004-rascunho-dof` é
aplicada somente pelo setup em banco novo; não há atualização autorizada de
instalação existente.

Os testes direcionados de contratos, PostgreSQL/HTTPS e Playwright passaram
(35 testes); `npm test` passou com 74 testes em oito arquivos,
`npm run typecheck` passou e `npm audit` não apontou vulnerabilidades. Na
execução completa, os máximos locais de consulta foram 26,9 ms para nome,
7,1 ms para CPF, 6,7 ms para matrícula e 56,6 ms para página ampla.
O navegador usa API simulada e dados fictícios; os testes de backend usam
HTTPS com CA e PostgreSQL descartáveis, em execução separada.
Playwright 1.64.1 e Chromium 156.0.8078.4 foram usados nesta máquina. O teste
integrado de navegador com CA operacional e a revisão humana continuam
pendentes. A proteção da admissão durante a gravação foi ampliada e verificada
posteriormente, conforme descrito abaixo.

Na continuação da fatia 5, foram adicionados blocos manuais, versões técnicas
vazias e prévia não oficial. Os blocos são cifrados, ordenáveis e desativáveis;
alterações exigem motivo e usam a revisão do rascunho. A abertura da prévia é
auditada; o conteúdo é escapado e exibido em iframe isolado. Variáveis não
disponíveis são destacadas, mas a conferência que deverá bloqueá-las ainda não
existe. A migração `005-blocos-dof` é aplicada apenas em banco novo.

`npm run typecheck`, `npm test` (78 testes em nove arquivos) e `npm audit`
passaram; a auditoria de dependências não apontou vulnerabilidades. Na
execução completa, a abertura auditada de uma prévia de 45 anos por HTTPS
descartável levou 7,5 ms. Em Chromium com API simulada, o máximo observado em
cinco edições até a exibição foi 33,7 ms com um bloco e 84,7 ms no limite de
200 blocos e 20.000 caracteres. A atualização local não usa rede nem debounce.
São medições locais, sem garantia de capacidade operacional ou integração do
navegador à CA operacional. O bundle principal ainda ultrapassa 500 kB.
O gate da fatia 5 continua **não cumprido**.

Também foi acrescentado o número de processo cifrado e validado por máscaras
explicitamente configuradas, sem formato institucional presumido. Sua
alteração usa motivo e revisão; a remoção requer confirmação. Sem máscara
configurada, inclusão e substituição são bloqueadas. A migração
`006-processo-dof` só é aplicada em banco novo.

`npm run typecheck`, `npm test` (80 testes em dez arquivos) e `npm audit`
passaram; não foram apontadas vulnerabilidades nas dependências. Os testes
incluem configuração ausente, cifra, remoção, permissões e concorrência em
infraestrutura descartável e API simulada. Essa preparação não implementa a
conferência nem autoriza emissão.

O autor agora pode encaminhar um rascunho a um coordenador específico, que o
consulta sem poder editá-lo. Enquanto encaminhado, o conteúdo fica bloqueado
até o autor recolhê-lo com motivo cifrado. O envio permanece em `rascunho` e não
constitui conferência. Os testes direcionados passaram (34 testes em quatro
arquivos), incluindo revogação, papéis, concorrência, gatilhos, auditoria e
navegador com API simulada. A migração `007-encaminhamento-dof` é aplicada
somente em banco novo; não há atualização autorizada de instalações existentes.
`npm test` passou com 84 testes em 11 arquivos e `npm audit` não apontou
vulnerabilidades. Nesta execução, a prévia HTTPS descartável de 45 anos levou
7,7 ms; a atualização local no navegador simulado levou até 84,3 ms no limite
de blocos. O bundle principal continua acima de 500 kB. Essas medições não
substituem integração com a CA operacional nem demonstram capacidade de produção.

Foi adicionada uma verificação preliminar auditada para rascunhos próprios e
encaminhados ao coordenador destinatário. Ela compara identidade, matrícula,
admissão, período e recálculo, processo e variáveis de blocos ativos; informa
pendências e avisos, sem transição de estado. Falta a definição dos campos
obrigatórios e da aprovação institucional do modelo. A verificação posterior
da filiação é descrita abaixo; afastamentos e incorporações da fonte ainda não
são automaticamente confrontados com os lançamentos.

A migração `008-preconferencia-dof` protege a leitura da fonte durante a
consulta com um bloqueio advisory compartilhado; escritas em pessoa e vínculo
obtêm o bloqueio exclusivo antes do comando. Há conflito explícito quando
uma escrita já está em andamento. O bloqueio é global e seu impacto em
importações e sincronização futuras ainda não foi aferido. O setup aplica
essa migração somente em banco novo; instalação anterior não inicia e não há
procedimento autorizado de atualização. A verificação é um retrato pontual:
mudanças posteriores exigem nova consulta.

Os testes direcionados de backend HTTPS/PostgreSQL e navegador com API
simulada passaram (32 testes), incluindo duplicidade concorrente, máscaras,
regra incompatível, erros de integridade e resposta obsoleta. Na execução,
a prévia de 45 anos levou 7,2 ms no HTTPS descartável; as atualizações locais
no limite de 200 blocos e 20.000 caracteres chegaram a 85,0 ms e, com milhares
de delimitadores malformados, a 160,3 ms. Essas medições são locais e não
representam desempenho operacional nem substituem a revisão humana.
`npm run typecheck` passou, `npm test` passou com 88 testes em 12 arquivos e
`npm audit` não apontou vulnerabilidades. Na suíte completa, os máximos
correspondentes foram 8,2 ms, 84,2 ms e 158,1 ms, respectivamente; o bundle
principal ainda excede 500 kB.

O autor pode confirmar expressamente o ajuste de início anterior à admissão,
com revisão, confirmação cifrada e auditoria. Essa confirmação é invalidada
quando o cálculo é editado e não é considerada válida enquanto a admissão da
fonte divergir. Não pode ser alterada em documento encaminhado ou conferido.
Na consulta preliminar, sua ausência permanece um bloqueio; sua presença não
representa conferência nem aprovação. A migração `009-confirmacao-inicio-dof`
é aplicada apenas a banco novo. Não há procedimento autorizado para atualizar
uma instalação existente. Testes direcionados passaram (34 testes em três
arquivos), com permissões, CSRF, cifra, alterações da fonte e concorrência em
PostgreSQL/HTTPS descartáveis e navegador com API simulada. `npm run typecheck`
passou, `npm test` passou com 90 testes em 13 arquivos e `npm audit` não
apontou vulnerabilidades. Na suíte completa, a prévia HTTPS de 45 anos levou
7,8 ms e a atualização local no limite de blocos chegou a 84,9 ms, ou 159,3 ms
com milhares de delimitadores malformados.

A criação e a edição do cálculo também usam o bloqueio advisory compartilhado
da fonte: uma escrita já iniciada em pessoa ou vínculo retorna conflito, e uma
escrita iniciada durante o salvamento aguarda a transação. A edição relê os
dados após obter o bloqueio, sem conceder escrita da fonte à aplicação.
`npm run typecheck` passou e os 22 testes direcionados de PostgreSQL/HTTPS
descartáveis passaram, incluindo as duas ordens de concorrência. A suíte
completa passou com 90 testes em 13 arquivos; `npm audit` não apontou
vulnerabilidades. Nesta execução, a prévia HTTPS de 45 anos levou 7,6 ms; a
atualização no limite de blocos chegou a 84,4 ms, ou 158,3 ms com milhares de
delimitadores malformados. O bloqueio é global, não cobre outras tabelas de
fonte e precisa ter desempenho, falhas e ordenação reavaliados antes de
importação ou sincronização.

A pré-conferência agora verifica a integridade da cifra do nome da mãe e a
validade técnica do texto, sem exibi-lo ou afirmar que corresponde à pessoa.
Campo ausente continua como aviso, e cifra corrompida ou texto inválido geram
bloqueio. O texto protegido usa UTF-8 diretamente no envelope cifrado; a
importação futura deve observar esse contrato. `npm run typecheck` e os
23 testes direcionados passaram em recursos sintéticos descartáveis;
`npm test` passou com 91 testes em 14 arquivos e `npm audit` não apontou
vulnerabilidades. Nesta execução, a prévia HTTPS de 45 anos levou 7,9 ms; a
atualização no limite de blocos chegou a 84,8 ms, ou 156,3 ms com milhares de
delimitadores malformados. Naquela etapa a prévia ainda não exibia o campo;
essa exibição foi acrescentada posteriormente, conforme abaixo.

A prévia provisória passou a mostrar os campos da fonte necessários à DOF,
inclusive CPF integral e nome da mãe, quando disponível, somente ao autor ou
ao coordenador destinatário. A leitura é auditada, protegida contra escrita
concorrente e mantida apenas em memória no navegador; a tela não se atualiza
automaticamente quando a fonte muda. O mesmo resolvedor verifica as variáveis
na pré-conferência. A suíte completa passou (93 testes em 14 arquivos),
incluindo autorização, integridade, escape de HTML, resposta obsoleta e
concorrência. `npm run typecheck` passou e `npm audit` não apontou
vulnerabilidades. Não houve conferência, aprovação de modelo ou emissão.

Nenhum banco, serviço, certificado ou dado real foi alterado. A aplicação não
possui conferência, emissão, importação ou instalação como
serviço; não está pronta para uso operacional. Requisitos de certificado,
conta de serviço, proxy, backup e suporte do sistema operacional permanecem
sem aceite.
Divergências e decisões estão em
[001-regras-e-estado-inicial.md](decisoes/001-regras-e-estado-inicial.md) e
[002-modelo-e-protecao.md](decisoes/002-modelo-e-protecao.md) e
[003-motor-calculo.md](decisoes/003-motor-calculo.md) e
[004-autenticacao.md](decisoes/004-autenticacao.md) e
[005-consulta-servidores.md](decisoes/005-consulta-servidores.md) e
[006-calculo-interativo-dof.md](decisoes/006-calculo-interativo-dof.md) e
[007-rascunhos-dof.md](decisoes/007-rascunhos-dof.md) e
[008-blocos-e-previa-dof.md](decisoes/008-blocos-e-previa-dof.md) e
[009-processo-dof.md](decisoes/009-processo-dof.md) e
[010-encaminhamento-dof.md](decisoes/010-encaminhamento-dof.md) e
[011-preconferencia-dof.md](decisoes/011-preconferencia-dof.md) e
[012-confirmacao-inicio-dof.md](decisoes/012-confirmacao-inicio-dof.md) e
[013-identidade-fonte-dof.md](decisoes/013-identidade-fonte-dof.md) e
[014-dados-fonte-previa-dof.md](decisoes/014-dados-fonte-previa-dof.md).
