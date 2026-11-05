# Dados e importação

Contrato de dados entre o SisDoc e as fontes reais (planilhas DOF/DTC, base
legada em PostgreSQL e, futuramente, a API da folha). Desenho registrado na
[decisão 024](decisoes/024-importacao.md); a sincronização por API está em
[OPERACAO.md](OPERACAO.md#sincronização) e na
[decisão 025](decisoes/025-sincronizacao.md).

> Arquivos reais ficam **somente** em `dados-reais/` (ignorada pelo Git).
> Nunca anexe planilhas reais a issues, commits ou mensagens. Os modelos em
> [`referencias/modelos-importacao/`](../referencias/modelos-importacao/)
> contêm apenas dados sintéticos (CPFs válidos gerados, nomes fictícios).

## Visão geral

Na interface administrativa, **Importação e exportação** está organizada
em **Importar**, **Disponibilizar Legado**, **Exportar** e **Histórico**.
Upload e relatório ficam em Importar; ao escolher Núcleo com mapeamento,
recepção protegida, mapeamento, validação e promoção ocorrem na mesma aba.
Disponibilizar Legado continua disponível para lotes anteriores. As abas preservam o estado, mas não
gravam dados. Histórico reúne conferência por origem e lotes, com filtro
somente dos lotes carregados. Veja [operação](OPERACAO.md#organização-das-telas).
Os indicadores distinguem recepção do arquivo e aplicação no Núcleo.
Na promoção, acompanham lote/perfil, mapeamento, diferenças e confirmação;
o resumo exibe rejeitados, quarentena, divergências e preservação de correções.

| Tipo (`--tipo`) | Chave de identificação | Destino | Obrigatório? |
| --- | --- | --- | --- |
| `dados_funcionais` | pessoa por CPF; vínculo por (origem, matrícula) | `nucleo.pessoa`, `nucleo.vinculo` | **sim** (importe primeiro) |
| `eventos_funcionais` | matrícula + tipo + data + ato | `nucleo.evento_funcional` | opcional |
| `afastamentos` | matrícula + ano + tipo (ou intervalo) | `nucleo.afastamento` | opcional |
| `incorporacoes` | matrícula + tipo + início | `nucleo.incorporacao` | opcional |
| `periodos_ipam` | CPF + mês inicial | `nucleo.periodo_ipam` | opcional |

Os tipos que referenciam matrícula exigem que o vínculo já exista
(importado antes pelos dados funcionais da mesma origem); caso contrário a
linha é rejeitada com "Matrícula não encontrada; importe antes os dados
funcionais.".

A **origem** (`--origem`) identifica o sistema de onde vieram os dados
(ex.: `planilha-dof`, `planilha-dtc`, `legado`). Aceita até 63 caracteres:
letras minúsculas, números, ponto, hífen e sublinhado. Vínculos são únicos
por (origem, matrícula); a pessoa é única por CPF, independentemente da origem.

## Formatos aceitos

- **CSV UTF-8** (com ou sem BOM), separador `;` ou `,` detectado pelo
  cabeçalho, aspas no padrão RFC 4180.
- **XLSX**: primeira aba por padrão na CLI; na importação web, consulte e
  selecione a aba antes de validar. Nome inexistente ou relação inválida
  da aba selecionada é erro, nunca leitura silenciosa de outra aba.
  Células de data no formato serial do Excel são convertidas.
- **XML SisDoc v1**, detalhado abaixo; não é importador universal de XML.
- Tamanho máximo: **64 MB** por arquivo (CLI e tela).
- O cabeçalho é a primeira linha não vazia. Nomes são comparados sem acento,
  sem espaços/sublinhados e sem diferenciar maiúsculas; colunas
  desconhecidas são ignoradas com aviso; coluna repetida é erro (exceto
  `ADMISSAO`, ver abaixo).
- **Datas**: `AAAA-MM-DD`, `DD/MM/AAAA` ou serial do Excel. Data inválida
  em campo opcional vira anomalia e o campo fica vazio.
- **Meses** (períodos IPAM): `MM/AAAA`, `AAAA-MM` ou uma data (usa o mês).
- Textos: espaços repetidos são reduzidos e as bordas removidas; acentos e
  maiúsculas são preservados.

### `dados_funcionais`

Colunas da aba `DadosFuncionais` (12 do DOF; 18 dos DTCs). Obrigatórias:
`MATRICULA`, `NOME`, `CPF`.

| Coluna | Campo | Regras | Proteção |
| --- | --- | --- | --- |
| `MATRICULA` | vínculo.matrícula | até 40 caracteres; `matricula_norm` gerada | — |
| `NOME` | pessoa.nome | até 200 caracteres; nome de busca normalizado | — |
| `CPF` | pessoa.cpf | 11 dígitos com DV válido; ausente/ inválido = **quarentena** | cifrado + `cpf_hash` (HMAC) |
| `NASCIMENTO` | pessoa.nascimento | data | — |
| `MAE` | pessoa.nome da mãe | texto | cifrado |
| `ADMISSAO` | vínculo.admissão | data | — |
| `REGIMEJUR` | vínculo.regime | `ESTATUTARIO` ou `SERVICO PRESTADO` (outros = anomalia) | — |
| `CARGO` | vínculo.cargo | texto | — |
| `REFERENCIA` | vínculo.referência | sem hífen = anomalia | — |
| `SETOR` | vínculo.setor | texto | — |
| `ORGAO` | vínculo.órgão | texto | — |
| `DESLIGAMENTO` | vínculo.desligamento | data | — |
| `PISPASEP` | pessoa.PIS/PASEP | texto | cifrado |
| `NUMRG` | pessoa.RG | texto | cifrado |
| `NUMTITEL` | pessoa.título de eleitor | texto | cifrado |
| `ORGAORG` | pessoa.órgão expedidor | texto | — |
| `ENDERECO` | pessoa.endereço | texto | cifrado |
| `EXPEDICAO` | pessoa.expedição do RG | data | — |

Sinônimos aceitos no cabeçalho: `MATR`; `NOMEMAE`/`NOME DA MAE`;
`DATA NASCIMENTO`/`DT_NASCIMENTO`; `DATA ADMISSAO`/`DT_ADMISSAO`;
`REGIME`/`REGIME JURIDICO`; `DATA DESLIGAMENTO`; `PIS`/`PASEP`; `RG`;
`TITULO`/`TITULO ELEITOR`; `ORGAO EXPEDIDOR`; `DATA EXPEDICAO`.

**`ADMISSAO` duplicada**: nas planilhas DTC a data de expedição do RG vem
numa segunda coluna chamada `ADMISSAO`. Quando não há `EXPEDICAO` no
cabeçalho, a segunda `ADMISSAO` é tratada como `EXPEDICAO` e um aviso é
emitido.

**Consolidação por CPF**: as três planilhas (DOF, DTC IPAM, DTC
Comissionado/INSS) podem ser importadas e consolidam-se em uma pessoa por
CPF. Se o mesmo CPF aparece com dados diferentes, prevalece a primeira linha
e a divergência é reportada (lista de colunas, nunca os valores); campos
vazios na primeira são completados pelas seguintes.

### `afastamentos`

Duas formas (escolhida pelo cabeçalho):

- **Anual**: `MATRICULA, ANO, FALTAS, TS, PF, IP, OUTROS` — dias por ano
  (0 a 366); colunas vazias são ignoradas.
- **Intervalo**: `MATRICULA, TIPO, DT_INICIO, DT_FIM` — `TIPO` em `FALTA`,
  `TS`, `PF`, `IP`, `OUTRO` (aceita `LICENCA TS` etc.); fim ≥ início.

### `incorporacoes`

`MATRICULA, TIPO, DT_INICIO, DT_FIM` — `TIPO` em `PB`, `PV`, `LIC_PREMIO`;
fim ≥ início. Substitui a calculadora `INCORPORADO` das planilhas.

### `periodos_ipam`

`CPF, MES_INICIO, MES_FIM` — CPF inválido/ausente vai para quarentena;
período repetido (mesmo CPF e mês inicial) é rejeitado.

### `eventos_funcionais`

`MATRICULA, TIPO, DATA, ATO_NUMERO, DATA_PUBLICACAO, DESCRICAO` —
obrigatórios `MATRICULA` e `TIPO`. Tipos: `contratacao`, `nomeacao`,
`transposicao`, `enquadramento`, `reenquadramento`, `progressao`,
`designacao`, `exoneracao`, `mudanca_matricula`, `outro` (acentos e
espaços são normalizados; tipo desconhecido vira `outro` com anomalia).
`ATO_NUMERO` até 100 caracteres; `DESCRICAO` até 2.000.

## Classificação das ocorrências

| Tipo | Efeito | Exemplos |
| --- | --- | --- |
| `quarentena` | linha não gravada | CPF ausente ou com DV inválido |
| `rejeitada` | linha não gravada | matrícula/nome ausente, tipo inválido, intervalo invertido, matrícula inexistente |
| `duplicada` | linha repetida não gravada; a primeira é mantida | mesma matrícula no arquivo, mesmo registro repetido |
| `divergencia` | gravada com a primeira versão | mesmo CPF com dados diferentes |
| `anomalia` | gravada; apenas sinalizada | referência sem hífen, desligamento anterior à admissão, regime desconhecido, nascimento improvável, mãe/endereço ausentes, data inválida em campo opcional |

Na aplicação, o relatório mostra referências completas (matrícula, nome e CPF
quando disponíveis) para a conferência operacional autenticada. Relatórios
da CLI continuam mascarados. Nenhum dado pessoal vai para logs.

## Importação do histórico do servidor

O histórico é importado no contexto de uma pessoa e vínculo, separado da
importação administrativa de dados funcionais. A tela disponibiliza somente
o grupo selecionado: **Histórico Funcional** ou **Histórico Financeiro**.
O contrato exige esse grupo e o servidor rejeita linhas de outro grupo mesmo
que o arquivo tenha sido enviado manualmente. Os modelos atuais são
provisórios e representam o esquema genérico já implementado; os layouts
definitivos dependem dos exemplos das tabelas de origem que ainda serão
fornecidos.

Na validação, registros novos são listados como candidatos; registros
idênticos são inalterados e divergências são preservadas para revisão.
Somente os candidatos aceitos são aplicados após confirmação. Linhas rejeitadas
e divergentes não substituem dados cadastrados. A gravação é transacional e o
arquivo recebido é guardado cifrado como lote; não há criação, exclusão ou
recriação do banco ou do schema Legado.

## Execução

### Linha de comando

```powershell
# 1) Validação (padrão — nada é gravado)
npm run importacao -- --tipo dados_funcionais --arquivo dados-reais\dof.xlsx --origem planilha-dof --usuario <matrícula admin>

# 2) Gravação, com relatório completo em JSON
npm run importacao -- --tipo dados_funcionais --arquivo dados-reais\dof.xlsx --origem planilha-dof --usuario <matrícula admin> --commit --relatorio dados-reais\relatorio-dof.json

# 3) Conferência pós-importação
npm run importacao:conferir                                   # contagens gerais por origem
npm run importacao:conferir -- --tipo dados_funcionais --arquivo dados-reais\dof.xlsx --origem planilha-dof --amostra 20

# 4) Desfazer um lote
npm run importacao -- --rollback <id do lote>
```

- `--usuario` é a matrícula de um **administrador ativo**; o lote e a
  auditoria registram esse usuário.
- A CLI usa a configuração em `SISDOC_CONFIG` (como a aplicação) e mostra
  barra de progresso quando executada em terminal.
- `importacao:conferir` com arquivo compara origem × banco e lista uma
  amostra aleatória mascarada para conferência humana; termina com código 2
  se houver registros ausentes ou divergentes.
- `--rollback` usa a credencial de migração do provisionamento (a aplicação
  não tem `DELETE` em dados pessoais).

### Tela de administração

Menu **Administração → Importação** (perfil administrador): escolher tipo,
origem e arquivo, **Validar arquivo** (dry-run) e, só depois de validar o
mesmo arquivo, **Gravar importação** (com confirmação). A tela mostra
contagens, ocorrências, conferência por origem e os lotes anteriores. A rota
é `POST /api/v1/admin/importacoes?tipo=&origem=&modo=validar|gravar` com corpo
`application/octet-stream`; `GET /api/v1/admin/importacoes` e
`GET /api/v1/admin/importacoes/conferencia` listam e conferem.
Importação e exportação ficam na mesma tela **Importação**, separadas da
Sincronização com a API.

### Escolher Núcleo ou Legado

O campo **Schema de destino** seleciona schemas do banco local:

- **Núcleo:** formatos canônicos descritos neste guia; os servidores ficam
  disponíveis para busca e documentos.
- **Legado:** recepção de XLSX/CSV com cabeçalhos originais, em
  `legado.planilha_lote` e `legado.planilha_linha`. As linhas são cifradas,
  sem normalização ou conversão automática para o núcleo. Cabeçalhos vazios
  ou repetidos e valores sem cabeçalho são erros.

Use Legado para preservar a planilha original. Depois de guardar o lote, use
**Disponibilizar Legado para DOF e DTC**: selecione lote/tipo, confira a prévia
completa e mapeamento, valide a conversão e confirme **Aplicar no Núcleo**.
Somente a aplicação das linhas aceitas disponibiliza os dados nas consultas
e declarações. Veja o passo a passo na
[decisão 028](decisoes/028-legado-operacional-e-conferencia.md).

O assistente sugere as 18 colunas cadastrais e admite os cinco tipos já
documentados. Colunas extras continuam no Legado. Dados cadastrais existentes
e edições manuais são preservados; vazios podem ser completados. Divergências
exigem revisão explícita, não substituição automática. Referências complementares
existentes divergentes são preservadas integralmente.

A validação simula e desfaz a gravação; não alimenta o Núcleo. A aplicação
exige assinatura vinculada à sessão, lote, mapeamento e estado das fontes.
Mudanças após validar exigem nova validação. Repetir um lote/mapeamento
aplicado não cria duplicados. Quarentenas/rejeições não são aplicadas.

A prévia mostra até 20 linhas completas e o relatório até mil ocorrências,
com contagem explícita das demais. **Baixar todas as ocorrências em XLSX**
inclui o relatório completo após nova validação sem gravar. Proteja o download.

`POST /api/v1/admin/importacoes?destino=legado&origem=&modo=validar|gravar`
recebe o arquivo bruto. `GET /api/v1/admin/importacoes/legado` lista os
100 lotes mais recentes; `POST /api/v1/admin/importacoes/legado/exportar`
recebe `{loteId, formato}`. Todas as rotas são administrativas e auditadas
nas consultas/exportações e gravações. A carga respeita 64 MB, 100 mil linhas
e 256 colunas.

`POST /api/v1/admin/importacoes/legado/previa` recebe `{loteId, tipo}`.
`POST /api/v1/admin/importacoes/legado/promover` recebe
`{loteId, tipo, mapeamento, modo, validacao?}`; mapeamento associa campo
canônico à posição da coluna (zero-based) ou `null`. `validacao` é a assinatura
retornada por `modo: validar`, obrigatória em `modo: gravar`.
`POST /api/v1/admin/importacoes/legado/ocorrencias` recebe o mesmo mapeamento
em modo validar e devolve XLSX completo. Todas exigem administrador e CSRF.

### Exportação pela tela

Na tela **Administração → Importação**, selecione **Exportação de dados**:
tipo, origem e formato CSV UTF-8/XLSX. O administrador confirma o download
com dados pessoais completos. `POST /api/v1/admin/importacoes/exportar`
recebe JSON `{tipo, origem, formato, afastamentos}` com CSRF; `afastamentos`
é `anual` (padrão) ou `intervalo`.

Os cabeçalhos são os da importação e os arquivos podem ser reimportados.
Somente registros ativos da origem escolhida são incluídos. Exporte as duas
modalidades de afastamentos quando ambas existirem. CSV com conteúdo
interpretável como fórmula é recusado; XLSX mantém os valores como texto.
Incorporações anuais ou com convenção exclusiva não são convertidas para
intervalos inclusivos: a exportação é recusada com explicação.

Limites: 100 mil linhas e 64 MB por arquivo, sem truncamento silencioso.
A auditoria registra usuário, tipo, origem, formato e modalidade, sem valores
pessoais. O arquivo baixado **não é cifrado**; guarde-o em pasta protegida,
fora do Git. Exportação de dados não substitui backup de banco, auditorias,
documentos emitidos ou PDFs.
Para mover a instalação completa com usuários/aprovações/numeração, use o
[procedimento Windows Server](MIGRACAO_WINDOWS_SERVER.md), não reimportação
de planilhas nem setup sobre o banco restaurado.

## XML SisDoc v1 e seleção de abas

Modelo mínimo sintético, UTF-8:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<sisdoc xmlns="urn:sisdoc:importacao:1" versao="1">
  <registro>
    <MATRICULA>FICTICIA-001</MATRICULA>
    <NOME>Pessoa inteiramente fictícia</NOME>
    <CARGO>Cargo fictício</CARGO>
  </registro>
</sisdoc>
```

O exemplo demonstra estrutura, não uma linha cadastral válida: dados
funcionais exigem também CPF válido. O namespace pode ser omitido.
Cada `registro` contém campos simples e únicos; campos ausentes ficam
vazios. Entidades XML padrão e CDATA são aceitas como texto, sem executar
HTML. DTD, entidades externas, instruções de processamento, atributos de
campos e estruturas aninhadas são recusados. Nenhuma consulta de rede/arquivo
é feita pelo parser. XML de um fornecedor precisa ser convertido para este
perfil ou ter um adaptador versionado aprovado; não altere a raiz ao acaso.

Limites XML: 64 MB, 100 mil registros, 256 campos, profundidade 3 e 8.000
caracteres por campo. UTF-8 inválido, campos repetidos e XML malformado
produzem erro explícito, sem expor o conteúdo do arquivo na mensagem.

`POST /api/v1/admin/importacoes/abas` recebe XLSX bruto e devolve seus nomes
de abas; requer administrador/CSRF. Upload aceita `aba=<nome exato>` para
XLSX. Com seleção explícita, a identidade do lote é SHA-256 de
`sisdoc/aba/v1:` + nome JSON + byte NUL + arquivo, distinguindo abas do mesmo
arquivo. Sem seleção, conserva SHA-256 do arquivo e primeira aba.

## Histórico funcional e financeiro local

No Cadastro, selecione pessoa/vínculo e abra **Histórico funcional e
financeiro**. Todos os perfis funcionais consultam; somente administrador
cria, corrige com motivo, importa e exporta. Conteúdo e revisões ficam
cifrados; o histórico de alterações é append-only.

- Funcional: `ferias`, `licenca`, `abono_pecuniario`,
  `abono_permanencia`, `outro`; situação `informado`, `concedido`,
  `gozado` ou `cancelado`. Férias exigem início/fim e período aquisitivo;
  licença exige espécie e intervalo. Dias/saldos e efeitos são informados,
  não concessões automáticas nem entradas automáticas no cálculo DOF/DTC.
  Sobreposições geram aviso de revisão, sem soma de dias.
- Financeiro: grupo `financeiro`, tipo `lancamento`; situações `previsto`,
  `informado`, `pago`, `estornado`. Competência `AAAA-MM`, rubrica,
  natureza `provento|desconto`, modalidade `normal|complementar|retroativa`
  e valor decimal string com ponto e duas casas (`1234.56`).
  `pago` exige data de pagamento; retroativo exige competência de origem.
  Não são aceitos valores de ponto flutuante, vírgula ou negativos.
- Pagamento e fato funcional são registros distintos. `relacionadoId` e
  `eventoId` identificam registros existentes do mesmo vínculo. Estorno
  exige pagamento correspondente com mesmo valor/natureza; estorno
  duplicado ou edição incompatível do pagamento estornado são bloqueados.

Importação é por vínculo explicitamente selecionado, com origem técnica,
modelo canônico, validação e confirmação. Há downloads de cabeçalhos CSV
na própria tela; XLSX/XML usam os mesmos nomes de campos. Cabeçalhos ignoram
caixa/acentos/espaços/sublinhados; desconhecidos/duplicados são erros.
Datas devem estar em `AAAA-MM-DD`; identificador `idOrigem` é obrigatório.
Campos opcionais ausentes ficam `null`; efeitos ficam `nao_informado`.
A origem da linha, quando informada, deve ser a mesma do upload.

Modelo financeiro sintético:

```csv
GRUPO;TIPO;SITUACAO;DESCRICAO;COMPETENCIA;RUBRICA;NATUREZA;VALOR;FOLHA;IDORIGEM
financeiro;lancamento;informado;Lançamento fictício;2024-01;FICTICIA;provento;0.10;normal;EXEMPLO-1
```

A assinatura da validação vincula arquivo/linhas, pessoa/vínculo, origem,
sessão e revisões atuais. Confirmação revalida relações. Repetir origem/id
com mesmo conteúdo é inalterado; divergência preserva o registro existente
e exige correção manual. Rejeitados não são aplicados; o relatório informa
quantidades/linhas. As linhas aceitas são gravadas atomicamente e conservam
lote protegido/linha de origem. Limite de 100 mil registros por arquivo.

Rotas: `GET|POST servidores/:pessoa/historico`,
`PATCH servidores/:pessoa/historico/:id`,
`GET servidores/:pessoa/historico/:id/revisoes`,
`POST servidores/:pessoa/historico/importar` (arquivo bruto, query
`vinculoId,origem,modo,aba?,validacao?`) e
`POST servidores/:pessoa/historico/exportar` (`{vinculoId}`).
Todas sob `/api/v1`, autenticadas/auditadas; escritas exigem CSRF.

O GET aceita `grupo`, `competenciaInicio/Fim` (`AAAA-MM`), `inicio/fim`,
`rubrica` (contém), `limite` (1–100) e `cursor`, além de `vinculoId`.
Competência e rubrica filtram lançamentos financeiros; período usa sobreposição
dos fatos funcionais ou data do pagamento. Intervalos invertidos são rejeitados.
Filtros são **globais no vínculo**; resposta inclui `totais.registros`,
`proventosPagos`, `descontosPagos`, `proventosEstornados`, `descontosEstornados`,
independentes da página. Valores são strings exatas com duas casas decimais.
Busca textual da tela continua restrita à página e não altera esses totais.
Totais brutos mantêm estornos separados, sem inferência de saldo ou direitos.
Conteúdo cifrado é decifrado/filtrado no servidor; a consulta percorre todos
os registros do vínculo, não apenas a página. Validar escala com volume real
antes de declarar capacidade ilimitada.
Seleção assistida carrega todas as páginas de registros/eventos relacionados.
Exportação XLSX administrativa inclui
todo o vínculo até 10 mil registros, sem truncamento; preserva valor como
texto exato e metadados. O arquivo não é cifrado, não substitui backup e,
por conter metadados extras, não é modelo de reimportação direta.

## Garantias

- **Idempotência**: cada lote guarda o SHA-256 do arquivo (ou identidade da
  aba explicitamente selecionada, conforme acima). Repetir o mesmo
  arquivo (mesmo tipo e origem) não grava nada e informa o lote anterior.
  Arquivos diferentes comparam um `hash_conteudo` (HMAC) por registro:
  registros iguais ficam inalterados; só mudanças são atualizadas.
  Pela tela, mudanças cadastrais não substituem valores preenchidos:
  preenchem vazios e reportam divergências. A CLI mantém sua política anterior
  de atualizar campos alterados; não a use para contornar a revisão operacional.
- **Transação por lote**: a importação inteira é uma transação; falha
  inesperada anterior ao commit é revertida e registrada como lote `falhou`.
  Falhas ao reverter ou registrar o lote são comunicadas explicitamente,
  preservando as causas. Se a conexão falhar durante o `COMMIT`, o resultado
  é incerto: **confira a situação do lote antes de repetir a operação**,
  tanto na importação quanto no rollback. Não se presume que a carga foi
  desfeita e não se registra um lote falso de falha. A interface descarta
  conexões com estado transacional incerto.
- **Exclusão mútua**: um bloqueio consultivo impede importações e rollbacks
  simultâneos.
- **Rastreabilidade**: `nucleo.importacao_lote` (tipo, origem, canal,
  usuário, hash, contagens, datas) e `nucleo.importacao_registro` (estado
  anterior de cada linha alterada, acessível apenas ao papel de migração);
  auditoria `importacao_concluida`.
- **Não destrutivo**: emissões guardam snapshot; importações posteriores não
  alteram documentos emitidos. A importação não apaga registros ausentes do
  arquivo.
- **Rollback** (LIFO): desfaz somente o lote concluído mais recente,
  removendo o que foi inserido e restaurando o estado anterior do que foi
  atualizado. É recusado quando:
  - existe lote concluído posterior (desfaça-o antes);
  - algum servidor alterado pelo lote tem documento emitido;
  - auditorias, documentos ou outros registros já referenciam os dados do
    lote (por exemplo, uma consulta auditada ao servidor importado).
- **Desempenho**: cerca de 20 mil vínculos são importados em poucos
  segundos em máquina comum (verificado em `tests/importacao.test.ts`).

## Base legada em PostgreSQL

O esquema real ainda **não foi recebido**; o mapeamento é configurável e o
importador falha com mensagem clara (tabela e coluna) se faltar coluna.
Crie um JSON **fora do repositório** (ex.: `dados-reais\legado.json`):

```json
{
  "origem": "legado",
  "conexao": {
    "host": "127.0.0.1",
    "porta": 5432,
    "banco": "folha",
    "usuario": "leitura_sisdoc",
    "senhaVariavel": "SISDOC_LEGADO_SENHA"
  },
  "consultas": {
    "dados_funcionais": {
      "tabela": "rh.servidor",
      "colunas": { "MATRICULA": "matricula", "NOME": "nome", "CPF": "cpf", "ADMISSAO": "dt_admissao" }
    },
    "eventos_funcionais": {
      "tabela": "rh.evento",
      "colunas": { "MATRICULA": "matricula", "TIPO": "tipo", "DATA": "data" }
    }
  }
}
```

- As chaves de `colunas` são os campos canônicos das tabelas acima; os
  valores, as colunas da tabela legada. Só os campos obrigatórios de cada
  tipo precisam ser mapeados.
- Senha: `senhaVariavel` (nome de variável de ambiente) **ou**
  `senhaArquivo` (caminho absoluto fora do repositório) — nunca no JSON.
- Use um usuário somente leitura. A leitura ocorre em transação
  `REPEATABLE READ READ ONLY`; os tipos são importados na ordem dados
  funcionais → eventos → afastamentos → incorporações → períodos IPAM, cada
  um como lote próprio.

```powershell
$env:SISDOC_LEGADO_SENHA = [Net.NetworkCredential]::new('', (Read-Host 'Senha' -AsSecureString)).Password
npm run importacao -- --legado dados-reais\legado.json --usuario <matrícula admin>           # validação
npm run importacao -- --legado dados-reais\legado.json --usuario <matrícula admin> --commit  # gravação
```

## O que as fontes precisam fornecer (anexo A.7)

**Obrigatório**

- Dados pessoais por CPF: nome e CPF válido (demais dados pessoais do quadro
  `dados_funcionais` são necessários para emitir sem pendência).
- Vínculo por matrícula: matrícula, admissão, regime, cargo, referência,
  órgão/setor e desligamento quando houver.
- Identificador estável por origem (matrícula) e indicação de matrículas
  reaproveitadas.

**Opcional, mas necessário para declarações completas**

- Eventos estruturados (tipo, data, número do ato, publicação).
- Faltas e licenças por tipo, por ano ou por intervalo.
- Incorporações PB/PV/licença-prêmio com início e fim.
- Períodos de contribuição ao IPAM.
- Para a API (sincronização): data de alteração, cursor/paginação estável,
  exclusões/retificações e limites de uso.

Ausência de campo obrigatório é erro ou pendência explícita; o sistema não
inventa dados. Corte de 2019, matrículas reaproveitadas e totais anuais em
períodos parciais continuam exigindo decisão da área responsável.

## Modelos

`referencias/modelos-importacao/` traz um CSV e um XLSX por tipo, com os
cabeçalhos exatos e linhas sintéticas. Para regenerá-los:

```powershell
npm run build
node scripts\gerar-modelos-importacao.cjs
```
