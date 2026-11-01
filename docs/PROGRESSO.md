# Progresso da construção

## Modularização — etapa 6: sincronização — 01/11/2026

Módulo separado em coordenação do lote, mapeamento puro e persistência por
item. Mantidos locks, cliente transacional, savepoints, staging cifrado,
retomada, paginação, disjuntor e limites de remoção lógica.
**34/34 funções/métodos/construtores e arrows nomeadas** dessas unidades
com JSDoc específico.

Corrigido bug de mapeamento parcial que descartava campos canônicos de
vínculo sem alias. Cinco testes puros verificam aliases, dados inválidos,
zeros de matrícula e preservação de campos. Falhas técnicas antes ocultas
agora têm logging sanitizado, sem valores pessoais ou credenciais.

Typecheck aprovado; suíte completa **230/230 testes em 30 arquivos**.
Sem migração, sincronização real ou configuração externa habilitada.
A revisão integral permanece aberta nos demais serviços/helpers, DOF,
templates, telas restantes, CLI/setup/ferramentas e funções dos testes.

## Modularização — etapa 5: importador e falhas transacionais — 01/11/2026

Importador decomposto em coordenação, estado, gravação, relatório,
conferência e rollback. Imports da interface, Legado, CLI e testes
atualizados diretamente. **25/25 funções declaradas/arrows nomeadas**
dessas unidades com JSDoc específico. Mantidos cliente único por operação,
locks, cifra, idempotência, preenchimento de vazios e rollback LIFO.

Corrigidas falhas ocultas de rollback e registro de lote. Erro no commit
agora sinaliza resultado incerto, sem afirmar reversão nem registrar lote
falso de falha; a interface descarta conexão incerta. Manual explica que
o operador precisa conferir a situação antes de repetir. Oito novos testes
injetam falhas sem abrir conexão real.

Typecheck aprovado; suíte completa **225/225 testes em 29 arquivos**.
Nenhuma migração ou carga de dados operacionais. As demais unidades
continuam em revisão; não declarar a revisão integral concluída.

## Revisão/JSDoc — etapa 4: cálculo e funções dos contratos — 01/11/2026

Motor, calendário, histórico de vínculos, textos e funções nomeadas dos
contratos lidos e documentados. Nenhuma regra, validação ou saída alterada.
Varredura AST incluindo arrows nomeadas: **20/20 funções no cálculo** e
**14/14 nos contratos** com JSDoc. Typecheck aprovado; **61 testes em três
arquivos** passaram. Cobertura documental não representa nova aprovação
dos modelos nem conclusão da revisão dos demais módulos.

## Modularização — etapa 3: consulta e cálculo DTC — 01/11/2026

Serviço DTC decomposto em cálculo puro, consulta/validação da fonte e
coordenação transacional. JSDoc específico cobre todas as funções nomeadas
dessas unidades. Consultas usam o protetor e cliente da transação existente;
revisões, locks, auditoria, conferência, aprovação, idempotência, numeração,
snapshot e job PDF permanecem compatíveis.

Resultado pós-transação compartilhado entre DTC, DOF e emissões, mantendo
auditoria de falhas esperadas antes de lançar a resposta HTTP. Mensagem de
aprovação deixou de depender de rascunhos DOF. Helper de decifração textual
movido para segurança, retirando dependência Cadastro → Exportador.
Proteção de dados e exportador documentados após leitura.

Typecheck aprovado; suíte completa **217/217 testes em 28 arquivos**,
com quatro novos casos de tradução do resultado e regressões de integração
e navegador. Sem migrações ou dados operacionais alterados.
Revisão integral ainda pendente nas demais unidades, conforme
[ARQUITETURA.md](ARQUITETURA.md).

## Modularização — etapa 2: interface por domínio — 01/11/2026

Interface reorganizada em aplicação, autenticação, infraestrutura,
componentes compartilhados, administração, cadastro, DOF, DTC, documentos
e transferência. Transporte HTTP separado de sete clientes tipados;
fachada pública e comportamento das requisições preservados.

Cadastro e DTC decompostos em componentes coesos de busca, lista, detalhe,
referências, eventos, editor e documento. Entrada React reduzida à montagem.
JSDoc específico nas unidades revisadas, sem comentários automáticos genéricos.
Estado dos formulários, prévias salvas, confirmação de saída, autorizações,
CSS e contratos preservados. Nenhuma migração ou carga de dados reais.

Typecheck e build web aprovados; **30/30 testes em quatro suítes de navegador**.
Prévia no limite de 45 anos/200 blocos/20.000 caracteres abaixo de 175 ms
nos cenários sintéticos. Serviços maiores, editor DOF, transferência,
pacotes e demais funções continuam na revisão; etapa 2 não é conclusão integral.

