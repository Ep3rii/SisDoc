# Auditoria visual do SisDoc

## Ajustes solicitados após a auditoria — 08/11/2026

O lote posterior atende à revisão do usuário:

- **Login:** ícone do olho centralizado pela altura real do input; mensagens
  de sessão/erro abaixo do cabeçalho, fora da área centralizada do cartão.
  Clipboard (copiar, recortar, colar e arrastar) bloqueado nos campos de senha
  do acesso e da troca, inclusive quando revelados. Autocomplete e autenticação
  permanecem intactos. Essa restrição foi solicitada pelo usuário; não é
  apresentada como ganho de segurança e dificulta colagem de gerenciadores.
- **Editor/prévia:** duas colunas iguais (50% do espaço disponível para cada,
  descontado o intervalo) em desktop acima de 900 px; abaixo disso, empilhadas
  para preservar leitura e ausência de overflow. Removidos ajuste da largura,
  Atualizar prévia e Ampliar prévia; mantidos zoom e Página inteira.
  Prévia local continua automática. A fonte DOF é reconsultada automaticamente
  ao retornar à janela e após mudança de revisão; falhas mantêm retentativa
  explícita. Durante conferência, a reconsulta por foco permanece bloqueada.
- **Salvar DOF:** ação visível desde a abertura do cálculo para perfis
  autorizados, desabilitada com orientação até cálculo/motivo válidos.
  Edição em somente leitura e criação pelo admin continuam impedidas.
  Salvar ainda exige os mesmos dados, confirmação e motivo no backend.

Reprodução antes da correção: teste de geometria mediu olho 5,40625 px fora
do centro, diferença de 226,875 px entre as colunas e ausência de Salvar
rascunho no cálculo inicial. Capturas usam apenas dados fictícios.
Novas regressões em
[interface-ajustes-visuais.test.ts](../tests/interface-ajustes-visuais.test.ts)
incluem clipboard, aviso após Sair, divisão em 1920/1366/1024 px e reflow em
768/390 px. Testes existentes de fonte/revisão/conferência agora exercitam
atualização automática ao retornar à janela, sem botão manual.

O cenário antigo `preview-ampliado` foi substituído por
`preview-pagina-inteira`; não é reportado como modal ainda disponível.
A baseline inicial e as evidências históricas permanecem preservadas no Git.

**Validado:** build e tipos aprovados, **116/116 testes em sete arquivos**,
60 cenários/1.928 combinações, 849,31 segundos, sem ocorrências automatizadas
ou rotas inesperadas. A primeira rodada focada passou 30/31; uma expectativa
histórica de botão ausente foi atualizada para botão desabilitado, conforme
o novo requisito, e a rodada completa passou. Nenhum lote revertido neste
ajuste. HTTPS confiável confirmou health 200, index e 16 assets iguais ao
build; serviços ativos, sem reinício ou teste de escrita real.

Evidências finais: [login](../tests/visual/evidencias/AJ-01-login-depois.png),
[editor](../tests/visual/evidencias/AJ-02-editor-depois.png),
[salvar](../tests/visual/evidencias/AJ-03-salvar-depois.png).
A baseline pós-correções foi atualizada após essa validação; a baseline inicial
permanece intacta. Um agente foi acionado para o visualizador, mas retornou
sem patch; implementação e integração realizadas diretamente.

## Escopo e execução

Auditoria autorizada em 08/11/2026, após o inventário do checkpoint 1.
Os checkpoints seguintes foram dispensados pelo usuário. Apenas interface
e testes estão no escopo; banco, autenticação, autorização, auditoria,
aprovações de modelos e motor de cálculo não foram modificados.

Comandos:

```powershell
npm run test:visual
npm run test:visual:report
```

Playwright já existia como devDependency. Acrescentado somente `axe-core`
como devDependency, sem CI ou serviços externos. O executor existente remove
configuração operacional e variáveis PostgreSQL. O preview Vite é temporário,
em loopback, com todas as chamadas de API interceptadas; rotas não simuladas
falham explicitamente. Dados e capturas são inteiramente fictícios.

