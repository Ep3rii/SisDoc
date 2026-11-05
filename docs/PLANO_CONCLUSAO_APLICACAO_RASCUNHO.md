# Plano de conclusão funcional do SisDoc

**Estado: RASCUNHO para retomada posterior — 04/11/2026.**

Solicitado pelo responsável para organizar as pendências da aplicação.
Não autoriza implementação, alteração de regras, importação ou publicação.
As propostas abaixo dependem de apuração e confirmação; não são contratos
definitivos de tabelas, arquivos ou cálculos.

## 1. Direcionamento e ponto de partida

O foco passa de instalação/migração de máquina para **concluir a aplicação**.
Documentação de migração fica como referência histórica, fora do caminho
principal de retomada. Não apagar evidências operacionais nem desativar
proteções, backups ou procedimentos necessários a futuras atualizações.
Evoluções de schema eventualmente necessárias não são migração de máquina.

Já existem cadastro local, DOF/três DTCs, motor compartilhado API/navegador,
ajustes exclusivos da declaração, sugestões cadastrais, importação mapeada
CSV/XLSX/XML SisDoc v1 e histórico funcional/financeiro genérico por vínculo.
Esses recursos são base reutilizável, **não evidência de que as fichas
financeiras, o histórico definitivo ou os dossiês já estejam completos**.

Referências: [Progresso](PROGRESSO.md),
[Dados e importação](DADOS_E_IMPORTACAO.md),
[Invariantes](ia/INVARIANTES.md) e
[decisão 033](decisoes/033-edicao-contextual-e-historico-local.md).
O [plano anterior](PLANO_EVOLUCAO_NUCLEO.md) registra a expansão já entregue,
não substitui a apuração desta nova etapa.

## 2. Frentes de trabalho

### A. Fichas financeiras — tabelas, relações e consulta

**Pendente:** identificar as tabelas que compõem a ficha financeira e
como seus registros se relacionam com pessoa, matrícula e vínculo.

1. Levantar tabelas/arquivos, dicionário de campos e chaves nas fontes.
2. Apurar competência, exercício, folha, rubricas, proventos/descontos,
   bases e contribuições quando presentes, retroativos, cancelamentos
   e estornos. Não presumir que toda coluna exista ou tenha esse significado.
3. Distinguir competência de referência e pagamento, cadastro da rubrica
   e lançamento, valor informado e pagamento comprovado.
4. Comparar a estrutura real com o histórico financeiro existente e decidir
   o que reutilizar, complementar ou especializar, sem criar um segundo
   registro concorrente do mesmo fato.
5. Planejar consulta da ficha por vínculo/exercício/competência e detalhamento
   dos lançamentos, com totais reconciliáveis e rastreabilidade.

**Entregáveis:** inventário das fontes, mapa de relações, proposta de modelo
canônico e exemplos inteiramente sintéticos de ficha e reconciliação.
**Aceite:** lançamentos e totais podem ser explicados até a origem;
complementares/retroativos não viram duplicatas e ausência de dado não vira zero.

### B. Histórico funcional — estrutura ainda a apurar

**Pendente de apuração:** quais tabelas contêm o histórico e se existe
uma tabela consolidada ou composição de várias fontes.

1. Mapear eventos, atos, cargos, lotações, regimes, afastamentos, férias,
   licenças, abonos e outros fatos efetivamente disponíveis.
2. Distinguir fato ocorrido, ato publicado, vigência, período aquisitivo,
   concessão/gozo e retificação/cancelamento, conforme a fonte permitir.
3. Confrontar esses registros com eventos/afastamentos/incorporações e
   histórico local existentes; definir a representação canônica de cada fato.
4. Definir tratamento de vínculos sucessivos/simultâneos, lacunas,
   sobreposições e divergências, sem consolidação automática por nome.
5. Propor linha do tempo consultável, preservando origem e revisões.

