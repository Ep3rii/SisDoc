# Auditoria visual do SisDoc

## Escopo e execução

Auditoria autorizada em 08/11/2026, após o inventário do checkpoint 1.
Os checkpoints seguintes foram dispensados pelo usuário. Apenas interface
e testes estão no escopo; banco, autenticação, autorização, auditoria,
aprovações de modelos e motor de cálculo não serão modificados.

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

## Cobertura e limitações a registrar no fechamento

O inventário foi corrigido durante a leitura para incluir a quarta aba,
**Histórico**, da importação administrativa. A lista compartilhada tem
Rascunhos, Encaminhadas, Devolvidas e Conferidas; não possui aba Emitidas.
As emissões estão no Histórico.

Estados sem equivalente visual não são inventados. Login não recebe lista
longa; editores de documento existente não recebem documento vazio inválido.
As seis configurações de zoom não cobrem todos os estados em todas as resoluções.

PDFs v1/v2 e prévias provisórias possuem finalidades e textos diferentes.
A comparação com documento oficial não pode ser comprovada por screenshot
do editor nem por respostas fictícias de emissão. Não serão alteradas aprovações
ou versões de snapshot para contornar essa limitação.

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
Os commits e evidências depois serão registrados após cada rodada completa.

| ID | Tela / configuração representativa | Problema e causa provável | Gravidade / regra | Arquivo da correção | Antes | Depois / commit |
|---|---|---|---|---|---|---|
| VIS-01 | Editor DOF · analista · 1366×768 · dados | Campo focado por Tab sob a barra fixa; espaço/rolagem não consideram o rodapé | Crítico · teclado, WCAG 2.4.7 | `estilos.css` | [captura](../tests/visual/evidencias/VIS-01-antes.png), [medida](../tests/visual/evidencias/VIS-01-antes.json) | [captura](../tests/visual/evidencias/VIS-01-depois.png), [medida](../tests/visual/evidencias/VIS-01-depois.json) · lote crítico |
| VIS-02 | Editor DOF · analista · 1366×768 · zoom 150% | Prévia com apenas 80 px de altura CSS; editor e controles disputam largura/altura | Crítico · emissão, reflow | `previa-documento.tsx`, `estilos.css` | [captura](../tests/visual/evidencias/VIS-02-antes.png) | [captura](../tests/visual/evidencias/VIS-02-depois.png) · lote crítico |
| VIS-03 | Auditoria · admin · 1024×768 · dados; tabela DOF, lotes e prévia ampliada | Regiões roláveis sem foco próprio; teclado não alcança conteúdo lateral | Importante · WCAG 2.1.1 | Tabelas e visualizador compartilhado | [captura](../tests/visual/evidencias/VIS-03-antes.png) | Pendente |
| VIS-04 | Todas · login sem sessão · 1366×768 · dados | Regras CSS com fontes menores de 13 px, incluindo `small` | Importante · requisito de leitura do projeto | `estilos.css` | [captura](../tests/visual/evidencias/VIS-04-antes.png) | Pendente |
| VIS-05 | Editor DOF · admin · 1366×768 · dados | Identificador da prévia: `#566a78` sobre `#dce1e5`, contraste 4,27:1 | Importante · WCAG 1.4.3 | `estilos.css` | [captura](../tests/visual/evidencias/VIS-05-antes.png) | Pendente |
| VIS-06 | Histórico de importação · admin · 1920×1080 · erro | Falha de listagem mantém “Carregando lotes...” | Importante · comunicação de estado | `importacao.tsx` | [captura](../tests/visual/evidencias/VIS-06-antes.png) | Pendente |
| VIS-07 | Histórico funcional e editor DOF · admin · 1366×768 · dados | Datas civis apresentadas em ISO nos resumos e referências | Refinamento · português e datas | Apresentação dos históricos e DOF | [captura](../tests/visual/evidencias/VIS-07-antes.png) | Pendente |
| VIS-08 | Ficha · analista · 1366×768 · dados | Múltiplos vínculos geram vários botões primários simultâneos | Refinamento · padrão visual do projeto | `detalhe.tsx` | [captura](../tests/visual/evidencias/VIS-08-antes.png) | Pendente |

### Lote crítico

Reflow do editor/preview até 1.200 px CSS, altura de prévia mínima de 240 px
e espaço de rolagem para a barra de totais, preservada fixa. `scroll-padding`
sozinho não resolveu dois controles na aba Blocos; a segunda correção,
`scroll-margin` nos alvos de foco, passou no reteste do cenário (24 combinações).
Rodada completa: 106/107 testes passaram; única falha corrigida e retestada.
Consolidado: 1.832 combinações sem erro, foco encoberto ou altura insuficiente.
Build web e tipos aprovados. Um filtro inicialmente ancorado não selecionou
testes e não foi contado como validação; execução efetiva feita em seguida.

Nenhum lote revertido. Importantes/refinamentos ainda pendentes; a próxima
rodada completa também revalida integralmente as correções críticas.
