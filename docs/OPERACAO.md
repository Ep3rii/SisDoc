# Operação — aplicação ainda não autorizada

O login, a administração e a consulta de servidores existem para verificação
em recursos descartáveis. Há cálculo, rascunho, blocos e prévia provisórios de
DOF e conferência provisória pela interface, mas **não há emissão, importação,
backup ou serviço Windows implementados**. A prévia não é um modelo oficial. Não instalar
ou usar operacionalmente até a
conclusão das demais fatias, revisão e autorização formal.
O renderizador experimental de PDF é usado apenas por testes sintéticos: não
há botão de download, arquivo operacional persistido, numeração ou emissão.

## Pré-requisitos para uma futura instalação

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

O backend atende apenas em `127.0.0.1` por HTTPS. O endereço aberto pelo
navegador deve usar o nome do certificado e a porta configurada, e a CA deve
ser confiável para o navegador. Não desative a validação TLS. Proxy Caddy/IIS,
serviço, regras de rede e certificado operacional confiável ainda exigem
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

O setup aplica até `012-conferencia-dof` ao banco novo. Uma instalação anterior sem essa
migração não inicia com esta versão. Não existe procedimento aprovado de
atualização: não aplique a migração manualmente em banco existente.

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

## Cálculo de referência da DOF

Nos detalhes de um vínculo com admissão informada, selecione **Calcular DOF**,
informe o intervalo e prepare a tabela anual. Confira registros de
afastamentos e incorporações em sua origem e lance os dias em cada ano;
esses registros ainda não são carregados automaticamente. Ao confirmar a
tabela, campos vazios representam zero, inclusive nas páginas não exibidas.
Para início após a admissão, informe também os acumulados anteriores de T/S e
P/F e sua origem. Datas anteriores à admissão geram aviso de ajuste.

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

No rascunho, informe o processo compatível e um motivo. A gravação é cifrada e
compartilha a revisão com cálculo e blocos. Para remover um processo incorreto,
marque a confirmação e informe o motivo; a remoção permanece possível mesmo sem
máscara configurada. O histórico de ajustes preserva os valores cifrados. A
prévia usa o processo salvo, não o texto ainda em edição.

## Encaminhamento para análise

No rascunho próprio, salve ou descarte as alterações pendentes, escolha um
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
consulte os rascunhos antes de repetir a devolução.

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