## Matriz

- Chromium; admin, analista, coordenador e login sem sessão.
- 1920×1080, 1366×768, 1280×720 e 1024×768.
- Prioridade: perfis × viewports × estados aplicáveis a 100%.
- Zoom 125%/150% nas seis telas mais usadas, em 1366×768 com dados.
  Emulado por viewport CSS reduzido e device scale factor, não pelo comando
  nativo Ctrl+ do navegador; conferência manual de zoom nativo continua necessária.
- Dados, vazio, carregando, erro, lista longa e nome acima de 80 caracteres,
  conforme a existência desses estados no componente.
- Listas longas respeitam os limites do contrato: 50 itens visíveis e total
  acima de 50 onde existe paginação global. Não são enviadas respostas inválidas
  com mais itens que o contrato permite.
- Tema escuro: **não suportado**.

## Evidências

[Relatório navegável](../tests/visual/relatorio.html), capturas em
[screenshots](../tests/visual/screenshots/) e resultados axe/medidas em
[resultados](../tests/visual/resultados/).
O JSON inclui configurações, violações, verificações incompletas, medidas e
falhas de rede/runtime. Zero violações axe não comprova conformidade WCAG completa.

Baseline inicial preservada em [baseline.json](../tests/visual/baseline.json)
e no commit `850bd05`. As capturas de trabalho são atualizadas pela suíte:
as imagens iniciais completas continuam no Git nesse commit; exemplos antes
e depois ficam em [evidencias](../tests/visual/evidencias/). A
[baseline pós-correções](../tests/visual/baseline-pos-correcoes.json) registra
as 1.928 combinações finais separadamente, sem sobrescrever a inicial.

## Arquivos e comandos criados

- [auditoria.test.ts](../tests/visual/auditoria.test.ts): Chromium, matriz,
  axe, medidas, regressões visuais e relatório HTML local
- [cenarios.ts](../tests/visual/cenarios.ts), [fixtures.ts](../tests/visual/fixtures.ts)
  e [tipos.ts](../tests/visual/tipos.ts): cenários e contratos fictícios
- [relatorio.html](../tests/visual/relatorio.html), [resultados](../tests/visual/resultados/),
  [screenshots](../tests/visual/screenshots/) e [evidencias](../tests/visual/evidencias/):
  resultados reutilizáveis da auditoria
- [package.json](../package.json): `test:visual` (build, tipos dos testes e
  sete arquivos de testes) e `test:visual:report` (abrir relatório)
- Este relatório e os pontos de memória em
  [Recapitulação](ia/RECAPITULACAO.md) e [Progresso](PROGRESSO.md)

Fontes alteradas: estilos/visualizador/datas/tabelas compartilhados; busca,
ficha, históricos, referências e importação do vínculo; apresentação/ações
DOF e DTC; histórico documental; usuários, importação e auditoria administrativas.
Não houve alteração de API, banco, autenticação, permissões ou cálculo.

## Cobertura e limitações

Os cenários completos e seus estados/perfis estão em
[cenarios.ts](../tests/visual/cenarios.ts). A cobertura foi ampliada de 56
para 60 cenários após a baseline, acrescentando detalhes funcional/financeiro,
revisões e sugestões de cadastro.

