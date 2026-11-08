# Pontos de memória do projeto

## Ficha do servidor — 08/11/2026

Início é a entrada de todos os perfis. Busca por matrícula abre diretamente
a ficha quando há uma única pessoa em todas as páginas; ambiguidades
permanecem na lista. Cartões por vínculo levam ao cálculo DOF; DTCs recebem
o servidor/vínculo sem nova busca. Admin consulta, mas não cria documentos.
Documentos por pessoa preservam visibilidade e paginação na API; histórico
funcional do Núcleo tem contagem total e abre sob demanda. Referências e
edição cadastral continuam disponíveis, sem mudança do motor de cálculo.
GET `servidores/:id/ficha` e `servidores/:id/documentos`, sem migração.

Typecheck/build e 30 testes focados passaram, incluindo integração real
descartável com 52 vínculos e aceite de três interações no navegador.
Ficha observada em 1366/768/390 px com dados fictícios. Instalação única
reiniciada, serviços ativos; HTTPS validado sem ignorar certificados:
health `200`, novas rotas sem sessão `401`, Caddy `200`, seis assets e
index iguais ao build. Base real não recebeu dados de teste.
Detalhes e limites em [Progresso](../PROGRESSO.md).

Entrada curta para agentes retomarem o trabalho sem reler todo o histórico.
Atualizada em **05/11/2026**, com a decisão de manter uma instalação editável
única chamada Produção.
É um índice derivado: código, testes e decisões prevalecem em caso de conflito.

## Habilidades locais do Copilot — 08/11/2026

Instaladas em `.github/skills`: `sisdoc-inspecao-visual`,
`sisdoc-testes-depuracao` e `sisdoc-api-dados`. Consulte o catálogo em
`.github/copilot-instructions.md`. São fluxos locais adaptados ao ambiente
único, aos testes descartáveis e à proteção de dados reais; não adicionam
dependências, MCPs, permissões ou instalações operacionais.
Formato, nomes e referências locais foram conferidos no checkout; descoberta e
invocação efetiva no VS Code exigem uma nova conversa no harness pretendido.
Nenhum build, reinício, publicação ou alteração de banco faz parte desta etapa.

## Foco atual da retomada — ambiente único

O checkout `C:\SisDoc` é a única versão editável e deve também servir a
aplicação pelo serviço Windows. Não criar Homologação/staging, banco
operacional duplicado, cópias de projeto ou fluxo de promoção/publicação.
Configuração externa, dados persistentes e salvaguardas de alterações no banco
continuam válidos. Consulte [Ambiente único — Produção](../AMBIENTE_PRODUCAO.md),
[Invariantes](INVARIANTES.md) e [decisão 035](../decisoes/035-versoes-e-ambientes.md).

**Estado validado em 05/11/2026:** SisDoc e SisDocCaddy estão ativos; o XML do
serviço SisDoc aponta para `C:\SisDoc`. Typecheck e build passaram. Smoke
somente leitura: API health `200`, rota privada sem sessão `401`, proxy `200`
e seis assets servidos iguais ao build do checkout. As cópias de projeto nos
diretórios de release foram removidas. Nenhuma gravação ou migração de banco
foi executada.

### Ajustes de interface — 05/11/2026

Foram alinhadas datas em tabelas, badges, avisos de aprovação junto à emissão
PDF, login (sem sidebar, centralizado e com ícone de senha), rolagem/rodapé da
sidebar, títulos de seção, contraste, estilos de botões, estados vazios com
ação contextual e indicador de sincronização por ponto com tooltip. A
formatação compartilhada preserva datas civis sem deslocamento de fuso. Não
houve mudança de lógica de negócio.

Typecheck/build passaram e a aplicação foi reiniciada. Login foi verificado no
navegador em 390, 768 e 1366 px; health `200`, rota privada sem sessão `401`
e proxy `200`. Telas autenticadas não foram navegadas manualmente; nenhuma
autenticação ou escrita no banco foi realizada.

### Busca unificada — 08/11/2026

Busca compartilhada no topo e no centro do Início, sem seletor de critério.
Números e matrículas com sufixos numéricos buscam matrícula exata; demais
termos buscam nome. Enter envia; `/` foca a busca fora de campos de texto;
Início recebe foco automático. A seleção de DTC registra temporariamente seu
destino para receber a busca do topo e cancela o registro ao sair; não há
campo duplicado nem Voltar à lista. O filtro local do Início foi removido.
API/permissões/documentos não mudaram. Typecheck/build e 7 testes direcionados
de navegador/paginação passaram. Quatro testes antigos ainda esperam UI
anterior; detalhes em [Progresso](../PROGRESSO.md).
Build instalado na versão única, serviços ativos após reinício e smoke HTTPS
`200/401/200` confirmado, sem gravação de dados de teste na base real.