## Modularização — etapa 1: composição da API — 01/11/2026

Revisão estrutural do grafo local de todos os fontes e testes, sem ciclos
locais identificados. Diagnóstico, invariantes e limites da revisão em
[ARQUITETURA.md](ARQUITETURA.md). Não é revisão semântica de todas as
funções: serviços de domínio, interface, pacotes, CLI e ferramentas seguem
pendentes nas etapas posteriores.

AppModule agora compõe módulos de infraestrutura, segurança, servidores,
cálculos, documentos, importação e sincronização. Serviços ficam privados
por domínio; pool/configuração são os únicos exports globais. Health
movido para infraestrutura, com seu teste atualizado. Encerramento do pool
é tipado e ocorre após a destruição dos workers. Rotas, política de acesso,
transações e comandos operacionais preservados; nenhuma migração ou
gravação de dados reais necessária.

JSDoc adicionado às funções da composição, bootstrap, configuração,
transações, diagnóstico e tratamento de erros, além das referências dos
tokens. A documentação de todas as funções ainda não está concluída.

Build e typecheck aprovados. Suíte completa: **213/213 testes, 27 arquivos**.
Novos testes verificam injeção de todos os controllers, guarda única,
exports restritos e encerramento dos workers antes do pool; integração
HTTPS/banco existente também passou.
Etapa publicada na instalação local: health e página HTTPS 200, consulta
privada sem sessão 401 e listener somente em loopback, após reinício.

## Prioridades de UI/UX e correção CSP — 01/11/2026

Transferência dividida em Importar, Disponibilizar Legado, Exportar e
Histórico, com teclado e estado preservado. Filtros, contagens, limpeza e
atualização padronizados em oito listas; seu alcance é somente a lista
carregada, sem ampliar o escopo autorizado. Alterações pendentes em
formulários de exclusão são protegidas ao trocar filtros.

Cadastro dividido em identificação/contato, documentos e vínculo, com
seleção automática do vínculo escolhido na lista. Grupos recolhíveis
organizam referências, vínculos, períodos e cargos DTC; documentação INSS
separada de licenças e confirmações. Ações destrutivas foram separadas
visualmente das principais, preservando motivos e autorização. Mensagens
antigas de emissão indisponível na DOF foram corrigidas.

CSP da página autoriza apenas os hashes SHA-256 dos estilos fixos DOF/DTC.
Sandbox e bloqueio de scripts/CSS arbitrário preservados; sem novas rotas,
migrações ou gravações operacionais. 51 testes direcionados aprovados
(incluindo revalidação focada de 9 testes de transferência/listas),
build e typecheck aprovados. Cobertura inclui CSP real em prévias,
três tipos DTC, estado entre abas, teclado, transferência em 375 px,
filtros e confirmação de saída com formulário pendente.

API e frontend publicados juntos; aplicação reiniciada em loopback,
health e página HTTPS 200, política com os dois hashes confirmada.
Na página compartilhada, a prévia DOF exibiu a cor e a fonte esperadas,
com sandbox sem permissões; não foram alterados documentos reais.
Avaliação e operação atualizadas; propostas adicionais continuam opcionais.

## Prévias persistentes e densidade — 01/11/2026

DOF salva/reaberta carrega a prévia automaticamente e recarrega a cada
revisão, sem exigir abrir/fechar. DTC mantém a prévia da revisão salva
durante a edição. Tabelas, controles anuais e painéis foram compactados,
preservando dados completos e alvos móveis de 44 px. 25 testes de navegador
passaram, incluindo persistência entre abas, respostas antigas descartadas,
DTC em edição e tamanho dos campos anuais; build e typecheck aprovados.
Frontend publicado na instalação existente, com health e página 200.

A [avaliação por tela](AVALIACAO_UI_UX.md) registra sugestões não implementadas
e a pendência visual da CSP, resolvida no ajuste registrado acima. A prévia disponível não equivale a
conferência ou emissão autorizada.

## Senhas, destinatários e organização do menu — 01/11/2026

Senhas de usuário exigem 10 caracteres em contratos, API, setup, CLI e
interface; Argon2id, lista de senhas comuns e sessões permanecem.
Coordenadores ativos são os únicos novos destinatários de encaminhamentos;
administradores ficam fora da seleção e envios diretos são recusados na API
e no banco, mantendo sua consulta global e revisão.

