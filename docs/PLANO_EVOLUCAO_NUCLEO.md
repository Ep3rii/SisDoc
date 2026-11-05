# Plano de evolução — edição local, prévias e Núcleo

**Estado: expansão implementada, validada e publicada em 04/11/2026, com
autorização expressa. Registro histórico de escopo.**

Para a próxima etapa, consultar o
[rascunho de conclusão funcional](PLANO_CONCLUSAO_APLICACAO_RASCUNHO.md),
que depende da apuração das fontes financeiras/funcionais, dossiês e regras.

Este plano preserva a análise original como referência de escopo, não como
descrição da instalação atual. A autorização confirmou os dois escopos de
edição, acrescentou sugestões de atualização cadastral e contadores de
encaminhados/retornos. Regras efetivas na
[decisão 033](decisoes/033-edicao-contextual-e-historico-local.md).

## 1. Base verificada antes da implementação

Análise somente de código/documentação e estado do Git, sem consultar dados
operacionais, importar arquivos, migrar banco ou reiniciar serviços.

- DOF apresenta dados do servidor como cartões somente leitura em
  [calculo-dof.tsx](../apps/web/src/dof/calculo-dof.tsx).
  [BlocosDof](../apps/web/src/dof/blocos-dof.tsx) já reflete blocos locais,
  mas consulta a fonte da revisão salva; não existe prévia integral do formulário.
- DTC mantém a prévia salva durante a edição em
  [documento.tsx](../apps/web/src/dtc/documento.tsx).
- O layout compartilhado divide editor/prévia igualmente e desconta 330px
  da altura do iframe em [estilos.css](../apps/web/src/compartilhado/estilos.css).
- [EditorCadastro](../apps/web/src/cadastro/editor-cadastro.tsx) e
  [cadastroApi](../apps/web/src/infraestrutura/cadastro.api.ts) já permitem
  edição no Núcleo local, com motivo e revisões de pessoa/vínculo.
  A decisão 027 restringe essa ação administrativa.
- [ImportacaoAdmin](../apps/web/src/transferencia/importacao.tsx) já oferece
  upload, validação, relatório e confirmação para Núcleo e Legado.
  O Núcleo exige formato canônico; o Legado tem mapeamento de colunas.
- [lerPlanilha](../apps/api/src/importacao/planilhas.ts) lê CSV/XLSX;
  XML de dados não é um formato de importação implementado.
- O Núcleo já recebe pessoas/vínculos, eventos funcionais, afastamentos,
  incorporações e períodos IPAM. Não se trata de criar outro banco de cadastro.

Referências: [Invariantes](ia/INVARIANTES.md),
[decisão 027](decisoes/027-administracao-documentos-cadastro-legado.md),
[decisão 030](decisoes/030-perfis-e-edicao-rascunhos.md) e
[Dados e importação](DADOS_E_IMPORTACAO.md).

## 2. Decisão principal: significado de alteração local

Recomendação: **dois escopos explícitos**, sem escrita nas fontes externas.

| Escopo | Persistência e efeito | Permissão proposta |
| --- | --- | --- |
| Ajustar nesta declaração | Ajustes no rascunho; não alteram o cadastro nem outras declarações | Analista, coordenador e administrador, respeitando estado/encaminhamento |
| Corrigir cadastro local | Correção no Núcleo da instalação, reutilizada em novas consultas/documentos | Administrador, conforme decisão 027 |

O escopo padrão dentro do editor seria **somente esta declaração**.
Corrigir o cadastro exigiria ação distinta e confirmação do alcance.
Não haveria propagação silenciosa entre os dois escopos.

Dados pessoais pertencem à pessoa; dados funcionais pertencem ao vínculo.
CPF/matrícula exigem validação e tratamento de identidade: ajustar sua
apresentação no documento não pode trocar pessoa/vínculo ou consolidar
cadastros automaticamente. Correções canônicas com colisão seriam bloqueadas
para reconciliação explícita.

Preservar origem, lotes importados e auditoria; correções manuais não devem
ser sobrescritas por nova importação/sincronização. Documentos emitidos
conservam snapshots e PDFs. Mudanças da fonte que afetem rascunhos exigem
revalidação explícita, sem alterar documentos históricos.

Confirmado: ajuste padrão exclusivo da declaração, com sugestão explícita
no cadastro e correção canônica administrativa separada. Não houve ampliação
de permissões sobre o cadastro.

## 3. Fases de execução

### Fase 1 — Dados editáveis no contexto do documento

1. Reutilizar campos, validações e padrões do cadastro existente.
2. Exibir inputs na aba Dados do servidor e nas telas equivalentes dos três
   tipos de DTC, sem exigir sair do documento.
3. Mostrar valor de origem, valor ajustado e indicação de alteração local;
   permitir remover o ajuste e voltar ao valor de referência.
