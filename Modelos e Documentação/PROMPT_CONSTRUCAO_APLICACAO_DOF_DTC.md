# Prompt — Construção da aplicação Sistema de DOFs e DTCs para produção em Windows

Atue como **engenheiro de software sênior e líder técnico**, com experiência em TypeScript/NestJS, React, PostgreSQL, geração de PDF, segurança de aplicações web, LGPD e implantação de produção em Windows, sem vincular essa finalidade a uma edição específica do sistema operacional.

## 1. Objetivo

**Construa a aplicação**, não um plano. Ao final, o usuário deve poder abrir o sistema em seu computador, entrar com matrícula e senha, buscar um servidor, calcular o tempo, editar o documento em tela, conferir, emitir e baixar em PDF os quatro documentos (**DOF, DTC IPAM, DTC Comissionado e DTC INSS**), com histórico e trilha de auditoria.

O sistema deve ser construído **para uma única instalação operacional de produção**.
Não haverá ambiente permanente de teste, homologação ou demonstração, nem modo
`AMBIENTE=teste`. A finalidade de produção independe de ser Windows de estação
ou Windows Server, desde que SO, componentes, licenciamento, capacidade e
controles de segurança sejam compatíveis e tenham suporte vigente.

O banco operacional nasce vazio; a importação dos dados reais será feita **pelo
usuário autorizado**, por ferramentas entregues e verificadas (seção 6).
Nenhum dado real passa pela IA, Git ou serviços externos não autorizados.
Dados sintéticos existem apenas como fixtures de testes de software, nunca
como carga automática do banco operacional ou emissões na sequência oficial.
Testes continuam obrigatórios: usam recursos descartáveis restritos à execução,
sem criar outro ambiente operacional ou escrever na base de produção.

Definição de **"utilizável"** (critério de aceite global):

1. `npm run setup` prepara a instalação de produção (banco vazio, migrações, chaves criptográficas próprias e administrador criado por comando interativo, sem senha fixa).
2. `npm start` sobe a aplicação em HTTPS no endereço configurado; não executa seed sintético. Antes de operar, o usuário realiza a importação autorizada e confere os resultados.
3. O usuário percorre, só pela interface, o fluxo: login → busca → seleção do vínculo → cálculo → edição com motivo → prévia → conferência → emissão (coordenador) → PDF → histórico → cópia como rascunho. Isso para **cada um dos quatro documentos**.
4. `npm test` passa por completo (cálculo, API, permissões, PDF, E2E).
5. Importar arquivos reais nos formatos documentados não requer alteração de código, apenas configuração; a equivalência dos formatos é verificada com fixtures descartáveis.
6. Um manual curto (`docs/MANUAL_USO.md`) e um runbook (`docs/OPERACAO.md`) permitem a uma pessoa que não participou do desenvolvimento instalar, usar e restaurar um backup.

## 2. Documentos de referência (leia antes de escrever código)

As **duas únicas referências ativas de construção** são este prompt e
[`REGRAS_E_BASES_DE_CALCULO_DOF_DTC.md`](./REGRAS_E_BASES_DE_CALCULO_DOF_DTC.md).
Os requisitos dos planos anteriores foram consolidados no **anexo A deste
prompt**; os originais estão em `arquivo/`, apenas para rastreabilidade, sem
necessidade de leitura para implementar. O antigo prompt de elaboração de plano
também foi arquivado: a tarefa atual é construir, não gerar outro cronograma.

Precedência:

1. Documento de regras: evidência das fórmulas e textos condicionais, com distinção
   obrigatória entre `[FÓRMULA]`, `[ESTRUTURA]` e `[INFERIDO]`.
2. Decisões explícitas deste prompt: correções de defeitos e perfis provisórios
   de implementação. As inferências não se tornam regras oficiais por precedência.
3. Anexo A: arquitetura, modelo de dados, API, segurança, operação e ambiente local.

Documentação de contexto e decisões no repositório são derivadas dessas duas
referências. A imagem orienta a identidade visual; modelos limpos orientam o
layout oficial. Não são fontes de dados pessoais ou autoridade de cálculo.

**Conflitos históricos consolidados (registrar em `docs/decisoes/`):**

| Tema | Referência anterior | Documento de regras mostra | Decisão para a implementação |
|---|---|---|---|
| P/F na soma de deduções | §2.3 item 4 e §6.2 item 5: "coluna D não entra" | Fórmula `G` do DOF **inclui** o excesso de P/F acima de **180 dias acumulados**; o IPAM também (por período) | Seguir as planilhas. Parâmetro `pf_limite = 180` e `pf_entra_na_soma = true` em `RegrasVersao`, marcado como **regra provisória** |
| Escopo dos limites T/S (730) e P/F (180) | pendência 2 | DOF: acumulado no vínculo; IPAM: por período declarado | Parâmetro `escopo_limite` com valores `vinculo` ou `periodo`; perfil `dof-planilha` usa `vinculo`, `ipam-planilha` usa `periodo`; Comissionado e INSS herdam `ipam-planilha` até decisão |
| Total no cabeçalho do DOF | — | `C22` usa dias **brutos**; o texto usa dias **líquidos** | Exibir ambos, rotulados ("dias do período" × "tempo líquido") |
| Campo `Nível` do DOF | — | `FIND("-")` falha em 136 referências sem hífen | Tratar sem erro: nível vazio + aviso |
| Totais até a linha 69 | §2.5 | Perde o último ano para quem tem mais de ~41 anos | **Não replicar o defeito**; é o caso GT-02 |

Se encontrar outra divergência, **não escolha em silêncio**: registre em
`docs/decisoes/` (contexto, alternativas, escolha, motivo). A precedência não
autoriza alterar texto oficial, perder dados ou apresentar inferência como
aprovação administrativa.

## 3. Restrições (não negociáveis)

