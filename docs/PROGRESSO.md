# Progresso da construção

## Instalação única editável — 05/11/2026

A diretriz atual é manter uma única versão editável, chamada Produção, no
checkout `C:\SisDoc`. Não criar Homologação/staging, banco operacional
duplicado, cópias de projeto ou fluxo de promoção/publicação. O serviço
Windows deve usar o mesmo checkout; configuração externa, dados persistentes e
salvaguardas do banco permanecem separados do código. Ver
[Ambiente único — Produção](AMBIENTE_PRODUCAO.md) e
[decisão 035](decisoes/035-versoes-e-ambientes.md).

## Ajustes de interface — 05/11/2026

**Implementado:** datas de tabelas em `dd/mm/aaaa` (com hora mantida para
registros de data/hora); contador de encaminhados azul; aviso de aprovação
restrito aos controles de emissão PDF; login centralizado sem sidebar, com
ícone acessível para mostrar/ocultar senha e sem preenchimento de usuário;
menu da sidebar com rolagem própria e rodapé fixo; títulos de seção com 13 px
ou mais; contrastes revisados; estilos primário/secundário/destrutivo
uniformizados; estados vazios com ação quando há próximo passo; status da
sincronização reduzido a ponto com tooltip.

**Testado e instalado na versão única:** `npm run typecheck` e `npm run build`
passaram. O navegador mostrou login responsivo em 390, 768 e 1366 px, sem
sidebar e sem aviso de emissão no topo; health HTTPS `200`, rota privada sem
sessão `401` e página Caddy `200`. Contrastes conferidos: textos pequenos
cinza e estados desabilitados ajustados acima de 4,5:1. Serviços foram
reiniciados e seguem ativos. Nenhuma sessão autenticada ou operação de banco
foi usada; telas autenticadas compilam, mas não foram navegadas manualmente
nesta rodada. Lógica de negócio não foi alterada.

**Implementado e validado diretamente na instalação única:** o serviço
Windows SisDoc usa `C:\SisDoc`; as cópias `v0.1.0`,
`v0.1.0-candidate` e `v0.0.0-rollback` foram removidas após a troca. O
typecheck e o build passaram. Smoke test somente leitura: health da API
`200`, rota privada sem sessão `401`, proxy `200` e os seis assets servidos
correspondem ao build do checkout (`200`). Nenhum dado foi gravado no banco;
testes automatizados de lógica não foram executados porque a alteração foi
documental e de configuração operacional.

**Histórico da primeira publicação — 05/11/2026:** release `v0.1.0`, commit
`22f38b3`, foi instalado em
`C:\ProgramData\SisDoc\instalacao\releases\v0.1.0`. Naquele estado, `npm ci`
não reportou vulnerabilidades; build e typecheck completos passaram; 42 testes
focados em importação, histórico, DOF e DTC passaram. O diagnóstico de
instalação somente leitura passou no banco/migração 025. Nenhuma migração de
schema ou aprovação de template foi aplicada. A validação então registrou
`SisDoc` e `SisDocCaddy` ativos, API HTTPS health 200, rota privada sem sessão
401, proxy página 200 e os seis assets do entrypoint comparados por hash. A
página compartilhada mostrou login, sem autenticação ou gravação.

O backup pré-deploy do PostgreSQL custom foi validado por `pg_restore --list`,
cifrado DPAPI CurrentUser e conferido por hash em round-trip:
`C:\ProgramData\SisDoc\instalacao\backup\release-v0.1.0-20261105\sisdoc.dump.dpapi`
(SHA-256 do cifrado:
`61FA0FEDDFF5AFC9884D8314BE3DFCBA6CD9FEDF3CC531ADEC566F57839DA7AA`).
É backup local apenas do banco; não é backup completo nem ensaio de
restauração. O rollback `0529dc3` foi mantido em
`C:\ProgramData\SisDoc\instalacao\releases\v0.0.0-rollback` naquele momento;
a cópia foi removida após a troca para o checkout único, e o commit continua
disponível no histórico Git. Esses registros são históricos, não instruções
para promover ou alternar instalações.

Na publicação anterior, Homologação não foi criada: a porta `127.0.0.1:3444`
estava livre, faltavam banco/configuração/chaves/certificado independentes e o
papel PostgreSQL conhecido não tinha `CREATEDB` ou `CREATEROLE`. Esse plano foi
substituído pela decisão de instalação única. O commit/tag da publicação não
foram enviados ao remoto; a tentativa de conexão PostgreSQL administrativa
sem senha foi recusada.

## Revisão visual da importação — 05/11/2026

Observação realizada em preview local do build, com sessão e respostas
inteiramente sintéticas; a página compartilhada em produção permaneceu no
login, sem autenticação ou gravação. Em 1366 px, 764 px e 390 px:

- A navegação lateral passava a comprimir o conteúdo em larguras de tablet.
  O menu agora recolhe abaixo de 900 px, preservando a área útil.
- A importação foi organizada em seções de arquivo/destino e aba XLSX, com
  etapas visuais não confundíveis com botões. A última etapa e a ação mudam
  conforme o fluxo: guardar no Legado, guardar para mapear ou aplicar no Núcleo.
- A opção de mapeamento explica o que acontece, XML/requisitos ficam em seção
  recolhida e a confirmação permanece indisponível até validar o arquivo.
  A mensagem de validação não aparece antes de selecionar/validar arquivo.
- Conferência e lotes foram inspecionados com linhas sintéticas; tabelas
  preservam rolagem horizontal e cabeçalhos, sem remover campos operacionais.

**Validação:** build web e `npm run typecheck` aprovados; `git diff --check`
limpo. Preview verificado visualmente e por acessibilidade em desktop, tablet
e celular, incluindo os três destinos/modos, sem transbordamento horizontal
da página. Nenhuma interação com produção, dado real, banco, publicação ou
commit.

## Separação da importação de históricos — 05/11/2026

Implementada no histórico por pessoa/vínculo a seleção exclusiva entre
**Histórico Funcional** e **Histórico Financeiro**. O grupo é exigido no
contrato e na API; linhas de outro grupo são rejeitadas, o grupo integra a
prova de validação, e os modelos/ações exibidos correspondem à aba ativa.
Divergências existentes seguem preservadas; não há sobrescrita automática.

**Limite ainda pendente:** o importador administrativo do Núcleo continua com
os tipos de origem atuais (Dados Funcionais, Afastamentos, Incorporações,
Períodos IPAM e Eventos Funcionais). Não os removi nem agrupei sem amostras
das tabelas de Histórico Funcional/Financeiro: falta definir identificação
do vínculo, mapeamento e reconciliação. Os modelos genéricos atuais são
provisórios e não substituem o layout real a ser apresentado.

Ver [Dados e importação](DADOS_E_IMPORTACAO.md) e
[decisão 033](decisoes/033-edicao-contextual-e-historico-local.md).
Typecheck e teste direcionado de evolução do Núcleo aprovados; nenhuma
alteração de banco, publicação ou commit.

## Prévia, motivos e emissão em lote — 04/11/2026

Implementação atual no worktree, ainda **não publicada**. A [decisão 034](decisoes/034-emissao-em-lote-e-motivos-condicionais.md)
registra o escopo e seus limites:

- DOF conferidas (página atual) e DTCs conferidas (itens carregados do tipo)
  podem ser selecionadas para emissão sequencial. Cada documento exige prévia
  aberta e revisada, prova da fonte atual explicitamente válida e chave
  idempotente própria. Falhas são individuais; emissões concluídas não são
  revertidas. Aprovações, permissões e validações do servidor permanecem
  obrigatórias.
- A DTC com estado de fonte `null` não é considerada íntegra nem habilitada
  para emissão em lote. Resultado incerto preserva a chave no retry enquanto
  a interface permanece aberta; após recarga, consultar o Histórico antes de
  tentar outra emissão.
- Motivos de cálculo/processo/blocos DOF e conteúdo DTC aparecem quando há
  mudança real contra o documento salvo; restaurar os valores limpa motivo e
  pendência. Motivos de devolução/transição permanecem inalterados.
- Visualizadores DOF/DTC foram uniformizados e o layout ficou fluido e
  responsivo; prévias de edição continuam instantâneas e locais.

**Blocos da página 2 — extração parcial implementada:** a tela carrega eventos
funcionais e permite copiar os campos disponíveis para um bloco inativo,
escolhido manualmente. A sugestão não classifica eventos, não calcula
períodos/direitos e exige revisão/edição antes de ativação. Classificação
automática dos eventos e fórmulas homologadas continuam pendentes de validação
institucional; nenhum texto oficial ou cálculo é inferido.

**Validação:** `npm run typecheck`, build web e 24 testes focados de interface
DOF/DTC aprovados, com API sintética e dados fictícios. O teste direcionado de
blocos também passou, cobrindo extração revisável, bloco inativo, prévia e
preservação de alterações/conflitos. `git diff --check` aprovado. Sem
alteração de banco/serviços, publicação, aprovação de modelos ou commit/push.

## Rascunho de conclusão funcional — 04/11/2026

Por orientação do responsável, migração de máquina deixa o foco ativo;
seus registros ficam como referência histórica, sem exclusão de evidências.
Criado [plano em rascunho](PLANO_CONCLUSAO_APLICACAO_RASCUNHO.md) para
retomada: fichas financeiras, histórico funcional ainda a apurar, dossiês
antigos ainda a tratar, revisão de regras/campos e tipos/layout de importação.
Inclui levantamento de fontes, dependências, entregáveis, aceite e ponto
exato de retomada, distinguindo o histórico genérico já existente do domínio
definitivo ainda não apurado.

**Realizado:** planejamento documental e atualização dos pontos de memória.
**Pendente:** confirmação de prioridade, apuração e aprovação das propostas;
nenhuma implementação dessas frentes, importação, mudança de banco/serviços
ou publicação nesta etapa. Git conferido: base `3404937`, alterações UX
anteriores ainda no worktree e preservadas. Sem novo commit/push.
Validação documental por leitura e `git diff --check`; testes de código não
se aplicam a esta entrega exclusivamente documental.

## Publicação autorizada e melhorias UI/UX — 04/11/2026

Pedido expresso do responsável autorizou publicar a evolução anterior e
executar as prioridades de [UI/UX](AVALIACAO_UI_UX.md). Estado atual:
**implementado, testado e publicado**; os registros abaixo sobre publicação
pendente são históricos, anteriores a esta autorização.

- DTC organizada em abas com lançamentos preservados, totais e próximo passo;
  campo inválido abre a aba correta antes de apresentar validação.
- Prévia ampliada em modal nativo, fundo isolado, foco inicial/retorno e Escape.
  Menu recolhível, cabeçalho móvel/avisos compactos e orientações secundárias
  recolhidas sem esconder pendências. Senhas têm revelação acessível e requisito.
- Importação mostra etapas reais e resumo de rejeitados/quarentena/divergências
  antes da aplicação. Sugestões comparam campo atual e sugerido lado a lado,
  com documento/revisão/alcance e confirmação administrativa preservados.