Menu do administrador: Administração primeiro (Usuários, Importação e
exportação, Sincronização, Auditoria), seguido de Cadastro de pessoas, DOFs,
DTCs e Documentos emitidos. Dados completos continuam acessíveis aos perfis
autenticados. Veja [operação](OPERACAO.md#senhas-encaminhamentos-e-menu).

Build/typecheck aprovados; 34 testes focados passaram e verificações adicionais
de migração/setup passaram (5 casos), além de 3 casos revalidados para setup
com senha exatamente de 10 caracteres e recusa de envio por analista e
coordenador. Backup confirmado; migração `022-destinatario-coordenador`
aplicada e produção reiniciada com health/página 200 em loopback.

Fontes ativas: [prompt](../Modelos%20e%20Documentação/PROMPT_CONSTRUCAO_APLICACAO_DOF_DTC.md)
e [regras](../Modelos%20e%20Documentação/REGRAS_E_BASES_DE_CALCULO_DOF_DTC.md),
[guia descritivo](../Modelos%20e%20Documentação/guia_descritivo_declaracoes_funcionais_e_tempo_contribuicao.md)
e [protótipo visual](../Modelos%20e%20Documentação/prototipo_SistemaWEB.jpeg).

## Plano aprovado: Legado operacional e interface — 31/10–01/11/2026

Concluídos o assistente Legado → prévia/mapeamento → validação assinada →
confirmação → Núcleo, a preservação de valores existentes/edições manuais
com divergências explícitas e o download completo de ocorrências em XLSX.
A base cadastral possui 18 campos; informações extras permanecem no lote
Legado e não são inferidas como frequência ou períodos contributivos.
Veja [decisão 028](decisoes/028-legado-operacional-e-conferencia.md).

Busca de servidores abre uma lista paginada por matrícula natural crescente,
preservando zeros e texto, com desempate por origem e UUID. CPF e referências
são completos para todos os perfis autenticados, sem ampliar permissões de
alteração/exportação. O editor DTC oferece PB/PV/licença-prêmio e a prova de
revisão incorpora períodos IPAM e detecta mudanças concorrentes.

**Validação:** 204 casos verificados em 25 arquivos. Na execução completa
final de produto, 202 passaram; duas expectativas de sequência/contagem de
migrações foram corrigidas e revalidadas pelos testes focados (emissão 11/11;
sequência 1/1). Build e `npm run typecheck` passaram. O ensaio HTTPS com
64 sessões por perfil e mistas completou 960 requisições sem erros, com p95
entre 3,57 e 3,75 segundos e máximo de 4,15 segundos nessa execução conjunta;
não reutilizar a medição anterior de aproximadamente 0,7 segundo como
resultado desta versão. Não mede emissão de PDFs concorrentes.

**Implantação:** backup `pg_dump -Fc` confirmado; migrações
`020-listagem-servidores` e `021-revisao-periodos-ipam` aplicadas. Produção
reiniciada em `https://localhost:3443/`, health e página 200, rotas novas 401
sem sessão e escuta exclusiva em loopback. Conferências DTC com a prova antiga
exigem reconferência; PDFs emitidos permanecem imutáveis.
Nenhuma carga real foi aplicada ao Núcleo pelo agente: depende da conferência
e confirmação posteriores do responsável. Fatias 8–9 continuam como extras.

| Fatia | Estado | Evidência |
|---|---|---|
| 0 — fundação | gate técnico verificado | `npm run setup` e `npm start` em recursos descartáveis; HTTPS com CA e nome verificados; health e página inicial |
| 1 — dados e contratos | gate técnico verificado | migração no banco vazio e em cópia sintética da fundação; contratos, restrições, privilégios e concorrência testados |
| 2 — cálculo | gate técnico verificado | GT-01, GT-REF e GT-02 a GT-11 em JSON; propriedades, regras provisórias e bundle de navegador |
| 3 — autenticação e perfis | gate técnico verificado | matriz negativa nas rotas existentes e criação de administrador por setup; revisão humana e navegador integrado a HTTPS pendentes |
| 4 — consulta de servidores | gate técnico verificado | busca em HTTPS e PostgreSQL descartável com 17.700 vínculos fictícios; interface exercitada com API simulada |
| 5 — DOF | gate técnico verificado | fluxo completo até PDF, histórico, cópia e cancelamento com aprovação sintética e caso de mais de 41 anos (`tests/emissao.test.ts`); emissão operacional bloqueada até aprovação formal |
| 6 — DTCs | gate técnico verificado | DTC IPAM, Comissionado e INSS com PDFs dos quatro tipos sem corte nos máximos (4 períodos, 3 cargos) em `tests/dtc.test.ts`; template INSS provisório |
| 7 — importação e sincronização | em andamento | — |
| 8 e 9 — operação | pacote extra | somente após autorização do responsável |

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
disponíveis são destacadas; naquela entrega ainda não havia conferência. A
migração `005-blocos-dof` é aplicada apenas em banco novo.

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
validade técnica do texto, sem afirmar que corresponde à pessoa.
Naquela etapa, campo ausente gerava aviso, e cifra corrompida ou texto inválido
geravam bloqueio. A conferência provisória posterior passou a bloquear também
a ausência. O texto protegido usa UTF-8 diretamente no envelope cifrado; a
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
vulnerabilidades. Naquela etapa não havia conferência, aprovação de modelo ou emissão.

O coordenador destinatário pode devolver o rascunho não conferido com motivo
cifrado, visível apenas ao autor. A operação encerra o encaminhamento, cria
nova revisão e não altera o status para conferido. A leitura do motivo e a
devolução são auditadas sem o texto nos detalhes; conflitos, identidade do
destinatário e concorrência com recolhimento são tratados explicitamente.
Essa operação não substitui a devolução posterior de documento conferido. A
migração `010-devolucao-dof` só é aplicada em banco novo; não há procedimento
aprovado para atualização de instalação existente. `npm run typecheck` e a
suíte completa passaram (95 testes em 14 arquivos); `npm audit` não apontou
vulnerabilidades. Os testes cobrem autorização, cifra, motivo inválido,
revisão, concorrência e a interface com dados sintéticos. A prévia HTTPS de
45 anos levou 11,7 ms; no navegador simulado, a atualização no limite dos
blocos chegou a 87,3 ms, ou 167,7 ms com delimitadores malformados.

A prévia aberta fornece uma prova autenticada das revisões do documento, da
pessoa e do vínculo selecionados; a verificação preliminar a compara quando
presente e informa conflito se elas mudaram. Sem prévia, a verificação continua
disponível sem essa comparação. A migração `011-revisao-fonte-dof` incrementa
as revisões a cada atualização e é aplicada apenas em banco novo. A prova não
representa conferência nem revisão humana e não cobre outras tabelas da fonte.
Os testes direcionados passaram (46 testes em cinco arquivos), incluindo
PostgreSQL/HTTPS descartáveis e navegador com API simulada. `npm run typecheck`
e a suíte completa passaram (98 testes em 14 arquivos); `npm audit` não apontou
vulnerabilidades. Nesta execução, a prévia HTTPS de 45 anos levou 11,5 ms; a
atualização no limite dos blocos chegou a 86,6 ms, ou 158,6 ms com
delimitadores malformados.

Analista ou coordenador pode conferir provisoriamente um rascunho próprio, e
o coordenador destinatário pode conferir o encaminhado. A confirmação exige
prévia vinculada, revisão humana expressa e revalidação transacional da fonte,
do relatório e dos bloqueios. Seis campos da referência ausentes bloqueiam a
conferência como medida conservadora, sem presumir aprovação institucional. O
coordenador autor ou destinatário pode devolver o conferido com motivo cifrado;
o evento anterior permanece imutável. A lista e a prévia usam a fonte atual,
não um snapshot. A migração `012-conferencia-dof` só é aplicada em banco novo.
Foram verificados 46 testes direcionados com PostgreSQL/HTTPS descartáveis e
navegador com API simulada. `npm run typecheck` e `npm test` passaram, com
102 testes em 14 arquivos; `npm audit` não apontou vulnerabilidades. Na suíte
completa, a abertura HTTPS da prévia de 45 anos levou 13,2 ms e a atualização
local no limite dos blocos chegou a 87,9 ms, ou 163,1 ms com delimitadores
malformados. O bundle principal continua acima de 500 kB. A implementação e
seus limites estão na [decisão 017](decisoes/017-conferencia-provisoria-dof.md).

Foi preparado um renderizador experimental de PDF provisório, ainda sem rota,
botão, armazenamento ou emissão. Os testes leem PDFs inteiramente sintéticos,
verificam as 12 colunas de cada linha de 45 anos, cabeçalhos repetidos,
paginação, margens e os limites de 200 blocos e 20.000 caracteres; cobrem
isolamento e falhas do navegador. Em 20 renderizações aquecidas em memória,
a mediana foi 278,0 ms, o p95 291,9 ms e o máximo 300,5 ms. A medição não
inclui fila, gravação ou download e não comprova o requisito ponta a ponta.
Fontes autorizadas, snapshot persistido, número, job, histórico e aprovação
institucional continuam pendentes; detalhes na
[decisão 018](decisoes/018-pdf-provisorio-dof.md). A suíte completa passou com
110 testes em 15 arquivos, e `npm audit` não apontou vulnerabilidades. Na
execução completa, as 20 renderizações aquecidas em memória tiveram mediana
de 290,6 ms, p95 de 301,8 ms e máximo de 304,7 ms.
Um formatador separado prepara nomes seguros para os quatro tipos e aceita
sufixos de colisão explícitos, sem gravar arquivos. A busca e reserva
atômica de nomes e a recuperação de colisões continuam não implementadas. A
suíte completa posterior passou com 118 testes em 16 arquivos.

Um componente experimental grava PDFs sintéticos em diretórios temporários,
por UUID, sem sobrescrever e com conferência de SHA-256. Testes verificam
concorrência, alterações no arquivo, escrita parcial e falhas de publicação e
limpeza. A medição direcionada de 20 renderizações aquecidas com gravação e
verificação local teve mediana de 302,6 ms, p95 de 317,2 ms e máximo de
317,7 ms; não inclui fila ou transação. Não há worker, gravação operacional
ou recuperação integrada. A ACL, os limites de persistência e as pendências
estão na [decisão 019](decisoes/019-armazenamento-pdf.md). A suíte completa
passou com 129 testes em 17 arquivos; nela, as 20 renderizações com gravação
tiveram mediana de 299,9 ms, p95 de 316,5 ms e máximo de 327,9 ms.

Um processador experimental reivindica jobs sintéticos após commit, valida e
decifra a cópia provisória, grava o PDF e conclui o job e o artefato em uma
transação. Foram testados concorrência, perda de posse, falhas de disco e de
transação, confirmações incertas e retomada da mesma emissão em PostgreSQL
descartável. Em 20 jobs aquecidos de 45 anos, a execução direcionada teve
mediana de 289,3 ms, p95 de 309,5 ms e máximo de 322,6 ms da chamada do
processador ao commit do artefato. Não inclui transporte ou espera em fila e
não comprova o limite ponta a ponta. O processador não está ligado à aplicação,
não inicia worker e pode deixar arquivos órfãos; a recuperação segura e o
reprocessamento operacional de falhas permanecem pendentes. A identidade da
posse agora é o UUID do artefato interno. Detalhes e demais limites na
[decisão 020](decisoes/020-processamento-pdf-provisorio.md). `npm test`
passou com 130 testes em 17 arquivos; `npm run typecheck` passou e
`npm audit` não apontou vulnerabilidades.

O processador também possui reagendamento interno experimental para jobs
falhos. A mesma emissão e o mesmo número são preservados; chamadas simultâneas,
estados inconsistentes, conclusão concorrente e confirmação incerta foram
testados em banco descartável. Não há rota, autenticação ou auditoria para
esse método, e o estado concluído do banco não comprova o arquivo em disco.
Um reprocessamento operacional autorizado e auditado ainda não foi implementado.
A suíte completa voltou a passar com 130 testes em 17 arquivos.

Até essa etapa, nenhum banco, serviço, certificado ou dado real havia sido alterado.

## Preparação dos componentes locais — 31/10/2026

Foi instalado o PostgreSQL 16.15-5 com o instalador oficial da EDB, após
verificação do hash e da assinatura e autorização para criar o serviço Windows.
O serviço `postgresql-x64-16` inicia automaticamente como `NetworkService`.
O instalador configurou inicialmente a escuta em todas as interfaces; ela foi
restringida a `127.0.0.1:5432` e o serviço foi reiniciado. A autenticação local
usa `scram-sha-256`. A conexão sem senha foi recusada e uma consulta autenticada
confirmou PostgreSQL 16.15, codificação UTF-8 e endereço local.

Foram confirmados Node 24.20.0, npm 11.19.0, dependências npm e Chromium
156.0.8078.4. `npm test` passou com 130 testes em 17 arquivos e
`npm run typecheck` passou. Após a instalação, os 25 testes de
`node scripts\executar-testes.cjs tests\fundacao.test.ts` também passaram.
Esses testes usam PostgreSQL e demais recursos descartáveis, não o serviço
instalado; eles não validam a aplicação integrada ao banco permanente.

O [suporte regular do Windows 10 Pro 22H2](https://learn.microsoft.com/en-us/lifecycle/products/windows-10-home-and-pro)
terminou em 14/10/2025. Não foi verificada a cobertura por atualizações de
segurança estendidas; o suporte aplicável deve ser confirmado antes do uso
operacional.
Até esta preparação dos componentes, não haviam sido criados banco ou papéis do SisDoc, certificado, configuração
`SISDOC_CONFIG` ou serviço da aplicação. O proxy permanece sem decisão e sem
integração. A preparação do PostgreSQL não equivale à instalação do SisDoc
nem autoriza seu uso operacional. A inicialização e a autorização posteriores
estão registradas abaixo.

A aplicação não possui emissão, importação ou instalação como serviço. O uso
operacional das funções existentes foi autorizado em 31/10/2026
([decisão 021](decisoes/021-autorizacao-operacional.md)); certificado local
autossinado foi aceito por não haver acesso externo. Conta de serviço, proxy,
backup e suporte do sistema operacional permanecem pendentes.
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
[014-dados-fonte-previa-dof.md](decisoes/014-dados-fonte-previa-dof.md) e
[015-devolucao-rascunho-dof.md](decisoes/015-devolucao-rascunho-dof.md) e
[016-revisao-fonte-previa-dof.md](decisoes/016-revisao-fonte-previa-dof.md) e
[017-conferencia-provisoria-dof.md](decisoes/017-conferencia-provisoria-dof.md) e
[018-pdf-provisorio-dof.md](decisoes/018-pdf-provisorio-dof.md) e
[019-armazenamento-pdf.md](decisoes/019-armazenamento-pdf.md) e
[020-processamento-pdf-provisorio.md](decisoes/020-processamento-pdf-provisorio.md) e
[021-autorizacao-operacional.md](decisoes/021-autorizacao-operacional.md).

## Inicialização local e layout — 31/10/2026

Após a configuração do PostgreSQL, foram provisionados o banco `sisdoc`
em UTF-8 e os logins separados `sisdoc_migracao` e `sisdoc_app`, sem
privilégios administrativos. As credenciais ficaram protegidas fora do
checkout; o login da aplicação não recebe as credenciais de migração.

Foi configurado HTTPS direto em loopback com certificado folha autossinado,
não emissor de CA, para `localhost` e `127.0.0.1`, válido até 31/10/2027.
A confiança em `LocalMachine\Root` foi instalada mediante autorização
expressa para todos os usuários Windows, além da confiança do Node.
Não foram desativados TLS, validação de certificados ou controles de sessão.

Somente depois dessas etapas, o setup foi inicializado com confirmação
interativa. Aplicou 13 migrações até `012-conferencia-dof`, criou um
administrador ativo com troca obrigatória de senha e a configuração externa
em `C:\ProgramData\SisDoc\instalacao`. O banco tem **zero pessoas**:
nenhum dado real ou fictício foi importado. A lista externa de senhas comuns
foi instalada com a licença MIT do SecLists preservada.

O backend foi iniciado manualmente em **https://localhost:3443/**. Foram
verificados certificado confiável no Windows, página inicial, health 200,
sessão não autenticada 401 e escuta exclusiva em `127.0.0.1`.
O PostgreSQL tem serviço automático; **a aplicação ainda não tem serviço
Windows**. O primeiro login e a troca de senha deverão ser feitos pelo
responsável, sem compartilhar a senha.

O editor DOF foi reorganizado conforme o protótipo: menu lateral escuro
por perfil, busca global, dados em cartões, cinco abas acessíveis, prévia
auditada independente da aba e barra inferior com totais e salvamento.
DTCs, histórico e emissão continuam claramente indisponíveis. A admissão
não foi rotulada como posse/exercício e as deduções não incluem
incorporações indevidamente. Troca de abas preserva valores e a busca
global confirma antes de descartar edições.

Os 16 testes de interface de rascunhos passaram, incluindo regressão do
layout em duas colunas, teclado, prévia entre abas, cancelamento de busca,
menu móvel e ausência de overflow horizontal em 375 pixels.
O novo teste também verifica os quatro totais exatos com faltas e
incorporação PB, e a limpeza de dados integrais ao fechar a prévia.
A comparação visual foi feita com dados inteiramente fictícios em API
simulada, não no banco instalado. Em uma execução direcionada, os máximos
edição-exibição foram 39,4 ms para 45 anos, 99,0 ms no limite de blocos e
174,2 ms com delimitadores malformados. Não são garantia operacional.

Foram preparados [README](../README.md),
[instalação local](INSTALACAO_LOCAL.md), [operação](OPERACAO.md) e contexto
de construção. A autorização operacional solicitada foi recebida como
intenção do responsável, mas emissão, importação, DTCs, edição cadastral
exclusiva da declaração, backups, serviço, suporte de segurança e aceite
institucional permanecem pendentes. As máscaras de processo estão ausentes.
O gate da fatia 5 continua parcial; próximos passos detalhados na
documentação da instalação.

`npm run typecheck` passou e `npm test` passou com **131 testes em 17
arquivos**, usando recursos descartáveis. O aviso preexistente de bundle
frontend acima de 500 kB continua; não foi ocultado nem tratado como falha.

## Autorização operacional — 31/10/2026

O responsável autorizou expressamente o uso operacional da instalação local
(`https://localhost:3443/`). A autorização, seu escopo e os recursos ainda
indisponíveis estão na [decisão 021](decisoes/021-autorizacao-operacional.md).
A interface passou a indicar a autorização; novas instalações continuam
iniciando sem autorização até registro próprio do responsável.

## Fatia 5 concluída — emissão da DOF — 31/10/2026

Implementada a emissão da DOF de ponta a ponta, condicionada à aprovação
formal da regra e do template ([decisão 022](decisoes/022-aprovacao-formal-e-emissao.md)):

- migração `013-emissao`: `documentos.aprovacao_modelo` (imutável, gravável
  só pelo papel de migração), `documentos.emissao_aprovacao` (vínculo imutável
  da emissão à aprovação usada) e GRANTs de coluna mínimos ao papel da
  aplicação para numeração, emissão, jobs/artefatos de PDF e cancelamento;
- `npm run migrar` (atualização idempotente de instalação existente) e
  `npm run aprovar-modelo` (interativo, confirmação `APROVAR DOF`, auditado);
- `POST /api/documentos/:id/emitir` (coordenador, `Idempotency-Key`,
  revalidação de conferência, fonte e regra, `FOR UPDATE` na numeração,
  snapshot cifrado), worker de PDF iniciado com a API com reprocessamento no
  mesmo número, template oficial sem marca de prévia, download auditado,
  histórico, cópia como rascunho e cancelamento com motivo cifrado;
- interface: **Emitir DOF** em DOFs conferidas para coordenador, estado e
  download do PDF, tela **Histórico** habilitada, cópia e cancelamento.

`tests/emissao.test.ts` cobre, com aprovação sintética em banco descartável:
bloqueio sem aprovação, perfis, idempotência concorrente, numeração
sequencial concorrente, PDF gerado para caso com mais de 41 anos de serviço,
falha e reprocessamento com o mesmo número, worker automático, nomes de
colisão, download auditado, histórico por perfil, cópia, cancelamento e
`migrar` sobre banco com 13 migrações.

`npm run typecheck` passou e `npm test` passou com **140 testes em 18
arquivos**. **Nenhuma aprovação foi registrada na instalação local**: a
emissão operacional permanece bloqueada até a validação formal pela área
responsável. A instalação local precisa de `npm run build` e
`npm run migrar` antes de reiniciar com esta versão. DTCs, importação, backup
e serviço Windows continuam pendentes.
## Fatia 6 concluída — DTC IPAM, Comissionado e INSS — 31/10/2026

As três DTCs funcionam de ponta a ponta, do rascunho ao PDF, ao histórico, à
cópia e ao cancelamento. A migração `014-dtc` e a
[decisão 023](decisoes/023-dtc-ipam-comissionado-inss.md) registram o desenho.
Cada tipo exige aprovação formal própria. O template INSS sai marcado como
**MODELO PROVISÓRIO** até o recebimento dos textos oficiais.

Na finalização, dois testes antigos foram ajustados ao novo comportamento:

- o job de PDF de DTC agora registra o evento `conferencia_dtc` antes de
  passar o documento a conferido;
- o item **DTC IPAM** do menu passou a ficar habilitado.

`npm test` passou com **148 testes em 19 arquivos**.

Complemento DTC: editor preserva e permite PB/PV/licença-prêmio anuais;
cálculo e snapshot mantêm valores não zero com aviso provisório. A prova
específica inclui os períodos IPAM e fica cifrada no evento imutável de
ajuste da revisão conferida. Bloqueio SHARE/NOWAIT mantém a fonte estável
até o commit; alteração posterior invalida conferência/emissão, inclusive
com prévia renovada. Conferências anteriores sem prova completa precisam
ser devolvidas e reconferidas. Migração `021-revisao-periodos-ipam` instala
helper SECURITY DEFINER restrito, sem ampliar UPDATE; setup e gate da API
exigem 021. INSS provisório e
proibição de administrador criar/copiar permanecem inalterados.
Validação focada do complemento: cálculo/editor **37/37** e integração DTC
**18/18**, incluindo papel real, prova antiga/nova e escritas IPAM
concorrentes. Build API e typecheck dos testes passaram. Sem deploy.

A instalação local foi atualizada, com backup `pg_dump` prévio, por
`npm run migrar`, que aplicou `014-dtc`. A aplicação foi reiniciada em
`https://localhost:3443/`. Nenhuma aprovação de DTC foi registrada.

## Fatia 7 concluída — importação, legado e sincronização — 31/10/2026

- **Importação** (CLI `npm run importacao` e tela **Importação**, admin):
  CSV/XLSX dos cinco tipos, dry-run por padrão, quarentena/rejeição/
  duplicadas/divergências/anomalias com CPF mascarado, consolidação por CPF,
  idempotência por hash do arquivo e por registro, transação única, rollback
  LIFO, conferência `npm run importacao:conferir` com amostra mascarada e
  modelos sintéticos em `referencias/modelos-importacao/`
  ([decisão 024](decisoes/024-importacao.md),
  [DADOS_E_IMPORTACAO.md](DADOS_E_IMPORTACAO.md)).
- **Base legada**: mapeamento JSON configurável; falha clara se faltar coluna.
  O esquema real ainda não foi recebido.
- **Sincronização** com API simulada (`tools/api-simulada/`): carga completa
  e incremental, staging, `hash_conteudo`, exclusão lógica após reconciliação
  completa, disjuntor e aviso offline; a emissão não depende da API
  ([decisão 025](decisoes/025-sincronizacao.md)). Só servidores e vínculos
  são sincronizados.
- Migração `015-importacao`: o papel da aplicação passa a ter INSERT/UPDATE
  por coluna nas tabelas do núcleo; DELETE continua negado.
- 20 mil vínculos importados em segundos no teste. `npm test` passou com
  **166 testes em 21 arquivos**; `npm run typecheck` passou.

## Implantação da fatia 7 e aprovações formais — 31/10/2026

A instalação local foi atualizada com backup `pg_dump` prévio e
`npm run migrar` (aplicou `015-importacao`); a aplicação foi reiniciada em
`https://localhost:3443/`, somente em loopback.

Aprovação formal registrada para **DOF, DTC IPAM, DTC Comissionado e DTC
INSS** por Euzébio Pereira da Silva Filho (Desenvolvedor de Sistemas),
referência "Autorização do responsável em 31/10/2026 (docs/decisoes/022)".
A emissão operacional está liberada para coordenadores. A DTC INSS foi
aprovada a pedido do responsável mesmo com os textos provisórios; os PDFs
continuam marcados como **MODELO PROVISÓRIO** até os textos oficiais.

Pacote extra (fatias 8–9 e pendências externas) não autorizado por enquanto.

## Cadastro, Informática e transferência de dados — 31/10/2026

Alteração funcional autorizada pelo responsável, separada do pacote extra:

- Cadastro usa analista/coordenador, com consulta auditada aos dados pessoais
  completos e referências de eventos, afastamentos, incorporações e períodos IPAM.
- Administrador da Informática tem acesso funcional completo, inclusive
  rascunhos e emissões de terceiros, sem eliminar revisão, CSRF, auditoria,
  aprovação formal ou imutabilidade dos documentos emitidos.
- Migração `016-acesso-admin` atualiza os controles de perfil no banco.
- Sincronização reúne importação e exportação dos cinco tipos em CSV/XLSX,
  por origem, com dados completos e confirmação/auditoria. Exportação não é backup.
- Testados 64 usuários concorrentes por perfil e um grupo misto (256 contas
  e sessões reais HTTPS, base sintética de 20 mil vínculos, 960 requisições):
  zero erros. p95 da suíte completa entre 715,0 e 737,2 ms; máximo 795,7 ms.
  A medição cobre sessão, busca e referências, não emissão concorrente de PDFs.
- Chromium verificou a consulta de referências pelo Cadastro e a exportação
  com confirmação/download na tela Sincronização.

Detalhes, limites e evidências:
[decisão 026](decisoes/026-cadastro-informatica-e-exportacao.md).
A aplicação permanece somente em loopback; as fatias 8–9 continuam fora do escopo.

Validação final: 173 testes em 22 arquivos (a única expectativa antiga de
contagem das migrações foi corrigida e o arquivo de emissão reexecutado com
10/10 testes aprovados). Build e `npm run typecheck` aprovados.

Implantado em `https://localhost:3443/` após backup `pg_dump` e aplicação de
`016-acesso-admin`. Health respondeu `ok`; referências e exportação sem
login responderam 401. Nenhum dado real ou usuário operacional foi usado
nos testes de carga.

## Ajustes da administração e XLSX legado — 31/10/2026

Concluído, conforme a
[decisão 027](decisoes/027-administracao-documentos-cadastro-legado.md):
administrador não cria DOF/DTC nem cópias, mas opera documentos existentes;
exclusão física controlada de documentos e PDFs; edição de servidores no
núcleo local com motivo, auditoria cifrada e revisões; Sincronização separada
de Importação/Exportação; seleção de destino Núcleo/Legado.

XLSX destinado ao legado preserva cabeçalhos e valores textuais em staging
cifrado, sem conversão automática para o núcleo. A validação e gravação pela
interface foram exercitadas com planilha fictícia. Nenhum XLSX pessoal do
responsável foi aberto. Edição de servidores passou em 3 testes específicos.
A suíte completa passou: **181 testes em 23 arquivos**, build e typecheck.
As migrações `017-documentos-admin`, `018-edicao-cadastro` e
`019-planilhas-legado` foram aplicadas após backup `pg_dump`; a aplicação
foi reiniciada em `https://localhost:3443/`. Nenhum documento operacional
foi excluído e nenhuma planilha real foi importada automaticamente.