- **Stack:** Node.js LTS suportado, TypeScript, NestJS, React + Vite (build servido pelo backend), PostgreSQL 16, Zod compartilhado, Playwright + Chromium para PDF, Vitest. **Nesta máquina, manter Node 24.20.0 da linha 24, já confirmado pelo usuário**, sem substituir ferramentas globais. Confirmar suporte/compatibilidade dessa linha antes do aceite operacional; não retornar automaticamente a Node 20/22. Fila de PDF em tabela `job_pdf` no PostgreSQL.
- **Não usar:** Docker/contêineres, Redis, microsserviços, CI, pull request, SSO, assinatura digital, exportação Word (nesta fase).
- **Arquitetura:** monólito modular conforme anexo A.1 (`apps/api`, `apps/web`, `packages/calculo`, `packages/templates`, `packages/contratos`, `tools/`, `scripts/`, `docs/`).
- **Cálculo** é um **pacote puro** (sem banco, rede, relógio) usado no servidor e no navegador. **Nenhuma fórmula de tempo na tela nem no template.**
- **Integração externa só no módulo `sincronizacao`.** Busca, cálculo, prévia e emissão leem apenas o banco local e funcionam com a API fora do ar.
- **Segurança** conforme anexo A.3: Argon2id (mínimo 12 caracteres), sessão no servidor com cookie `__Host-` `HttpOnly` `Secure` `SameSite=Lax`, CSRF, bloqueio após 5 falhas por 15 min, mensagem de login única, perfis verificados **no servidor**, auditoria append-only (inclusive leitura), CPF por HMAC para busca e cifrado em coluna, logs sem CPF/RG/senha/token, nada de dado pessoal em `localStorage`/`sessionStorage`. **Não afrouxe nenhum controle para facilitar testes.**
- **Instalação de produção:** qualquer Windows compatível e suportado, com ou sem domínio. Node/PostgreSQL em loopback; acesso por HTTPS via Caddy ou IIS conforme compatibilidade e decisão registrada. Caminhos, portas, banco e chaves são configuração, não constantes. Não existe ambiente separado de teste/homologação.
- **Emissão operacional:** somente com regras/templates aprovados, dados conferidos, autorização e controles implementados. Não há chave que transforme regra provisória em oficial; enquanto faltar aprovação, bloquear a emissão afetada com mensagem acionável. Artefatos de testes de software ficam fora do histórico e da numeração oficiais.
- **Git local:** branch `main`, commits pequenos em português, tag por versão. `.gitignore` bloqueia `.env`, `dados-reais/`, PDFs, backups, chaves e certificados.

## 4. Escopo funcional a entregar

### 4.1 Documentos
Os quatro documentos, com campos, limites e textos conforme o anexo A.4 e o documento de regras:

| Documento | Particularidades obrigatórias |
|---|---|
| **DOF** | 1 período; tabela anual **sem limite fixo de 45 linhas**; deduções por ano (faltas, T/S, P/F, I/P, outros); incorporações PB/PV/Licença-prêmio; texto da 2ª página por blocos (contratação, transposição/enquadramento, progressão, complementares); **linhas condicionais do "DECLARO"** (regras §2.7 do documento de regras); número gerado na emissão |
| **DTC IPAM** (Anexo III) | até 4 períodos, cada um com sua tabela anual e limites por período; totais consolidados (contribuição e efetivo exercício); períodos no IPAM; seis linhas de totais (total, EE, PB, PV, PB/PV, licença-prêmio) |
| **DTC Comissionado** (Anexo VIII) | até 3 cargos em comissão (decretos de nomeação/exoneração, publicações no DO, datas) e até 4 períodos; as seis linhas de totais são **inferidas** — marcar como provisórias |
| **DTC INSS** | até 4 períodos, categoria funcional, licenças, documentação-base e observações por blocos; sem datas/anos fixos no texto |

### 4.2 Comportamentos transversais
- **Texto do tempo** exatamente como §1.4 do documento de regras (milhar com ponto, sem decimais; plural/singular; 2 dígitos; omissões; ponto final somente com dias > 0 — ou padronize a pontuação e registre a decisão).
- **Campos digitados à mão hoje** (matrícula de entrada, referência/padrão, data final, nº do processo, local e data, textos de ocorrências) viram campos **validados** (anexo A.4). O nº da declaração deixa de ser edição livre: é reservado na emissão conforme A.5.
- **Lançamento manual de deduções e incorporações por ano**: como as planilhas originais têm faltas, licenças e PB/PV/LP digitados à mão e a fonte pode não trazê-los, o editor deve permitir informá-los por ano (com motivo e registro em `ajuste_campo`) e gravá-los no documento — **sem alterar o banco de origem**.
- **Estados do documento** (`rascunho → conferido → emitido / cancelado`), numeração transacional sem reutilização indevida, snapshot imutável, hash SHA-256 do PDF, nome do arquivo `NOME_TIPO_AAAA-MM-DD.pdf` (anexo A.5), histórico das 5 últimas emissões por grupo DOF/DTC do usuário, "reabrir como cópia".
- **Variável ausente** bloqueia a emissão; ajuste em tela exige motivo.
- **Painéis separados** de DOF e de DTC; aviso quando a última sincronização passar de 24 h (sem bloquear).
- **Usuários e perfis** (`analista`, `coordenador`, `secretario_adjunto`, `admin`) com as permissões da matriz do anexo A.3; criação de usuários por tela de administração e por comando.
- **Administração:** blocos/templates versionados; auditoria; sincronização (lotes e erros); **importação de dados** (seção 6).

## 5. Motor de cálculo

Implemente `packages/calculo` conforme o documento de regras **com as correções e perfis provisórios da seção 2 deste prompt**:

- Contagem **inclusiva** (`fim − início + 1`); ano 365 dias; mês 30 dias; conversão por aritmética inteira.
- Tabela anual gerada de `ano(início)` a `ano(fim)`, sem limite de linhas; 1ª linha contada do início até 31/12; última do 1/1 até a data final.
- Deduções: faltas, I/P e outros integrais; excesso de T/S (>730) e P/F (>180) deduzido **no ano em que o limite é ultrapassado**, só do efetivo exercício; **contribuição não deduz T/S nem P/F**.
- Total de contribuição (DOF) = contribuição + PB + PV + licença-prêmio.
- `RegrasVersao` parametriza limites, bases (365/30), escopo do limite, inclusão de P/F e perfil por tipo de documento. Cada documento guarda a versão usada. **Nenhuma regra provisória pode ser tratada como oficial**: a interface e o snapshot exibem "regra provisória (planilha)" até aprovação.
- Retorne `avisos` (início anterior à posse, T/S/P/F acima do limite, deduções maiores que os dias do ano, referência sem hífen etc.).

**Casos dourados obrigatórios** (arquivos JSON em `packages/calculo/casos/`, executados em todo `npm test`):

| Código | Caso | Esperado |
|---|---|---|
| GT-01 | 1.311 dias | 3 anos, 7 meses, 6 dias |
| GT-REF | Admissão 17/06/1986, fim 20/03/2026, 1 falta | brutos **14.522**; contribuição = efetivo exercício = **14.521** → **39 anos, 09 meses e 16 dias**; texto `14.521 dias, que correspondem a 39 anos, 09 meses e 16 dias.` |
| GT-02 | Mais de 41 anos de serviço (ex.: admissão em 1980) | todos os anos entram nos totais (a planilha atual perde o último) |
| GT-03 | T/S acumulado passa de 730 em dois anos seguidos; P/F passa de 180 | excesso deduzido ano a ano, só do efetivo exercício |
| GT-04 | Período que cruza bissextos | contagem por calendário |
| GT-05 | Início anterior à posse | usa a posse e emite aviso |
| GT-06 | PB, PV e licença-prêmio juntos | texto "DECLARO" com a ordem e as condicionais da tabela §2.7 |
| GT-07 | IPAM com 3 períodos | limites por período; somas dos períodos |
| GT-08 | Matrícula inexistente / mudança de matrícula | erro "Matrícula incorreta" / ligação `matricula_anterior_id` |
| GT-09 | Admissão em 31/12 seguida de ano não bissexto | 365 dias no ano seguinte (a planilha conta 366) |
| GT-10 | Todas as combinações de `PB+PV` e `LP` nulos/não nulos | 4 variantes do texto do "DECLARO" |
| GT-11 | Dias = 0 no resumo | decisão de pontuação registrada e testada |