- Histórico com rótulos de negócio, seleção de relacionamentos de todas as
  páginas e filtros globais por competência/período/rubrica. API calcula totais
  exatos do resultado completo, sem compensar estornos ou inferir direitos.
  Busca textual identifica seu alcance restrito à página.
- Telas carregadas sob demanda, com tratamento explícito de falha de download.
  Maior chunk: 486,48 kB; sem aviso >500 kB nem alteração artificial do limite.
  Entrada 32,05 kB; com React, contratos, validação e runtime, aproximadamente
  796 kB/187 kB gzip iniciais, contra cerca de 1.030 kB/248 kB gzip anteriores.
  Não confundir o tamanho da entrada com todo o carregamento inicial.

Validação final: typecheck e build aprovados; **46/46** testes em cinco
arquivos (interface DOF/DTC, evolução Núcleo, permissões/tokens).
Sob LocalService, PostgreSQLs descartáveis: **45 aprovados/um excluído**
em DTC/emissão/importação, incluindo totais globais constantes entre páginas.
Excluído somente o teste preexistente de carga que cria 48 sessões e exige 64.
Prévia válida: 61,3 ms em 45 anos, 131,4 ms no máximo 200 blocos/20 mil caracteres;
entrada malformada 257,9 ms. Nenhuma operação fictícia na base operacional.
Não é nova regressão integral nem certificação por operadores/leitor de tela.

### Publicação e proteção operacional

Proxy e API suspensos, PostgreSQL preservado ativo. Captura consistente incluiu
dump custom, configuração/material criptográfico/TLS, PDFs e serviços.
Dump conferido por listagem e leitura integral; pacote cifrado com DPAPI
CurrentUser, decifrado em memória e hash comparado. Capturas plaintext
temporárias removidas; runtime anterior preservado para contingência.
Backup protegido é local e vinculado à conta/máquina: **não é cópia externa
portável nem ensaio de restauração**. Agendamento/recuperação seguem pendentes.

Aplicada somente `025-historico-servidor`; diagnóstico somente leitura
aprovado, mantendo quatro aprovações v2 pendentes. API iniciada/health validado
antes de iniciar Caddy. Ambos serviços automáticos Running sob LocalService;
HTTPS via proxy health 200 e privado sem sessão 401. Certificado/nome
validados com `--ssl-no-revoke` (revogação não verificada).
Index e 23 assets servidos são idênticos ao build final por SHA-256.
Login HTTPS também aberto em navegador limpo, sem autenticar/gravar e sem
erros JavaScript. O Zod registra aviso CSP ao sondar compilação dinâmica,
mantendo a validação sem liberar `unsafe-eval`; 401 de sessão anônima é esperado.
Sem aprovação automática, importação real, restauração ou reinício do PostgreSQL.
Não houve novo commit/push: base funcional `3404937`, UX no worktree.
Tarefa/arquivos temporários removidos e ACLs de atributos dos dois executáveis
de teste restauradas. Backup protegido e runtime anterior foram preservados.

## Evolução autorizada do Núcleo — 04/11/2026

Implementado o [plano aprovado](PLANO_EVOLUCAO_NUCLEO.md), conforme
[decisão 033](decisoes/033-edicao-contextual-e-historico-local.md):

- Identificação editável DOF/três DTCs, com ajustes na entrada cifrada da
  declaração, sem escrever no cadastro/fonte externa. Remoção restaura referência.
  Cálculo, prévia, conferência, snapshot e cópia usam os mesmos valores efetivos.
- Correção canônica local administrativa separada e sugestões no cadastro
  derivadas dos ajustes salvos. Cancelar correção não invalida a declaração.
- Prévia local a cada alteração válida, sem salvar por tecla; entrada inválida
  mostra pendência em vez de totais antigos. Zoom, página/largura, proporção e
  ampliação, inclusive saída por Escape. Corrigidas sobreposição ao rodapé,
  ciclo de medição e ampliação encoberta pelo cabeçalho.
- Círculos nas abas Encaminhados/Retornos e lista de retornos. Contagem global
  autorizada, atualizada por escrita/foco/30 segundos; abrir não limpa pendência.
- Núcleo reutiliza o mapeamento do Legado na própria tela. XML SisDoc v1,
  seleção explícita de aba XLSX e limites/erros sem fallback silencioso.
- Histórico funcional/financeiro por vínculo, com férias, licenças e abonos,
  cifragem/revisões append-only, valores exatos em centavos, estornos vinculados,
  importação validada/idempotente, consulta de revisões e exportação XLSX.
  Não calcula folha/direitos nem totais globais a partir de página parcial.

Integração corrigiu ainda a instalação limpa que aplicava apenas até 023:
agora usa a sequência compartilhada completa. Reconsultas DOF após escrita
preservam lock de alteração; auditoria DTC normaliza opcionais ausentes.
Regras de emissão/aprovação e permissões canônicas foram preservadas.

### Evidências de validação

- `npm run typecheck` aprovado e builds API/web aprovados.
- Seletor combinado: interface-rascunhos 17, interface-dtc 4, evolução-núcleo 17,
  permissões/tokens 5: **43/43 aprovados**.
- PostgreSQL descartável sob LocalService: emissão 13, DTC 20 e importação 12:
  **45 aprovados, um excluído**. Inclui instalação/migração 025, quatro PDFs
  sintéticos, ajuste de CPF/nome/admissão no snapshot/cópia DOF, sugestões/retornos,
  cifragem/revisões/estornos e exportação/importação histórica idempotente.
- Um teste de carga preexistente excluído: cria 3 × 16 = 48 sessões, mas exige 64.
  Não é uma regressão completa aprovada. Fundação completa permanece sem aceite:
  a CLI recompila o projeto e LocalService não pode sobrescrever código.
- Medidas máximas edição–exibição: 56,6 ms em 45 anos; **135,3 ms** com 45 anos,
  200 blocos e 20.000 caracteres válidos (meta <200 ms); 250,3 ms com 6.600
  delimitadores malformados (entrada inválida, limite <1 s).
- Navegador com CSP real, escape/sandbox e erros JavaScript monitorados.
  Geometria DOF em 1366×768, 1920×1080 e 390×844; inspeção de capturas sintéticas.
  Três DTCs verificam identificação instantânea e persistência ao reabrir.
  [Avaliação UI/UX atualizada](AVALIACAO_UI_UX.md).

### Instalação preservada; publicação pendente

**Não aplicado operacionalmente:** migração 025, novas telas/API e reinício.
Sem importações/testes fictícios na base operacional, sem aprovação de modelos.
Confirmação específica para backup protegido/migração/publicação solicitada,
mas responsável indisponível: publicação adiada, sem presumir autorização.

Os builds de validação haviam substituído os artefatos usados pela instalação.
Reconstruídos isoladamente os cinco workspaces no Git `f788a6d`; repostos
somente os artefatos gerados, com SHA-256 conferido, preservando todas as fontes
novas e alterações preexistentes. Página HTTPS confirmada no bundle anterior
`index-6QKYBrdf.js`; health 200, privado sem sessão 401 e serviços Running.
Nenhum serviço foi reiniciado; o banco operacional continua em 024.
Novo build no checkout altera novamente os artefatos servidos: a próxima
publicação exige janela controlada, backup verificado, migração e reinício.
Tarefa agendada, PostgreSQLs de teste, cópia temporária do navegador e fontes
isoladas de reconstrução encerrados/removidos. ACLs temporárias de atributos
dos dois executáveis de teste restauradas; sem ampliar escrita no código.
Sem commit/push nesta etapa. Aviso de bundle candidato >500 kB permanece
recomendação de otimização, não erro ocultado por aumento do limite.

Reverificação em 04/11/2026 após 04:20: serviços SisDoc/SisDocCaddy Running,
health HTTPS 200, privado sem sessão 401 e `git diff --check` sem erros.
Guia operacional corrigido para distinguir o candidato que exige 025 da
instalação preservada em 024. Implementação/análise UI/UX entregues; publicação
permanece uma operação separada, sem autorização presumida.

## Reinício dos serviços Windows — 03/11/2026 22:54

Confirmados SisDoc e SisDocCaddy registrados e ativos como serviços Windows
sob `LocalService`, substituindo o registro anterior de processos manuais.
Reinício solicitado pelo responsável: proxy parado, API reiniciada e proxy
religado na ordem de dependência. PostgreSQL permaneceu ativo, sem reinício.
Após a operação, serviços em Running, API em loopback na porta 3443 e proxy
na interface LAN na porta 443. HTTPS via proxy: health 200 e rota privada sem
sessão 401. Curl validou certificado/nome com `--ssl-no-revoke`; revogação não
foi verificada. Não houve build, migração, alteração de dados ou aprovação.

## Perfis, rascunhos e modelos de serviço — 03/11/2026

Implementada a descontinuação do perfil Secretário Adjunto pela migração
obrigatória `024-perfil-secretario-adjunto`: contas antigas são inativadas,
convertidas para analista, têm sessões revogadas e a alteração é auditada.
Analista, coordenador e administrador podem consultar/editar rascunhos DOF/DTC
de terceiros; a edição compartilhada permanece limitada a rascunhos, e DOF
com encaminhamento ativo continua bloqueada até recolhimento/devolução.

Validação de código desta etapa: typecheck aprovado; interface 16/16 e
permissões/tokens 5/5 aprovados. A suíte fundação/migração continua bloqueada
em recursos descartáveis porque o PostgreSQL embutido recusa iniciar sob conta
Windows administrativa nesta sessão. Nenhum teste foi apontado para base
operacional.

Estado operacional observado em 03/11/2026 20:42 (somente leitura):
- `npm run verificar-instalacao` aprovado com histórico até 024.
- API ativa em `127.0.0.1:3443` e Caddy ativo em `192.168.70.26:443`.
- Health 200 e rota privada 401 sem sessão, no acesso direto e via proxy.
- API e Caddy executando sob `NT AUTHORITY\LOCAL SERVICE`, mas sem serviços
  WinSW registrados (processos diretos).
- Regra de firewall `SisDoc LAN TCP 443` ativa em perfis Domain/Private, com
  escopo de rede restrito.

Pendências mantidas: aprovação formal dos quatro templates v2, validação do
fluxo operacional completo (login/troca inicial/aceite) e definição final de
partida automática via serviço Windows.
Escopo de rede atualizado em [decisão 032](decisoes/032-proxy-lan-restrito.md).

## Estado da instalação limpa na retomada da tarde — 03/11/2026

Consulta de pendências motivou nova inspeção somente leitura. Configuração
externa e provisionamento agora existem; não foi repetido setup.
Diagnóstico aprovado: arquivos/TLS/lista/PDF/Chromium, PostgreSQL 16 local,
login restrito e sequência até 023. Um formato de processo configurado;
quatro aprovações de templates v2 continuam pendentes.
Página/health HTTPS 200 e documentos sem sessão 401, sem ignorar TLS.
Listeners 5432 e 3443 somente em `127.0.0.1`.
Proprietário do processo da API não é a conta dedicada `sisdoc_exec`.
`SISDOC_CONFIG` não persistida em User/Machine; pode ser definida por sessão.

