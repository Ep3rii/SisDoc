# Avaliação técnica de UI/UX — 04/11/2026

## Método e limites

Revisão React/CSS e testes de navegador com dados sintéticos, complementados
por inspeção de capturas DOF em 1366×768, 1920×1080 e 390×844.
Os três editores DTC foram testados com a CSP real. Cadastro/histórico/importação
foram analisados no código e em integrações API; isso não equivale a teste
visual completo dessas telas. Não houve edição de documentos operacionais.
Não é teste de usabilidade com operadores nem certificação de acessibilidade.
As nove prioridades abaixo foram implementadas, testadas e **publicadas**
em 04/11/2026, após autorização expressa. Migração 025 e serviços validados;
46 testes de interface/contratos/permissões e 45 integrações aprovados
(um teste preexistente excluído). Isso não certifica toda a matriz de usabilidade.
Situação operacional em [Progresso](PROGRESSO.md).

O layout tem uma base coerente: menu por perfil, busca global, tabelas
paginadas, confirmação de ações sensíveis e editor com prévia lateral.
O diagnóstico que orientou esta rodada identificou espaço vertical consumido por
orientações/controles, formulários extensos, rótulos técnicos e hierarquia
entre lista/editor. No modo página inteira, uma A4 cabe no espaço disponível,
mas fica pequena em 1366×768: largura e ampliação são necessárias para leitura.
Em 390px, menu/cabeçalho/avisos ocupam boa parte da primeira tela.

## Prioridades executadas nesta publicação

| Prioridade | Área | Recomendação e aceite |
|---|---|---|
| Alta | Hierarquia dos editores | Consolidar avisos repetidos e recolher orientações secundárias. Manter sempre visíveis escopo local, estado não salvo e próximo passo, sem esconder pendências de conferência. |
| Alta | DTC | Abas Identificação, Períodos, Cargos/Documentação e Conferência, com resumo dos totais. Mudar de aba não pode perder lançamentos ou invalidar silenciosamente a prévia. |
| Alta | Importação Núcleo | Indicador de etapas Arquivo → Aba/perfil → Mapeamento → Diferenças → Confirmação. Destacar quantidades, divergências e preservação de correções antes de aplicar. |
| Alta | Histórico funcional/financeiro | Trocar códigos por rótulos de negócio; seleção assistida de evento/pagamento relacionado em vez de digitar UUID. Manter rastreabilidade disponível ao expandir. |
| Alta | Consulta histórica | Filtros globais por competência/período/rubrica e paginação com totais globais calculados no servidor. Nunca chamar o subtotal da página de saldo ou direito. |
| Média | Prévia ampliada | Completar gestão de foco, retorno ao acionador e isolamento do fundo; testar teclado/leitor de tela. Escape e fechamento por botão já funcionam, mas não caracterizam modal acessível completo. |
| Média | Menu/móvel | Recolher categorias e compactar cabeçalho/avisos; manter contadores legíveis sem depender só de cor. Validar tarefas reais em 390px, não apenas ausência de overflow. |
| Média | Sugestões cadastrais | Comparação lado a lado: valor atual, valor sugerido, documento/revisão e alcance. Resolução deve continuar administrativa e explícita. |
| Média | Desempenho inicial | Carregar administração, importação e editores por demanda. Bundle candidato: cerca de 1.030 kB minificado/248 kB gzip; não aumentar o limite do bundler para esconder o aviso. |

Resultado:
- Hierarquia: avisos compactados, orientações secundárias recolhidas e
  estado não salvo/próximo passo preservados.
- DTC: abas Identificação, Períodos, Cargos/Documentação e Conferência,
  com resumo de totais e validação abrindo o painel do campo inválido.
- Importação: indicadores das etapas reais de recepção e promoção,
  resumo de rejeitados/quarentena/divergências e preservação antes da aplicação.
- Histórico: rótulos e seleção assistida de relações, carregadas em todas as
  páginas; competência/período/rubrica e totais exatos globais no servidor.
- Prévia: modal nativo com isolamento do fundo, foco inicial, retorno e Escape.
  Navegação por teclado automatizada; leitor de tela ainda requer aceite humano.
- Menu: categorias recolhíveis, cabeçalho móvel/aviso compactos e contadores
  preservados com nomes acessíveis.
- Sugestões: comparação tabular, documento/revisão/alcance e ação administrativa
  explícita, sem aplicação automática.
- Desempenho: telas lazy, fallback de carregamento e proteção contra falha de
  chunk com recarga explícita. Maior chunk 486,48 kB, sem elevar o limite.
  Inicial completo aproximadamente 796 kB/187 kB gzip; entrada isolada 32,05 kB.
- Login/troca: senha revelável por botão acessível e mínimo junto à nova senha.

Aceite com operadores: localizar um vínculo, ajustar somente a declaração,
identificar a sugestão cadastral, corrigir o cadastro com motivo e tratar um
retorno. Medir passos/erros sem registrar dados pessoais. Verificar zoom 200%,
leitor de tela, foco e controles móveis; esses cenários não foram certificados.

## Ajustes aplicados

- DOF salva/reaberta carrega a prévia auditada automaticamente. Continua
  visível entre abas; salvar uma nova revisão recarrega os dados. O comando
  **Atualizar prévia** substitui abrir/fechar. Respostas de revisões antigas
  são descartadas; erros têm mensagem e retentativa. Conferência continua
  dependente de dados e prova válidos, não apenas de exibir a prévia.