Complemente com testes de propriedade (fast-check): soma por ano = total; conversão ida e volta; contribuição ≥ efetivo exercício.

## 6. Dados de produção e fixtures de verificação

### 6.1 Fixtures sintéticas exclusivamente para testes de software
`tools/anonimizar` gera arquivos/fixtures **100% fictícios** com o mesmo formato
e armadilhas das bases reais (perfil em §1.5 do documento de regras), suficientes
para medir desempenho (≈ 17,7 mil vínculos). Usar somente em recursos
descartáveis de execução de testes, com destino validado e diferente do banco
operacional. Não entregar seed automático de produção nem modo demonstrativo.

- matrículas `N..NNNNNN-D`, inclusive **mesma pessoa com sufixos `-1` e `-2`** e **matrícula duplicada**;
- regime `ESTATUTARIO` e `SERVICO PRESTADO`; referências `PNS-D`, `IX-B`, `UNICA`, `SERV00`, `DAI1`…`DAS7`, e **referências sem hífen**;
- servidores com 41+ anos, desligados, nascimento/endereço/mãe ausentes, CPF com e sem máscara, datas inválidas, admissão posterior ao desligamento;
- afastamentos anuais e incorporações em volumes variados; períodos IPAM; um caso de mudança de matrícula entre sistemas;
- uma **API simulada** em loopback (paginação, timeout, 429, remoção e dados inválidos) para o módulo de sincronização.

Nunca copie nomes, CPF, endereços ou filiação das planilhas de exemplo; nem sequer abra arquivos de dados reais caso eles existam na máquina.

### 6.2 Importação dos dados reais (você constrói; o usuário executa)
Entregue **importação por linha de comando e por tela de administração**, idempotente e auditada:

**Formatos de entrada aceitos** (CSV UTF-8 e XLSX; modelos em branco em `referencias/modelos-importacao/` com cabeçalhos exatos e um exemplo sintético):

| Arquivo | Conteúdo | Observação |
|---|---|---|
| `dados_funcionais` | as colunas da aba `DadosFuncionais` (12 do DOF; 18 dos DTCs): `MATRICULA, NOME, CPF, NASCIMENTO, MAE, ADMISSAO, REGIMEJUR, CARGO, REFERENCIA, SETOR, ORGAO, DESLIGAMENTO, PISPASEP, NUMRG, NUMTITEL, ORGAORG, ENDERECO, EXPEDICAO` | aceitar a coluna `ADMISSAO` duplicada como `EXPEDICAO` quando vier assim; aceitar as três planilhas e **consolidar por CPF** |
| `afastamentos` | `MATRICULA, ANO, FALTAS, TS, PF, IP, OUTROS` (ou por intervalo de datas) | opcional |
| `incorporacoes` | `MATRICULA, TIPO (PB/PV/LIC_PREMIO), DT_INICIO, DT_FIM` | substitui a calculadora `INCORPORADO` |
| `periodos_ipam` | `CPF, MES_INICIO, MES_FIM` | opcional |
| `eventos_funcionais` | `MATRICULA, TIPO, DATA, ATO_NUMERO, DATA_PUBLICACAO, DESCRICAO` | opcional |
| base legada em PostgreSQL | via **arquivo de mapeamento** (YAML/JSON) tabela→campo canônico | o esquema real ainda não foi recebido: o mapeamento é configurável, e o importador falha com mensagem clara se faltar coluna |

**Comportamento obrigatório:**

1. **Validação e `--dry-run`** (padrão): nada é gravado; produz relatório de contagens (lidos, válidos, rejeitados, duplicados) e lista de divergências por linha, **sem imprimir CPF completo** (usar máscara).
2. **Normalização:** CPF só com 11 dígitos e dígito verificador válido; `matricula_norm`; datas ISO; remoção de espaços; maiúsculas/acentos preservados no texto original e normalizados em campo de busca.
3. **Regras de consolidação:** pessoa por CPF; vínculo por (`sistema_origem`, `matricula`); mesma matrícula repetida = rejeitar a duplicada e reportar (nunca escolher em silêncio); CPF ausente = quarentena; nada de "corrigir" dado sem registro.
4. **Anomalias sinalizadas (não bloqueantes):** referência sem hífen, desligamento anterior à admissão, regime desconhecido, nascimento improvável, endereço/mãe ausentes.
5. **Execução real** (`--commit`) em transação por lote, com `lote_importacao`, `importado_em`, hash do arquivo e usuário; reexecutar o mesmo arquivo **não altera nada**; `--rollback <lote>` desfaz o lote se nenhum documento emitido depender dele.
6. **Não destrutivo:** documentos emitidos mantêm o snapshot; uma nova importação nunca altera emissões antigas.
7. **Desempenho:** importar ≈ 20 mil vínculos em poucos minutos em máquina comum, com barra de progresso.
8. **Segurança:** arquivos reais ficam em `dados-reais/` (fora do Git); a importação cifra CPF/RG/título/PIS e gera `cpf_hash` na gravação; o log nunca contém dados pessoais.
9. **Pós-importação:** comando `npm run importacao:conferir` compara contagens origem × banco e amostra aleatória (com máscara) para conferência humana.
10. **Sincronização** (`sincronizacao`): carga inicial + incremental, `staging_api`, `hash_conteudo`, exclusão lógica, disjuntor, tudo testado contra a API simulada. A integração com a API **real** fica pronta para configuração (URL, credenciais, mapeamento) — nada de valor real no código.

### 6.3 Contrato de dados com as fontes reais
Gere `docs/DADOS_E_IMPORTACAO.md` com: dicionário de campos, formato de cada arquivo, regras de validação, exemplos, lista do que a API/base legada **precisa** fornecer (anexo A.7) e o que é opcional.

## 7. Método de trabalho (como você deve conduzir)