Esta evidência supera o bloqueio histórico de inicialização abaixo, sem
atribuir à sessão a criação dos arquivos/banco ou o início do processo.
Pendente validar execução/diagnóstico sob a conta dedicada, primeiro
login/troca de senha e aceite funcional, conferir formato institucional e
obter aprovação formal por tipo antes de emitir. Serviço automático,
backup/recuperação e falha da suíte fundação continuam separados.
Nenhum serviço, dado ou aprovação foi alterado nesta conferência.

## Instalação limpa no destino: infraestrutura — 03/11/2026

Após a preparação abaixo, o responsável confirmou VM exclusiva do SisDoc
e solicitou **instalação limpa**, sem restaurar banco/chaves da origem.
Esta escolha substitui a pendência de obter a captura para esta instalação;
o procedimento de migração continua disponível para outros cenários.

Preparado e validado nesta máquina:

- Configuração PostgreSQL anterior preservada fora do Git; escuta alterada
  de `*` para `127.0.0.1`. Serviço reiniciado e `pg_isready` aprovado;
  listener confirmado somente em IPv4 loopback. SCRAM-SHA-256 preservado.
- Diretórios externos com ACLs restritas e conta Windows executora sem
  grupo administrativo. Credencial dessa conta protegida por DPAPI para
  a conta instaladora, fora do checkout.
- TLS `localhost`/`127.0.0.1` gerado localmente; par de chaves, nome/IP,
  validade e confiança Windows conferidos. Somente certificado público
  adicionado à confiança local; chave privada no diretório protegido.
- Lista pública SecLists de senhas comuns e licença preservadas fora do Git.
- Chromium instalado em cache compartilhado protegido e variável
  `PLAYWRIGHT_BROWSERS_PATH` persistida no escopo Machine.
- Processo real sob a conta executora confirmou leitura de código/TLS/lista,
  acesso negado ao provisionamento, HTTPS com validação TLS e geração de
  PDF em memória. Processo encerrado; arquivos auxiliares de validação removidos.

Preparado fluxo local interativo protegido para concluir o provisionamento:
solicita senha PostgreSQL sem eco, confere ausência de banco/papéis SisDoc,
coleta administrador inicial, exige `CRIAR`, gera credenciais técnicas,
persiste provisionamento exclusivo e chama o instalador compartilhado.
Não aprova modelos nem importa dados. Sintaxe e cancelamento antes da
autenticação conferidos sem criar banco, provisionamento ou raiz.
**O fluxo completo ainda não foi executado**, pois a senha administrativa
não está disponível à sessão; deve ser digitada pelo operador no terminal,
nunca no chat. Comando em [Instalação](INSTALACAO_LOCAL.md).

Validação adicional: cinco testes do diagnóstico passaram. A suíte fundação
falhou no `beforeAll` de preparação descartável, reportando
`Unknown Error: undefined`; **27 casos não executados**. Binários PostgreSQL
embutidos respondem `--version`, mas a causa dessa falha não foi estabelecida.
Não tratar essa tentativa como aprovação do instalador ou regressão completa.
Nenhum teste foi apontado para o PostgreSQL operacional.

**Ainda pendente/bloqueado:** autenticação PostgreSQL local autorizada,
criação de banco/papéis e execução do setup, diagnóstico da instalação
completa, configuração de processos institucionais, primeiro login com
troca obrigatória de senha e partida/aceite da API sob conta executora.
Não houve restauração, importação, seed, aprovação formal, publicação ou
início da API. Aprovação v2, serviço automático e backup seguem separados.

## Preparação do checkout no destino — 03/11/2026

Inspecionado o checkout de referência `26faa91` na máquina de destino.
Preservada alteração local preexistente em `package.json` (`allowScripts`).
Node 24.21.0/npm 11.19.0 e PostgreSQL 16.15 disponíveis; serviço PostgreSQL
ativo. A presença de builds/dependências antigos não foi tratada como
instalação operacional concluída.

O primeiro typecheck falhou por resolução ausente do workspace
`@sisdoc/contratos`. Executado `npm ci --no-audit --no-fund` com o lock
existente; após reinstalação, typecheck e build aprovados.
Chromium Playwright iniciou e encerrou em modo headless.
**5/5 testes do diagnóstico** aprovados pelo runner isolado do projeto.
Aviso preexistente de bundle web acima de 500 KB permanece.

O diagnóstico operacional chegou à configuração externa e falhou:
`SISDOC_CONFIG` não está definida no processo nem nos escopos persistidos
User/Machine; o diretório padrão externo da instalação não existe.
Não foi localizado nem fornecido um caminho autorizado da captura da origem.
Isso não demonstra ausência de cópias em outros volumes nem de banco existente.
PostgreSQL foi observado escutando em `0.0.0.0` e `::`, não apenas loopback.
Não foi alterada a configuração nem reiniciado o serviço, pois uso exclusivo
e autorização para essa intervenção ainda não foram confirmados.

**Preparado/testado:** dependências locais, tipos, build, Chromium e suíte
direcionada. **Não publicado/não operacional:** sem setup, criação de banco,
restauração, migração de schema, importação, aprovação ou partida da API.
Pendente obter a captura protegida original (dump, configuração/chaves,
PDFs, TLS, lista de senhas e provisionamento), conferir o release da captura,
autorizar/revisar a escuta local, restaurar e executar diagnóstico/aceite.
Nenhum segredo ou dado pessoal foi registrado nesta memória.

## Preparação de migração Windows Server — 01/11/2026

Reanalisados checkout, bootstrap/setup, configuração, sequência de migrações,
armazenamento/worker PDF e documentos de instalação. O responsável escolheu
**migração completa para Windows Server x64**, preservando dados, usuários,
documentos e aprovações; nesta etapa foi preparado o procedimento, sem
exportar ou restaurar dados operacionais.

Guias de instalação/início/operação e README atualizados: retiradas
afirmações antigas de emissão não implementada, setup limitado à 014,
ausência de atualização de schema e máscaras antigas na consulta.
Novo [guia de migração](MIGRACAO_WINDOWS_SERVER.md) cobre captura consistente,
papéis/GRANTs, restore no destino vazio, preservação cifra/HMAC/PDF,
TLS/ACLs por conta do destino, cache Chromium, aceite e retorno controlado.
Exportação CSV/XLSX não substitui migração da instalação.

Implementado `npm run verificar-instalacao`: diagnóstico somente leitura,
com configuração externa, arquivos/TLS, Chromium, PostgreSQL 16 local,
login restrito e histórico completo. Erros indicam etapa com detalhes
externos sanitizados. Aprovações/máscaras são informadas, não alteradas.
Bootstrap passou a exigir `023-modelos-oficiais`, evitando iniciar release
v2 sobre banco ainda em 022; aviso inicial do setup acompanha recursos atuais.

Validação:

- Typecheck e build aprovados; aviso de bundle web acima de 500 KB permanece.
- **31/31 testes em duas suítes** após correção do teste de bootstrap:
  27 da fundação e quatro iniciais do diagnóstico, todos em recursos descartáveis.
- Após acrescentar verificação da falha CLI sem vazamento de caminho:
  typecheck e **5/5 testes do diagnóstico** aprovados.
- Links locais de dez documentos conferidos sem falhas.
- Diagnóstico na origem aprovado sem escrita: histórico até 023,
  PostgreSQL/login locais, arquivos e Chromium acessíveis. Um formato de
  processo já configurado; quatro aprovações v2 pendentes.
- `pg_dump` e `pg_restore` 16.15 disponíveis na origem; não executado dump.

**Não houve** carga, seed, aprovação, restauração, migração de schema ou
partida/parada da API operacional. A porta 3443 estava sem listener na
inspeção inicial; na verificação final, página/health HTTPS responderam 200
e rota privada 401, com certificado validado e sem intervenção no processo.
Não se tratou a disponibilidade histórica como estado atual.
Nenhuma máquina Windows Server foi homologada nesta etapa.

**Pendente:** janela de captura/transferência autorizada, restauração/aceite
no destino e aprovação formal v2. Backup agendado, serviço automático,
exposição de rede e revisão integral do restante do projeto permanecem fora
desta entrega. A última suíte completa anterior continua sendo a de 251 testes
dos modelos; não somar execuções direcionadas como nova regressão completa.

## Modelos oficiais de saída — 01/11/2026

DOF, DTC IPAM, Comissionado e INSS adaptados às referências locais indicadas
pelo responsável. Cabeçalhos/brasão, grades de identificação, frequência,
ocorrências, categorias e assinaturas usam dados do documento/fonte;
exemplos individuais e imagens completas permanecem fora do Git.
Demonstrativos DTC são anexos separados; o campo Classe da DOF não é
inferido, pois não possui fonte contratada. Detalhes e limites:
[decisão 029](decisoes/029-modelos-oficiais-versionados.md).

Formulários e CSS fixo são compartilhados por emissão/prévia. Prévia
continua sem validade oficial e não simula número/data. Modelos v1 usam
renderizadores históricos; versões desconhecidas falham explicitamente.
Aprovação antiga não autoriza a v2. Migração, setup novo, emissão e CLI
de aprovação usam as mesmas quatro versões de template.

Validação final:

- Typecheck e build aprovados.
- Suíte completa isolada: **251/251 testes em 32 arquivos**.
- **12 testes de modelos oficiais**, incluindo compatibilidade v1, escape,
  brasão sem rede, prévias sem número/data, cabeçalhos dentro das células e
  geometria/paginação A4. DOF sintética de 45 anos: duas páginas;
  IPAM/Comissionado: duas com anexo; INSS: três com anexo.
- Antes da regressão completa final, **20/20 testes** de modelos e PDF DOF
  no limite passaram. Não somar essa execução à suíte completa.
- Prévia no limite (45 anos/200 blocos/20.000 caracteres): 99,9 ms;
  delimitadores malformados: 170,1 ms. Aviso de bundle web acima de 500 KB
  permanece como pendência de organização do carregamento.

Cadastro de `023-modelos-oficiais` aplicado em produção com autorização
específica e apenas essa migração pendente. Conferidos quatro templates v2
com **zero aprovações novas**; templates/aprovações anteriores preservados,
sem alteração na quantidade de documentos/jobs. Nenhuma carga ou seed.
Produção reiniciada: página/health HTTP 200, documentos sem sessão HTTP 401
e listener HTTPS somente em loopback.
**Emissões novas aguardam aprovação formal por tipo.**

Esta entrega não encerra a revisão integral/modularização dos demais
serviços/helpers, telas, setup/ferramentas e funções das suítes restantes.

## Modularização — etapa 7: DOF, templates e recursos CLI — 01/11/2026

DOF separada em contexto/helpers puros, consultas/validação, escrita de
ajustes e emissão/cópia. O serviço público mantém as transições do
rascunho; emissão/cópia compõem os mesmos recursos. Consultas e escrita
recebem o cliente existente, sem abrir transações adicionais. Preservados
locks, autoria/destinatários, revisões, conferência, aprovação, idempotência
e numeração/snapshot/job PDF atômicos.

