# Avaliação técnica de UI/UX — 01/11/2026

## Método e limites

Avaliação da estrutura React/CSS de todas as telas principais e dos testes
de navegador com dados sintéticos. A página operacional foi aberta para
inspeção; não foram feitas alterações em documentos reais. Não é um teste
de usabilidade com operadores, nem uma certificação de acessibilidade.

O layout tem uma base coerente: menu por perfil, busca global, tabelas
paginadas, confirmação de ações sensíveis e editor com prévia lateral.
Os principais problemas são densidade excessivamente espaçada, textos
operacionais repetidos, ações concorrentes e hierarquia entre lista/editor.

## Ajustes aplicados

- DOF salva/reaberta carrega a prévia auditada automaticamente. Continua
  visível entre abas; salvar uma nova revisão recarrega os dados. O comando
  **Atualizar prévia** substitui abrir/fechar. Respostas de revisões antigas
  são descartadas; erros têm mensagem e retentativa. Conferência continua
  dependente de dados e prova válidos, não apenas de exibir a prévia.
- DTC mantém a prévia da revisão salva ao editar; os novos valores do
  formulário aparecem após salvar. Esse estado é informado explicitamente.
- Tabelas usam fonte de 13 px, espaçamento de células menor, ações e
  campos anuais compactos, linhas alternadas e destaque ao passar o mouse.
  Não há ocultação ou truncamento de dados pessoais.
- Painéis têm menos preenchimento interno. Campos e botões tabulares
  conservam alvos de pelo menos 32 px no desktop e 44 px em telas móveis.
  A rolagem horizontal permanece quando necessária para preservar colunas.

## Avaliação por tela e recomendações

### Prioridades aplicadas na continuação

- Transferência dividida em quatro abas com navegação por teclado e estado
  preservado: Importar, Disponibilizar Legado, Exportar e Histórico.
- Filtros e ações de atualização padronizados em servidores, DOFs,
  encaminhados, DTCs, histórico, usuários, auditoria e lotes. São filtros
  da lista carregada, com alcance e contagem explícitos; filtros globais por
  período/responsável em todas as páginas continuam recomendação futura.
- Cadastro local separado em identificação/contato, documentos e vínculo.
  O vínculo escolhido na lista é selecionado automaticamente. Cadastro
  completo, referências, vínculos, períodos e cargos têm grupos recolhíveis;
  documentação INSS separada das licenças e das confirmações. Na DTC,
  grupos preservam lançamentos e a prévia continua mostrando a revisão salva.
- Exclusão física, cancelamento e devolução separados visualmente das ações
  principais, sem retirar motivos, confirmação ou controles de autorização.
- Orientações antigas de emissão indisponível na DOF substituídas pelo fluxo
  Salvar → Conferir → Emitir, sem liberar emissão direta de rascunhos.

A tabela abaixo conserva a avaliação original e propostas que excedem
esses ajustes (como filtros globais, novas abas DTC e menus de ações).