1. **Leia os dois documentos ativos**, incluindo o anexo A, e atualize, antes de codar, `docs/ia/CONTEXTO.md`, `GLOSSARIO.md`, `INVARIANTES.md`, `CONVENCOES.md`, `MODELO_DADOS.md` e `REGRAS_CALCULO.md`, contendo apenas o que está nas referências. Preserve a base já preparada e integre suas decisões confirmadas; não recrie o ambiente nem declare a maquete como fluxo funcional concluído.
2. **Construa em fatias verticais utilizáveis**, nesta ordem. Só avance quando o gate da fatia estiver verde.

| Fatia | Conteúdo | Gate (verificável) |
|---|---|---|
| 0 | Esqueleto do monólito, configuração, scripts, health check, HTTPS local | `npm run setup && npm start` abre a página inicial |
| 1 | Schemas (`legado`, `nucleo`, `documentos`, `seguranca`), migrações, contratos Zod | migração em banco vazio; restrições e `REVOKE` testados |
| 2 | **Motor de cálculo** + casos dourados + textos condicionais | todos os GT passam |
| 3 | Autenticação, sessão, CSRF, perfis, auditoria, usuários | matriz negativa de acesso passa; criação do admin por comando |
| 4 | Consulta de servidores, busca e vínculos; fixtures descartáveis para aferição | busca por nome/CPF/matrícula em < 1 s com ≈ 17,7 mil vínculos, sem carregar a base operacional com fixtures |
| 5 | **DOF de ponta a ponta**: rascunho, editor, prévia, blocos, conferência, numeração, snapshot, PDF, histórico | fluxo completo verificado por testes com caso 41+ anos; emissão operacional só após aprovação |
| 6 | DTC IPAM, DTC Comissionado, DTC INSS | os quatro PDFs gerados, sem conteúdo cortado nos máximos (4 períodos, 3 cargos) |
| 7 | **Importação** (CLI + tela), conferência pós-importação, sincronização com API simulada, modo offline | importar arquivos no formato real (sintéticos) idempotente; API bloqueada não impede emissão |
| 8 | Hardening: testes negativos de segurança, carga, falhas de disco/worker, `npm audit`, varredura de segredos | sem crítico/alto aberto |
| 9 | Backup e restauração (banco + PDFs), instalação como serviço, scripts PowerShell, manual e runbook | restauração em banco isolado recupera emissão, PDF e hash |

3. **Teste antes de declarar pronto.** Não considere uma tarefa concluída porque o código foi escrito: rode os testes, abra o fluxo e registre a evidência. Se algo não puder ser executado no seu ambiente, diga exatamente o que ficou **não verificado**.
4. **Decisões:** quando uma informação externa faltar, avance a parte independente: implemente o parâmetro/ponto de extensão e a regra de referência para verificação automatizada, marque como **provisório** na interface/decisão e liste a pendência. Em produção, bloqueie emissão que dependa de regra/template não aprovado; não substitua aprovação por aviso. Pergunte se a dúvida impedir continuidade segura ou puder causar perda de dados.
5. **Commits** pequenos ao fim de cada tarefa verificada; `npm test` antes de cada commit; tag ao fim de cada fatia.
6. **Não invente funcionalidades** fora do escopo. Fora de escopo: cadastro/alteração de dados funcionais nas fontes, cálculo de aposentadoria, aplicativo móvel, acesso do próprio servidor, SSO, assinatura digital.
7. **Registro de execução** em `docs/PROGRESSO.md`: fatia, o que foi entregue, testes executados, pendências, decisões tomadas.

## 8. Qualidade e segurança de desenvolvimento

- Nada de dados reais em código, testes, exemplos, logs, mensagens de commit ou ferramentas externas.
- Segredos fora do Git, em configuração externa com ACL restrita; chaves operacionais geradas pelo `setup`, sem reutilizar a CA ou segredos da preparação demonstrativa. Fixtures usam chaves efêmeras próprias, nunca as de produção.
- Toda entrada validada com Zod no servidor; HTML do template escapado; sem execução de script na prévia (iframe `sandbox`, CSP restritiva).
- Gravação do snapshot e reserva de numeração na mesma transação; emissão idempotente (`Idempotency-Key`); PDF criado depois do commit e regerável a partir do snapshot.
- Mensagens de erro em português e acionáveis; interface acessível por teclado, com contraste adequado, em telas de 1366×768.
- Sem dependências desnecessárias; fixar versões; registrar versões exatas de Node, PostgreSQL e Chromium.
- Código comentado apenas onde a regra de domínio não é óbvia, citando a seção do documento de regras.

## 9. Entregáveis finais

Ao terminar (ou ao fim de cada fatia, em versão parcial), apresente nesta ordem:

1. **Resumo**: o que está utilizável agora e como iniciar (comandos exatos).
2. **Estado por fatia**: concluída / parcial / não iniciada, com a evidência (testes executados e resultado).
3. **Como importar os dados reais**: passo a passo com os comandos, os formatos de arquivo e o que conferir depois.
4. **Regras provisórias em uso** e o que depende de confirmação da área (P/F, escopo dos limites, formato dos números, textos do Comissionado e do INSS, pontuação do resumo).
5. **Pendências externas** (API oficial, esquema do legado, certificado da CA interna, retenção, RIPD, encarregado), cada uma com o impacto e o ponto do sistema que já está preparado.
6. **Limitações conhecidas e riscos** (o que não foi testado, o que usa dado sintético).
7. **Lista de arquivos e comandos** relevantes (`scripts/`, `tools/`, `docs/`).

Não declare prontidão ou validade administrativa sem evidência e autorização.
O uso operacional exige regras/templates aprovados, importação conferida por
amostra oficial (≈30 matrículas) e instalação autorizada pelo responsável,
seja em estação Windows ou Windows Server. Não é exigido outro servidor para
homologação; o aceite é um processo, não um ambiente adicional.

---

## Anexo A — Requisitos consolidados de construção e operação

Consolidação em 31/10/2026 dos requisitos necessários dos planos anteriores.
O cronograma de dois desenvolvedores permanece apenas no arquivo histórico:
executar pelas fatias da seção 7, sem supor equipe, aprovação ou capacidade não
confirmadas. Este anexo não declara implementação nem aceite das funcionalidades.

### A.1 Arquitetura e decisões

| Decisão | Requisito |
|---|---|
| D1 | Legado até 2019 importado uma vez para PostgreSQL, somente leitura após carga; fonte original restrita e relatório de divergências |
| D2 | Fonte atual copiada ao schema `nucleo` por sincronização; só esse módulo acessa API; consultas funcionam offline |
| D3 | Modelo canônico pessoa/vínculo/evento; adaptadores preservam identificação/origem e não inferem ligações ambíguas |
| D4 | Cálculo puro e determinístico compartilhado; casos dourados antes de release |
| D5 | Rascunho JSON com versões; emissão preserva snapshot imutável |
| D6 | PDF no servidor por HTML/CSS/Chromium, fontes embutidas e templates versionados |
| D7 | Sessão no servidor com cookie opaco e CSRF; sem tokens/dados em armazenamento web |
| D8 | Auditoria append-only de consulta, edição, conferência, emissão, cópia, cancelamento e download |
| D9 | Instalação nativa de produção em Windows compatível e suportado; Node/PostgreSQL serviços, Caddy ou IIS HTTPS e tarefas Windows; sem ambiente operacional adicional |
| D10 | Git/main, testes locais, revisão manual cruzada, commits pequenos e tags; sem CI/PR |
| D11 | IA como apoio, contexto e cartões delimitados; revisão humana de cálculo/segurança; sem dados reais ou decisão jurídica pela IA |