| Área / rota | Telas e componentes exercitados | Perfis |
|---|---|---|
| `#/inicio`, sem sessão | Login, erro de credenciais e troca obrigatória de senha | Sem sessão; todos na troca |
| `#/inicio` | Busca, seleção, ficha, vínculos, documentos, referências, sugestões, eventos e edição cadastral | Admin, analista, coordenador; edição admin |
| Histórico dentro da ficha | Funcional/financeiro, filtros, paginação, detalhes e revisões; abertura de novo registro e importação CSV/XLSX/XML | Todos em leitura; ações admin |
| `#/dofs/{aba}` | Rascunhos, Encaminhadas, Devolvidas, Conferidas, exclusão e emissão em lote | Admin, analista, coordenador |
| Editor DOF | Dados, Período, Tabela ano a ano, Blocos, Conferência, prévia/ampliação e confirmação inicial | Admin, analista, coordenador conforme ações atuais |
| `#/dtcs/{aba}` | Quatro abas da lista, filtro por tipo; editores IPAM, Comissionado e INSS, Conferência e documento conferido | Admin, analista, coordenador conforme ações atuais |
| `#/historico` | Emissões, situações, disponibilidade/falha de PDF e ações autorizadas | Admin, analista, coordenador |
| `#/administracao/usuarios` | Lista, edição, novo usuário em modal, erros e regras de senha | Admin |
| `#/administracao/importacao` | Importar, Disponibilizar Legado, Exportar, Histórico de lotes e erro de listagem | Admin |
| `#/administracao/sincronizacao`, `#/administracao/auditoria` | Status/configuração visível, filtros, tabelas e estados de consulta | Admin |

O inventário foi corrigido durante a leitura para incluir a quarta aba,
**Histórico**, da importação administrativa. A lista compartilhada tem
Rascunhos, Encaminhadas, Devolvidas e Conferidas; não possui aba Emitidas.
As emissões estão no Histórico.

Estados sem equivalente visual não são inventados. Login não recebe lista
longa; editores de documento existente não recebem documento vazio inválido.
As seis configurações de zoom não cobrem todos os estados em todas as resoluções.
Carregamento/erro não têm representação independente em todos os editores.
Upload, mapeamento, resultado completo de arquivos e conversão do legado não
foram exercitados integralmente. Conflitos e confirmações nativas não cobrem
toda a matriz. A navegação crítica por teclado usa 60 Tabs em dados/1366×768/
100%; não comprova todas as sequências possíveis em todos os estados.
Não houve teste em Firefox/WebKit, leitor de tela ou rasterização comparativa
integral de preview/PDF. O conteúdo do iframe PDF não entra na análise axe.

PDFs v1/v2 e prévias provisórias possuem finalidades e textos diferentes.
A comparação com documento oficial não pode ser comprovada por screenshot
do editor nem por respostas fictícias de emissão. Não serão alteradas aprovações
ou versões de snapshot para contornar essa limitação.
Os testes de modelos cobrem documentos fictícios v1/v2, A4, textos, escape,
limites e paginação: DOF/IPAM/Comissionado com duas páginas e INSS com três.
Isso não substitui a comparação visual manual entre preview e PDF aprovado.

## Pendências que precisam de decisão

1. Reorganizar os tipos administrativos do Núcleo em Dados funcionais,
   Histórico funcional e Histórico financeiro: altera o fluxo, fora do escopo UI.
2. Consolidar os dois pontos de acesso ao histórico na ficha: envolve navegação
   e deve ser avaliado separadamente, sem remover acesso nesta auditoria.
3. Aplicar tamanho mínimo de 13 px também às fontes dos modelos institucionais
   de PDF: os templates usam medidas em pontos e são versionados. Alterá-los
   pode mudar paginação e requer tratar aprovação/versionamento dos modelos.
4. Nome de download contendo servidor + tipo + data: o nome é validado no
   contrato de download e produzido pelo backend; não alterar esse contrato
   como correção meramente visual.

## Verificações manuais

1. Em máquina com Chromium e CA confiável, abrir a instalação, somente em leitura.
   Conferir fontes/foco em zoom nativo 100%, 125% e 150%, sem emitir ou gravar.
2. Abrir o relatório local; revisar capturas de nome longo, 1024 px e zoom 150%.
   Validar que o próximo passo de cada fluxo continua compreensível.