| Tela | Diagnóstico | Melhoria recomendada | Prioridade |
|---|---|---|---|
| Login / troca de senha | Formulário simples e concentrado; estados de erro já existem. | Mostrar requisito de 10 caracteres junto ao campo, permitir revelar senha com botão acessível e manter erros vinculados ao campo. | Média |
| Menu / cabeçalho | Categorias por tarefa melhoraram a navegação; menu longo e subtítulos consomem altura. | Categorias recolhíveis, indicação clara da tela atual e contadores de pendências autorizadas; não carregar dados de áreas sem permissão. | Média |
| Buscar servidores | Lista inicial é útil; avisos repetidos precedem os resultados, e detalhes ficam extensos. | Uma barra única de filtros com origem/órgão, matrícula primeiro, quantidade exibida e ação de limpar filtro; detalhes em abas Cadastro, Vínculos e Referências. | Alta |
| Cadastro / referências | Dados completos disponíveis, mas campos técnicos aparecem como rótulos e o vínculo exige seleção adicional. | Rótulos de negócio, agrupamento de identificação, documentos e vínculo; abrir o vínculo escolhido na lista sem seleção redundante. Manter todos os valores acessíveis. | Alta |
| DOF — cálculo/editor | Abas, totais fixos e prévia lateral são adequados. A tabela anual é larga; mensagens de emissão ainda dizem indisponível em um fluxo já entregue. | Separar deduções e incorporações em grupos claros; identificar valores ainda não salvos; substituir mensagens antigas por orientação ao fluxo Conferir → Emitir, sem habilitar emissão antes da conferência. | Alta |
| Rascunhos / encaminhados | Listas e ações são claras; falta filtro por servidor, situação e responsável. | Barra de filtros consistente, datas compactas e ação primária Abrir; indicadores de revisão/encaminhamento sem depender só de cor. | Alta |
| DOF conferida | Prévia automática já existe, mas emissão e devolução disputam espaço. | Prévia lateral e área de decisão com Emitir como ação principal; devolução em seção própria, sempre mantendo motivo e confirmação. | Alta |
| DTC — editor | Prévia foi preservada durante edição; formulário longo por períodos/cargos. | Abas Identificação, Períodos, Incorporações, Documentação e Conferência; resumo persistente de totais e aviso de prévia da revisão salva. | Alta |
| Histórico / PDF | Muitas ações na última coluna e ausência de filtros de período/servidor. | Filtros por matrícula, número, tipo, situação e datas; Baixar PDF como ação direta e demais ações em menu acessível. Separar exclusão física visualmente do cancelamento. | Alta |
| Usuários | Criação ocupa o topo mesmo quando a tarefa é localizar/editar; dois formulários ampliam a página. | Lista primeiro, busca por nome/matrícula e botão Novo usuário; criação/edição em painel contextual. Redefinição de senha em seção separada. | Média |
| Importação / exportação | Fluxo seguro e explícito, mas upload, conversão, exportação, totais e histórico formam uma página muito longa. | Abas Importar, Disponibilizar Legado, Exportar e Histórico; assistente com etapa atual; mapeamento recolhível e resumo de válidos/rejeitados antes da confirmação. | Alta |
| Prévia do Legado / ocorrências | 20 colunas exigem rolagem; erros completos podem ser baixados, mas é difícil encontrar um campo. | Congelar linha/cabeçalho e matrícula; filtros por tipo de ocorrência e busca por linha; mostrar extras preservados separadamente. Não mascarar valores operacionais. | Alta |
| Sincronização | Estado da integração e ações ficam juntos; configuração ausente ainda exibe comandos desabilitados. | Cartão de situação resumido, última execução e próximo passo; detalhes técnicos e erros em expansão. Diferenciar completa de incremental com explicação breve. | Média |
| Auditoria | Identificadores UUID e códigos de ação são pouco legíveis; não há filtros. | Filtros por período, usuário e ação; rótulos compreensíveis com identificador técnico disponível ao expandir/copiar. Não acrescentar senhas, tokens ou valores pessoais aos logs. | Alta |

## Achado de integração visual — corrigido

Na página operacional, o navegador registrou bloqueios de estilos inline
pela política CSP. Os editores usam `iframe srcDoc`, que herda a política da
página; os templates usam estilos inline. Isso pode comprometer a aparência
das prévias mesmo quando seu conteúdo está disponível.

A correção autoriza somente os dois blocos CSS fixos dos templates por
hash SHA-256 na política herdada. Não libera `unsafe-inline` na página
principal, scripts, atributos de estilo ou CSS arbitrário. Os templates
compartilham as constantes usadas para gerar a política, evitando hashes
manuais desatualizados. Iframes continuam em sandbox sem permissões.

Essa abordagem preserva a prévia local dos blocos ainda não salvos, sem
enviar HTML adicional ao servidor ou abandonar a autorização/auditoria da
consulta. É uma alternativa à resposta HTML dedicada originalmente sugerida.
Frontend e API precisam ser publicados juntos e a API reiniciada quando
o CSS do template mudar. Os testes de navegador usam a CSP de produção,
verificam estilos calculados de DOF e dos três tipos DTC e comprovam o
bloqueio de CSS arbitrário e scripts inseridos na prévia DTC.

## Sequência sugerida e aceite

1. Concluído: integração visual das prévias e mensagens antigas de emissão.
2. Concluído: filtros da lista carregada, grupos cadastrais e abas de transferência.
3. Concluído: grupos DTC e separação das ações destrutivas. Próximos opcionais:
   filtros globais, abas DTC, menus de ações e compactação do menu.
4. Validar com operadores: localizar servidor, corrigir referência, salvar,
   conferir e emitir; medir passos, tempo e erros sem registrar dados pessoais.

Aceite sugerido: prévia automática após cada gravação/reabertura, ausência
de dados de outra revisão, navegação por teclado, layout sem overflow da
página em 375 px (rolagem interna das tabelas permitida), controles móveis
de 44 px, zoom de 200% sem perda de ações e nenhuma informação completa
removida por perfil ou por redução de densidade. Cenários não testados não
devem ser declarados aprovados.