Estrutura:

```text
apps\api\                  auth, servidores, sincronizacao, calculo, documentos, historico, auditoria
apps\web\                  React: painéis, editor e prévia
packages\calculo\          funções puras + casos dourados
packages\templates\        HTML/CSS e blocos por tipo
packages\contratos\        tipos e Zod compartilhados
tools\migracao\            importação/conferência
tools\anonimizar\          geração inteiramente fictícia, sem ler bases reais
scripts\                  instalação, teste, sync, publicação, backup e restauração
docs\ia\                  contexto derivado
docs\decisoes\            decisões versionadas
referencias\              modelos limpos e ativos autorizados
```

Backend serve o build React, sem servidor frontend separado na instalação.
Fila interna PostgreSQL, sem Redis. Fontes oficiais nunca são alteradas pelo
editor; ajustes pertencem ao documento. Preparar separação da autenticação para
integração institucional futura, sem implementar SSO/MFA nesta fase.

### A.2 Modelo de dados e integridade

UUID para entidades, `date` para datas funcionais sem hora; timestamps operacionais
com fuso. Identificadores pessoais cifrados, CPF original normalizado com 11 dígitos
antes da cifra, lookup/unicidade por HMAC `cpf_hash`, não por texto cifrado.
Preservar matrícula original e normalizada, sufixos e origem.

| Schema/tabela | Campos e controles obrigatórios |
|---|---|
| `nucleo.pessoa` | id, cpf cifrado, cpf_hash único, nome/busca normalizada, nascimento, nome_mae, nome_pai, pis_pasep, rg_numero, rg_orgao, rg_expedicao, titulo_eleitor, endereco, atualizado_em; `pg_trgm` para nome |
| `nucleo.vinculo` | id, pessoa_id FK, matricula, matricula_norm, sistema_origem, id_origem, regime_juridico, cargo, classe, nivel, referencia, setor, orgao_codigo/nome, admissao, desligamento, matricula_anterior_id; únicos origem/matrícula e origem/id_origem; índice matrícula |
| `nucleo.evento_funcional` | id, vinculo_id, tipo, data_evento/publicacao, ato_tipo/numero, descricao_origem, dados JSON, fonte; índice vínculo/data |
| `nucleo.afastamento` | id, vinculo_id, tipo, data_inicio/fim ou dias/ano_ref, observacao, fonte; tipos falta/licenca_ts/licenca_pf/licenca_ip/outro; índice vínculo/tipo/data |
| `nucleo.incorporacao` | id, vinculo_id, tipo PB/PV/LIC_PREMIO, data_inicio/fim e dias de entrada quando anuais; convenção de contagem e origem explícitas, conforme documento de regras §8 |
| `nucleo.periodo_ipam` | id, pessoa_id, mes_inicio/fim |
| `nucleo.sincronizacao_lote` | id, origem, tipo completa/incremental/servidor, início/fim, status, lidos/inseridos/atualizados/removidos, erros sanitizados e cursor |
| `nucleo.staging_api` | id, lote_id, id_origem, payload, recebido_em/processado_em; retenção 30 dias; proteger dados pessoais também no staging |
| `documentos.documento` | id, tipo, pessoa_id/vinculo_id, status, processo_numero, entrada/ajustes/resultado_calculo JSON, template_versao_id, regras_versao, substitui_id, criado_por/em, atualizado_em |
| `documentos.documento_periodo` | id, documento_id, ordem 1–4, início/fim, cargo, categoria, observacao; único documento/ordem; DOF limita a um |
| `documentos.documento_cargo_comissionado` | id, documento_id, ordem 1–3, cargo, decreto_nomeacao/exoneracao, publicacao_do_nomeacao/exoneracao, data_entrada_exercicio/encerramento; único documento/ordem |
| `documentos.documento_bloco` | id, documento_id, bloco_versao_id, ordem, ativo, variaveis JSON, texto_final |
| `documentos.bloco_texto` | id, codigo único, titulo, tipos_documento, ativo |
| `documentos.bloco_versao` | id, bloco_id, versao, conteudo, esquema_variaveis, vigente_de; único bloco/versão |
| `documentos.template_versao` | id, tipo, versao, html, css, vigente_de; único tipo/versão |
| `documentos.numeracao` | tipo/ano PK, ultimo_numero, sufixo; `SELECT ... FOR UPDATE` |
| `documentos.emissao` | id, documento_id, numero_formatado, snapshot imutável, emitido_por/em; unicidade tipo/ano/número e idempotência |
| `documentos.job_pdf` | referência emissão, status, tentativas, erro sanitizado, controle de posse/retomada do worker; PDF/caminho/hash conforme decisão A.5 |
| `documentos.ajuste_campo` | id, documento_id, campo, valor_original/novo, motivo obrigatório, usuario_id, em |
| `seguranca.usuario` | id, matricula única, nome/email, senha_hash, papel, ativo, tentativas_falhas, bloqueado_ate, troca_senha_obrigatoria, ultimo_login |
| `seguranca.sessao` | id_hash, usuario_id, criada_em, expira_em, ultimo_uso, ip, user_agent; índice expiração |
| `seguranca.auditoria` | id bigserial, usuario_id, acao, entidade/id, pessoa_id, ip, detalhes minimizados, em; índices pessoa/data e usuário/data; sem UPDATE/DELETE pela aplicação |
| `legado` | Cópia fiel conforme mapeamento real, importado_em/lote_importacao; tradução por script ou visão materializada, sem mutação funcional |

Tabelas canônicas sincronizadas guardam `sistema_origem`, `id_origem`,
`hash_conteudo`, `sincronizado_em`, `removido_na_fonte_em`.
Eventos: contratação, nomeação, transposição, enquadramento, reenquadramento,
progressão, designação, exoneração, mudança de matrícula e outro.
Controle de importação inclui hash/usuário/status/contagens e dependências para
rollback seguro. Adicionar apenas campos/tabelas necessários, com migrações.

Não apagar pessoa ou registros que sumiram da API; marcar desligamento/remoção.
Imutabilidade protegida no banco e API. Cancelamento é estado auditado do
documento, não UPDATE do snapshot. Definir menor privilégio por função de banco;
aplicação nunca usa superusuário; migração e restauração usam credencial separada.