### Histórico da primeira publicação — 05/11/2026

Em 05/11/2026 foi publicado o release local `v0.1.0`, commit `22f38b3`, no
diretório `C:\ProgramData\SisDoc\instalacao\releases\v0.1.0`. Build, typecheck,
42 testes focados e verificações somente leitura passaram; health HTTPS 200,
rota privada sem sessão 401 e assets do entrypoint foram conferidos. Nenhuma
migração ou aprovação de modelo foi executada. O backup pré-deploy somente do
banco e o rollback `0529dc3` foram preservados; detalhes em
[Progresso](../PROGRESSO.md). O commit/tag não foram enviados ao remoto.

Naquele estado, Homologação não existia por falta de recursos independentes e
permissões de provisionamento. A proposta foi posteriormente substituída pela
decisão de instalação única; as evidências de release acima são históricas,
não instruções para alternar ambientes.

### Revisão visual em 05/11/2026

A importação administrativa foi revisada no preview local, com API/sessão
sintéticas, nas larguras desktop, tablet e celular. Abaixo de 900 px o menu
recolhe para liberar largura. A etapa Importar separa arquivo/destino de aba
XLSX, mostra progresso como etapas (não botões), explica o mapeamento e ajusta
etapa final/ação ao destino. XML e requisitos ficam recolhidos; a tabela
histórica foi observada com valores sintéticos. Build web passou. Nenhuma
autenticação ou escrita na instalação operacional.

### Continuação em 05/11/2026 — importação de histórico

No importador de histórico por pessoa/vínculo, a tela agora oferece apenas o
grupo ativo (Histórico Funcional ou Histórico Financeiro); contrato e API
exigem o grupo, rejeitam linhas de outro grupo e incluem o grupo na prova da
validação. Divergências seguem sem sobrescrita. Typecheck e 18 testes focados
de evolução do Núcleo passaram.

Isso **não consolidou ainda o importador administrativo geral em três
categorias**: nele continuam Dados Funcionais, Afastamentos, Incorporações,
Períodos IPAM e Eventos Funcionais. A consolidação precisa dos exemplos das
tabelas históricas para definir layout, chaves de vínculo, mapeamento e
reconciliação; não remover esses fluxos nem inventar compatibilidades antes
disso. Estado e limites em [Dados e importação](../DADOS_E_IMPORTACAO.md) e
[Progresso](../PROGRESSO.md).

A etapa mais recente está implementada no worktree, mas **não foi publicada**.
Ver [decisão 034](../decisoes/034-emissao-em-lote-e-motivos-condicionais.md)
e [evidências](../PROGRESSO.md): emissão sequencial por item nas DOFs
conferidas/DTCs carregadas, revisão individual da prévia e prova atual de
fonte, idempotência preservada no retry, motivos condicionais e viewer/layout
unificados. Blocos da página 2: extração dos campos de eventos para sugestão
inativa, com destino escolhido manualmente e revisão obrigatória; sem
classificação ou cálculo automático. Typecheck, build web, 24 testes focados
DOF/DTC e teste direcionado de blocos passaram; `git diff --check` passou.
Sem mudança de banco/serviços ou publicação.

**Pendente desta etapa:** classificação automática dos eventos e cálculos dos
blocos da página 2. Tipos dos eventos importados são texto livre; não há
mapeamento aprovado para as quatro categorias dos blocos nem fórmulas
homologadas. Não inferir texto oficial ou cálculo. Retomar após validação
institucional do mapeamento, precedência, conflitos e cálculos.

## Pendências estruturais — conclusão funcional

O responsável retirou migração de máquina do foco ativo; manter seus registros
apenas como referência, sem apagar evidências ou proteções operacionais.
Novo [plano em rascunho](../PLANO_CONCLUSAO_APLICACAO_RASCUNHO.md):
tabelas das fichas financeiras; histórico funcional ainda a apurar;
dossiês antigos ainda a tratar; revisão das regras/campos; tipos e layout
da importação do Núcleo. Histórico genérico existente não fecha esses domínios.
Essas frentes continuam apenas planejadas; não presumir modelos finais nem
usar dados reais em testes. Retomá-las após resolver a pendência de mapeamento
dos blocos ou por nova priorização do responsável.

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

### Estado corrente do worktree — lote e interface