**Entregáveis:** catálogo de fatos e relações, lacunas conhecidas e proposta
de modelo/consulta. **Aceite:** o histórico mantém fatos contraditórios
identificáveis até revisão; um mesmo evento não é contado duas vezes.
Nenhum efeito no cálculo será ativado apenas por existir no histórico.

### C. Dossiês antigos — preparação e incorporação posterior

**Pendente:** os dados ainda serão tratados; formato, qualidade e alcance
não estão definidos.

1. Inventariar os formatos e sua finalidade: documentos, imagens, planilhas,
   registros estruturados ou combinação deles.
2. Definir critérios de identificação, vínculo, origem, data, integridade,
   duplicidade, acesso e guarda, após conhecer o material.
3. Separar evidência documental original de informação extraída e validada.
   Não presumir leitura automática/OCR, nem tratá-los como escopo aprovado.
4. Planejar fila de conferência para correspondências ambíguas e extrações
   incompletas; dado não confirmado não alimenta cadastro/cálculo silenciosamente.
5. Só então decidir armazenamento, consulta/anexos e integração com os
   fatos funcionais/financeiros. Reutilizar os recursos que forem equivalentes.

**Entregáveis:** protocolo de tratamento, metadados mínimos e proposta de
incorporação. **Aceite:** cada informação aproveitada aponta para evidência
e validação, sem confundir documento antigo com prova de pagamento ou direito.

### D. Regras de cálculo e alimentação dos campos

Revisar DOF, DTC IPAM, DTC Comissionado e DTC INSS, sem presumir que as
regras atuais estejam erradas ou já representem a regra institucional final.

1. Montar matriz por campo: origem, transformação, regra, obrigatoriedade,
   possibilidade de ajuste, destino na prévia/PDF e situação de validação.
2. Apurar fontes institucionais vigentes, aplicabilidade temporal e responsável
   pelo aceite de cada regra; registrar dúvidas, não inventar respostas.
3. Revisar datas/contagem, limites e sobreposições, afastamentos, faltas,
   incorporações, contribuições e arredondamentos quando aplicáveis.
4. Definir precedência entre referência, correção canônica e ajuste exclusivo
   da declaração, incluindo ausência, inconsistência e invalidação da conferência.
5. Determinar explicitamente quais fatos históricos/financeiros podem alimentar
   quais campos. Registro financeiro não implica contribuição nem efeito no tempo.
6. Criar casos de referência sintéticos com resultados esperados homologáveis;
   executar o mesmo motor na API e navegador e conferir prévia/snapshot/PDF.

**Entregáveis:** matriz campo–fonte–regra, catálogo versionado de regras e
casos de referência com responsável pelo aceite.
**Aceite:** resultados reproduzíveis e rastreáveis; nenhuma alteração em
documentos emitidos. Aprovação de regra e de modelo permanece explícita por tipo.

### E. Importação do Núcleo — revisão dos tipos e layout

1. Inventariar os tipos hoje apresentados e sua correspondência com entidades
   canônicas. Separar destino, tipo de dado e formato do arquivo na interface.
2. Revisar rótulos, ajuda e agrupamentos de negócio após a apuração de A/B/C.
   Agrupamento a avaliar: cadastro/vínculos; histórico funcional; fichas
   financeiras; dossiês, somente quando houver tratamento definido.
3. Reutilizar recepção, seleção de aba, mapeamento, validação, diferenças,
   confirmação e relatórios. Não criar importadores paralelos sem necessidade.
4. Definir modelos/versionamento por tipo, campos obrigatórios, chaves,
   dependências entre cargas e relações entre abas/tabelas quando existirem.
   XML de terceiros depende de perfil conhecido; não é aceito genericamente.
5. Mostrar o que será incluído, complementado, preservado, rejeitado ou
   enviado à revisão, inclusive ambiguidade de pessoa/vínculo e duplicatas.
6. Revisar divergência/correção manual, repetição idempotente, confirmação
   vinculada à validação atual e permissões, do contrato à tela.