3. Usar leitor de tela com dados fictícios e percorrer menus, abas, tabelas,
   modais e mensagens; axe não verifica entendimento da leitura.
4. Comparar documento de teste aprovado, de cada tipo e versão, com o PDF:
   A4, margens, quebras, cabeçalho/rodapé, fontes, períodos, totais e nome do arquivo.
   Não emitir dados reais como teste nem aprovar modelo provisório para executá-lo.

## Resultado

**Final: 60 cenários, 1.928 combinações, 112/112 testes em seis arquivos.**
Build completo e tipos aprovados; 845,84 segundos na última rodada completa.
Onze grupos corrigidos: três críticos, cinco importantes, três refinamentos.
Zero ocorrências automatizadas remanescentes nas guardas executadas, sem
rotas inesperadas ou erros de runtime; isso não significa WCAG integral.
Dois lotes revertidos, registrados abaixo. A segunda rodada dos refinamentos
passou integralmente após corrigir a hierarquia das retentativas.

**Instalação conferida:** HTTPS com CA confiável, health 200, index e 16
assets iguais ao build final. Serviços SisDoc e SisDocCaddy ativos, sem
reinício. Nenhum teste gravou dados reais. Commits locais, sem push.

Baseline inicial: **56 cenários, 1.832 combinações**, 107 testes aprovados
em seis arquivos (auditoria, modelos/PDFs, nomes e regressões DOF/DTC/usuários).
Build completo e tipos dos testes aprovados. Nenhuma rota de API inesperada
ou erro de runtime. A execução completa levou 747 segundos.

Ocorrências na baseline: fontes abaixo de 13 px em 1.826 combinações,
contraste axe em 150, região rolável sem foco em 44, foco encoberto em 13
e altura de prévia insuficiente em seis. Não são 2.039 problemas diferentes:
as ocorrências repetem os mesmos componentes nas configurações.
Botões desabilitados medidos não apresentaram contraste inferior a 4,5:1.

### Lotes e problemas reproduzidos

Todos os itens abaixo foram reproduzidos antes de alterar a interface.

