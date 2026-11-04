# Pontos de memória do projeto

Entrada curta para agentes retomarem o trabalho sem reler todo o histórico.
Atualizada em **04/11/2026**, após validar a evolução do Núcleo em recursos descartáveis.
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

### Evolução funcional autorizada — implementada e testada, publicação pendente

O responsável aprovou o [plano](../PLANO_EVOLUCAO_NUCLEO.md), incluindo sugestões
no cadastro e contadores de pendências. Código da [decisão 033](../decisoes/033-edicao-contextual-e-historico-local.md)
implementado: ajustes exclusivos DOF/DTC, correção canônica administrativa
separada, sugestões derivadas dos ajustes salvos, prévia instantânea compartilhada,
zoom/proporção/ampliação, encaminhados/retornos, Núcleo mapeado CSV/XLSX/XML
SisDoc v1 e histórico funcional/financeiro cifrado com revisões/importação/exportação.
Não calcula folha/direitos; filtros/subtotais históricos são da página carregada.

Validados: typecheck/build; **43/43** testes de interface DOF/DTC, contratos,
permissões/tokens; **45 aprovados e um excluído** em emissão, DTC e importação,
sob LocalService com PostgreSQL descartável. Inclui instalação com 025,
atualização, PDFs, ajustes no snapshot/cópia, sugestões, retornos e histórico.
Excluído teste de carga preexistente que cria 48 sessões e exige 64.
Fundação completa não validada: CLI tenta recompilar código sem ACL de escrita
sob LocalService. Não ampliar ACL do código nem usar produção para contornar.
Prévia válida de 45 anos/200 blocos/20 mil caracteres: máximo 135,3 ms nesta VM.

**Instalação continua em 024. Não reiniciar usando build candidato sem migrar.**
Autorização específica de backup/migração/publicação não foi obtida.
Os builds de validação haviam substituído artefatos locais; para não misturar
web nova e API antiga, os cinco `dist` foram repostos a partir de uma compilação
isolada de `f788a6d`, sem reverter fontes. SHA-256 conferido; página HTTPS
serve o bundle anterior, health 200 e privado 401. Serviços continuam Running,
sem reinício ou migração nesta etapa. Fontes novas permanecem não commitadas.
Novo `npm run build` nesta pasta volta a substituir artefatos servidos:
validar/publicar em janela controlada, com backup e migração 025.
Avaliação e prioridades visuais: [UI/UX](../AVALIACAO_UI_UX.md).

### Perfis, rascunhos e serviços Windows — 03/11/2026

Implementada a migração obrigatória `024-perfil-secretario-adjunto`, a
descontinuação do perfil sem transferir permissões exclusivas e o acesso
compartilhado de consulta/edição restrito a rascunhos DOF/DTC. Encaminhamento
DOF ativo continua bloqueando edição; conferência, emissão e outras transições
não foram ampliadas.

Validados: typecheck; 16 testes de interface; cinco testes de permissões e
tokens. A suíte de fundação/migração não iniciou porque o PostgreSQL embutido
recusa execução sob a conta Windows administrativa da sessão.

Estado observado em 03/11/2026 20:42 (somente leitura): diagnóstico
`npm run verificar-instalacao` aprovado e histórico confirmado até
`024-perfil-secretario-adjunto`; API ativa em `127.0.0.1:3443` e Caddy ativo
em `192.168.70.26:443`, ambos sob `NT AUTHORITY\LOCAL SERVICE`.
A rota de health responde 200 e rota privada sem sessão responde 401 no
caminho direto da API e via proxy. Em 03/11/2026 22:54, SisDoc e SisDocCaddy
foram confirmados como serviços Windows sob LocalService e reiniciados na
ordem de dependência, sem reiniciar PostgreSQL. Health via proxy 200 e privado
sem sessão 401; certificado/nome validados, sem verificar revogação.
Aprovação formal dos templates v2 continua pendente.

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

A instalação aceita dois pontos de acesso HTTPS:
- direto na API em loopback: `https://localhost:3443/`;
- proxy Caddy na LAN (escopo restrito por firewall): `https://192.168.70.26/`.
Base de decisão: [031](../decisoes/031-servicos-locais-caddy.md) e
[032](../decisoes/032-proxy-lan-restrito.md).

Início manual e atualização: [Como ligar](../COMO_LIGAR.md) e
[Operação](../OPERACAO.md). Não iniciar segunda cópia com a porta ocupada;
verificar PID/comando antes de parar somente o processo correto.
Não executar setup, migração ou operação de dados apenas para recapitular.

Migração completa para Windows Server é preparada em
[Migração Windows Server](../MIGRACAO_WINDOWS_SERVER.md): preservar dump,
cifra/HMAC, PDFs e arquivos externos da mesma captura; reaplicar ACLs por
conta do destino e instalar Chromium no contexto correto. Não executar
setup sobre restauração. `npm run verificar-instalacao` usa `SISDOC_CONFIG`
e diagnóstico somente leitura; bootstrap exige 024. Captura/restauração
operacional e aceite no Windows Server ainda não foram executados.

No destino, em 03/11/2026, o responsável confirmou VM exclusiva e escolheu
**instalação limpa**, substituindo a intenção de restaurar a origem.
Dependências reinstaladas; typecheck/build e cinco testes do diagnóstico
aprovados. PostgreSQL 16 restringido a `127.0.0.1` e serviço reiniciado.
Diretórios externos protegidos, TLS local confiável, lista de senhas com
licença e Chromium compartilhado preparados. Conta executora não
administrativa validada: acesso a código/TLS/lista, provisionamento negado,
HTTPS e PDF em memória aprovados. Fluxo local interativo de conclusão
disponível fora do Git; detalhes em [Instalação](../INSTALACAO_LOCAL.md).
Na validação mais recente, configuração/provisionamento já existem e o
diagnóstico somente leitura passou: banco/login restrito e histórico completo
até 024, arquivos/TLS/PDF/Chromium acessíveis. Página/health HTTPS 200 e
privados 401. API e Caddy ativos sob a conta dedicada (`LocalService`), porém
como processos diretos (sem serviços WinSW registrados); não repetir setup.
Pendente validar execução sob conta dedicada, primeiro login/troca e aceite
funcional, conferir um formato de processo configurado e aprovar formalmente
os quatro templates v2. `SISDOC_CONFIG` não persistida: definir por sessão.
Serviço automático e backup/recuperação continuam separados.
Tentativa adicional da suíte fundação falhou na preparação dos recursos
descartáveis (27 casos não executados); não declarar regressão aprovada.

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