Editor DOF separado em apresentação, hook de coordenação e contexto
tipado. Painéis ocultos continuam montados; pendências, revisão salva e
prévia auditada não foram descartadas. Templates agora têm índice somente
de exports, prévia DOF própria e helpers HTML compartilhados. CSS fixos
DOF/DTC permaneceram idênticos para não alterar hashes CSP.
**87/87 funções/métodos/construtores e arrows nomeadas** nas unidades
DOF da API, editor de cálculo e templates receberam JSDoc específico.

Importação/conferência CLI usam argumentos e recursos compartilhados,
sem importar outra entrada executável. Falha de encerramento após erro
de conexão não é mais ocultada; ambas as causas são preservadas. Chaves
são validadas antes de abrir conexão. Entradas setup/usuários, scripts
de isolamento/modelos e fixtures sintéticas revisados receberam JSDoc;
isso não encerra a revisão dos serviços setup nem de todas as suítes.
Varredura final confirmou **111/111 funções nomeadas** documentadas no
conjunto específico de arquivos revisados nesta etapa.

Validação:

- Typecheck e build aprovados; regressão completa após DOF/templates:
  **230/230 testes em 30 arquivos**, incluindo navegador e PDFs.
- Após extração dos recursos CLI: typecheck e **29/29 testes em três
  arquivos**, incluindo **oito novos testes** de argumentos, limite exato
  de 64 MB, conexão simulada e preservação de falhas de limpeza.
- Validação final dos recursos CLI: **9/9 testes**, incluindo o teste
  adicional de chaves inválidas recusadas antes de qualquer conexão.
- Verificação mecânica: 14 métodos DOF extraídos e 21 funções de templates
  com corpos equivalentes; HTML de prévia/emissão DOF sintéticas igual
  byte a byte à implementação anterior em execução.
- Prévia sintética no limite (45 anos/200 blocos/20.000 caracteres):
  99,7 ms; delimitadores malformados: 169,6 ms. Warning de bundle web
  superior a 500 KB permanece; não houve mudança incidental de carregamento.

Nenhuma migração, importação real ou alteração de dados operacionais.
Pasta de imagens modelo ignorada; instruções curtas e recapitulação
adicionadas para retomada do agente.
**Revisão integral permanece aberta:** demais serviços/helpers, componentes
DOF/transferência e telas ainda não revisados, implementação setup,
ferramentas e funções nomeadas das suítes restantes.

## Modularização — etapa 6: sincronização — 01/11/2026

Módulo separado em coordenação do lote, mapeamento puro e persistência por
item. Mantidos locks, cliente transacional, savepoints, staging cifrado,
retomada, paginação, disjuntor e limites de remoção lógica.
**34/34 funções/métodos/construtores e arrows nomeadas** dessas unidades
com JSDoc específico.

Corrigido bug de mapeamento parcial que descartava campos canônicos de
vínculo sem alias. Cinco testes puros verificam aliases, dados inválidos,
zeros de matrícula e preservação de campos. Falhas técnicas antes ocultas
agora têm logging sanitizado, sem valores pessoais ou credenciais.

Typecheck aprovado; suíte completa **230/230 testes em 30 arquivos**.
Sem migração, sincronização real ou configuração externa habilitada.
A revisão integral permanece aberta nos demais serviços/helpers, DOF,
templates, telas restantes, CLI/setup/ferramentas e funções dos testes.

## Modularização — etapa 5: importador e falhas transacionais — 01/11/2026

Importador decomposto em coordenação, estado, gravação, relatório,
conferência e rollback. Imports da interface, Legado, CLI e testes
atualizados diretamente. **25/25 funções declaradas/arrows nomeadas**
dessas unidades com JSDoc específico. Mantidos cliente único por operação,
locks, cifra, idempotência, preenchimento de vazios e rollback LIFO.

Corrigidas falhas ocultas de rollback e registro de lote. Erro no commit
agora sinaliza resultado incerto, sem afirmar reversão nem registrar lote
falso de falha; a interface descarta conexão incerta. Manual explica que
o operador precisa conferir a situação antes de repetir. Oito novos testes
injetam falhas sem abrir conexão real.

Typecheck aprovado; suíte completa **225/225 testes em 29 arquivos**.
Nenhuma migração ou carga de dados operacionais. As demais unidades
continuam em revisão; não declarar a revisão integral concluída.

## Revisão/JSDoc — etapa 4: cálculo e funções dos contratos — 01/11/2026

Motor, calendário, histórico de vínculos, textos e funções nomeadas dos
contratos lidos e documentados. Nenhuma regra, validação ou saída alterada.
Varredura AST incluindo arrows nomeadas: **20/20 funções no cálculo** e
**14/14 nos contratos** com JSDoc. Typecheck aprovado; **61 testes em três
arquivos** passaram. Cobertura documental não representa nova aprovação
dos modelos nem conclusão da revisão dos demais módulos.

## Modularização — etapa 3: consulta e cálculo DTC — 01/11/2026

Serviço DTC decomposto em cálculo puro, consulta/validação da fonte e
coordenação transacional. JSDoc específico cobre todas as funções nomeadas
dessas unidades. Consultas usam o protetor e cliente da transação existente;
revisões, locks, auditoria, conferência, aprovação, idempotência, numeração,
snapshot e job PDF permanecem compatíveis.

Resultado pós-transação compartilhado entre DTC, DOF e emissões, mantendo
auditoria de falhas esperadas antes de lançar a resposta HTTP. Mensagem de
aprovação deixou de depender de rascunhos DOF. Helper de decifração textual
movido para segurança, retirando dependência Cadastro → Exportador.
Proteção de dados e exportador documentados após leitura.

Typecheck aprovado; suíte completa **217/217 testes em 28 arquivos**,
com quatro novos casos de tradução do resultado e regressões de integração
e navegador. Sem migrações ou dados operacionais alterados.
Revisão integral ainda pendente nas demais unidades, conforme
[ARQUITETURA.md](ARQUITETURA.md).

## Modularização — etapa 2: interface por domínio — 01/11/2026

Interface reorganizada em aplicação, autenticação, infraestrutura,
componentes compartilhados, administração, cadastro, DOF, DTC, documentos
e transferência. Transporte HTTP separado de sete clientes tipados;
fachada pública e comportamento das requisições preservados.

Cadastro e DTC decompostos em componentes coesos de busca, lista, detalhe,
referências, eventos, editor e documento. Entrada React reduzida à montagem.
JSDoc específico nas unidades revisadas, sem comentários automáticos genéricos.
Estado dos formulários, prévias salvas, confirmação de saída, autorizações,
CSS e contratos preservados. Nenhuma migração ou carga de dados reais.

Typecheck e build web aprovados; **30/30 testes em quatro suítes de navegador**.
Prévia no limite de 45 anos/200 blocos/20.000 caracteres abaixo de 175 ms
nos cenários sintéticos. Serviços maiores, editor DOF, transferência,
pacotes e demais funções continuam na revisão; etapa 2 não é conclusão integral.

## Modularização — etapa 1: composição da API — 01/11/2026

Revisão estrutural do grafo local de todos os fontes e testes, sem ciclos
locais identificados. Diagnóstico, invariantes e limites da revisão em
[ARQUITETURA.md](ARQUITETURA.md). Não é revisão semântica de todas as
funções: serviços de domínio, interface, pacotes, CLI e ferramentas seguem
pendentes nas etapas posteriores.

AppModule agora compõe módulos de infraestrutura, segurança, servidores,
cálculos, documentos, importação e sincronização. Serviços ficam privados
por domínio; pool/configuração são os únicos exports globais. Health
movido para infraestrutura, com seu teste atualizado. Encerramento do pool
é tipado e ocorre após a destruição dos workers. Rotas, política de acesso,
transações e comandos operacionais preservados; nenhuma migração ou
gravação de dados reais necessária.

JSDoc adicionado às funções da composição, bootstrap, configuração,
transações, diagnóstico e tratamento de erros, além das referências dos
tokens. A documentação de todas as funções ainda não está concluída.

Build e typecheck aprovados. Suíte completa: **213/213 testes, 27 arquivos**.
Novos testes verificam injeção de todos os controllers, guarda única,
exports restritos e encerramento dos workers antes do pool; integração
HTTPS/banco existente também passou.
Etapa publicada na instalação local: health e página HTTPS 200, consulta
privada sem sessão 401 e listener somente em loopback, após reinício.

## Prioridades de UI/UX e correção CSP — 01/11/2026

Transferência dividida em Importar, Disponibilizar Legado, Exportar e
Histórico, com teclado e estado preservado. Filtros, contagens, limpeza e
atualização padronizados em oito listas; seu alcance é somente a lista
carregada, sem ampliar o escopo autorizado. Alterações pendentes em
formulários de exclusão são protegidas ao trocar filtros.

Cadastro dividido em identificação/contato, documentos e vínculo, com
seleção automática do vínculo escolhido na lista. Grupos recolhíveis
organizam referências, vínculos, períodos e cargos DTC; documentação INSS
separada de licenças e confirmações. Ações destrutivas foram separadas
visualmente das principais, preservando motivos e autorização. Mensagens
antigas de emissão indisponível na DOF foram corrigidas.

CSP da página autoriza apenas os hashes SHA-256 dos estilos fixos DOF/DTC.
Sandbox e bloqueio de scripts/CSS arbitrário preservados; sem novas rotas,
migrações ou gravações operacionais. 51 testes direcionados aprovados
(incluindo revalidação focada de 9 testes de transferência/listas),
build e typecheck aprovados. Cobertura inclui CSP real em prévias,
três tipos DTC, estado entre abas, teclado, transferência em 375 px,
filtros e confirmação de saída com formulário pendente.

API e frontend publicados juntos; aplicação reiniciada em loopback,
health e página HTTPS 200, política com os dois hashes confirmada.
Na página compartilhada, a prévia DOF exibiu a cor e a fonte esperadas,
com sandbox sem permissões; não foram alterados documentos reais.
Avaliação e operação atualizadas; propostas adicionais continuam opcionais.

## Prévias persistentes e densidade — 01/11/2026

DOF salva/reaberta carrega a prévia automaticamente e recarrega a cada
revisão, sem exigir abrir/fechar. DTC mantém a prévia da revisão salva
durante a edição. Tabelas, controles anuais e painéis foram compactados,
preservando dados completos e alvos móveis de 44 px. 25 testes de navegador
passaram, incluindo persistência entre abas, respostas antigas descartadas,
DTC em edição e tamanho dos campos anuais; build e typecheck aprovados.
Frontend publicado na instalação existente, com health e página 200.

A [avaliação por tela](AVALIACAO_UI_UX.md) registra sugestões não implementadas
e a pendência visual da CSP, resolvida no ajuste registrado acima. A prévia disponível não equivale a
conferência ou emissão autorizada.

