# Arquitetura e revisão estrutural

## Decisão e alcance

Em 01/11/2026 foi autorizada a revisão e refatoração por etapas, publicando
cada etapa validada. A aplicação continua um **monólito modular local**:
não foram introduzidos microsserviços, broker, ORM, outro banco ou ambientes
permanentes. Rotas, contratos, papéis, numeração, auditoria e comandos de
operação devem permanecer compatíveis.

A revisão inicial inspecionou o grafo de imports relativos de todos os
arquivos TypeScript/TSX/CJS de aplicações, pacotes, ferramentas, scripts e
testes. A leitura detalhada nesta etapa cobriu composição, bootstrap,
configuração, transações, guarda, erros e integração dos serviços no Nest.
Isso **não equivale a revisão semântica completa de cada função**, nem a
uma auditoria de vulnerabilidades ou nova certificação de concorrência.

## Diagnóstico inicial

Inventário após a extração dos módulos: 178 arquivos, incluindo 30 arquivos
de testes. Não foram encontrados ciclos nos imports locais resolvidos pela
análise estática. Imports dinâmicos, dependências de pacotes e relações
transacionais não são provados por essa verificação.

| Área | Diagnóstico | Tratamento |
|---|---|---|
| Monorepo | API, web, contratos, cálculo e templates já têm fronteiras úteis. | Preservar workspaces e separar responsabilidades dentro deles. |
| Composição API | Um único módulo registrava todos os controllers e factories. | Etapa 1: módulos NestJS por domínio, com serviços privados. |
| Infraestrutura | Pool/configuração precisam ser únicos; workers devem terminar antes de fechar o banco. | Etapa 1: módulo global restrito a esses dois recursos e encerramento testado. |
| Segurança | Guarda global aplica políticas e CSRF; serviços também confirmam sessão em transações. | Preservar as duas camadas; modularizar não substitui autorização. |
| Documentos | Rascunhos (~87 KB) e DTC (~55 KB) concentram consultas, cálculo e transições. | Revisar e extrair unidades coesas em etapa própria, preservando locks, revisões e atomicidade. |
| Cadastro e transferência | Cadastro importa um helper do exportador; rascunhos referenciam constantes de migrações. | Dependências existentes a revisar; não mover helpers ou constantes sem ler todos os consumidores. |
| Web | 25 arquivos na raiz, com editor DOF, DTC e cadastro extensos. Cliente HTTP reúne vários domínios. | Etapa 2: pastas por domínio, transporte compartilhado, clientes tipados e componentes Cadastro/DTC separados. Editor DOF e transferência ainda precisam decomposição. |
| Pacotes | Motor compartilhado evita divergência entre navegador/API; contratos e templates têm arquivos agregadores com lógica. | Preservar API pública; separar implementação dos exports quando os domínios forem revisados. |
| Testes | Fundação reúne instalação, banco, autorização e documentos em um arquivo amplo. | Preservar regressões; separar fixtures e suítes apenas com isolamento comprovado. |
| Documentação | Cobertura JSDoc é baixa: 14 de 811 declarações com corpo na varredura inicial, contando métodos e construtores. | Documentar função por função durante a revisão de cada módulo; não gerar comentários genéricos. |
| Operação | Aplicação inicia manualmente; backup e serviço automático continuam extras. | Não incluir novos recursos operacionais nesta refatoração. |

## Estrutura da API após a etapa 1

```text
apps/api/src/
  main.ts                         entrada operacional; pool e instalação
  aplicacao.ts                    HTTPS, CSP, assets e composição
  app.module.ts                   importa os módulos; não registra serviços
  injecao.ts                      identidade dos tokens BANCO/CONFIGURACAO
  infraestrutura/
    infraestrutura.module.ts      recursos únicos e encerramento do pool
    saude.controller.ts           diagnóstico público sem dados funcionais
  seguranca/seguranca.module.ts    autenticação, usuários e guarda global
  servidores/servidores.module.ts cadastro local e referências
  calculos/calculos.module.ts     cálculo pela API
  documentos/documentos.module.ts DOF, DTC, emissão, exclusão e worker PDF
  importacao/importacao.module.ts arquivos e promoção Legado → Núcleo
  sincronizacao/sincronizacao.module.ts integração externa e agendamento
  migracoes/                      versões e privilégios existentes
  setup/                          instalação, atualização e aprovação
```

Arquivos de infraestrutura já usados por CLI permanecem na raiz nesta
etapa. Em particular, `configuracao.ts` resolve a raiz a partir de
`__dirname`; movê-lo exige revisar seus consumidores e a instalação.
Não foram adicionados arquivos de compatibilidade nem reexports artificiais:
o teste de health passou a importar seu novo arquivo.

