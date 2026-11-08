# Invariantes

Regras obrigatórias para desenvolver e operar o SisDoc. Os identificadores
permitem citar uma regra em tarefas, revisões e testes. Este documento não é
um relatório de conformidade: uma regra escrita não comprova sua implementação.
Confirme comportamento no código e nos testes; registre evidências e limites
em [Progresso](../PROGRESSO.md). Conflitos com decisões vigentes devem ser
explicitados, não resolvidos por suposição.

## Instalação única e operação

- **OP-01 — Só existe Produção.** A única instalação editável é `C:\SisDoc`.
  Código, build servido e serviço SisDoc usam esse checkout. Não criar
  Homologação, staging, banco operacional duplicado, cópias do projeto ou
  fluxo de promoção entre ambientes. Commits e tags históricos não são
  instalações ativas. Arquivos externos de configuração, TLS, PDFs, logs e
  backups não constituem outro ambiente.
- **OP-02 — Testes não usam a base real.** Recursos temporários e descartáveis
  dos testes existentes são permitidos; não representam um segundo ambiente
  operacional. Não redirecionar testes ao banco de Produção nem executar nele
  seeds fictícios, testes destrutivos ou ensaios de restauração. Fixtures e
  planilhas de teste são inteiramente fictícias.
- **OP-03 — Manutenção exige salvaguardas.** Antes de migração ou manutenção
  direta de schema/dados reais, registrar o estado atual do código e das
  migrações em commit e obter backup verificado fora do Git. Só então executar
  a operação autorizada, com janela e serviços parados quando necessário.
  Isso não substitui as confirmações das operações funcionais da aplicação.
  Não usar `npm run setup` para iniciar ou atualizar uma instalação existente.
- **OP-04 — Build afeta Produção.** O build atualiza arquivos da instalação
  única; não é uma verificação somente leitura. Validar mudanças coesas e
  conferir o comportamento servido conforme o procedimento de operação.
  Não iniciar outra cópia manual enquanto o serviço estiver ativo.
- **OP-05 — Rede e serviços têm escopo explícito.** Banco e backend escutam
  apenas em loopback; o acesso operacional é via Caddy com HTTPS confiável.
  Serviços, firewall e fontes reais não são alterados sem autorização.
  Não ignorar validação TLS nem reescrever `Origin` para contornar controles
  de segurança.

Referências: [Ambiente único — Produção](../AMBIENTE_PRODUCAO.md),
[decisão 035](../decisoes/035-versoes-e-ambientes.md) e
[Operação](../OPERACAO.md).

## Cálculo, documentos e emissão

- **DOC-01 — Emissão exige aprovação específica.** Exigir autorização, dados
  conferidos e regra e template aprovados por tipo: DOF, DTC IPAM, DTC
  Comissionado e DTC INSS. Aprovar um tipo não libera outro. Aviso ou
  configuração não transforma material provisório em oficial; textos não
  extraídos da fonte oficial permanecem marcados como provisórios.
- **DOC-02 — Snapshot e layout são versionados.** Selecionar o layout pela
  versão imutável do snapshot. Modelos v2 exigem aprovação própria; versões
  v1 e PDFs existentes não são substituídos por uma atualização de template.
  Imagens-modelo completas não entram no Git.
- **DOC-03 — Cálculo é determinístico.** Receber todas as entradas, inclusive
  a data de referência, sem acessar relógio, banco ou rede. Preservar o motor
  compartilhado API/navegador e o significado de datas civis, sem deslocá-las
  por conversão de fuso.
- **DOC-04 — Ajuste documental não altera cadastro.** Ajustes de cálculo ou
  conteúdo pertencem ao documento e não modificam sua fonte cadastral.
  A edição explícita do cadastro local é uma operação distinta, permitida
  conforme o perfil, com motivo, revisão e auditoria; não atualiza diretamente
  o banco externo.
- **DOC-05 — Emissão é atômica e idempotente.** Gravar número, snapshot e job
  de PDF atomicamente. Produzir PDF após o commit; falha posterior reprocessa
  o mesmo job e número, sem emitir novamente ou consumir nova numeração.
- **DOC-06 — Cancelamento não é exclusão física.** Cancelamento preserva
  registro e número. A exclusão física controlada pode remover documento e
  PDF conforme a decisão 027, mas preserva auditoria e impede reutilização
  da numeração. Exige motivo, revisão atual e confirmação explícita; não
  substitui anulação administrativa de documento entregue nem remove cópias
  baixadas, impressas ou existentes em backups.
- **DOC-07 — Conflitos e falhas são explícitos.** Nas operações com controle
  de revisão, exigir a revisão atual e rejeitar conflito sem sobrescrita
  silenciosa. Não informar conclusão quando a operação falhou ou está
  pendente; retentativas preservam os contratos de idempotência.