| ID | Tela / configuração representativa | Problema e causa provável | Gravidade / regra | Arquivo da correção | Antes | Depois / commit |
|---|---|---|---|---|---|---|
| VIS-01 | Editor DOF · analista · 1366×768 · dados | Campo focado por Tab sob a barra fixa; espaço/rolagem não consideram o rodapé | Crítico · teclado, WCAG 2.4.7 | `estilos.css`, visualizador | [captura](../tests/visual/evidencias/VIS-01-antes.png), [medida](../tests/visual/evidencias/VIS-01-antes.json) | [captura](../tests/visual/evidencias/VIS-01-depois.png), [medida](../tests/visual/evidencias/VIS-01-depois.json) · `7723cdd`, `c0728b6` |
| VIS-02 | Editor DOF · analista · 1366×768 · zoom 150% | Prévia com apenas 80 px de altura CSS; editor e controles disputam largura/altura | Crítico · emissão, reflow | `previa-documento.tsx`, `estilos.css` | [captura](../tests/visual/evidencias/VIS-02-antes.png) | [captura](../tests/visual/evidencias/VIS-02-depois.png) · `7723cdd` |
| VIS-03 | Auditoria · admin · 1024×768 · dados; tabela DOF, lotes e prévia ampliada | Regiões roláveis sem foco próprio; teclado não alcança conteúdo lateral | Importante · WCAG 2.1.1 | Tabelas e visualizador compartilhado | [captura](../tests/visual/evidencias/VIS-03-antes.png) | [captura](../tests/visual/evidencias/VIS-03-depois.png) · `1c3e022` |
| VIS-04 | Todas · login sem sessão · 1366×768 · dados | Regras CSS com fontes menores de 13 px, incluindo `small` | Importante · requisito de leitura do projeto | `estilos.css` | [captura](../tests/visual/evidencias/VIS-04-antes.png) | [captura](../tests/visual/evidencias/VIS-04-depois.png) · `1c3e022` |
| VIS-05 | Editor DOF · admin · 1366×768 · dados | Identificador da prévia: `#566a78` sobre `#dce1e5`, contraste 4,27:1 | Importante · WCAG 1.4.3 | `estilos.css` | [captura](../tests/visual/evidencias/VIS-05-antes.png) | [captura](../tests/visual/evidencias/VIS-05-depois.png) · `1c3e022` |
| VIS-06 | Histórico de importação · admin · 1920×1080 · erro | Falha de listagem mantém “Carregando lotes...” | Importante · comunicação de estado | `importacao.tsx` | [captura](../tests/visual/evidencias/VIS-06-antes.png) | [captura](../tests/visual/evidencias/VIS-06-depois.png) · `1c3e022` |
| VIS-07 | Histórico funcional e editor DOF · admin · 1366×768 · dados | Datas civis apresentadas em ISO nos resumos e referências | Refinamento · português e datas | Apresentação dos históricos e DOF | [captura](../tests/visual/evidencias/VIS-07-antes.png) | [captura](../tests/visual/evidencias/VIS-07-depois.png) · `4f2adf6d` |
| VIS-08 | Ficha · analista · 1366×768 · dados; busca global | Vários vínculos e busca do topo competem como primários simultâneos | Refinamento · padrão visual do projeto | `detalhe.tsx`, `busca-global.tsx`, estilos contextuais | [captura](../tests/visual/evidencias/VIS-08-antes.png) | [captura](../tests/visual/evidencias/VIS-08-depois.png) · `4f2adf6d` |
| VIS-09 | Usuários · admin · 1024×768 · texto longo | `min-width: max-content` impede quebra de nome e empurra ações para fora da área visível | Importante · leitura e texto longo | `estilos.css` | [captura](../tests/visual/evidencias/VIS-09-antes.png) | [captura](../tests/visual/evidencias/VIS-09-depois.png) · `1c3e022`, `4f2adf6d` |
| VIS-10 | Período DOF · admin · 1366×768 · dados | Altura da prévia cresce com a rolagem, deslocando continuamente o retorno aos rascunhos | Crítico · navegação, WCAG 2.1.1 | `previa-documento.tsx` | [medição](../tests/visual/evidencias/VIS-10-antes.json) | [medição](../tests/visual/evidencias/VIS-10-depois.json), [captura](../tests/visual/evidencias/VIS-10-depois.png) · `c0728b6` |
| VIS-11 | Histórico de emissões · admin · 1366×768 · dados; devolução DOF/DTC | Cancelar/devolver indevidamente vermelhos | Refinamento · vermelho só para erro/exclusão | Histórico e ações DOF/DTC | [captura](../tests/visual/evidencias/VIS-11-antes.png), [medição](../tests/visual/evidencias/VIS-11-antes.json) | [captura](../tests/visual/evidencias/VIS-11-depois.png), [medição](../tests/visual/evidencias/VIS-11-depois.json) · `4f2adf6d` |

### Lote crítico

Reflow do editor/preview até 1.200 px CSS, altura de prévia mínima de 240 px
e espaço de rolagem para a barra de totais, preservada fixa. `scroll-padding`
sozinho não resolveu dois controles na aba Blocos; a segunda correção,
`scroll-margin` nos alvos de foco, passou no reteste do cenário (24 combinações).
Rodada completa: 106/107 testes passaram; única falha corrigida e retestada.
Consolidado: 1.832 combinações sem erro, foco encoberto ou altura insuficiente.
Build web e tipos aprovados. Um filtro inicialmente ancorado não selecionou
testes e não foi contado como validação; execução efetiva feita em seguida.

Lote inicial sem reversão. Os lotes seguintes e suas reversões estão abaixo;
a próxima rodada completa revalida integralmente as correções críticas.

### Lote de acessibilidade — reversão necessária

