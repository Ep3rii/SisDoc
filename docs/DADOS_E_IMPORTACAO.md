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
Upload e relatório ficam em Importar; mapeamento, prévia e confirmação de
promoção ficam em Disponibilizar Legado. As abas preservam o estado, mas não
gravam dados. Histórico reúne conferência por origem e lotes, com filtro
somente dos lotes carregados. Veja [operação](OPERACAO.md#organização-das-telas).

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
- **XLSX**: lida a primeira planilha; células de data no formato serial do
  Excel são convertidas.
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

## Garantias

- **Idempotência**: cada lote guarda o SHA-256 do arquivo. Repetir o mesmo
  arquivo (mesmo tipo e origem) não grava nada e informa o lote anterior.
  Arquivos diferentes comparam um `hash_conteudo` (HMAC) por registro:
  registros iguais ficam inalterados; só mudanças são atualizadas.
  Pela tela, mudanças cadastrais não substituem valores preenchidos:
  preenchem vazios e reportam divergências. A CLI mantém sua política anterior
  de atualizar campos alterados; não a use para contornar a revisão operacional.
- **Transação por lote**: a importação inteira é uma transação; falha
  inesperada não deixa dados parciais e é registrada como lote `falhou`.
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