Referências:
[decisão 027](../decisoes/027-administracao-documentos-cadastro-legado.md) e
[decisão 029](../decisoes/029-modelos-oficiais-versionados.md).
Cobertura representativa a consultar:
[cálculo](../../tests/calculo.test.ts),
[API/navegador](../../tests/calculo-navegador.test.ts),
[emissão](../../tests/emissao.test.ts) e
[transações](../../tests/resultado-transacao.test.ts).

## Autenticação, permissões e auditoria

- **SEG-01 — Autorização é no servidor.** Ocultar um botão não concede nem
  revoga permissão. O administrador de Informática pode consultar e operar
  documentos existentes, inclusive de terceiros; não pode criar DOF/DTC ou
  reabrir emissões como cópia. Exclusão controlada e edição cadastral seguem
  seus requisitos próprios. Os demais perfis mantêm seus limites.
- **SEG-02 — Visibilidade não amplia ações.** Dados de trabalho são exibidos
  completos aos perfis autenticados conforme a decisão 028, sem ampliar os
  limites de ações de cada perfil.
- **SEG-03 — Auditoria é preservada.** Consultas e ações sensíveis são
  auditadas; a aplicação não altera nem apaga registros de auditoria.
  Inspeção de telas e consultas podem produzir auditoria mesmo sem editar
  um cadastro; não prometer ausência de escrita apenas por usar leitura.
- **SEG-04 — Senhas e sessões mantêm as proteções.** Usar Argon2id, mínimo
  de 10 caracteres e verificação local contra senhas comuns; cinco falhas
  bloqueiam por 15 minutos, com mensagem de falha única. Sessões permanecem
  no servidor, revogáveis, com cookie `__Host-` seguro, validação de origem
  e CSRF nas escritas autenticadas.
- **SEG-05 — Entrada e prévia são protegidas.** Validar entrada no servidor,
  escapar HTML e impedir execução de scripts na prévia. Não guardar dados
  pessoais em `localStorage` ou `sessionStorage`.

Referências:
[decisão 026](../decisoes/026-cadastro-informatica-e-exportacao.md),
[decisão 027](../decisoes/027-administracao-documentos-cadastro-legado.md) e
[decisão 028](../decisoes/028-legado-operacional-e-conferencia.md).
Cobertura representativa:
[permissões](../../tests/permissoes.test.ts),
[sessão e origem](../../tests/tokens.test.ts) e
[senhas](../../tests/politica-senhas.test.ts).

## Proteção de dados e certificados

- **DAD-01 — Dados reais não são material de desenvolvimento.** Não colocar
  dados pessoais ou segredos no Git, em memórias, logs técnicos, capturas de
  teste ou serviços externos não autorizados. Auditoria funcional protegida
  pode conter os dados previstos no seu contrato; não equivale a log técnico
  nem autoriza registrar payloads completos indiscriminadamente.
- **DAD-02 — Cifra e pesquisa são preservadas.** Normalizar e cifrar CPF,
  pesquisando-o por HMAC; cifrar os demais identificadores exigidos. Proteger
  também snapshots, áreas intermediárias de importação, relatórios e backups.
  Chaves ficam fora do banco e do repositório.
- **DAD-03 — Certificado público não é chave privada.** Arquivos operacionais
  TLS ficam fora do checkout, com ACLs adequadas. O certificado público da CA
  interna pode ser distribuído por canal administrativo confiável aos clientes
  autorizados. Nunca distribuir sua chave privada, incluí-la no Git ou
  registrá-la em logs. O certificado do servidor deve validar o nome/IP
  usado no acesso; pertencer à mesma rede não estabelece confiança na CA.

Cobertura representativa:
[proteção de dados](../../tests/protecao-dados.test.ts) e
[instalação](../../tests/verificar-instalacao.test.ts).

## Importação, sincronização e fonte cadastral

- **IMP-01 — Ausência não prova remoção.** Pessoas não são apagadas por
  ausência na API; remoção lógica só ocorre após reconciliação completa
  confiável. Importações e sincronizações são rastreáveis e idempotentes,
  sem resolver duplicidades ou vínculos ambíguos em silêncio.
- **IMP-02 — Legado não alimenta o Núcleo automaticamente.** Conversão exige
  mapeamento validado e confirmação. Preservar dados existentes e edições
  manuais, completar vazios e explicitar divergências sem sobrescrita
  silenciosa. Vincular a validação à sessão e ao estado da fonte; não aplicar
  uma prova de validação a arquivo ou estado diferente.

Referências: [Dados e importação](../DADOS_E_IMPORTACAO.md) e
[decisão 028](../decisoes/028-legado-operacional-e-conferencia.md).
Cobertura representativa:
[importação](../../tests/importacao.test.ts) e
[sincronização](../../tests/sincronizacao.test.ts).
