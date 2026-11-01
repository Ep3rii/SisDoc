# Pontos de memória do projeto

Entrada curta para agentes retomarem o trabalho sem reler todo o histórico.
Atualizada em **01/11/2026**, após preparar instalação/migração Windows Server.
É um índice derivado: código, testes e decisões prevalecem em caso de conflito.

## 1. Objetivo e permissões

Cadastro de Pessoas consulta referências completas e prepara DOF e DTC
IPAM/Comissionado/INSS. Dados de trabalho são completos para todos os perfis
autenticados; isso não amplia permissões de escrita/exportação.
Administrador da Informática revisa documentos existentes e edita cadastro
local, mas não cria/copia documentos. Destinatários DOF são coordenadores
ativos, não administradores. Senha de usuário: mínimo de 10 caracteres.

Fontes: [Contexto](CONTEXTO.md), [Invariantes](INVARIANTES.md),
[decisão 027](../decisoes/027-administracao-documentos-cadastro-legado.md)
e [decisão 028](../decisoes/028-legado-operacional-e-conferencia.md).

## 2. Mapa rápido do código

| Ponto | Local e responsabilidade |
|---|---|
| API | `apps/api/src`: composição NestJS por domínio; pool/configuração únicos. |
| Web | `apps/web/src`: aplicação, autenticação, infraestrutura, compartilhado, cadastro, DOF, DTC, documentos, administração e transferência. |
| Regras compartilhadas | `packages/calculo` e `packages/contratos`: cálculo puro e validação na API/navegador. |
| Modelos | `packages/templates`: HTML escapado, modelos versionados e prévias sem scripts. |
| DTC | `documentos/dtcs.ts` coordena; `consulta-dtc.ts` consulta; `calculos/calculo-dtc.ts` calcula. |
| DOF | `documentos/rascunhos.ts` coordena; contexto, consultas, escrita e emissão/cópia separados em `*-dof.ts`. |
| Editor DOF | `apps/web/src/dof/calculo-dof.tsx` apresenta; `use-editor-dof.ts` mantém estado e pendências. |
| Templates | `packages/templates/src/index.ts` somente exporta; escape/data/campo compartilhados em `html.ts`. |
| Modelos de saída v2 | `versoes.ts` centraliza versões/CSS; `modelo-dof.ts` compartilha prévia/emissão; `emissao-dtc.ts` inclui anexo; `*-v1.ts` preservam históricos. |
| Importador | `importacao/importador.ts` coordena; estado, gravação, relatório, conferência e rollback separados. |
| CLI de importação | `argumentos-cli.ts` e `recursos-cli.ts` compartilhados; conferência não importa outra CLI executável. |
| Diagnóstico da instalação | `scripts/verificar-instalacao.cjs`: arquivos/TLS/Chromium e metadados do banco somente leitura; não aprova/restaura. |
| Sincronização | `sincronizacao/sincronizacao.ts` coordena; mapeamento e persistência por item separados. |

Caminhos de DTC/DOF/importador/CLI/sincronização são relativos a `apps/api/src`;
recursos CLI ficam na pasta `importacao`.
Detalhes e invariantes de extração: [Arquitetura](../ARQUITETURA.md).

## 3. Último estado validado

- Fatias funcionais 5–7 implementadas; fatias 8–9 e recursos externos
  adicionais continuam extras, sujeitos a autorização.
- Modularização publicada por etapas: interface `8f25038`, DTC `a0e06e2`,
  cálculo/contratos `016bca6`, importador `44aa9c5`, sincronização `7a32252`.
- DOF/templates/recursos CLI publicados na etapa 7 (`17bb1d3`).
- Última regressão completa após modelos oficiais: **251/251 testes em 32
  arquivos**, typecheck/build aprovados. Inclui 12 casos dedicados de
  versionamento, escape, prévias e geometria/paginação A4.
- Preparação de migração validada posteriormente: typecheck/build,
  31 testes direcionados em duas suítes; diagnóstico final com cinco testes,
  incluindo falha CLI sanitizada. Não é nova execução completa.
- Produção tinha página/health 200 e privados 401 após os modelos. Na
  inspeção da preparação de migração, a porta 3443 estava sem listener;
  na verificação final voltou a responder página/health 200 e privados 401
  com validação TLS. Nenhum processo operacional foi iniciado/parado nesta etapa.