Fontes, contraste, regiões com foco e erro de importação passaram nas
1.832 combinações, mas os novos alvos de Tab expuseram foco ainda encoberto
no visualizador e no retorno aos rascunhos. Primeira rodada: 105/107 passaram.
Segunda tentativa ampliou a reserva de rolagem e estabilizou a medição por
dois frames; Blocos/Usuários passaram, mas Período continuou falhando.
Conforme a regra de duas tentativas, o lote foi registrado e revertido.
A reaplicação só ocorreu depois de isolar e corrigir a causa abaixo.

Revertido `bff4808` por `9b99d06`. Uma tentativa isolada de proteger foco
com evento e espaço adicional também falhou após duas tentativas:
`bbb4f15`, revertido por `e42a030`. Não há alteração de autenticação ou
tratamento de foco desse lote no estado final.

### Causa isolada: altura do preview

Aumentar a cobertura para 60 Tabs e dois frames de estabilização reproduziu
o problema mesmo após reverter as fontes. Medição direta: rolar 250 px
aumentava a altura do documento de 1.268 para 1.518 px; o retorno permanecia
no mesmo ponto encoberto. O cálculo de altura usava a posição da prévia sem
limite superior e criava esse crescimento.

Correção no próprio visualizador: altura normal limitada a 65% do viewport,
com mínimo de 240 px e ampliação preservada. A altura do documento estabilizou
em 1.146 px e o retorno ficou acima do rodapé. Sete cenários DOF/preview e
um diagnóstico passaram; tipos aprovados. Diagnóstico temporário removido,
medidas e captura fictícia preservadas. A suíte permanente verifica mínimo,
máximo e 60 passos de Tab. Este lote não altera cálculo documental ou dados.

### Acessibilidade após corrigir a causa

Reaplicadas fontes de interface ≥13 px, cor do identificador `#435968`,
foco visível para todos os controles/regiões, regiões roláveis nomeadas com
Tab e quebra de nomes longos nas tabelas. Erro de importação agora comunica
a falha e orienta usar Atualizar lista; requisições, importação e dados não
mudaram. Rodada completa **107/107**, 1.832 combinações, zero ocorrências
automatizadas (axe, fonte, overflow, contraste desabilitado, foco e altura).
Tipos aprovados. Os dois lotes revertidos permanecem registrados; a reaplicação
só ocorreu depois da correção do crescimento ilimitado, em lote separado.
Datas e hierarquia da ficha foram tratadas no lote seguinte.

### Refinamentos de apresentação

Datas civis agora usam dd/mm/aaaa em resumos, referências, revisões e DOF;
competências usam mm/aaaa. Inputs, contratos, cálculos e valores enviados
continuam intactos. Busca do topo secundária; apenas o primeiro vínculo é
primário, e formulários locais mantêm hierarquia contextual. Paginação,
filtros, redefinição e cancelamento/devolução são secundários; exclusão
continua vermelha. Botões nas tabelas não quebram palavras no meio.

A guarda de primários abrange cabeçalho e conteúdo, não só `main`; dialog
aberto é o contexto ativo, e abas/navegação não contam como ações primárias.
A primeira execução ampliada foi interrompida para incluir a busca do topo
nessa verificação, sem aceitar uma medida parcial como conformidade.
O JSON anterior VIS-11 inclui “Confirmar exclusão física” pela expressão
inicial do teste: isso não era uma violação; cancelar/devolver eram.
A rodada completa seguinte aprovou 109/112 testes; encontrou dois primários
no estado de erro dos históricos funcional/financeiro. Retentativas e
paginação de revisões foram ajustadas somente por classe visual. A mesma
rodada também teve erro explícito de abertura de arquivos de evidência
(`UNKNOWN`), inclusive no resumo; não foi contada como validação concluída.
Na reexecução não foram feitas varreduras Git dos resultados enquanto a suíte
os escrevia, para evitar concorrência de acesso aos arquivos no Windows.