## Senhas, destinatários e organização do menu — 01/11/2026

Senhas de usuário exigem 10 caracteres em contratos, API, setup, CLI e
interface; Argon2id, lista de senhas comuns e sessões permanecem.
Coordenadores ativos são os únicos novos destinatários de encaminhamentos;
administradores ficam fora da seleção e envios diretos são recusados na API
e no banco, mantendo sua consulta global e revisão.

Menu do administrador: Administração primeiro (Usuários, Importação e
exportação, Sincronização, Auditoria), seguido de Cadastro de pessoas, DOFs,
DTCs e Documentos emitidos. Dados completos continuam acessíveis aos perfis
autenticados. Veja [operação](OPERACAO.md#senhas-encaminhamentos-e-menu).

Build/typecheck aprovados; 34 testes focados passaram e verificações adicionais
de migração/setup passaram (5 casos), além de 3 casos revalidados para setup
com senha exatamente de 10 caracteres e recusa de envio por analista e
coordenador. Backup confirmado; migração `022-destinatario-coordenador`
aplicada e produção reiniciada com health/página 200 em loopback.

Fontes ativas: [prompt](../Modelos%20e%20Documentação/PROMPT_CONSTRUCAO_APLICACAO_DOF_DTC.md)
e [regras](../Modelos%20e%20Documentação/REGRAS_E_BASES_DE_CALCULO_DOF_DTC.md),
[guia descritivo](../Modelos%20e%20Documentação/guia_descritivo_declaracoes_funcionais_e_tempo_contribuicao.md)
e [protótipo visual](../Modelos%20e%20Documentação/prototipo_SistemaWEB.jpeg).

## Plano aprovado: Legado operacional e interface — 31/10–01/11/2026

Concluídos o assistente Legado → prévia/mapeamento → validação assinada →
confirmação → Núcleo, a preservação de valores existentes/edições manuais
com divergências explícitas e o download completo de ocorrências em XLSX.
A base cadastral possui 18 campos; informações extras permanecem no lote
Legado e não são inferidas como frequência ou períodos contributivos.
Veja [decisão 028](decisoes/028-legado-operacional-e-conferencia.md).

Busca de servidores abre uma lista paginada por matrícula natural crescente,
preservando zeros e texto, com desempate por origem e UUID. CPF e referências
são completos para todos os perfis autenticados, sem ampliar permissões de
alteração/exportação. O editor DTC oferece PB/PV/licença-prêmio e a prova de
revisão incorpora períodos IPAM e detecta mudanças concorrentes.

**Validação:** 204 casos verificados em 25 arquivos. Na execução completa
final de produto, 202 passaram; duas expectativas de sequência/contagem de
migrações foram corrigidas e revalidadas pelos testes focados (emissão 11/11;
sequência 1/1). Build e `npm run typecheck` passaram. O ensaio HTTPS com
64 sessões por perfil e mistas completou 960 requisições sem erros, com p95
entre 3,57 e 3,75 segundos e máximo de 4,15 segundos nessa execução conjunta;
não reutilizar a medição anterior de aproximadamente 0,7 segundo como
resultado desta versão. Não mede emissão de PDFs concorrentes.

**Implantação:** backup `pg_dump -Fc` confirmado; migrações
`020-listagem-servidores` e `021-revisao-periodos-ipam` aplicadas. Produção
reiniciada em `https://localhost:3443/`, health e página 200, rotas novas 401
sem sessão e escuta exclusiva em loopback. Conferências DTC com a prova antiga
exigem reconferência; PDFs emitidos permanecem imutáveis.
Nenhuma carga real foi aplicada ao Núcleo pelo agente: depende da conferência
e confirmação posteriores do responsável. Fatias 8–9 continuam como extras.

| Fatia | Estado | Evidência |
|---|---|---|
| 0 — fundação | gate técnico verificado | `npm run setup` e `npm start` em recursos descartáveis; HTTPS com CA e nome verificados; health e página inicial |
| 1 — dados e contratos | gate técnico verificado | migração no banco vazio e em cópia sintética da fundação; contratos, restrições, privilégios e concorrência testados |
| 2 — cálculo | gate técnico verificado | GT-01, GT-REF e GT-02 a GT-11 em JSON; propriedades, regras provisórias e bundle de navegador |
| 3 — autenticação e perfis | gate técnico verificado | matriz negativa nas rotas existentes e criação de administrador por setup; revisão humana e navegador integrado a HTTPS pendentes |
| 4 — consulta de servidores | gate técnico verificado | busca em HTTPS e PostgreSQL descartável com 17.700 vínculos fictícios; interface exercitada com API simulada |
| 5 — DOF | gate técnico verificado | fluxo completo até PDF, histórico, cópia e cancelamento com aprovação sintética e caso de mais de 41 anos (`tests/emissao.test.ts`); emissão operacional bloqueada até aprovação formal |
| 6 — DTCs | gate técnico verificado | DTC IPAM, Comissionado e INSS com PDFs dos quatro tipos sem corte nos máximos (4 períodos, 3 cargos) em `tests/dtc.test.ts`; template INSS provisório |
| 7 — importação e sincronização | em andamento | — |
| 8 e 9 — operação | pacote extra | somente após autorização do responsável |

O checkout inicial contém as referências e não contém a aplicação demonstrativa
citada no prompt. Node 24.20.0 e npm 11.19.0 foram encontrados; PostgreSQL e
Caddy operacionais não foram encontrados nas verificações iniciais.
`npm test` executou nove testes com PostgreSQL 16.15 descartável em UTF-8,
incluindo recusa de banco ocupado, rollback de ACL, senhas ocultas e HTTPS.
`npm run typecheck`, `npm run build` e `npm audit` passaram. A interface estática
foi aberta no navegador por servidor local temporário; a conexão HTTPS do
backend foi verificada separadamente com CA e nome, sem ignorar erros.

Na fatia 1, os schemas exigidos, a migração transacional, contratos de domínio
e componente de cifra/HMAC foram adicionados. As verificações usam apenas
recursos sintéticos: vínculos, períodos, retenção de staging, rollback,
restrições de acesso, snapshot/auditoria imutáveis e concorrência. `legado`
permanece sem tabelas até o fornecimento do mapeamento oficial. Os caminhos
funcionais que usarão esses componentes ainda não existem; o banco não valida
sozinho se um campo `bytea` foi cifrado. `npm run typecheck` passou e `npm test`
passou com 24 testes, incluindo a migração em PostgreSQL 16.15 descartável.

Na fatia 2, o motor puro calcula os perfis provisórios, preserva a diferença
entre aplicação anual e por período, gera textos condicionais e rejeita
entradas ambíguas de períodos parciais. `npm run typecheck` e `npm test`
passaram: 55 testes no total, incluindo os GT e propriedades com
`fast-check`. `npm audit` não apontou vulnerabilidades. A busca de GT-08 é
uma função pura com vínculos sintéticos, não uma consulta operacional.

Na fatia 3, a migração 002, sessões, limites, CSRF, perfis, auditoria e
administração foram exercitados com PostgreSQL e HTTPS descartáveis. Os
testes cobrem mensagens de login, bloqueio por matrícula/IP, expiração,
revogação, concorrência, matriz negativa para as rotas existentes, último
administrador, falhas de infraestrutura, setup e criação por comando.
O fluxo da interface foi exercitado no navegador com API simulada em
1366×768 e 375×812, incluindo troca inicial, criação/edição/redefinição,
auditoria, saída e foco inicial por teclado. Esse teste não valida o fluxo
integrado de navegador com CA operacional. `npm run typecheck`, `npm test`
(64 testes em sete arquivos) e `npm audit` passaram sem vulnerabilidades.
A revisão humana está pendente. A compilação da interface avisa que o bundle
principal excede 500 kB; ainda não foi feita aferição de carregamento em rede.

Na fatia 4, analista, coordenador e secretário adjunto podem consultar nome,
CPF ou matrícula, selecionar uma pessoa e percorrer vínculos e eventos
paginados. O administrador técnico não tem acesso funcional. As consultas são
autorizadas e auditadas, sem termo de busca no registro de auditoria; o CPF
aparece mascarado nos detalhes. A migração `003-consulta` adiciona índices
para vínculos e eventos. O setup a aplica somente em banco novo; não há
procedimento autorizado de atualização de instalação existente.

Em PostgreSQL 16.15 e HTTPS descartáveis, os testes inseriram 17.700 vínculos
exclusivamente fictícios e verificaram a matriz de acesso, CPF mascarado,
vínculos com sufixos, matrícula duplicada, paginação, erros e auditoria. Em
uma execução direcionada, os tempos máximos observados foram 25,2 ms para
nome, 6,2 ms para CPF, 6,5 ms para matrícula e 50,5 ms para páginas de nome
com muitos resultados; cada medição deve ficar abaixo de 1.000 ms. São
medições locais, não uma garantia de capacidade em produção.

A interface foi exercitada no navegador com API simulada e dados fictícios:
resultados vazios, falhas e retentativas, paginação de busca/vínculos/eventos,
sessão expirada, perfis, foco por teclado e larguras de 1366 e 375 pixels.
Foi usado o navegador integrado baseado em Electron 43.8.3 e Chromium
150.0.7871.250. `npm run typecheck`, `npm test` (67 testes em sete arquivos)
e `npm audit` passaram; a auditoria não apontou vulnerabilidades.
Esse teste não substitui navegador integrado ao serviço HTTPS com CA confiável,
revisão de acessibilidade ou revisão humana. O gerador atual atende à aferição
da consulta, mas ainda não cobre todos os cenários necessários à importação
e sincronização da fatia 7.

Na primeira entrega da fatia 5, o cálculo interativo da DOF usa a admissão do vínculo local e o
motor de regra provisória no servidor. A interface permite informar deduções e
incorporações por ano, inclusive períodos com mais de 41 anos; exige confirmar
os valores e informa que os registros da fonte ainda não são carregados
automaticamente. Não grava documento nem modifica a fonte. Testes HTTPS e
PostgreSQL descartáveis verificaram 45 anos, totais, perfis, CSRF, erros,
auditoria e ausência de emissão; a interface foi exercitada separadamente com
API simulada, inclusive paginação e telas de 1366 e 375 pixels. `npm test`
passou com 69 testes, `npm run typecheck` passou e `npm audit` não apontou
vulnerabilidades. O gate da fatia 5 permanece **não cumprido**.

Na continuação da fatia 5, analista e coordenador podem salvar, listar,
reabrir e editar seus próprios rascunhos de DOF. Entradas, resultados,
valores de ajustes e motivos são cifrados; a fonte não é alterada. A revisão
impede sobrescritas concorrentes, a remoção de anos exige confirmação, e a
interface avisa antes de descartar alterações. Mudança da admissão é sinalizada
e uma regra incompatível bloqueia a edição. A migração `004-rascunho-dof` é
aplicada somente pelo setup em banco novo; não há atualização autorizada de
instalação existente.

Os testes direcionados de contratos, PostgreSQL/HTTPS e Playwright passaram
(35 testes); `npm test` passou com 74 testes em oito arquivos,
`npm run typecheck` passou e `npm audit` não apontou vulnerabilidades. Na
execução completa, os máximos locais de consulta foram 26,9 ms para nome,
7,1 ms para CPF, 6,7 ms para matrícula e 56,6 ms para página ampla.
O navegador usa API simulada e dados fictícios; os testes de backend usam
HTTPS com CA e PostgreSQL descartáveis, em execução separada.
Playwright 1.64.1 e Chromium 156.0.8078.4 foram usados nesta máquina. O teste
integrado de navegador com CA operacional e a revisão humana continuam
pendentes. A proteção da admissão durante a gravação foi ampliada e verificada
posteriormente, conforme descrito abaixo.

Na continuação da fatia 5, foram adicionados blocos manuais, versões técnicas
vazias e prévia não oficial. Os blocos são cifrados, ordenáveis e desativáveis;
alterações exigem motivo e usam a revisão do rascunho. A abertura da prévia é
auditada; o conteúdo é escapado e exibido em iframe isolado. Variáveis não
disponíveis são destacadas; naquela entrega ainda não havia conferência. A
migração `005-blocos-dof` é aplicada apenas em banco novo.

`npm run typecheck`, `npm test` (78 testes em nove arquivos) e `npm audit`
passaram; a auditoria de dependências não apontou vulnerabilidades. Na
execução completa, a abertura auditada de uma prévia de 45 anos por HTTPS
descartável levou 7,5 ms. Em Chromium com API simulada, o máximo observado em
cinco edições até a exibição foi 33,7 ms com um bloco e 84,7 ms no limite de
200 blocos e 20.000 caracteres. A atualização local não usa rede nem debounce.
São medições locais, sem garantia de capacidade operacional ou integração do
navegador à CA operacional. O bundle principal ainda ultrapassa 500 kB.
O gate da fatia 5 continua **não cumprido**.

Também foi acrescentado o número de processo cifrado e validado por máscaras
explicitamente configuradas, sem formato institucional presumido. Sua
alteração usa motivo e revisão; a remoção requer confirmação. Sem máscara
configurada, inclusão e substituição são bloqueadas. A migração
`006-processo-dof` só é aplicada em banco novo.

`npm run typecheck`, `npm test` (80 testes em dez arquivos) e `npm audit`
passaram; não foram apontadas vulnerabilidades nas dependências. Os testes
incluem configuração ausente, cifra, remoção, permissões e concorrência em
infraestrutura descartável e API simulada. Essa preparação não implementa a
conferência nem autoriza emissão.

O autor agora pode encaminhar um rascunho a um coordenador específico, que o
consulta sem poder editá-lo. Enquanto encaminhado, o conteúdo fica bloqueado
até o autor recolhê-lo com motivo cifrado. O envio permanece em `rascunho` e não
constitui conferência. Os testes direcionados passaram (34 testes em quatro
arquivos), incluindo revogação, papéis, concorrência, gatilhos, auditoria e
navegador com API simulada. A migração `007-encaminhamento-dof` é aplicada
somente em banco novo; não há atualização autorizada de instalações existentes.
`npm test` passou com 84 testes em 11 arquivos e `npm audit` não apontou
vulnerabilidades. Nesta execução, a prévia HTTPS descartável de 45 anos levou
7,7 ms; a atualização local no navegador simulado levou até 84,3 ms no limite
de blocos. O bundle principal continua acima de 500 kB. Essas medições não
substituem integração com a CA operacional nem demonstram capacidade de produção.

Foi adicionada uma verificação preliminar auditada para rascunhos próprios e
encaminhados ao coordenador destinatário. Ela compara identidade, matrícula,
admissão, período e recálculo, processo e variáveis de blocos ativos; informa
pendências e avisos, sem transição de estado. Falta a definição dos campos
obrigatórios e da aprovação institucional do modelo. A verificação posterior
da filiação é descrita abaixo; afastamentos e incorporações da fonte ainda não
são automaticamente confrontados com os lançamentos.

A migração `008-preconferencia-dof` protege a leitura da fonte durante a
consulta com um bloqueio advisory compartilhado; escritas em pessoa e vínculo
obtêm o bloqueio exclusivo antes do comando. Há conflito explícito quando
uma escrita já está em andamento. O bloqueio é global e seu impacto em
importações e sincronização futuras ainda não foi aferido. O setup aplica
essa migração somente em banco novo; instalação anterior não inicia e não há
procedimento autorizado de atualização. A verificação é um retrato pontual:
mudanças posteriores exigem nova consulta.

Os testes direcionados de backend HTTPS/PostgreSQL e navegador com API
simulada passaram (32 testes), incluindo duplicidade concorrente, máscaras,
regra incompatível, erros de integridade e resposta obsoleta. Na execução,
a prévia de 45 anos levou 7,2 ms no HTTPS descartável; as atualizações locais
no limite de 200 blocos e 20.000 caracteres chegaram a 85,0 ms e, com milhares
de delimitadores malformados, a 160,3 ms. Essas medições são locais e não
representam desempenho operacional nem substituem a revisão humana.
`npm run typecheck` passou, `npm test` passou com 88 testes em 12 arquivos e
`npm audit` não apontou vulnerabilidades. Na suíte completa, os máximos
correspondentes foram 8,2 ms, 84,2 ms e 158,1 ms, respectivamente; o bundle
principal ainda excede 500 kB.

O autor pode confirmar expressamente o ajuste de início anterior à admissão,
com revisão, confirmação cifrada e auditoria. Essa confirmação é invalidada
quando o cálculo é editado e não é considerada válida enquanto a admissão da
fonte divergir. Não pode ser alterada em documento encaminhado ou conferido.
Na consulta preliminar, sua ausência permanece um bloqueio; sua presença não
representa conferência nem aprovação. A migração `009-confirmacao-inicio-dof`
é aplicada apenas a banco novo. Não há procedimento autorizado para atualizar
uma instalação existente. Testes direcionados passaram (34 testes em três
arquivos), com permissões, CSRF, cifra, alterações da fonte e concorrência em
PostgreSQL/HTTPS descartáveis e navegador com API simulada. `npm run typecheck`
passou, `npm test` passou com 90 testes em 13 arquivos e `npm audit` não
apontou vulnerabilidades. Na suíte completa, a prévia HTTPS de 45 anos levou
7,8 ms e a atualização local no limite de blocos chegou a 84,9 ms, ou 159,3 ms
com milhares de delimitadores malformados.

A criação e a edição do cálculo também usam o bloqueio advisory compartilhado
da fonte: uma escrita já iniciada em pessoa ou vínculo retorna conflito, e uma
escrita iniciada durante o salvamento aguarda a transação. A edição relê os
dados após obter o bloqueio, sem conceder escrita da fonte à aplicação.
`npm run typecheck` passou e os 22 testes direcionados de PostgreSQL/HTTPS
descartáveis passaram, incluindo as duas ordens de concorrência. A suíte
completa passou com 90 testes em 13 arquivos; `npm audit` não apontou
vulnerabilidades. Nesta execução, a prévia HTTPS de 45 anos levou 7,6 ms; a
atualização no limite de blocos chegou a 84,4 ms, ou 158,3 ms com milhares de
delimitadores malformados. O bloqueio é global, não cobre outras tabelas de
fonte e precisa ter desempenho, falhas e ordenação reavaliados antes de
importação ou sincronização.

A pré-conferência agora verifica a integridade da cifra do nome da mãe e a
validade técnica do texto, sem afirmar que corresponde à pessoa.
Naquela etapa, campo ausente gerava aviso, e cifra corrompida ou texto inválido
geravam bloqueio. A conferência provisória posterior passou a bloquear também
a ausência. O texto protegido usa UTF-8 diretamente no envelope cifrado; a
importação futura deve observar esse contrato. `npm run typecheck` e os
23 testes direcionados passaram em recursos sintéticos descartáveis;
`npm test` passou com 91 testes em 14 arquivos e `npm audit` não apontou
vulnerabilidades. Nesta execução, a prévia HTTPS de 45 anos levou 7,9 ms; a
atualização no limite de blocos chegou a 84,8 ms, ou 156,3 ms com milhares de
delimitadores malformados. Naquela etapa a prévia ainda não exibia o campo;
essa exibição foi acrescentada posteriormente, conforme abaixo.

A prévia provisória passou a mostrar os campos da fonte necessários à DOF,
inclusive CPF integral e nome da mãe, quando disponível, somente ao autor ou
ao coordenador destinatário. A leitura é auditada, protegida contra escrita
concorrente e mantida apenas em memória no navegador; a tela não se atualiza
automaticamente quando a fonte muda. O mesmo resolvedor verifica as variáveis
na pré-conferência. A suíte completa passou (93 testes em 14 arquivos),
incluindo autorização, integridade, escape de HTML, resposta obsoleta e
concorrência. `npm run typecheck` passou e `npm audit` não apontou
vulnerabilidades. Naquela etapa não havia conferência, aprovação de modelo ou emissão.

O coordenador destinatário pode devolver o rascunho não conferido com motivo
cifrado, visível apenas ao autor. A operação encerra o encaminhamento, cria
nova revisão e não altera o status para conferido. A leitura do motivo e a
devolução são auditadas sem o texto nos detalhes; conflitos, identidade do
destinatário e concorrência com recolhimento são tratados explicitamente.
Essa operação não substitui a devolução posterior de documento conferido. A
migração `010-devolucao-dof` só é aplicada em banco novo; não há procedimento
aprovado para atualização de instalação existente. `npm run typecheck` e a
suíte completa passaram (95 testes em 14 arquivos); `npm audit` não apontou
vulnerabilidades. Os testes cobrem autorização, cifra, motivo inválido,
revisão, concorrência e a interface com dados sintéticos. A prévia HTTPS de
45 anos levou 11,7 ms; no navegador simulado, a atualização no limite dos
blocos chegou a 87,3 ms, ou 167,7 ms com delimitadores malformados.

A prévia aberta fornece uma prova autenticada das revisões do documento, da
pessoa e do vínculo selecionados; a verificação preliminar a compara quando
presente e informa conflito se elas mudaram. Sem prévia, a verificação continua
disponível sem essa comparação. A migração `011-revisao-fonte-dof` incrementa
as revisões a cada atualização e é aplicada apenas em banco novo. A prova não
representa conferência nem revisão humana e não cobre outras tabelas da fonte.
Os testes direcionados passaram (46 testes em cinco arquivos), incluindo
PostgreSQL/HTTPS descartáveis e navegador com API simulada. `npm run typecheck`
e a suíte completa passaram (98 testes em 14 arquivos); `npm audit` não apontou
vulnerabilidades. Nesta execução, a prévia HTTPS de 45 anos levou 11,5 ms; a
atualização no limite dos blocos chegou a 86,6 ms, ou 158,6 ms com
delimitadores malformados.

Analista ou coordenador pode conferir provisoriamente um rascunho próprio, e
o coordenador destinatário pode conferir o encaminhado. A confirmação exige
prévia vinculada, revisão humana expressa e revalidação transacional da fonte,
do relatório e dos bloqueios. Seis campos da referência ausentes bloqueiam a
conferência como medida conservadora, sem presumir aprovação institucional. O
coordenador autor ou destinatário pode devolver o conferido com motivo cifrado;
o evento anterior permanece imutável. A lista e a prévia usam a fonte atual,
não um snapshot. A migração `012-conferencia-dof` só é aplicada em banco novo.
Foram verificados 46 testes direcionados com PostgreSQL/HTTPS descartáveis e
navegador com API simulada. `npm run typecheck` e `npm test` passaram, com
102 testes em 14 arquivos; `npm audit` não apontou vulnerabilidades. Na suíte
completa, a abertura HTTPS da prévia de 45 anos levou 13,2 ms e a atualização
local no limite dos blocos chegou a 87,9 ms, ou 163,1 ms com delimitadores
malformados. O bundle principal continua acima de 500 kB. A implementação e
seus limites estão na [decisão 017](decisoes/017-conferencia-provisoria-dof.md).

Foi preparado um renderizador experimental de PDF provisório, ainda sem rota,
botão, armazenamento ou emissão. Os testes leem PDFs inteiramente sintéticos,
verificam as 12 colunas de cada linha de 45 anos, cabeçalhos repetidos,
paginação, margens e os limites de 200 blocos e 20.000 caracteres; cobrem
isolamento e falhas do navegador. Em 20 renderizações aquecidas em memória,
a mediana foi 278,0 ms, o p95 291,9 ms e o máximo 300,5 ms. A medição não
inclui fila, gravação ou download e não comprova o requisito ponta a ponta.
Fontes autorizadas, snapshot persistido, número, job, histórico e aprovação
institucional continuam pendentes; detalhes na
[decisão 018](decisoes/018-pdf-provisorio-dof.md). A suíte completa passou com
110 testes em 15 arquivos, e `npm audit` não apontou vulnerabilidades. Na
execução completa, as 20 renderizações aquecidas em memória tiveram mediana
de 290,6 ms, p95 de 301,8 ms e máximo de 304,7 ms.
Um formatador separado prepara nomes seguros para os quatro tipos e aceita
sufixos de colisão explícitos, sem gravar arquivos. A busca e reserva
atômica de nomes e a recuperação de colisões continuam não implementadas. A
suíte completa posterior passou com 118 testes em 16 arquivos.

Um componente experimental grava PDFs sintéticos em diretórios temporários,
por UUID, sem sobrescrever e com conferência de SHA-256. Testes verificam
concorrência, alterações no arquivo, escrita parcial e falhas de publicação e
limpeza. A medição direcionada de 20 renderizações aquecidas com gravação e
verificação local teve mediana de 302,6 ms, p95 de 317,2 ms e máximo de
317,7 ms; não inclui fila ou transação. Não há worker, gravação operacional
ou recuperação integrada. A ACL, os limites de persistência e as pendências
estão na [decisão 019](decisoes/019-armazenamento-pdf.md). A suíte completa
passou com 129 testes em 17 arquivos; nela, as 20 renderizações com gravação
tiveram mediana de 299,9 ms, p95 de 316,5 ms e máximo de 327,9 ms.

Um processador experimental reivindica jobs sintéticos após commit, valida e
decifra a cópia provisória, grava o PDF e conclui o job e o artefato em uma
transação. Foram testados concorrência, perda de posse, falhas de disco e de
transação, confirmações incertas e retomada da mesma emissão em PostgreSQL
descartável. Em 20 jobs aquecidos de 45 anos, a execução direcionada teve
mediana de 289,3 ms, p95 de 309,5 ms e máximo de 322,6 ms da chamada do
processador ao commit do artefato. Não inclui transporte ou espera em fila e
não comprova o limite ponta a ponta. O processador não está ligado à aplicação,
não inicia worker e pode deixar arquivos órfãos; a recuperação segura e o
reprocessamento operacional de falhas permanecem pendentes. A identidade da
posse agora é o UUID do artefato interno. Detalhes e demais limites na
[decisão 020](decisoes/020-processamento-pdf-provisorio.md). `npm test`
passou com 130 testes em 17 arquivos; `npm run typecheck` passou e
`npm audit` não apontou vulnerabilidades.

O processador também possui reagendamento interno experimental para jobs
falhos. A mesma emissão e o mesmo número são preservados; chamadas simultâneas,
estados inconsistentes, conclusão concorrente e confirmação incerta foram
testados em banco descartável. Não há rota, autenticação ou auditoria para
esse método, e o estado concluído do banco não comprova o arquivo em disco.
Um reprocessamento operacional autorizado e auditado ainda não foi implementado.
A suíte completa voltou a passar com 130 testes em 17 arquivos.

Até essa etapa, nenhum banco, serviço, certificado ou dado real havia sido alterado.

## Preparação dos componentes locais — 31/10/2026

Foi instalado o PostgreSQL 16.15-5 com o instalador oficial da EDB, após
verificação do hash e da assinatura e autorização para criar o serviço Windows.
O serviço `postgresql-x64-16` inicia automaticamente como `NetworkService`.
O instalador configurou inicialmente a escuta em todas as interfaces; ela foi
restringida a `127.0.0.1:5432` e o serviço foi reiniciado. A autenticação local
usa `scram-sha-256`. A conexão sem senha foi recusada e uma consulta autenticada
confirmou PostgreSQL 16.15, codificação UTF-8 e endereço local.

Foram confirmados Node 24.20.0, npm 11.19.0, dependências npm e Chromium
156.0.8078.4. `npm test` passou com 130 testes em 17 arquivos e
`npm run typecheck` passou. Após a instalação, os 25 testes de
`node scripts\executar-testes.cjs tests\fundacao.test.ts` também passaram.
Esses testes usam PostgreSQL e demais recursos descartáveis, não o serviço
instalado; eles não validam a aplicação integrada ao banco permanente.

O [suporte regular do Windows 10 Pro 22H2](https://learn.microsoft.com/en-us/lifecycle/products/windows-10-home-and-pro)
terminou em 14/10/2025. Não foi verificada a cobertura por atualizações de
segurança estendidas; o suporte aplicável deve ser confirmado antes do uso
operacional.
Até esta preparação dos componentes, não haviam sido criados banco ou papéis do SisDoc, certificado, configuração
`SISDOC_CONFIG` ou serviço da aplicação. O proxy permanece sem decisão e sem
integração. A preparação do PostgreSQL não equivale à instalação do SisDoc
nem autoriza seu uso operacional. A inicialização e a autorização posteriores
estão registradas abaixo.

A aplicação não possui emissão, importação ou instalação como serviço. O uso
operacional das funções existentes foi autorizado em 31/10/2026
([decisão 021](decisoes/021-autorizacao-operacional.md)); certificado local
autossinado foi aceito por não haver acesso externo. Conta de serviço, proxy,
backup e suporte do sistema operacional permanecem pendentes.
Divergências e decisões estão em
[001-regras-e-estado-inicial.md](decisoes/001-regras-e-estado-inicial.md) e
[002-modelo-e-protecao.md](decisoes/002-modelo-e-protecao.md) e
[003-motor-calculo.md](decisoes/003-motor-calculo.md) e
[004-autenticacao.md](decisoes/004-autenticacao.md) e
[005-consulta-servidores.md](decisoes/005-consulta-servidores.md) e
[006-calculo-interativo-dof.md](decisoes/006-calculo-interativo-dof.md) e
[007-rascunhos-dof.md](decisoes/007-rascunhos-dof.md) e
[008-blocos-e-previa-dof.md](decisoes/008-blocos-e-previa-dof.md) e
[009-processo-dof.md](decisoes/009-processo-dof.md) e
[010-encaminhamento-dof.md](decisoes/010-encaminhamento-dof.md) e
[011-preconferencia-dof.md](decisoes/011-preconferencia-dof.md) e
[012-confirmacao-inicio-dof.md](decisoes/012-confirmacao-inicio-dof.md) e
[013-identidade-fonte-dof.md](decisoes/013-identidade-fonte-dof.md) e
[014-dados-fonte-previa-dof.md](decisoes/014-dados-fonte-previa-dof.md) e
[015-devolucao-rascunho-dof.md](decisoes/015-devolucao-rascunho-dof.md) e
[016-revisao-fonte-previa-dof.md](decisoes/016-revisao-fonte-previa-dof.md) e
[017-conferencia-provisoria-dof.md](decisoes/017-conferencia-provisoria-dof.md) e
[018-pdf-provisorio-dof.md](decisoes/018-pdf-provisorio-dof.md) e
[019-armazenamento-pdf.md](decisoes/019-armazenamento-pdf.md) e
[020-processamento-pdf-provisorio.md](decisoes/020-processamento-pdf-provisorio.md) e
[021-autorizacao-operacional.md](decisoes/021-autorizacao-operacional.md).

## Inicialização local e layout — 31/10/2026

Após a configuração do PostgreSQL, foram provisionados o banco `sisdoc`
em UTF-8 e os logins separados `sisdoc_migracao` e `sisdoc_app`, sem
privilégios administrativos. As credenciais ficaram protegidas fora do
checkout; o login da aplicação não recebe as credenciais de migração.

Foi configurado HTTPS direto em loopback com certificado folha autossinado,
não emissor de CA, para `localhost` e `127.0.0.1`, válido até 31/10/2027.
A confiança em `LocalMachine\Root` foi instalada mediante autorização
expressa para todos os usuários Windows, além da confiança do Node.
Não foram desativados TLS, validação de certificados ou controles de sessão.

Somente depois dessas etapas, o setup foi inicializado com confirmação
interativa. Aplicou 13 migrações até `012-conferencia-dof`, criou um
administrador ativo com troca obrigatória de senha e a configuração externa
em `C:\ProgramData\SisDoc\instalacao`. O banco tem **zero pessoas**:
nenhum dado real ou fictício foi importado. A lista externa de senhas comuns
foi instalada com a licença MIT do SecLists preservada.

O backend foi iniciado manualmente em **https://localhost:3443/**. Foram
verificados certificado confiável no Windows, página inicial, health 200,
sessão não autenticada 401 e escuta exclusiva em `127.0.0.1`.
O PostgreSQL tem serviço automático; **a aplicação ainda não tem serviço
Windows**. O primeiro login e a troca de senha deverão ser feitos pelo
responsável, sem compartilhar a senha.

O editor DOF foi reorganizado conforme o protótipo: menu lateral escuro
por perfil, busca global, dados em cartões, cinco abas acessíveis, prévia
auditada independente da aba e barra inferior com totais e salvamento.
DTCs, histórico e emissão continuam claramente indisponíveis. A admissão
não foi rotulada como posse/exercício e as deduções não incluem
incorporações indevidamente. Troca de abas preserva valores e a busca
global confirma antes de descartar edições.

Os 16 testes de interface de rascunhos passaram, incluindo regressão do
layout em duas colunas, teclado, prévia entre abas, cancelamento de busca,
menu móvel e ausência de overflow horizontal em 375 pixels.
O novo teste também verifica os quatro totais exatos com faltas e
incorporação PB, e a limpeza de dados integrais ao fechar a prévia.
A comparação visual foi feita com dados inteiramente fictícios em API
simulada, não no banco instalado. Em uma execução direcionada, os máximos
edição-exibição foram 39,4 ms para 45 anos, 99,0 ms no limite de blocos e
174,2 ms com delimitadores malformados. Não são garantia operacional.

Foram preparados [README](../README.md),
[instalação local](INSTALACAO_LOCAL.md), [operação](OPERACAO.md) e contexto
de construção. A autorização operacional solicitada foi recebida como
intenção do responsável, mas emissão, importação, DTCs, edição cadastral
exclusiva da declaração, backups, serviço, suporte de segurança e aceite
institucional permanecem pendentes. As máscaras de processo estão ausentes.
O gate da fatia 5 continua parcial; próximos passos detalhados na
documentação da instalação.

`npm run typecheck` passou e `npm test` passou com **131 testes em 17
arquivos**, usando recursos descartáveis. O aviso preexistente de bundle
frontend acima de 500 kB continua; não foi ocultado nem tratado como falha.

## Autorização operacional — 31/10/2026

O responsável autorizou expressamente o uso operacional da instalação local
(`https://localhost:3443/`). A autorização, seu escopo e os recursos ainda
indisponíveis estão na [decisão 021](decisoes/021-autorizacao-operacional.md).
A interface passou a indicar a autorização; novas instalações continuam
iniciando sem autorização até registro próprio do responsável.

## Fatia 5 concluída — emissão da DOF — 31/10/2026

Implementada a emissão da DOF de ponta a ponta, condicionada à aprovação
formal da regra e do template ([decisão 022](decisoes/022-aprovacao-formal-e-emissao.md)):

- migração `013-emissao`: `documentos.aprovacao_modelo` (imutável, gravável
  só pelo papel de migração), `documentos.emissao_aprovacao` (vínculo imutável
  da emissão à aprovação usada) e GRANTs de coluna mínimos ao papel da
  aplicação para numeração, emissão, jobs/artefatos de PDF e cancelamento;
- `npm run migrar` (atualização idempotente de instalação existente) e
  `npm run aprovar-modelo` (interativo, confirmação `APROVAR DOF`, auditado);
- `POST /api/documentos/:id/emitir` (coordenador, `Idempotency-Key`,
  revalidação de conferência, fonte e regra, `FOR UPDATE` na numeração,
  snapshot cifrado), worker de PDF iniciado com a API com reprocessamento no
  mesmo número, template oficial sem marca de prévia, download auditado,
  histórico, cópia como rascunho e cancelamento com motivo cifrado;
- interface: **Emitir DOF** em DOFs conferidas para coordenador, estado e
  download do PDF, tela **Histórico** habilitada, cópia e cancelamento.

`tests/emissao.test.ts` cobre, com aprovação sintética em banco descartável:
bloqueio sem aprovação, perfis, idempotência concorrente, numeração
sequencial concorrente, PDF gerado para caso com mais de 41 anos de serviço,
falha e reprocessamento com o mesmo número, worker automático, nomes de
colisão, download auditado, histórico por perfil, cópia, cancelamento e
`migrar` sobre banco com 13 migrações.

`npm run typecheck` passou e `npm test` passou com **140 testes em 18
arquivos**. **Nenhuma aprovação foi registrada na instalação local**: a
emissão operacional permanece bloqueada até a validação formal pela área
responsável. A instalação local precisa de `npm run build` e
`npm run migrar` antes de reiniciar com esta versão. DTCs, importação, backup
e serviço Windows continuam pendentes.
## Fatia 6 concluída — DTC IPAM, Comissionado e INSS — 31/10/2026

As três DTCs funcionam de ponta a ponta, do rascunho ao PDF, ao histórico, à
cópia e ao cancelamento. A migração `014-dtc` e a
[decisão 023](decisoes/023-dtc-ipam-comissionado-inss.md) registram o desenho.
Cada tipo exige aprovação formal própria. O template INSS sai marcado como
**MODELO PROVISÓRIO** até o recebimento dos textos oficiais.

Na finalização, dois testes antigos foram ajustados ao novo comportamento:

- o job de PDF de DTC agora registra o evento `conferencia_dtc` antes de
  passar o documento a conferido;
- o item **DTC IPAM** do menu passou a ficar habilitado.

`npm test` passou com **148 testes em 19 arquivos**.

Complemento DTC: editor preserva e permite PB/PV/licença-prêmio anuais;
cálculo e snapshot mantêm valores não zero com aviso provisório. A prova
específica inclui os períodos IPAM e fica cifrada no evento imutável de
ajuste da revisão conferida. Bloqueio SHARE/NOWAIT mantém a fonte estável
até o commit; alteração posterior invalida conferência/emissão, inclusive
com prévia renovada. Conferências anteriores sem prova completa precisam
ser devolvidas e reconferidas. Migração `021-revisao-periodos-ipam` instala
helper SECURITY DEFINER restrito, sem ampliar UPDATE; setup e gate da API
exigem 021. INSS provisório e
proibição de administrador criar/copiar permanecem inalterados.
Validação focada do complemento: cálculo/editor **37/37** e integração DTC
**18/18**, incluindo papel real, prova antiga/nova e escritas IPAM
concorrentes. Build API e typecheck dos testes passaram. Sem deploy.

A instalação local foi atualizada, com backup `pg_dump` prévio, por
`npm run migrar`, que aplicou `014-dtc`. A aplicação foi reiniciada em
`https://localhost:3443/`. Nenhuma aprovação de DTC foi registrada.

## Fatia 7 concluída — importação, legado e sincronização — 31/10/2026

- **Importação** (CLI `npm run importacao` e tela **Importação**, admin):
  CSV/XLSX dos cinco tipos, dry-run por padrão, quarentena/rejeição/
  duplicadas/divergências/anomalias com CPF mascarado, consolidação por CPF,
  idempotência por hash do arquivo e por registro, transação única, rollback
  LIFO, conferência `npm run importacao:conferir` com amostra mascarada e
  modelos sintéticos em `referencias/modelos-importacao/`
  ([decisão 024](decisoes/024-importacao.md),
  [DADOS_E_IMPORTACAO.md](DADOS_E_IMPORTACAO.md)).
- **Base legada**: mapeamento JSON configurável; falha clara se faltar coluna.
  O esquema real ainda não foi recebido.
- **Sincronização** com API simulada (`tools/api-simulada/`): carga completa
  e incremental, staging, `hash_conteudo`, exclusão lógica após reconciliação
  completa, disjuntor e aviso offline; a emissão não depende da API
  ([decisão 025](decisoes/025-sincronizacao.md)). Só servidores e vínculos
  são sincronizados.
- Migração `015-importacao`: o papel da aplicação passa a ter INSERT/UPDATE
  por coluna nas tabelas do núcleo; DELETE continua negado.
- 20 mil vínculos importados em segundos no teste. `npm test` passou com
  **166 testes em 21 arquivos**; `npm run typecheck` passou.

## Implantação da fatia 7 e aprovações formais — 31/10/2026

A instalação local foi atualizada com backup `pg_dump` prévio e
`npm run migrar` (aplicou `015-importacao`); a aplicação foi reiniciada em
`https://localhost:3443/`, somente em loopback.

Aprovação formal registrada para **DOF, DTC IPAM, DTC Comissionado e DTC
INSS** por Euzébio Pereira da Silva Filho (Desenvolvedor de Sistemas),
referência "Autorização do responsável em 31/10/2026 (docs/decisoes/022)".
A emissão operacional está liberada para coordenadores. A DTC INSS foi
aprovada a pedido do responsável mesmo com os textos provisórios; os PDFs
continuam marcados como **MODELO PROVISÓRIO** até os textos oficiais.

Pacote extra (fatias 8–9 e pendências externas) não autorizado por enquanto.

## Cadastro, Informática e transferência de dados — 31/10/2026

Alteração funcional autorizada pelo responsável, separada do pacote extra:

- Cadastro usa analista/coordenador, com consulta auditada aos dados pessoais
  completos e referências de eventos, afastamentos, incorporações e períodos IPAM.
- Administrador da Informática tem acesso funcional completo, inclusive
  rascunhos e emissões de terceiros, sem eliminar revisão, CSRF, auditoria,
  aprovação formal ou imutabilidade dos documentos emitidos.
- Migração `016-acesso-admin` atualiza os controles de perfil no banco.
- Sincronização reúne importação e exportação dos cinco tipos em CSV/XLSX,
  por origem, com dados completos e confirmação/auditoria. Exportação não é backup.
- Testados 64 usuários concorrentes por perfil e um grupo misto (256 contas
  e sessões reais HTTPS, base sintética de 20 mil vínculos, 960 requisições):
  zero erros. p95 da suíte completa entre 715,0 e 737,2 ms; máximo 795,7 ms.
  A medição cobre sessão, busca e referências, não emissão concorrente de PDFs.
- Chromium verificou a consulta de referências pelo Cadastro e a exportação
  com confirmação/download na tela Sincronização.

Detalhes, limites e evidências:
[decisão 026](decisoes/026-cadastro-informatica-e-exportacao.md).
A aplicação permanece somente em loopback; as fatias 8–9 continuam fora do escopo.

Validação final: 173 testes em 22 arquivos (a única expectativa antiga de
contagem das migrações foi corrigida e o arquivo de emissão reexecutado com
10/10 testes aprovados). Build e `npm run typecheck` aprovados.

Implantado em `https://localhost:3443/` após backup `pg_dump` e aplicação de
`016-acesso-admin`. Health respondeu `ok`; referências e exportação sem
login responderam 401. Nenhum dado real ou usuário operacional foi usado
nos testes de carga.

## Ajustes da administração e XLSX legado — 31/10/2026

Concluído, conforme a
[decisão 027](decisoes/027-administracao-documentos-cadastro-legado.md):
administrador não cria DOF/DTC nem cópias, mas opera documentos existentes;
exclusão física controlada de documentos e PDFs; edição de servidores no
núcleo local com motivo, auditoria cifrada e revisões; Sincronização separada
de Importação/Exportação; seleção de destino Núcleo/Legado.

XLSX destinado ao legado preserva cabeçalhos e valores textuais em staging
cifrado, sem conversão automática para o núcleo. A validação e gravação pela
interface foram exercitadas com planilha fictícia. Nenhum XLSX pessoal do
responsável foi aberto. Edição de servidores passou em 3 testes específicos.
A suíte completa passou: **181 testes em 23 arquivos**, build e typecheck.
As migrações `017-documentos-admin`, `018-edicao-cadastro` e
`019-planilhas-legado` foram aplicadas após backup `pg_dump`; a aplicação
foi reiniciada em `https://localhost:3443/`. Nenhum documento operacional
foi excluído e nenhuma planilha real foi importada automaticamente.