- Migração autorizada `023-modelos-oficiais` cadastra quatro templates v2.
  Aplicada sem novas aprovações, preservando históricos/documentos/jobs.
  Nenhuma carga real ou sincronização externa executada.
- **Emissões v2 aguardam aprovação formal específica por tipo.** Aprovação
  antiga não autoriza v2; PDFs/snapshots antigos conservam seu renderer v1.
  Prévia já usa os formulários novos, sem validade/número/data oficiais.
  [Decisão 029](../decisoes/029-modelos-oficiais-versionados.md).

Evidências cronológicas: [Progresso](../PROGRESSO.md).

## 4. Pendências da revisão integral

**A revisão integral ainda não está concluída.** Retomar a leitura e revisão
de serviços/helpers ainda não cobertos, componentes DOF/transferência e
telas restantes, implementação setup/ferramentas e funções nomeadas das
suítes de testes. DOF da API, editor de cálculo DOF e templates foram
decompostos e documentados; entradas CLI/setup/usuários e fixtures/scripts
revisados não equivalem à revisão integral de suas dependências.
Documentar funções nomeadas/métodos com JSDoc específico após verificar
seu comportamento; não gerar comentários genéricos para simular cobertura.

Preservar locks, revisão concorrente, auditoria, aprovação por tipo,
idempotência, numeração/snapshot/job PDF atômicos e estado de edição/prévias.
Não reabrir fatias extras nem declarar conclusão pela análise do grafo.

## 5. Validação e cuidados técnicos

Na raiz do repositório, em PowerShell:

```powershell
npm run typecheck
npm run build
node scripts\executar-testes.cjs tests\arquivo.test.ts
```

Sem seletor, o runner executa a suíte completa. Ele prepara caminhos ASCII/8.3
e remove configuração/variáveis PostgreSQL operacionais do processo de teste.
Não contorne esse isolamento. Escolha a menor suíte que cubra a mudança.

Testes que verificam identidade de classes/tokens do build CommonJS da API
usam `createRequire(import.meta.url)`; referências:
`tests/modulos-api.test.ts` e `tests/importacao-falhas.test.ts`.

Resultado de domínio esperado é convertido em HTTP **após** a transação
para preservar auditoria. Falha de commit é resultado incerto: conferir
antes de repetir. Conexão com estado incerto ou lock não liberado é descartada.
Mapeamento parcial da sincronização preserva campos canônicos sem alias.

## 6. Operação e materiais locais

A instalação é HTTPS em loopback: `https://localhost:3443/`.
Início manual e atualização: [Como ligar](../COMO_LIGAR.md) e
[Operação](../OPERACAO.md). Não iniciar segunda cópia com a porta ocupada;
verificar PID/comando antes de parar somente o processo correto.
Não executar setup, migração ou operação de dados apenas para recapitular.

Migração completa para Windows Server é preparada em
[Migração Windows Server](../MIGRACAO_WINDOWS_SERVER.md): preservar dump,
cifra/HMAC, PDFs e arquivos externos da mesma captura; reaplicar ACLs por
conta do destino e instalar Chromium no contexto correto. Não executar
setup sobre restauração. `npm run verificar-instalacao` usa `SISDOC_CONFIG`
e diagnóstico somente leitura; bootstrap exige 023. Captura/restauração
operacional e aceite no Windows Server ainda não foram executados.

Configuração, chaves e certificados ficam fora do Git; nunca copiar seu
conteúdo para memórias. A pasta `Modelos e Documentação/imagens modelo/`
é material local ignorado, assim como os arquivos sensíveis já excluídos.
Contém as referências oficiais de saída DOF/DTC; não copiar exemplos
pessoais. Demonstrativos DTC são anexos; Classe DOF permanece sem fonte.
Não registrar listas de pessoas ou valores importados nesta documentação.

## Como manter estes pontos

Atualizar somente os pontos afetados após cada etapa, com evidência e
limites claros. Manter este arquivo curto; detalhes novos pertencem a
Arquitetura, Progresso, Operação ou decisões. Não guardar PIDs, sessões,
logs extensos ou suposições como fatos duráveis.