4. Introduzir contrato/persistência de ajustes por documento, com motivo,
   revisão concorrente e auditoria protegida. Não reutilizar o PATCH de
   cadastro para um ajuste exclusivo de declaração.
5. Aplicar os mesmos dados efetivos ao cálculo, à prévia, à conferência e ao
   snapshot de emissão. Campos como admissão podem invalidar períodos/totais.
6. Integrar correção canônica ao editor apenas para o perfil autorizado;
   recarregar referência e exigir revalidação após salvar.
7. Manter bloqueio em estados não editáveis e DOF encaminhada.

**Aceite:** ajuste exclusivo permanece após reabrir o rascunho e não aparece
em outra declaração/cadastro. Correção canônica aparece nas novas consultas,
sem modificar snapshots emitidos. Conflitos e falhas de gravação são visíveis;
nenhum campo pendente é apresentado como salvo.

### Fase 2 — Prévia instantânea e melhor aproveitamento de tela

1. Usar um estado coerente do formulário para identificação, processo,
   períodos, ocorrências, blocos e totais de DOF/DTC.
2. Atualizar a prévia a cada alteração, sem depender de Salvar/Calcular.
   Reutilizar motor puro e templates compartilhados, sem cálculo paralelo.
3. Para entradas incompletas/inválidas, mostrar pendências e retirar totais
   inválidos; não continuar exibindo resultado antigo como se fosse atual.
4. Separar **prévia de edição, não salva e sem validade** da
   **prévia auditada da revisão salva**. Conferência/emissão continuam
   exigindo gravação e prova correspondente à revisão/fonte.
5. Não gravar a cada tecla nem armazenar dados pessoais no storage do
   navegador. Atualização visual e persistência são operações diferentes.
6. Ampliar a área útil, recolher elementos secundários, permitir ajustar
   largura dos painéis e oferecer modo ampliado para a prévia.
7. Oferecer ajustar à largura, página inteira e zoom, mantendo geometria
   A4 e paginação dos modelos; organizar rolagem sem perder acesso às ações.
8. Preservar isolamento sem scripts e escape de HTML. Eventual comunicação
   para dimensionamento não pode relaxar o sandbox indiscriminadamente.

**Aceite:** toda alteração relevante aparece sem salvar; respostas antigas
não substituem estado novo; conferência é bloqueada enquanto houver pendências.
Meta proposta: atualização em até 200ms após mudança válida no cenário de
referência, medido em ambiente de teste definido, inclusive documento longo.
Verificar 1366x768, 1920x1080 e largura móvel de 390px, sem corte de controles
ou rolagem horizontal da aplicação; zoom não modifica o PDF emitido.

### Fase 3 — Importação web do Núcleo com planilhas e XML

Reaproveitar importador, análise canônica, promoção do Legado, relatórios e
histórico existentes, em vez de criar outro fluxo de consolidação.

Fluxo proposto:

**Arquivo → origem/tipo → aba ou coleção → mapeamento → validação/diferenças
→ confirmação → lote e relatório.**

- Manter CSV/XLSX canônicos; oferecer mapeamento para cabeçalhos próprios,
  reutilizando o assistente do Legado e preservando a recepção protegida.
- Não exigir que o usuário navegue manualmente pelo Legado para alimentar
  o Núcleo; recepção/mapeamento podem ocorrer dentro do mesmo assistente.
- Acrescentar XML com perfis de estrutura versionados, namespaces e seleção
  de coleção/campos. XML arbitrário não determina tabelas automaticamente.
- Definir seleção de abas para XLSX com várias abas, sem alterar
  silenciosamente o comportamento atual de primeira aba.
- Apresentar inclusões, complementações, inalterados, divergências,
  duplicidades e quarentena. Não sobrescrever edições manuais.
- Vincular confirmação no servidor ao conteúdo, mapeamento, origem,
  sessão e estado relevante do Núcleo; exigir revalidação se mudarem.
- Reutilizar hash/lote e chaves de origem para idempotência. Pessoa por CPF
  e vínculo por origem/matrícula, sem associação ambígua automática.
- Bloquear DTD, entidades externas e acesso de rede/arquivos pelo parser XML;
  limitar bytes, profundidade, registros e expansão/descompactação.
  Manter limite de upload existente e explicitar limites por modalidade.
- Manter importação administrativa, CSRF, proteção do staging e relatórios.
  Tratar lotes grandes com progresso/status e cancelamento seguro conforme
  a capacidade medida; não ampliar limites sem ensaio.

**Aceite:** arquivos sintéticos CSV/XLSX/XML produzem os mesmos registros
canônicos; repetir um lote não duplica dados; alterar mapeamento invalida
confirmação; XML malformado/hostil é recusado com erro explícito. Nenhum
ensaio usa planilha real ou banco operacional.

### Fase 4 — Histórico funcional ampliado

Criar uma ficha por pessoa, organizada por vínculo e linha do tempo:

- Cadastro, vínculos, atos/eventos, férias, licenças/afastamentos,
  incorporações, histórico financeiro e documentos relacionados.
- Férias: período aquisitivo, concessão, intervalos de gozo,
  saldo informado, interrupção e eventual conversão em abono.
- Licenças: espécie, intervalo, ato, situação e efeitos informados
  sobre tempo de serviço/remuneração.
- Abonos: distinguir abono pecuniário de férias, abono de permanência
  e outros benefícios; evitar uma categoria genérica com regras implícitas.
- Registrar origem/lote/linha, ato e motivo, revisão, autor e histórico
  protegido. Correções preservam rastreabilidade.
- Reutilizar eventos/afastamentos/incorporações existentes quando equivalentes;
  criar apenas estruturas necessárias para os atributos ainda ausentes.
- Distinguir fatos, direitos/saldos informados, concessões, gozos e pagamentos.
  Um ato ou período não comprova pagamento.

**Aceite:** vários vínculos, férias fracionadas e alterações históricas
continuam identificáveis; sobreposições são sinalizadas. Seleção de eventos
para DOF/DTC é revisada, sem contagem automática em duplicidade.

### Fase 5 — Histórico financeiro por competência

Escopo inicial recomendado: **registrar, consultar e reconciliar**, não
processar folha de pagamento.

- Competência, data de pagamento, rubrica/código, descrição, natureza
  (provento/desconto), valor decimal, vínculo, origem e identificador externo.
- Associar pagamento a férias, abono/licença ou ato somente quando houver
  evidência; permitir lançamento financeiro sem evento identificado.
- Tratar folha normal, complementar e retroativos, distinguindo competência
  de origem e competência de pagamento. Evitar valores de ponto flutuante.
- Diferenciar previsto/informado/pago/estornado quando a fonte permitir;
  manter correção/estorno rastreável, sem apagar histórico para ajustar saldo.
- Importar rubricas/lançamentos pelo mesmo assistente, com validações próprias,
  chave de origem, prevenção de duplicidade e relatório de divergências.
- Filtros por pessoa, vínculo, competência e rubrica; totais e exportação
  autorizada, sem inferir contribuição previdenciária ou direitos.

**Fora deste escopo inicial:** cálculo automático de folha, tributos,
direitos, concessões, integração bancária e escrita em sistema externo.
Qualquer cálculo jurídico/financeiro exige fontes oficiais, regras
versionadas e aprovação específica.

**Aceite:** pagamentos complementares/retroativos não são confundidos com
duplicatas; totais reconciliam com fixtures sintéticas; direitos informados
não aparecem como valores pagos.

## 4. Ordem, testes e implantação

Ordem recomendada: confirmar decisões → fases 1/2 → fase 3 →
fase 4 → fase 5. A modelagem dos eventos e rubricas deve anteceder sua
importação especializada; cadastro canônico pode ser importado antes.

Por entrega: contratos/API/web coerentes, migrações necessárias,
typecheck/build e testes direcionados de permissões, concorrência, cálculo,
prévia, auditoria/importação, seguidos da regressão afetada.
Banco de testes descartável deve executar em contexto Windows compatível;
o bloqueio atual do PostgreSQL embutido sob conta administrativa não autoriza
apontar testes para produção.

Publicação requer autorização própria, backup protegido/verificado,
parada API/proxy na ordem correta, migração, build validado, retomada e
verificação de health/acesso. Aprovação pendente dos modelos oficiais
continua separada deste plano. Não alterar serviços/proxy neste planejamento.

## 5. Delimitações adotadas na execução

1. Ajustes exclusivos e sugestões no cadastro confirmados pelo responsável.
2. Correção canônica/importação permanecem administrativas.
3. Implementação contempla as cinco fases, preservando cálculo/regras vigentes.
4. XML SisDoc v1 documentado; não promete reconhecer esquemas arbitrários.
5. Histórico registra fatos/saldos informados e financeiro sem processar folha.
6. Contadores representam pendências de ação; visualização não limpa a fila.

## 6. Estado da entrega

Código implementado: ajustes DOF/DTC; sugestões no cadastro; prévia local com
zoom, proporção e ampliação; contadores/lista de retornos; importação mapeada
no Núcleo e XML/abas XLSX; histórico funcional/financeiro cifrado, importação,
exportação administrativa e consulta de revisões.

Na continuação UI/UX publicada, histórico passou a ter filtros e totais
globais no servidor; somente a busca textual permanece restrita à página.
Limites desta expansão: não há reconciliação automática de direitos/folha,
linha do tempo unificada de todas as fontes nem interpretação de XML de
terceiros. Relações históricas exigem identificadores existentes.

Resultados atuais de testes, migração e publicação são registrados em
[Progresso](PROGRESSO.md) e na [Recapitulação](ia/RECAPITULACAO.md);
build gerado não equivale a backend publicado ou migração aplicada.