### A.3 Segurança, perfis e LGPD

- Senha Argon2id, mínimo 12 caracteres, rejeição de senhas comuns vazadas por
  lista local, sem enviar senha a terceiros; criação administrativa; troca inicial.
- Após 5 falhas: bloqueio 15 min; rate limit por IP e matrícula; mensagem única
  “matrícula ou senha inválida”; não enumerar usuários.
- Sessão aleatória 256 bits, só SHA-256 no banco; renovação no login, inatividade
  30 min e duração máxima 8 h; logout revoga imediatamente.
- Cookie `__Host-`, `Path=/`, sem `Domain`, `HttpOnly`, `Secure`, `SameSite=Lax`.
  Escritas autenticadas exigem `X-CSRF-Token`. Não relaxar controles para testes.
- CSP restritiva, HSTS, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`,
  `Cache-Control: no-store` nas rotas pessoais. Prévia em iframe sandbox sem
  execução de scripts e HTML escapado.

| Ação | analista | coordenador | secretario_adjunto | admin |
|---|---|---|---|---|
| Buscar/ver pessoa e calcular | sim | sim | sim | não |
| Criar/editar rascunho | sim | sim | não | não |
| Conferir | sim | sim | não | não |
| Emitir | não | sim | não | não |
| Cancelar emitido | não | não | sim | sim |
| Histórico de terceiros/pesquisa avançada | não | sim | sim | não |
| Gerenciar blocos/templates/usuários | não | não | não | sim |
| Consultar auditoria | não | não | sim | sim |
| Importação e lotes de sincronização administrativos | não | não | não | sim |

A autorização não é hierarquia “admin e acima”: admin técnico **não vê dados
funcionais** pela aplicação. Importação/conferência admin mostra resultados
minimizados/mascarados, sem contornar a matriz. Atualização individual da fonte é
ação do analista/coordenador; permissões de autoria devem ser explícitas.

**Pendência preservada:** leitura/edição de rascunhos de terceiros pelo coordenador
não era consistente nos planos. Até decisão, adotar restrição por autoria nas
edições, registrar como provisória e permitir ao coordenador conferir/emitir
documentos encaminhados; não ampliar acesso por suposição.

LGPD:

1. Inventário de dados/finalidade/base legal validado por encarregado/jurídico.
2. Busca mostra nome/matrícula/órgão; CPF, se necessário, mascarado. Ler RG,
   título, endereço e filiação apenas quando exigidos pelo documento.
3. CPF lookup HMAC; CPF/RG/título/PIS cifrados; chaves fora do banco/repositório,
   com custódia separada e processo de recuperação. Proteger snapshots, backups,
   staging e relatórios que contenham dados pessoais, não só tabela pessoa.
4. Auditoria de abertura, consulta, prévia, edição, emissão e download;
   revisão mensal amostral; detalhes minimizados.
5. TLS ≥1.2; produção com BitLocker e backup externo cifrado.
6. Retenção de documentos/snapshots/auditoria/logs definida pela área; sem expurgo
   de emissões antes de aprovação; expurgo configurável e auditado.
7. RIPD e protocolo de incidentes antes de produção: detectar, conter, comunicar
   encarregado/ANPD quando aplicável, recuperar e registrar.
8. Gitleaks antes de commit; `npm audit` por versão; revisão cruzada humana.
   Logs nunca incluem CPF, RG, senha, sessão, chave ou corpo completo.

### A.4 Campos, blocos, validações e identidade visual

Documento de regras detalha DOF/IPAM/Comissionado; para o **INSS**, preservar:
nome/matrícula/CPF/nascimento/mãe/pai, documento de identidade/órgão, PIS/PASEP,
cargo, processo, número/ano, até quatro períodos sequenciados, categoria funcional
(efetivo/comissionado/contratado/serviço prestado), licenças/afastamentos,
documentação-base, observações e assinaturas do analista técnico e coordenador.
Textos oficiais INSS não foram extraídos no documento de regras: não inventá-los;
usar modelo limpo aprovado e identificar campos/textos provisórios.

Demais campos e assinaturas seguem o documento de regras. Classe/nível/referência,
órgão e vínculo preservados; períodos IPAM e decretos/publicações dos cargos são
campos próprios, não substituídos por observação livre.

Blocos versionados:

| Código | Uso | Variáveis |
|---|---|---|
| contratacao | DOF | data, regime, cargo, órgão; evento contratação/nomeação |
| transposicao | DOF | decreto, data, cargo, nível, referência, lei |
| progressao | DOF | portaria, data, nível, referência; uma por evento |
| complementares | DOF | texto/mudança de matrícula |
| declaro | DOF/IPAM | totais e AMD; condicionais do documento de regras |
| licencas_inss | INSS | sim/não, períodos, tipo |
| documentacao_inss | INSS | nomeação, CTPS, folha, frequência, outros |
| obs_contribuicao_inss | INSS | observações de contribuição aprovadas |
| ipam | IPAM/Comissionado | meses/anos |
| sem_emendas | todos | texto oficial, sem variáveis |

Variáveis `{{nome}}`, formatação de data/AMD; ausentes destacadas na prévia e
impeditivas no servidor. Ativar/desativar/reordenar blocos e ajustar texto conforme
política aprovada, sempre versionado/justificado. Instituição, CNPJ, Portaria MPS
nº 154/2008, anexos III/VIII e assinaturas vivem no template, não em controllers.

Antes de conferir/emitir:

- Pessoa/CPF/matrícula/vínculo consistentes e não ambíguos.
- Fim ≥ início; limites por tipo; sem sobreposição de períodos do documento.
- Início anterior à posse usa posse e exige aviso/confirmação.
- Deduções não excedem dias disponíveis; excesso não vira negativo silencioso.
- Campos obrigatórios/variáveis presentes e processo validado por máscara
  configurada; exemplos não equivalem a formato institucional aprovado.
- Cargo comissionado exige nomeação/entrada/publicação e, quando há saída,
  exoneração/datas/publicação.
- Dados com mais de 24 h geram aviso; API indisponível não impede operação local.

Visual: menu azul-marinho, seleção azul-petróleo, fundo claro, cartões de dados,
abas Dados/Período/Tabela/Blocos, editor e prévia lado a lado em desktop, resumo e
ações na base. Reflow em telas menores, teclado/foco visível/contraste; validar em
1366×768. Não copiar dados/nomes da imagem. Layout oficial só é confirmado por
modelos limpos, não pela maquete.

### A.5 Emissão, PDF e histórico

Transições:

| De → para | Autorização/condição |
|---|---|
| novo → rascunho | analista/coordenador, pessoa e tipo válidos |
| rascunho → conferido | analista/coordenador; validação no servidor |
| conferido → rascunho | coordenador; devolução com motivo |
| conferido → emitido | coordenador; processo, validações, número/snapshot/job transacionais |
| rascunho/conferido → cancelado | autor habilitado/coordenador; motivo |
| emitido → cancelado | secretário adjunto/admin; motivo, mantém número/PDF |

**Resolução da contradição histórica:** PDF é criado **depois do commit**.
Falha posterior não pode desfazer transação já confirmada nem devolver número.
Reservar número, gravar snapshot e job atomicamente, com `Idempotency-Key`;
falha anterior ao commit desfaz a reserva. Após commit, reprocessar o **mesmo
job/emissão/número**, nunca gerar outro para mascarar falha. Cancelamento mantém
registro/número. A exigência histórica “sem lacunas” significa não perder números
reservados sem registro; aceitação administrativa de PDF pendente/cancelamento
continua provisória e deve ser validada.

Estado funcional e status operacional do PDF são distintos: o status do job
indica pendente/processando/concluído/falhou e aparece na interface.
Snapshot permanece imutável. Como hash/caminho só ficam disponíveis após gerar
arquivo, persistir metadados em registro de artefato associado ao job/emissão,
sem UPDATE do snapshot; registrar esse ajuste de modelagem em decisão.
Testar concorrência, repetição da chave, falha antes/depois de commit, escrita
parcial de arquivo e retomada do worker.

PDF: Chromium reutilizado em caminho fixo `PLAYWRIGHT_BROWSERS_PATH`; fontes
autorizadas embutidas; A4, margens fixas, `printBackground`, evitar quebra dentro
de linhas, cabeçalho repetido e “página X de Y”. Um template por tipo.
Gravar arquivo íntegro em disco, SHA-256 e download autenticado/auditado.

Nome: `NOME_TIPO_AAAA-MM-DD.pdf`, maiúsculas, sem acentos, espaços `_`,
tipos DOF/DTC-IPAM/DTC-COMISSIONADO/DTC-INSS; sem CPF/matrícula, fuso
`America/Sao_Paulo`, colisões `_2`, `_3`. Limite **provisório** 80 caracteres
incluindo extensão/sufixo, a confirmar; acesso não depende de caminho fornecido
pelo usuário e deve impedir path traversal.

Prévia ≤1 s da edição até exibição correspondente, incluindo debounce/transporte.
PDF individual ≤5 s da solicitação válida até disponível, com Chromium aquecido,
incluindo fila/gravação. Medir quatro tipos, documentos longos, quatro períodos,
três cargos, pelo menos 20 repetições; registrar máximo/mediana/p95. Não esconder
falha do limiar na média. Partida fria e carga concorrente separadas.

Histórico: cinco últimos DOFs e cinco últimos DTCs do usuário; quantidade
configurável; banco guarda todas as emissões. Pesquisa servidor/número/período
somente coordenador/secretário. Copiar snapshot cria novo rascunho; original
inalterado. Reemissão corretiva referencia `substitui_id`.

### A.6 Instalação única de produção, publicação e recuperação

**Estado real atual:** a base NestJS/React demonstrativa, Node 24.20.0,
PostgreSQL 16.15/Caddy 2.11.7 e bancos da preparação anterior ainda existem.
Não há autenticação, cálculo ou emissão implementados. A alteração documental
**não converte essa instalação em produção**, remove bancos, altera serviços ou
substitui certificados. Planejar a transição com inventário, backup e autorização
antes de mudar recursos existentes; preservar dados e segredos até decisão.

**Arquitetura-alvo: uma única instalação de produção**, com parâmetros:

| Item | Requisito de produção |
|---|---|
| Windows | Edição/build compatível, licenciado e suportado; estação ou Server, sem obrigação de versão específica |
| Raiz | Diretório externo ao checkout, com ACL e acesso adequados à conta de serviço; não depender de unidade D: ou perfil pessoal |
| Banco | Um banco operacional, nome configurado; credenciais de app/migração/backup separadas por privilégio |
| PostgreSQL | Somente loopback, porta configurada |
| Backend | Somente loopback, porta configurada, sem acesso direto pela LAN |
| HTTPS | Caddy ou IIS/ARR/Rewrite suportado; nome/SAN corretos, cadeia confiável e renovação sob responsabilidade definida |
| Dados | Banco inicial vazio e importação real pelo usuário autorizado; sem seed sintético operacional |
| Execução | Serviço Windows sem privilégios administrativos, inicialização/recuperação controladas |
| Verificação | Testes automatizados em recursos temporários descartáveis; sem ambiente permanente de teste/homologação |

Pastas externas: `app`, `releases`, `config`, `pdf`, `logs`, `backup`, `scripts`,
`chromium`. Binários/dados/chaves atuais não entram no Git.
Preservar correção ASCII/8.3 para `initdb` Windows com perfil acentuado, sem
abandonar UTF-8; se caminho curto não existir, exigir escolha explícita de raiz.

Inventariar edição/build/ciclo de suporte e atualizações de segurança (incluindo
ESU quando necessário), privilégios, CPU/RAM/disco e compatibilidade das versões.
O rótulo produção não dispensa suporte vigente nem prova capacidade.
Sem domínio: matrícula/senha da aplicação e contas Windows locais.
Não criar firewall LAN/RDP ou instalar serviço sem autorização.

Conta de serviço sem Administradores: leitura/execução app/releases, leitura
config, escrita PDF/logs, navegador em pasta acessível; credenciais separadas de
migração/backup. ACL mínima com travessia necessária sem abrir perfil inteiro.
Não reutilizar automaticamente a CA demonstrativa da preparação anterior.
Produção exige certificado/cadeia confiável aprovados para os clientes e serviço,
renovação, TLS ≥1.2, proteção de disco (BitLocker quando disponível ou solução
aprovada equivalente) e faixa LAN autorizada quando houver acesso em rede.
Não usar `-k`/`ignoreHTTPSErrors` nem compartilhar chave privada.

Agendador Windows: incremental horária, completa semanal fora do expediente,
backup diário, limpeza de sessões diária, staging diário/semanal só concluído
e ≥30 dias, rotação de logs. Não iniciar instância sobreposta, usar lock no banco,
executar sem login interativo. A máquina de produção precisa cumprir a janela
de disponibilidade acordada; impedir suspensão incompatível com a operação,
verificar reboot/retomada e registrar execuções perdidas. Fixtures nunca chamam
API real ou disparam tarefas operacionais.

Publicação PowerShell, com confirmação explícita de ambiente:

1. main/tag/árvore limpa, dependências do lockfile, testes/typecheck/build.
2. Backup pré-publicação e registro versão/operador/data.
3. Release nova separada, migrações compatíveis testadas, troca controlada.
4. Reiniciar serviço, health/login/consulta local/PDF e registrar resultado.
5. Em falha, interromper e solicitar decisão; sem restauração destrutiva automática.

Backup diário: `pg_dump` formato custom + PDFs, versões/configuração recuperável
e manifesto/hashes; registrar exit code/duração/tamanho. Coordenar banco e
arquivos para não restaurar emissão sem PDF; chave necessária à decifração com
custódia separada/cifrada. Cópia externa aprovada/cifrada, nunca só no mesmo disco.
Retenção aprovada, credenciais backup separadas.
Restauração exige escolha/confirmacão de banco/versão/backup, para serviço,
restaura banco/arquivos, inicia e testa consulta/emissão/PDF/hash.
Primeiro ensaio em destino temporário isolado, sem sobrescrever o banco operacional;
isso é um procedimento descartável de recuperação, não outro ambiente permanente.
Repetir trimestralmente e antes de alterações
estruturais. Só considerar backup válido após restauração bem-sucedida.
Medir RPO/RTO e obter aceite, sem inventar SLA. Ausência de destino externo
adequado bloqueia o aceite de recuperação de produção; cópia no mesmo disco
não comprova recuperação após perda da máquina.

Logs estruturados/correlação, rotação tamanho/período e retenção; monitorar
Node/PostgreSQL/proxy, idade/falhas sync, jobs PDF e espaço. Verificar novas
versões com testes em recursos descartáveis antes de aplicar, durante janela
aprovada de manutenção, com backup e retorno. Não validar migrações destrutivas,
carga, falhas de disco ou scripts de limpeza diretamente na base operacional.
Não expurgar PDF retido para resolver disco cheio silenciosamente.

### A.7 API interna e sincronização

REST JSON `/api/v1`, Problem Details (RFC 7807), cursor e limite máximo 50.
Nome exige mínimo três caracteres; matrícula exata preservando vínculo/sufixo,
CPF normalizado/HMAC. Toda rota funcional autenticada; health pode ser público
somente com resultado técnico mínimo. Não transformar rota demonstrativa em
acesso funcional público.

| Rotas | Comportamento |
|---|---|
| POST auth/login, auth/logout; GET auth/me | sessão/troca de senha/revogação |
| GET servidores?q=; GET servidores/:id, /eventos | dados minimizados e vínculos locais, auditados |
| POST calculos | valida entrada e usa pacote puro; não grava fonte |
| GET/POST documentos; GET/PATCH documentos/:id | painel/criar/editar com motivo e autoria |
| GET documentos/:id/previa | HTML seguro da versão |
| POST documentos/:id/conferir, /emitir, /cancelar, /copia | fluxo A.5, idempotência na emissão |
| GET emissoes/:id/pdf; GET historico?tipo= | download/consulta auditados e autorizados |
| GET blocos, blocos/:codigo | catálogo por perfil funcional |
| PUT admin/blocos/:codigo; administração templates/usuarios | nova versão e gerenciamento admin |
| GET admin/auditoria | admin/secretário, dados minimizados |
| POST servidores/:id/atualizar | atualização individual pelo módulo sync |
| POST/GET admin/sincronizacoes | carga/lista lotes/erros, admin |
| administração importação/dry-run/conferência | seção 6.2, sem liberar dados funcionais ao admin |

Sync:

- Carga completa inicial de vínculos depois de 2019; incremental por alteração.
  Sem filtro, comparar hash e gravar somente mudanças.
- UPSERT origem/id_origem em transação por servidor; repetição não muda dados.
  Cursor/lote e contagens/erros persistidos; falha parcial não desfaz o aceito;
  retomada segura.
- Fonte vence no modelo canônico; ajustes somente no documento.
- Remoção lógica apenas após reconciliação completa confiável; ausência em página
  incompleta nunca prova exclusão. Sem DELETE de dados pessoais pela sync.
- Timeout 10 s, até três repetições com espera crescente, respeito a rate limit/429;
  disjuntor após cinco falhas seguidas, pausa/alerta e política de retomada testada.
- Payload staging por 30 dias para reprocessar, acesso restrito, expurgo sem apagar
  lote em processamento/necessário à auditoria.
- Offline: busca/cálculo/prévia/emissão seguem localmente; última sync visível e
  aviso após 24 h, configurável; sync não substitui backup próprio.
- Contrato por amostras JSON fictícias: autenticação, campos, datas/alteração,
  IDs, cursor/paginação/ordenação, exclusões/retificações, limites/manutenção.
  Endpoint/credenciais externos são configuração fora do Git.

Fontes devem fornecer dados pessoais por matrícula/CPF, eventos estruturados
(tipo/data/ato/publicação), faltas/licenças por tipo e período ou ano,
incorporações PB/PV/LP e períodos IPAM quando disponíveis.
Ausência de campo obrigatório é erro ou pendência explícita, não dado inventado.
Corte 2019, matrículas reaproveitadas e totais anuais em períodos parciais exigem
decisão documentada; importador configurable não prova esquema real recebido.

### A.8 Aceite, testes e pendências

Vitest unitário/propriedades/GT; PostgreSQL real para integração/restrições;
contratos fictícios; Playwright E2E e comparação visual por página;
ZAP local/npm audit/autorização; k6/carga e falhas de disco/worker.
Testar metas exigidas neste prompt, não só presença de página ou log sem erro.
Não mudar resultado esperado/regra para esconder divergência.

Pronto por tarefa: teste relevante + `npm test`, revisão humana, documentação e
decisão/migração atualizadas, sem dados reais/segredos, commit/tag quando cabível.
Instalação requer processo responsivo, não apenas criado; backup requer restauração.
Gates de cada fatia devem indicar parcial/não verificado com evidência.

Pendências externas: modelos limpos/textos INSS e Comissionado, regras oficiais,
incorporações inclusivas/exclusivas, períodos parciais, corte 2019,
perfis × autoria, processo/numeração/cancelamento, contrato API/legado,
capacidade/concorrência, ESU/infraestrutura, CA/DNS/renovação, backup/chaves,
RPO/RTO, retenção/RIPD/base legal, assinatura física/externa e operadores.
Valores provisórios não significam aprovação; mudança de escopo requer registro.

Antes de produção: amostra oficial ~30 casos, quatro layouts/regras aprovados,
importação real conciliada no ambiente autorizado, HTTPS/ACL/capacidade/backup
externo/restauração comprovados, treinamento/piloto, contingência e corte da
numeração/planilhas definidos, sem bloqueador crítico/alto ou erro de cálculo,
autorização explícita e responsável operacional designado.

Produção é a finalidade única da instalação, não declaração automática de
prontidão. Aceite e autorização permanecem obrigatórios em qualquer Windows.
A IA não manipula base real, aprova texto/regra jurídica ou autoriza
publicação/restauração operacional.
