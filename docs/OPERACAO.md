# Operação local — uso operacional autorizado

Há uma [instalação local inicializada](INSTALACAO_LOCAL.md), com banco
permanente, HTTPS e administrador inicial, **autorizada para uso operacional**
pelo responsável em 31/10/2026 ([decisão 021](decisoes/021-autorizacao-operacional.md)).
Estão liberados consulta de servidores e cálculo, rascunho, blocos, prévia e
conferência de DOF pela interface. A emissão da DOF e das DTCs IPAM,
Comissionado e INSS (numeração, snapshot, PDF, histórico, cópia e
cancelamento) foi **liberada em 31/10/2026** pelo registro da aprovação
formal de cada tipo, por Euzébio Pereira da Silva Filho (Desenvolvedor de
Sistemas), referência "Autorização do responsável em 31/10/2026
(docs/decisoes/022)" ([decisão 022](decisoes/022-aprovacao-formal-e-emissao.md)).
O modelo INSS continua provisório e sai marcado como tal
([decisão 023](decisoes/023-dtc-ipam-comissionado-inss.md)).
A importação de planilhas e da base legada está disponível ao administrador
(ver [Importação de dados](#importação-de-dados) e
[DADOS_E_IMPORTACAO.md](DADOS_E_IMPORTACAO.md)). **Backup e serviço Windows
da aplicação ainda não estão implementados**. A prévia
segue identificada como provisória; confira o conteúdo antes de qualquer uso
oficial.

## Pré-requisitos para uma nova instalação

- Windows compatível e com suporte de segurança comprovado; Node 24.20.0 nesta
  máquina e PostgreSQL 16. O PostgreSQL usado pelos testes é descartável e não
  substitui uma instalação operacional.
- Banco PostgreSQL **novo e vazio**, escutando somente em loopback, e dois
  papéis já provisionados: proprietário para migração e login distinto para a
  aplicação, sem superusuário, privilégios administrativos ou associações a
  outros papéis. A autenticação local deve exigir senha.
- Diretório pai protegido e uma **nova** raiz externa ao checkout e ao perfil
  pessoal. A inicialização se recusa a sobrescrever raiz existente ou banco
  não vazio. Verificar previamente a segurança do diretório pai.
- Certificado, chave e cadeia de CA externos ao checkout, com nome DNS
  correspondente e permissão de leitura adequada à futura conta de serviço.
  A inicialização verifica cadeia e nome, mas não constitui aprovação da CA ou
  verificação completa das ACLs desses arquivos.
- SID de conta de serviço distinto da conta instaladora e sem privilégios
  administrativos, e lista local não vazia de senhas comuns, fora do checkout.
  A pertinência da conta e sua associação a grupos devem ser verificadas pelo
  responsável; o instalador não cria ou inicia serviços.

## Comandos

Após instalar dependências do lockfile com `npm ci`, `npm run setup` deve ser
executado por operador autorizado em terminal interativo. O comando solicita os
parâmetros acima, senhas sem eco, máscaras de processo opcionais e confirmação
explícita `CRIAR`. Ele aplica a
estrutura versionada ao banco vazio, cria chaves próprias e um administrador
com troca de senha obrigatória. Não cria banco ou papéis PostgreSQL e não
importa dados. Se a transação ficar com estado incerto, preserve a raiz e
verifique o banco antes de qualquer nova tentativa.

O caminho da configuração externa aparece ao final do comando. Na mesma
sessão PowerShell, defina `SISDOC_CONFIG` com esse caminho e execute:

```powershell
$env:SISDOC_CONFIG = 'C:\caminho\externo\config\aplicacao.json'
npm start
```

Para a instalação já inicializada, use o caminho e as instruções de
[reinicialização local](INSTALACAO_LOCAL.md); não repita o setup.

O backend atende apenas em `127.0.0.1` por HTTPS. O endereço aberto pelo
navegador deve usar o nome do certificado e a porta configurada, e a CA deve
ser confiável para o navegador. Não desative a validação TLS. O certificado
local já é confiável neste Windows e o HTTPS direto dispensa proxy para
loopback. Serviço automático e eventual publicação por Caddy/IIS exigem
implementação e aprovação; não expor esta aplicação à rede.

O administrador criado pelo setup precisa alterar a senha no primeiro acesso.
Ele pode criar, editar, desativar e redefinir senhas pela tela; alteração de
perfil, desativação ou redefinição revoga as sessões afetadas. Não é permitido
remover o último administrador ativo. Também é possível criar usuários pelo
comando abaixo, com o serviço iniciado e a mesma configuração externa. O
comando autentica um administrador, verifica o certificado e solicita senhas
sem eco; não forneça senhas em argumentos ou variáveis de ambiente.

```powershell
npm run build
npm run usuario -- criar
```

Configurações antigas sem `seguranca.listaSenhas` podem iniciar se o banco já
possuir a migração 012, mas a criação ou troca de senha retorna erro até que a
lista local seja configurada. A conta que executa o serviço precisa conseguir
lê-la. Depois de uma falha de comunicação no comando, consulte os usuários
antes de repetir a criação.

O setup aplica até `014-dtc` ao banco novo. Uma instalação anterior sem essa
migração (por exemplo, em `013-emissao`) não inicia com esta versão. Para atualizar uma instalação existente,
pare a aplicação e execute na raiz do repositório:

```powershell
npm run build
npm run migrar
```

O comando lê `C:\ProgramData\SisDoc\provisionamento\banco.json` (ou o caminho
absoluto em `SISDOC_PROVISIONAMENTO`), conecta com o papel de migração e
aplica, numa transação, somente as migrações ausentes em `seguranca.migracao`.
Repetir o comando não altera nada. Senhas não são impressas. Bancos sem
histórico de migrações são recusados. Não aplique migrações manualmente.

## Aprovação formal e emissão da DOF

A emissão responde "Emissão operacional bloqueada: regra/template provisórios
ainda não aprovados" até que a regra de cálculo e o template vigentes sejam
aprovados formalmente pela área responsável. Somente após essa validação, o
operador autorizado registra a aprovação, em terminal interativo:

```powershell
npm run build
npm run aprovar-modelo -- DOF
```

O tipo pode ser `DOF`, `DTC_IPAM`, `DTC_COMISSIONADO` ou `DTC_INSS` (sem
argumento, o comando pergunta). A aprovação é por tipo: aprovar a DOF não
libera as DTCs. O comando mostra regra e template vigentes, pede nome/cargo
de quem aprovou e a referência da decisão (ofício, processo ou
`docs/decisoes/0NN`) e exige a digitação de `APROVAR <TIPO>` (por exemplo,
`APROVAR DOF`). Não aprove `DTC_INSS` enquanto o template
`emissao-dtc-inss-provisorio-1` não tiver os textos oficiais. O registro é permanente, imutável e auditado; o
papel da aplicação não consegue gravá-lo, e não existe chave ou configuração
que substitua a aprovação. Uma nova versão de regra ou template exige nova
aprovação.

Com a aprovação registrada, o coordenador emite pela tela de conferidos. O
número (`N° nP/AAAA`) é reservado na mesma transação do snapshot cifrado. O
PDF é gerado pelo worker iniciado com a aplicação em `pdf.diretorio` da
configuração (padrão `<raiz da instalação>\pdf`), requer o Chromium do
Playwright acessível à conta da aplicação e, em caso de falha, é reprocessado
automaticamente com o mesmo número. A tela Histórico lista as últimas cinco
emissões, permite baixar o PDF (acesso auditado), copiar como novo rascunho
(analista/coordenador) e cancelar com motivo obrigatório (secretário adjunto e
administrador). O número cancelado não é reutilizado.

## DTC IPAM, DTC Comissionado e DTC INSS

Analista e coordenador abrem **DTC IPAM**, **DTC Comissionado** ou **DTC INSS**
no menu, buscam o servidor e criam o rascunho com até quatro períodos (anos
gerados automaticamente para lançamento de faltas e afastamentos), até três
cargos em comissão (Comissionado) ou cargo/função e categoria funcional por
período, licenças, documentação-base e observação (INSS), além do processo.
Edições exigem motivo. A conferência é feita na prévia pelo autor ou por
coordenador; o coordenador pode devolver com motivo ou emitir. A numeração é
própria por tipo (`N° n/AAAA`), o PDF segue o mesmo worker da DOF e o
histórico mostra as cinco últimas DTCs emitidas, com cópia e cancelamento como
na DOF. Os totais do Comissionado e do INSS e as linhas de incorporação são
provisórios, e o PDF do INSS traz marca de modelo provisório
([decisão 023](decisoes/023-dtc-ipam-comissionado-inss.md)).

O limite é de cinco falhas por matrícula e 20 por IP em 15 minutos. O IP é o
endereço da conexão, sem confiar em cabeçalhos encaminhados. A origem aceita
para escritas é a origem HTTPS configurada; a publicação por proxy exige
configuração explícita e testes de origem e proxies confiáveis, ainda ausentes.

## Consulta de servidores

Analista, coordenador e secretário adjunto podem buscar por nome, CPF válido
ou matrícula exata, incluindo seu sufixo. Nome exige pelo menos três
caracteres. Resultados, vínculos e eventos são paginados; matrículas
duplicadas são apresentadas com sua origem, sem escolha automática. A busca
não devolve CPF e os detalhes exibem apenas máscara. O administrador técnico
não recebe acesso funcional por seu perfil.

O termo trafega no parâmetro `q` de uma requisição HTTPS local. A aplicação
não registra esse termo na auditoria ou em log de acesso, mas histórico de
rede, extensões, proxies ou servidores intermediários podem registrar URLs.
Não habilite publicação por proxy sem configurar e verificar a supressão de
parâmetros sensíveis em seus logs. A consulta é local e não faz sincronização.

## Importação de dados

O administrador importa os dados funcionais e, depois, eventos,
afastamentos, incorporações e períodos IPAM, pela tela **Importação** ou por
`npm run importacao`. Formatos, regras e exemplos estão em
[DADOS_E_IMPORTACAO.md](DADOS_E_IMPORTACAO.md). Procedimento recomendado:

1. Copie os arquivos reais para `dados-reais\` (fora do Git); não os abra em
   máquinas ou ferramentas não autorizadas.
2. Faça backup do banco (`pg_dump -Fc`) antes da primeira carga de cada
   origem.
3. Valide sem gravar (padrão), revise quarentenas, rejeições, duplicadas e
   divergências e corrija na fonte; o sistema não corrige dados sem registro.
4. Grave com `--commit` (ou **Gravar importação** na tela) e confira com
   `npm run importacao:conferir`, inclusive a amostra mascarada.
5. Se necessário, desfaça com `npm run importacao -- --rollback <lote>`
   antes de consultar ou emitir documentos dos servidores afetados; depois
   disso, o rollback é recusado e a correção deve ser feita por nova
   importação.

Repetir o mesmo arquivo não altera nada. Documentos emitidos mantêm seu
snapshot e não mudam com novas importações.

## Sincronização

A sincronização copia servidores e vínculos de uma API externa para o modelo
canônico local (decisão 025). Ela é opcional: sem o bloco `sincronizacao` na
configuração externa, a situação informa "não configurada" e o início é
recusado com 409. Busca, cálculo, prévia e emissão nunca dependem da API.

### Configuração

Bloco `sincronizacao` em `config\aplicacao.json` (fora do repositório; a URL
real e o token nunca entram no Git):

| Campo | Obrigatório | Padrão | Descrição |
| --- | --- | --- | --- |
| `origem` | sim | — | Identificador da fonte (`^[a-z0-9][a-z0-9_.-]{0,62}$`), gravado em `sistema_origem`. |
| `url` | sim | — | Endereço `http`/`https` da listagem de servidores, sem usuário, senha ou fragmento. |
| `credencialArquivo` | não | — | Caminho absoluto, fora do repositório, de um arquivo com o token Bearer (8–4096 caracteres ASCII visíveis). Restrinja a leitura à conta do serviço. |
| `avisoHoras` | não | 24 | Horas sem sincronização concluída até exibir o aviso de atraso. |
| `timeoutMs` | não | 10000 | Tempo limite por requisição (100–60000). |
| `limitePagina` | não | 50 | Itens por página (1–50). |
| `intervaloMinutos` | não | — | Executa incremental periódica (5–1440). Sem o campo, só há execução manual. |
| `pausaDisjuntorMinutos` | não | 15 | Pausa após abrir o disjuntor. |
| `esperaRepeticaoMs` | não | 1000 | Espera inicial entre repetições (dobra a cada tentativa). |
| `mapeamento` | não | — | Mapa de campo canônico → nome do campo na API (ex.: `{"nome": "nome_completo", "vinculo.matricula": "mat"}`). |

O contrato esperado da API e um exemplo fictício estão em
`referencias\api-simulada\`. Alterações na configuração exigem reiniciar o
serviço. A variável de ambiente `SISDOC_SINCRONIZACAO_AGENDADA=desligado`
desativa a execução periódica mesmo com `intervaloMinutos` configurado.

### Execução

O administrador técnico usa **Administração → Sincronização** (ou
`POST /api/v1/admin/sincronizacoes` com `{"tipo": "completa"}` ou
`{"tipo": "incremental"}`; a resposta 202 traz o lote em processamento). A
tela lista os lotes (`GET /api/v1/admin/sincronizacoes`) com lidos,
inseridos, atualizados, removidos e erros sanitizados. Todos os perfis
consultam `GET /api/v1/sincronizacao/situacao`.

- **Completa**: lê todas as páginas. Só depois de ler todas com sucesso faz a
  reconciliação e marca `removido_na_fonte_em` em servidores e vínculos
  ausentes. Nada é apagado. Falha numa página nunca prova remoção. A remoção
  lógica não é aplicada (e o motivo fica no lote) quando a carga trouxe itens
  sem identificador, nenhum servidor, ou mais de 10 ausências e mais de 20%
  dos registros ativos; confirme a fonte e repita.
- **Incremental**: envia `alterado_desde` com o instante da última página
  concluída e não remove nada. Exige uma completa anterior.
- Execute a primeira carga completa fora do horário de uso: cada servidor é
  gravado numa transação curta que bloqueia momentaneamente a conferência.
- Cada item fica cifrado em `nucleo.staging_api` antes da aplicação. Itens
  inválidos viram erros com posição, referência opaca (hash) e motivo, sem CPF
  ou nome, e não interrompem os demais. A fonte prevalece: conteúdo alterado
  atualiza o modelo canônico; conteúdo igual (mesmo hash) não grava nada.
- Um lote que falhou guarda o cursor e é retomado pela próxima execução do
  mesmo tipo em até 24 h.
- O staging é expurgado automaticamente após 30 dias, somente de lotes
  concluídos.

### Falhas, disjuntor e aviso offline

O cliente repete até 3 vezes falhas temporárias (rede, tempo limite, 5xx e
429) com espera crescente e respeita `Retry-After` de até 60 s. Credencial
recusada (401/403), JSON inválido ou fora do contrato não são repetidos. As
mensagens são fixas e nunca reproduzem respostas da API.

Após 5 execuções consecutivas com falha o disjuntor abre: novas execuções são
recusadas com 409 indicando o horário de liberação. Passada a pausa, uma
tentativa é liberada; se falhar, o disjuntor reabre; sucesso zera o contador.
Verifique a disponibilidade da API, o arquivo de token e a URL antes de tentar
de novo.

O cabeçalho dos perfis funcionais mostra a última sincronização concluída. Após
`avisoHoras` (ou com o disjuntor aberto), os painéis de DOF/DTC exibem um aviso
de dados possivelmente desatualizados. O
aviso não bloqueia busca, cálculo, prévia, conferência ou emissão; confira os
dados na fonte quando necessário.

Limitações: afastamentos, incorporações, eventos funcionais e períodos IPAM
não são sincronizados; não há sincronização de um único servidor; a mudança
de matrícula de um vínculo existente ou de CPF de uma origem já associada é
registrada como erro do item para revisão na fonte.

## Cálculo de referência da DOF

O menu lateral e a busca global seguem o
[protótipo visual](../Modelos%20e%20Documentação/prototipo_SistemaWEB.jpeg).
O editor tem cinco abas: **Dados do servidor**, **Período**, **Tabela ano a
ano**, **Blocos de texto** e **Conferência**. Use as setas esquerda/direita,
Home e End para navegar pelas abas por teclado. A troca de aba preserva os
campos editados; buscar outra pessoa ou mudar de tela pede confirmação quando
há alterações não salvas. No celular, abra **Menu** para navegar.

No desktop, a prévia fica à direita e os totais/ação de salvamento ficam na
barra inferior. As deduções exibidas são as deduções de contribuição do
resultado, não a diferença entre dias brutos e contribuição, que pode incluir
incorporações. A situação
da fonte informa consulta local, sem inventar data de sincronização.

Nos detalhes de um vínculo com admissão informada, selecione **Calcular DOF**,
informe o intervalo na aba **Período** e prepare a tabela anual. Confira registros de
afastamentos e incorporações em sua origem e lance os dias em cada ano;
esses registros ainda não são carregados automaticamente. Ao confirmar a
tabela, campos vazios representam zero, inclusive nas páginas não exibidas.
Para início após a admissão, informe também os acumulados anteriores de T/S e
P/F e sua origem. Datas anteriores à admissão geram aviso de ajuste.

Os cartões em **Dados do servidor** são somente leitura. Campos completos da
fonte são exibidos apenas após **Abrir prévia**, consulta auditada, e são
limpos ao fechar a prévia ou mudar a revisão. A data exibida é a admissão
disponível na fonte, não uma data de posse/exercício inferida.
Os ajustes cadastrais exclusivos da declaração previstos na seção 9 do
[guia descritivo](../Modelos%20e%20Documentação/guia_descritivo_declaracoes_funcionais_e_tempo_contribuicao.md)
ainda precisam ser implementados; não alterar a fonte para simulá-los.

O cálculo usa a regra provisória no servidor; calcular não grava rascunho nem
emissão. Analista e coordenador podem salvar o resultado como rascunho com
motivo e reabri-lo em **Meus rascunhos**. A edição é restrita ao autor;
um coordenador pode consultar apenas os rascunhos explicitamente encaminhados a
ele. Alterar valores exige
nova confirmação, cálculo e motivo. Antes de excluir anos por alteração do
período, confira e confirme os anos exibidos; os valores anteriores permanecem
cifrados no registro de ajustes.

A revisão impede sobrescrita concorrente. Em conflito, preserve os valores
anotados, reabra o rascunho e confira a versão salva. Se a comunicação falhar
ao salvar, consulte a lista antes de tentar novamente: a gravação pode ter
sido concluída. A interface avisa antes de descartar alterações não salvas,
mas uma sessão expirada encerra o acesso e essas alterações são perdidas.

A admissão usada no resultado é registrada e comparada com a fonte atual.
Se ela mudar, prepare a tabela e confira novamente; se estiver ausente, a
edição fica indisponível, embora o resultado salvo possa ser consultado.
Uma versão de regra diferente da disponível bloqueia a edição. A interface não
altera dados funcionais da fonte e o rascunho não é conferência nem emissão.
Se pessoa ou vínculo estiver sendo atualizado ao criar ou editar, o salvamento
retorna conflito: aguarde, reabra e confira os dados antes de tentar novamente.
Durante o salvamento, alterações nessas tabelas aguardam um bloqueio global.
Mudanças posteriores na fonte ainda podem exigir novo cálculo e verificação.

Quando o início informado anteceder a admissão considerada, o cálculo usa a
admissão como início efetivo. No rascunho salvo e sem alterações pendentes, o
autor deve marcar a confirmação específica e selecionar **Confirmar ajuste do
início** antes do encaminhamento. A confirmação fica cifrada e auditada, cria
uma nova revisão e não constitui conferência nem emissão. Ao alterar o
cálculo, confirme novamente; se a admissão atual divergir da considerada, a
confirmação deixa de valer enquanto houver divergência. Se a fonte estiver
sendo atualizada, aguarde e tente novamente.

## Blocos e prévia provisória

Após salvar um rascunho próprio, adicione blocos vazios, edite seu texto,
reordene e ative/desative conforme necessário. Salve com motivo; blocos já
salvos não são apagados, mas podem ser desativados. A revisão protege as
alterações de cálculo, blocos e processo em conjunto. Salve ou descarte uma categoria
antes de editar a outra.

Edite os blocos em **Blocos de texto**. O painel de prévia permanece acessível
ao trocar de aba, mas não abre automaticamente nem elimina a auditoria.

**Abrir prévia** registra a consulta e mostra o cálculo salvo com as alterações
locais dos blocos, mesmo antes de salvá-las. Ela exibe CPF integral e nome da
mãe, quando disponível, além dos demais campos da fonte necessários à DOF;
proteja a tela e não compartilhe a prévia. Somente o autor ou coordenador
destinatário tem acesso. A prévia é isolada e não tem validade oficial; seu
layout e textos não foram aprovados. Apenas as variáveis listadas na interface
são resolvidas, e as demais aparecem como indisponíveis. Se a fonte mudar,
feche e reabra a prévia; uma mudança posterior não atualiza a tela
automaticamente. Se a fonte estiver ocupada ou a identidade protegida estiver
inválida, a abertura informa conflito. Se outra sessão alterar o rascunho,
reabra-o e confira a revisão. Os limites técnicos são 200 blocos, 8.000
caracteres por bloco e 20.000 no total.

## Processo do rascunho

O setup solicita, opcionalmente, máscaras de número de processo separadas por
vírgula; deixá-las em branco desativa a inclusão e substituição do número. A
definição do formato deve ser fornecida pela área responsável; nenhuma máscara
vem predefinida. Na máscara, `#` representa um dígito, `@` uma letra ASCII e
`*` uma letra ou dígito. Letras, números, espaços internos e `.` `/` `-` são
literais. Por exemplo, `####/####` é apenas um formato sintético, não uma
recomendação institucional. São aceitas até dez máscaras de até 100
caracteres, sem partes opcionais ou repetição variável dentro de cada máscara.

Na aba **Dados do servidor**, informe o processo compatível e um motivo.
A instalação local atual não tem máscara configurada; inclusão e substituição
permanecem indisponíveis até uma definição institucional. A gravação é cifrada e
compartilha a revisão com cálculo e blocos. Para remover um processo incorreto,
marque a confirmação e informe o motivo; a remoção permanece possível mesmo sem
máscara configurada. O histórico de ajustes preserva os valores cifrados. A
prévia usa o processo salvo, não o texto ainda em edição.

## Encaminhamento para análise

Na aba **Conferência** do rascunho próprio, salve ou descarte as alterações pendentes, escolha um
coordenador ativo e selecione **Encaminhar rascunho**. O destinatário pode
consultar o cálculo, os blocos, o processo e a prévia em **Encaminhados a mim**.
Ele também pode selecionar **Devolver rascunho** e informar o motivo para o
autor. A devolução encerra o acesso do destinatário e não registra conferência.
O documento permanece rascunho. Nenhum outro perfil ganha acesso ao rascunho
por esse envio; a emissão ainda não está disponível.

Enquanto o encaminhamento estiver ativo, as edições ficam bloqueadas também
para o autor. Para corrigir ou trocar o destinatário, informe um motivo e use
**Recolher encaminhamento**, ou aguarde a devolução pelo destinatário. Ao
reabrir um rascunho devolvido, o autor vê a última devolução, sua data, o
coordenador e o motivo; confira-os antes de ajustar o documento. Se a consulta
do motivo falhar, ela informa o erro e oferece nova tentativa. Se o destinatário
ficar inativo ou deixar de ser
coordenador, o acesso dele é bloqueado e o autor poderá recolher. Uma cópia já
exibida antes do recolhimento não pode ser recuperada remotamente.

Em caso de conflito, reabra o rascunho. Se a comunicação falhar, confira o
estado antes de repetir: envio, recolhimento ou devolução podem ter sido concluídos.
Se o destinatário estiver em outra operação, aguarde e tente novamente.

## Verificação preliminar de pendências

No rascunho próprio ou encaminhado ao coordenador destinatário, salve ou
descarte as alterações locais e use **Verificar pendências para conferência**.
A consulta mostra bloqueios e avisos para a revisão salva. Ela não registra
conferência, não aprova o modelo e não autoriza emissão. Após alterações na
fonte ou no rascunho, execute novamente; uma consulta anterior não garante que
os dados continuem válidos.

Se a prévia estiver aberta, a consulta compara as revisões do documento, da
pessoa e do vínculo com as usadas ao abri-la. Divergência retorna conflito:
feche e reabra a prévia e execute a verificação novamente. Sem prévia aberta,
a consulta continua disponível, mas informa que não foi vinculada a ela.
Essa comparação não comprova revisão humana, não cobre outras tabelas da fonte
e não assegura que os dados permaneçam iguais após a consulta. A conferência
provisória revalida a fonte e o relatório na mesma transação.

A verificação identifica, entre outras pendências, CPF protegido inválido ou
inconsistente, matrícula divergente ou duplicada entre vínculos ativos,
vínculo removido, admissão alterada, divergência de período/cálculo, processo
fora das máscaras atuais e variáveis indisponíveis ou malformadas em blocos
ativos. Como medida conservadora, nascimento, nome da mãe, regime, cargo,
referência/padrão e órgão ausentes também bloqueiam a conferência provisória;
a obrigatoriedade institucional de cada campo ainda depende de aprovação.
Dados do vínculo sem data de sincronização, com mais de 24 horas ou com data
futura geram avisos. Se o nome da mãe estiver presente, a verificação
testa a cifra e a validade técnica do texto; não comprova sua correspondência
com a pessoa. Os registros de afastamento e incorporação não são
automaticamente confrontados com os lançamentos.

Se a fonte estiver sendo atualizada durante a consulta, a operação retorna
conflito; aguarde e tente novamente. Enquanto a consulta está em andamento,
escritas em pessoas e vínculos aguardam um bloqueio transacional global.
O mesmo protocolo protege a criação e a edição do cálculo, mas não outras
tabelas de fonte. Esse mecanismo provisório, sua ordenação e seu impacto em
importações futuras devem ser reavaliados antes de implementar sincronização
ou operação concorrente.

## Conferência provisória e devolução

No rascunho próprio ou encaminhado ao coordenador destinatário, abra a prévia
salva e execute a verificação de pendências. Resolva os bloqueios, leia os
avisos e confirme que revisou a prévia, os dados e os lançamentos antes de
selecionar **Conferir DOF provisória**. A operação registra a revisão e os
avisos, mas não aprova regras, modelo ou campos e não autoriza emissão.
Se o rascunho, a fonte ou os avisos mudarem, feche e reabra a prévia e refaça
a verificação. Se a comunicação falhar, consulte **DOFs conferidas** antes de
repetir, pois a conferência pode ter sido registrada.

Em **DOFs conferidas**, o autor ou coordenador destinatário pode consultar
seus documentos. A lista e a abertura da prévia indicam mudanças detectadas na
pessoa e no vínculo em cada consulta; elas não monitoram todas as fontes. A prévia usa a fonte atual e não preserva
um snapshot do conteúdo conferido. Se não puder ser carregada, a tela informa
o erro e oferece nova tentativa. O coordenador autor ou destinatário pode
informar um motivo e devolver o documento para ajustes; a conferência anterior
é preservada e eventual encaminhamento é encerrado. Se a comunicação falhar,
consulte os rascunhos antes de repetir a devolução. Com a aprovação formal
registrada, o coordenador pode **Emitir DOF** nesta tela, confirmando que
revisou a prévia; a fonte é revalidada na emissão e a mesma tentativa repetida
não gera outro número. Consulte a seção de aprovação formal e emissão.

## Verificação de software

Após `npm ci`, instale o navegador de testes com `npx playwright install chromium`.
`npm test` usa PostgreSQL 16.15, contas, banco, certificados e arquivos
inteiramente descartáveis. Não usa a instalação configurada. O teste Windows
exige caminhos ASCII ou 8.3 para o checkout e a pasta temporária, mantendo o
banco em UTF-8. Se necessário, defina `SISDOC_TEST_TEMP` para um diretório
temporário existente, externo ao checkout e à instalação operacional. Não há
ambiente permanente de teste. `npm run typecheck` verifica os tipos.

Os testes HTTPS verificam CA e nome contra PostgreSQL temporário. Os testes
Playwright usam Chromium instalado no cache local e uma prévia HTTP em loopback
com API inteiramente simulada e dados sintéticos; não reduzem os controles da
API HTTPS. Eles não substituem o teste do navegador integrado ao serviço com a
CA operacional confiável, nem uma revisão humana de acessibilidade.

Backup, restauração, atualização de instalações existentes e recuperação das
chaves ainda não estão implementados. A migração de uma fundação anterior foi
testada apenas em banco descartável; não há comando autorizado para executá-la
em instalação existente. Não há evidência de prontidão operacional.