**Entregáveis:** matriz tipo–entidade–formato–dependência, esboço do assistente
e modelos sintéticos. **Aceite:** o operador escolhe o tipo por finalidade;
destino e efeitos ficam claros antes de gravar, sem sobrescrita silenciosa.
Tipos ainda não definidos não devem aparecer como importação disponível.

## 3. Sequência sugerida e dependências

| Etapa | Trabalho | Condição para avançar |
|---|---|---|
| 1 | Apuração de A/B; inventário inicial de C; inventário dos campos/regras de D e tipos atuais de E | Fontes, responsáveis e lacunas registrados |
| 2 | Proposta de modelo A/B e matriz campo–fonte–regra D; protocolo C quando houver material | Revisão do responsável, sem definir tabelas por suposição |
| 3 | Protótipo do layout E e contratos/modelos de importação por tipo conhecido | Modelo e dependências do tipo aprovados |
| 4 | Implementação em fatias completas: persistência/contratos/API/importação/tela/testes | Autorização específica e aceite da fatia anterior |
| 5 | Integração dos campos/cálculos D e homologação funcional por tipo documental | Regras/fontes e casos esperados confirmados |
| 6 | Revisão de ponta a ponta e publicação das entregas aprovadas | Testes, aceite, proteção operacional e autorização |

O levantamento dos cálculos pode começar sem aguardar os dossiês.
A indefinição de C não bloqueia A/B/D/E quando a entrega não depende dela.
O layout pode ser prototipado cedo, mas contratos especializados só fecham
depois de conhecer os dados. Não há prazo estimado antes dessa apuração.

## 4. Critérios transversais de conclusão

- Preservar monólito modular e motor compartilhado; reutilizar entidades/helpers.
- Escritas locais, permissões e auditoria preservadas; nenhuma escrita na fonte externa.
- Identidade por pessoa/vínculo/origem, sem fusões heurísticas ou sobrescrita silenciosa.
- Valores exatos, ausência distinta de zero, origem/lote/linha e revisões rastreáveis.
- Dados reais e materiais sensíveis fora do Git e das memórias; somente
  exemplos sintéticos na documentação/testes. Sem testes/seeds em produção.
- Typecheck/build, testes direcionados e regressão afetada; importação repetida,
  divergência, concorrência, totais, casos de cálculo e equivalência API/navegador.
- Homologar com o responsável uma jornada de consulta/importação, correção,
  preparação, conferência e emissão por tipo permitido, sem liberar modelos por teste.
- Medir desempenho com volume representativo aprovado, incluindo histórico
  extenso e relações; os testes existentes não certificam escala ilimitada.
- Documentar separadamente implementado, testado, homologado, publicado e pendente.

Fora do escopo presumido: processar folha/tributos, conceder direitos,
integração externa nova, OCR automático, excluir legado ou reescrever
documentos emitidos. Exigem definição e autorização próprias.

## 5. Ponto exato de retomada

**Próxima ação:** iniciar a etapa 1, identificando com o responsável as
tabelas/arquivos disponíveis para fichas financeiras e histórico funcional.
Solicitar apenas estrutura/dicionário e exemplos sintéticos ou anonimizados
por canal institucional protegido; não pedir credenciais/dados pessoais no chat.

Registrar antes de implementar:
- Quais fontes/tabelas existem, como se relacionam e quem valida seu significado.
- Quais exercícios/períodos e vínculos precisam ser cobertos.
- Como distinguir lançamentos repetidos, retificações e cargas complementares.
- Qual o formato/estado do tratamento dos dossiês e o que deve ser consultável.
- Quais fontes normativas e exemplos esperados regem cada cálculo/campo.
- Quais tipos de importação devem permanecer, ser renomeados, agrupados ou acrescentados.

**Situação ao encerrar este planejamento:** rascunho registrado; nenhuma
dessas cinco frentes iniciada nesta etapa. Não executar automaticamente ao
retomar: confirmar a frente prioritária e as definições disponíveis.