A [decisão 034](../decisoes/034-emissao-em-lote-e-motivos-condicionais.md)
documenta os limites do lote, a elegibilidade explícita da fonte DTC, o retry
com a mesma chave e os motivos condicionais. Implementação e testes estão no
worktree, **sem publicação/commit**. A automação textual e de cálculos da
página 2 está limitada à extração dos campos disponíveis para sugestão
inativa e revisável, com seleção manual do destino. Classificação automática
e cálculos continuam pendentes de regras institucionais aprovadas; não foram
misturados ao cálculo da página 1.

### Evolução funcional e UI/UX — implementadas, testadas e publicadas

O responsável aprovou o [plano](../PLANO_EVOLUCAO_NUCLEO.md), incluindo sugestões
no cadastro e contadores de pendências. Código da [decisão 033](../decisoes/033-edicao-contextual-e-historico-local.md)
implementado: ajustes exclusivos DOF/DTC, correção canônica administrativa
separada, sugestões derivadas dos ajustes salvos, prévia instantânea compartilhada,
zoom/proporção/ampliação, encaminhados/retornos, Núcleo mapeado CSV/XLSX/XML
SisDoc v1 e histórico funcional/financeiro cifrado com revisões/importação/exportação.
Não calcula folha/direitos. Histórico tem filtros globais por competência,
período/rubrica e totais brutos globais no servidor, separados dos estornos;
busca textual permanece restrita à página. Seletores carregam todas as páginas
dos relacionamentos. DTC usa abas com estado preservado e validação focada;
prévia ampliada usa modal nativo/foco/Escape. Importação mostra etapas reais
e resumo de divergências; sugestões comparam cadastro e declaração.
Menu recolhível, orientação compacta, senha revelável e telas sob demanda.
Falha de download de tela mostra erro e recarga explícita.

Validados: typecheck/build; **46/46** testes de interface DOF/DTC, contratos,
permissões/tokens; **45 aprovados e um excluído** em emissão, DTC e importação
sob LocalService com PostgreSQL descartável. Inclui instalação/atualização 025,
PDFs, histórico global/paginação, relacionamentos completos, foco/modal e falha
de chunk. Excluído teste preexistente que cria 48 sessões e exige 64.
Fundação completa não validada: CLI recompila código sem ACL de escrita sob
LocalService. Não ampliar ACL do código nem usar produção para contornar.
Prévia válida máxima de 131,4 ms no seletor final (45 anos/200 blocos/20 mil caracteres).

Publicação expressamente autorizada: backup cifrado verificado, migração
**025-historico-servidor** aplicada e API/Caddy reiniciados em ordem.
Diagnóstico aprovado, serviços automáticos Running sob LocalService,
health HTTPS 200 e privado 401. Index e 23 assets publicados conferidos
por SHA-256 com o build final. Nenhuma carga fictícia/restauração em produção,
nem aprovação de modelos. Backup DPAPI CurrentUser é local/não portável;
leitura integral do dump e conferência criptográfica não equivalem a ensaio
de restauração. Backup externo/agendado e aceite com operadores continuam pendentes.
Base funcional em `3404937`; Git reconferido no planejamento posterior:
melhorias UX permanecem no worktree, sem novo commit/push.
Build no checkout substitui artefatos servidos:
atualizações futuras exigem janela controlada.
Evidências e limites: [Progresso](../PROGRESSO.md) e [UI/UX](../AVALIACAO_UI_UX.md).

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
e diagnóstico somente leitura; bootstrap exige 025. Restauração operacional
e aceite formal no Windows Server ainda não foram executados.

No destino, em 03/11/2026, o responsável confirmou VM exclusiva e escolheu
**instalação limpa**, substituindo a intenção de restaurar a origem.
Dependências reinstaladas; typecheck/build e cinco testes do diagnóstico
aprovados. PostgreSQL 16 restringido a `127.0.0.1` e serviço reiniciado.
Diretórios externos protegidos, TLS local confiável, lista de senhas com
licença e Chromium compartilhado preparados. Conta executora não
administrativa validada: acesso a código/TLS/lista, provisionamento negado,
HTTPS e PDF em memória aprovados. Fluxo local interativo de conclusão
disponível fora do Git; detalhes em [Instalação](../INSTALACAO_LOCAL.md).
Na validação mais recente, configuração/provisionamento já existem,
banco/login restrito e histórico completo até 025 foram confirmados.
Arquivos/TLS/PDF/Chromium acessíveis; página/health HTTPS 200 e privados 401.
API e Caddy são serviços Windows automáticos sob `LocalService`; não repetir setup.
Primeiro login/troca, aceite funcional institucional, formato de processo e
aprovação formal dos quatro templates v2 continuam pendentes.
`SISDOC_CONFIG` está configurada no serviço; terminais separados precisam
defini-la por sessão. Backup local protegido foi capturado na publicação;
agendamento, cópia externa e ensaio de recuperação não estão homologados.
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