```mermaid
flowchart TD
  Bootstrap["main / criarAplicacao"] --> App["AppModule"]
  App --> Infra["InfraestruturaModule: pool + configuração"]
  App --> Seg["SegurancaModule: guarda global"]
  App --> Cad["ServidoresModule"]
  App --> Calc["CalculosModule"]
  App --> Doc["DocumentosModule"]
  App --> Imp["ImportacaoModule"]
  App --> Sync["SincronizacaoModule"]
  Calc --> Motor["@sisdoc/calculo"]
  Doc --> Motor
  Doc --> Templates["@sisdoc/templates"]
  Web["React / Vite"] --> Motor
  Web --> Templates
  Motor --> Contratos["@sisdoc/contratos"]
  Templates --> Contratos
```

## Invariantes de modularização

### Interface — etapa 2

```text
apps/web/src/
  main.tsx                  montagem React e validação do elemento raiz
  aplicacao/app.tsx          sessão, navegação, menu e proteção de edição
  autenticacao/acesso.tsx    entrada e troca obrigatória de senha
  infraestrutura/
    http.ts                 transporte, erros e validação de respostas
    api.ts                  fachada tipada composta por domínio
    *.api.ts                autenticação, administração, cadastro,
                            sincronização, documentos, DOF e DTC
  compartilhado/            abas, filtros de lista e estilos
  administracao/            usuários e auditoria
  cadastro/                 lista, busca, detalhe, referências,
                            eventos e editor local
  dtc/                      lista, seleção, contexto, editor e documento
  dof/                      cálculo e etapas do fluxo DOF
  documentos/               histórico, emissão e exclusão
  transferencia/            importação/exportação, promoção e sincronização
```

Os componentes extraídos preservam sua posição na árvore React, chaves,
estado, efeitos e guardas de saída. O cliente continua usando a mesma
fachada `api`; transporte centraliza cookies, CSRF, prova da fonte, erros
e contratos sem duplicação. Imports dos consumidores foram atualizados,
sem criar wrappers para os caminhos antigos.

JSDoc específico cobre os clientes e transporte, autenticação/composição,
grupos Cadastro/DTC, filtros, abas e download de emissão. Isso ainda não
representa cobertura integral das funções web ou revisão semântica dos
grandes serviços. Typecheck e build web aprovados; **30 testes em quatro
suítes de navegador** passaram, incluindo rascunhos, DTC, transferência,
referências e cálculo no limite de tamanho.

- Registrar `InfraestruturaModule.registrar(...)` uma única vez no módulo
  raiz. Somente `BANCO` e `CONFIGURACAO` são exports globais.
- Controllers e serviços pertencem a seus módulos; não exportar tudo para
  evitar erros de injeção. Nova dependência entre domínios exige justificativa.
- Registrar a guarda por `APP_GUARD` no módulo de segurança; o escopo é
  global, mas `AutenticacaoService` permanece privado.
- Manter DOF, DTC, emissões e worker juntos até revisar suas fronteiras
  transacionais. Não dividir uma transação entre serviços ou abrir outro pool.
- Hooks `onModuleDestroy` dos workers precedem `onApplicationShutdown`
  do banco. Instanciar serviços por factories preserva esse ciclo NestJS.
- Pacotes compartilhados não importam aplicações. Cálculo não depende de
  HTTP, banco, sessão ou navegador; apresentação não decide autorização.
- Não mover migrações, mudar nomes de tabelas ou reimportar dados para
  acompanhar uma mudança de organização do código.

## Comentários dentro do código

Formato acordado: **JSDoc em cada função nomeada e método**, com propósito,
contrato relevante e efeitos/riscos não óbvios. Explicar referências entre
módulos, tokens e regras; não comentar indiscriminadamente imports,
callbacks anônimos ou variáveis autoexplicativas.

A etapa 1 documenta funções da composição, configuração, bootstrap,
transações, health e tratamento de erros. Métodos de domínio, interface,
pacotes, CLI e ferramentas ainda precisam de revisão e documentação.
Não afirmar que “todo o código está comentado” até concluir essas etapas.

## Sequência e validação

1. **Composição API:** extração de módulos e testes de injeção, escopo,
   encerramento e regressão HTTPS/banco.
2. **Interface por domínio:** mover componentes e transporte com todos os
   imports atualizados; preservar estado, prévias, acessibilidade e proteção
   de alterações pendentes. Validar build e testes de navegador.
3. **Serviços de domínio:** decompor primeiro DOF/DTC e transferência após
   leitura das transições e testes; documentar cada função nomeada.
4. **Pacotes, CLI e testes:** finalizar organização, JSDoc e revisão de
   referências; executar regressão completa antes de declarar encerramento.

Usar `npm run typecheck`, `npm run build` e o runner existente
`node scripts\executar-testes.cjs`. Testes nunca usam a configuração
operacional. O teste de composição carrega o build CommonJS por
`createRequire` para preservar a identidade dos tokens/classes do Nest;
imports intermediados pelo runner podem criar outra identidade de símbolo.

A produção recebe apenas builds validados, com reinício controlado do PID
confirmado e verificação HTTPS. Nenhuma migração é necessária para a
extração dos módulos.