- DOF e DTC têm prévia de edição local a cada alteração válida, sem gravação
  por tecla. Entradas inválidas retiram totais antigos e mostram pendências.
  Conferência continua usando a prova da revisão/fonte salvas, não o HTML local.
- Ajustar nesta declaração é o escopo padrão; referência e restauração ficam
  junto ao campo. Corrigir cadastro local é uma ação administrativa separada.
  Sugestões derivadas dos ajustes salvos aparecem no cadastro.
- Visualizador compartilhado com largura/página, zoom, proporção e ampliação.
  A validação corrigiu altura sobre o rodapé, ciclo síncrono de medição e
  cabeçalho encobrindo o botão de recolher. Em móvel, a prévia usa altura
  própria e rolagem da página, sem tentar caber abaixo de um formulário extenso.
- Contadores circulares nos cantos superiores direitos de Encaminhados e
  Retornos, com nomes acessíveis. Contam pendências de ação; abrir não zera.
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
  grupos preservam lançamentos e a prévia de edição acompanha o formulário.
- Exclusão física, cancelamento e devolução separados visualmente das ações
  principais, sem retirar motivos, confirmação ou controles de autorização.
- Orientações antigas de emissão indisponível na DOF substituídas pelo fluxo
  Salvar → Conferir → Emitir, sem liberar emissão direta de rascunhos.

A tabela abaixo preserva o diagnóstico e o roteiro por tela. As nove
prioridades acima já estão publicadas; o restante (por exemplo filtros globais
de auditoria/documentos e painel contextual de usuários) continua evolução
posterior, não deve ser confundido com aceite concluído de toda a tabela.

| Tela | Diagnóstico | Melhoria recomendada | Prioridade |
|---|---|---|---|
| Login / troca de senha | Formulário simples e concentrado; estados de erro já existem. | Mostrar requisito de 10 caracteres junto ao campo, permitir revelar senha com botão acessível e manter erros vinculados ao campo. | Média |
| Menu / cabeçalho | Categorias e contadores melhoram orientação; menu longo e subtítulos consomem altura. | Categorias recolhíveis e cabeçalho compacto; preservar indicação da tela e pendências autorizadas. | Média |
| Buscar servidores | Lista inicial é útil; avisos repetidos precedem os resultados, e detalhes ficam extensos. | Uma barra única de filtros com origem/órgão, matrícula primeiro, quantidade exibida e ação de limpar filtro; detalhes em abas Cadastro, Vínculos e Referências. | Alta |
| Cadastro / referências | Dados completos disponíveis, mas campos técnicos aparecem como rótulos e o vínculo exige seleção adicional. | Rótulos de negócio, agrupamento de identificação, documentos e vínculo; abrir o vínculo escolhido na lista sem seleção redundante. Manter todos os valores acessíveis. | Alta |
| DOF — cálculo/editor | Abas, totais fixos, ajustes e prévia instantânea são adequados. A tabela anual é larga e orientações consomem altura. | Separar deduções/incorporações e consolidar avisos sem perder identificação de pendências; preservar Salvar → Conferir → Emitir. | Alta |
| Rascunhos / encaminhados | Listas e ações são claras; falta filtro por servidor, situação e responsável. | Barra de filtros consistente, datas compactas e ação primária Abrir; indicadores de revisão/encaminhamento sem depender só de cor. | Alta |
| DOF conferida | Prévia automática já existe, mas emissão e devolução disputam espaço. | Prévia lateral e área de decisão com Emitir como ação principal; devolução em seção própria, sempre mantendo motivo e confirmação. | Alta |
| DTC — editor | Prévia instantânea implementada; formulário longo por períodos/cargos. | Abas de edição, resumo persistente e diferenciação explícita entre prévia local e prova salva. | Alta |
| Histórico / PDF | Muitas ações na última coluna e ausência de filtros de período/servidor. | Filtros por matrícula, número, tipo, situação e datas; Baixar PDF como ação direta e demais ações em menu acessível. Separar exclusão física visualmente do cancelamento. | Alta |
| Usuários | Criação ocupa o topo mesmo quando a tarefa é localizar/editar; dois formulários ampliam a página. | Lista primeiro, busca por nome/matrícula e botão Novo usuário; criação/edição em painel contextual. Redefinição de senha em seção separada. | Média |
| Importação / exportação | Abas, XML e mapeamento no Núcleo disponíveis no código; etapas ainda exigem muita leitura. | Assistente com etapa atual, mapeamento recolhível e resumo de válidos/rejeitados/divergências antes da confirmação. | Alta |
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
3. Concluído: grupos/abas DTC, separação das ações destrutivas, filtros globais
   do histórico por vínculo e compactação do menu. Menus de ações e filtros
   globais nas demais listas continuam evolução posterior.
4. Publicados: ajustes/sugestões, prévia instantânea, visualizador, contadores
   e nove prioridades desta rodada. Máximo de 131,4 ms no seletor final com
   45 anos, 200 blocos e 20.000 caracteres válidos, abaixo da meta de 200 ms.
5. Validar com operadores: localizar servidor, corrigir referência, salvar,
   conferir e emitir; medir passos, tempo e erros sem registrar dados pessoais.

Aceite sugerido: prévia automática a cada alteração válida e reabertura, ausência
de dados de outra revisão, navegação por teclado, layout sem overflow da
página em 375 px (rolagem interna das tabelas permitida), controles móveis
de 44 px, zoom de 200% sem perda de ações e nenhuma informação completa
removida por perfil ou por redução de densidade. Cenários não testados não
devem ser declarados aprovados.
