# Regras, bases de cálculo e condicionais — DOF e DTCs em produção (SEMAD / PMSL)

**Referência ativa de cálculo**, em conjunto com
[`PROMPT_CONSTRUCAO_APLICACAO_DOF_DTC.md`](./PROMPT_CONSTRUCAO_APLICACAO_DOF_DTC.md).
Arquitetura, segurança, modelo canônico, operação e campos INSS estão consolidados
no anexo A do prompt. Os planos antigos ficam em `arquivo/` apenas como histórico.
Este documento preserva evidências e inferências: não equivale a aprovação jurídica
nem comprova execução independente das planilhas nesta reorganização.

## Diretriz de operação — somente produção

- Existirá **uma única instalação operacional de produção**, independentemente
  da edição do Windows, desde que compatível, suportada e com os controles exigidos.
- **Não haverá ambiente de teste, homologação ou demonstração**, nem opção de
  execução `AMBIENTE=teste` ou modo demonstrativo.
- O banco operacional será iniciado vazio e receberá somente dados importados
  ou sincronizados por procedimentos autorizados; não terá seed de dados fictícios.
- Os exemplos numéricos deste documento e os testes automatizados verificam a
  implementação das fórmulas. Não constituem outro ambiente operacional e não
  podem criar pessoas, emissões, PDFs ou números oficiais na base de produção.
- Regras e textos inferidos ou provisórios permanecem identificados. A emissão
  operacional que dependa deles fica bloqueada até aprovação da área responsável.
- Finalidade de produção não equivale a prontidão: segurança, conferência da
  importação, backup, restauração, aceite e autorização continuam obrigatórios.
- Esta diretriz é documental: não converte automaticamente a aplicação atual,
  não exclui bancos existentes e não altera certificados, serviços ou dados.

Documento extraído das três pastas de trabalho Excel:

| Modelo | Arquivo | Abas |
|---|---|---|
| **DOF** — Declaração de Ocorrências Funcionais | `MODELO_DOF.xlsx` | `1ª PÁG`, `2º PÁG`, `INCORPORADO`, `DadosFuncionais` |
| **DTC IPAM** — Declaração de Tempo de Contribuição (Anexo III, regime IPAM / serviço prestado) | `MODELO_DTC_IPAM.xlsx` | `Declaração`, `2º Período`, `3º Período`, `4º Período`, `Tempo de EE e Contribuicao`, `INCORPORADO`, `DadosFuncionais` |
| **DTC Comissionado** — Declaração de Tempo de Contribuição para o INSS (Anexo VIII) | `MODELO_DTC_COMISSIONADO.xlsx` | `Declaração`, `Tempo de EE e Contribuicao`, `INCORPORADO`, `DadosFuncionais` |

> **Legenda de confiabilidade**
> - **[FÓRMULA]** — regra lida diretamente de uma fórmula existente na planilha.
> - **[ESTRUTURA]** — regra deduzida do layout/formatação (não há fórmula que a prove).
> - **[INFERIDO]** — dedução por analogia com outro modelo; **validar com a SEMAD** antes de implementar.
>
> **Aviso importante:** nos dois modelos DTC, as fórmulas das abas `Declaração` e `Tempo de EE e Contribuicao` estão **quebradas (`#REF!`)** — a aba `1º Período` do IPAM e todas as abas de período do Comissionado foram removidas, e vários campos da `Declaração` do IPAM foram substituídos por valores fixos de exemplo. A seção de cada DTC indica o que é fato e o que é dedução.

---

## 1. Convenções comuns a todos os modelos

### 1.1 Chave de busca e preenchimento
- **Chave:** a matrícula digitada em uma única célula de entrada, referenciada pelo nome definido `MATRIC`.
  - DOF: `MATRIC = '1ª PÁG'!A15` (também existem `_dt` e `_dataatual` = `'1ª PÁG'!E17`).
  - IPAM e Comissionado: `MATRIC = Declaração!K15`.
- Formato real da matrícula: texto `NNNNNN-D` (de 2 a 6 dígitos + hífen + dígito do vínculo). Exemplos: `203972-1`, `204836-2`. **A mesma pessoa pode ter mais de uma matrícula** (vínculos `-1`, `-2`), cada uma com sua própria linha.
- Busca sempre **exata**: `INDEX(DadosFuncionais!<col>:<col>, MATCH(MATRIC, DadosFuncionais!A:A, 0))`.

### 1.2 Condicional padrão de todo campo preenchido por busca [FÓRMULA]
```
SE MATRIC está vazia                     → "" (campo em branco)
SENÃO SE a matrícula não existe na base  → "Matrícula incorreta"
SENÃO                                    → valor da coluna correspondente em DadosFuncionais
```
A ocorrência de `"Matrícula incorreta"` recebe formatação condicional **texto vermelho-escuro (#9C0006) sobre fundo rosa (#FFC7CE)**.

### 1.3 Convenção de tempo (comercial) [FÓRMULA]
| Unidade | Regra |
|---|---|
| 1 ano | **365 dias** (anos bissextos não alteram o divisor) |
| 1 mês | **30 dias** |
| Anos | `ROUNDDOWN(dias / 365, 0)` |
| Meses | `ROUNDDOWN((dias − anos×365) / 30, 0)` |
| Dias | `dias − anos×365 − meses×30` |

### 1.4 Texto-padrão do tempo [FÓRMULA]
Formato: `"<N> dias, que correspondem a <AA> anos, <MM> meses e <DD> dias."`

Regras do texto:
1. `<N>` sai com **separador de milhar e sem decimais** (ex.: `14.521`) — a fórmula usa `TEXT(x,"0.00")`, que no Excel em português resulta em milhar com ponto. **Não gerar casas decimais.**
2. **Anos**: omitido se 0; `ano` se =1, `anos` caso contrário; sempre com 2 dígitos (`03`).
3. **Meses**: omitido se 0; `mês` se =1, `meses` caso contrário; 2 dígitos. Separador antes do mês: se há anos → `", "` (ou `" e "` quando dias = 0); se não há anos → sem separador.
4. **Dias**: omitido se 0; separador `" e "`; `dia.` se =1, `dias.` caso contrário. **O ponto final só existe quando há dias** (se dias = 0 o texto termina sem ponto — comportamento atual da planilha).
5. Se o total em dias for 0 → texto vazio `""`.

Exemplos válidos: `14.521 dias, que correspondem a 39 anos, 09 meses e 16 dias.` · `1.311 dias, que correspondem a 03 anos, 07 meses e 06 dias.`

### 1.5 Estrutura da aba `DadosFuncionais` (base de cadastro)

| Col. | Campo | DOF | DTC IPAM | DTC Comissionado |
|---|---|:-:|:-:|:-:|
| A | MATRICULA (chave) | ✔ | ✔ | ✔ |
| B | NOME | ✔ | ✔ | ✔ |
| C | CPF | ✔ | ✔ | ✔ |
| D | NASCIMENTO | ✔ | ✔ | ✔ |
| E | MAE | ✔ | ✔ | ✔ |
| F | ADMISSAO | ✔ | ✔ | ✔ |
| G | REGIMEJUR | ✔ | ✔ | ✔ |
| H | CARGO | ✔ | ✔ | ✔ |
| I | REFERENCIA | ✔ | ✔ | ✔ |
| J | SETOR | (não usado) | (não usado) | (não usado) |
| K | ORGAO | ✔ | — | — |
| L | DESLIGAMENTO | (não usado) | (não usado) | (não usado) |
| M | PISPASEP | — | ✔ | ✔ |
| N | NUMRG | — | ✔ | ✔ |
| O | NUMTITEL | — | ✔ | ✔ |
| P | ORGAORG (órgão expedidor do RG) | — | ✔ | ✔ |
| Q | ENDERECO | — | ✔ | ✔ |
| R | EXPEDICAO (data de expedição do RG) | — | ✔ | ✔ (cabeçalho aparece como `ADMISSAO` — duplicado) |

Perfil real dos dados:

| Base | Registros | `REGIMEJUR` | `REFERENCIA` |
|---|---:|---|---|
| DOF | 16.945 | só `ESTATUTARIO` | 178 valores distintos, formato `PREFIXO-LETRA` (ex.: `PNS-D`, `IX-B`, `VI-H`); 136 registros **sem hífen** |
| DTC IPAM | 15.838 | só `SERVICO PRESTADO` | só `UNICA` (15.202) e `SERV00` (636) |
| DTC Comissionado | 5.776 | só `ESTATUTARIO` | cargos comissionados `DAI1`…`DAI5`, `DAS`, `DAS1`…`DAS7` (5.748 começam com `DA`); quase nenhum tem hífen |

Matrículas duplicadas na base: 8 (DOF), 1 (Comissionado), 0 (IPAM) — a busca devolve sempre a **primeira** ocorrência.

### 1.6 Aba `INCORPORADO` (idêntica nos 3 arquivos)
Tabela auxiliar de até 20 períodos de incorporação: `PERIODO` (1–20), `DT INICIO`, `DT FIM`, `D = DT FIM − DT INICIO` e `D1 = SUM(D2:D65536)`.
- **Nenhuma outra aba referencia esta tabela.** É só uma calculadora de apoio; os valores de incorporação (PB/PV/Licença-prêmio) entram **manualmente** nas colunas H/I/J do DOF.
- Atenção: aqui os dias são `FIM − INÍCIO` (**sem** +1), diferente do cálculo principal, que é **inclusivo** (+1).

---

## 2. Modelo DOF — Declaração de Ocorrências Funcionais

### 2.1 Campos da `1ª PÁG`

| Campo | Célula | Origem / regra |
|---|---|---|
| Matrícula | `A15` | **Entrada manual** (`MATRIC`) |
| Nome do servidor | `A11` | busca → `DadosFuncionais!B` |
| Posse/Exercício | `H11` | busca → `F` (ADMISSAO) |
| Regime jurídico | `K11` | busca → `G` (REGIMEJUR) |
| CPF | `A13` | busca → `C` |
| Data de nascimento | `C13` | busca → `D` |
| Nome da mãe | `F13` | busca → `E` |
| Cargo/função/atividade | `C15` | busca → `H` |
| Nível | `J15` | derivado de `I` (REFERENCIA) — ver §2.2 |
| Referência/Padrão | `K15` | **Entrada manual** (no modelo: `J`) |
| Início do período | `B17` | busca → `F` (ADMISSAO); editável, sujeito à validação §2.3 |
| Fim do período | `E17` | **Entrada manual** (data); é também a **data de emissão** (`_dt`, impressa na 2ª página) |
| Órgão de origem | `G17` | busca → `K` (ORGAO) |
| Processo nº | `A19` | Entrada manual |
| Declaração nº | `D19` | Entrada manual (ex.: `N° 135P/2026`) |
| Ref. Data Inicial (auxiliar) | `S17` | `=IF(B17>=H11, B17, H11)` → o maior entre início informado e admissão |

### 2.2 Condicional do **Nível** (`J15`) [FÓRMULA]
```
SE MATRIC vazia                         → ""
SENÃO SE matrícula inexistente          → "Matrícula incorreta"
SENÃO SE REFERENCIA começa com "DA"     → ""   (cargo comissionado não tem nível)
SENÃO                                   → texto de REFERENCIA antes do primeiro "-"   (ex.: "PNS-C" → "PNS")
```
⚠ Se `REFERENCIA` não tiver hífen (136 registros na base atual), `FIND("-")` falha e a célula mostra `#VALUE!`. O sistema deve tratar esse caso.

### 2.3 Validações de dados (Data Validation) [ESTRUTURA]
| Campo | Regra | Mensagem |
|---|---|---|
| Início (`B17:C17`) | data **entre** `H11` (admissão) e `K13 − 1` | "Data INÍCIO inválida — você deve informar uma data compatível com o período de exercício do servidor" |
| Fim (`E17:F17`) | data **entre** `S17 + 1` e `K13` | "Data FIM inválida — …" |

`K13` funciona como "data limite/hoje" (a célula tem formatação condicional `K13 = TODAY()`), mas está **vazia** no modelo; vazia, a validação fica inatingível. Regra de negócio a implementar: `admissão ≤ início < hoje` e `início < fim ≤ hoje`.

### 2.4 Tabela anual (linhas 28–72, até 45 anos) — colunas e fórmulas [FÓRMULA]

**Entradas manuais por ano (linhas = anos civis):**
| Col. | Significado |
|---|---|
| `B` | Faltas (dias) |
| `C` | Licença **T/S** — tratamento de saúde |
| `D` | Licença **P/F** — doença em pessoa da família |
| `E` | Licença **I/P** — interesse particular |
| `F` | Outros (dias a deduzir) |
| `H` | Incorporado **PB** (dias) |
| `I` | Incorporado **PV** (dias) |
| `J` | Incorporado **LIC/PRE** — licença-prêmio (dias) |

**Geração das linhas de ano (`A`):**
```
A28 = 31/12/ANO(H11)                                  (primeiro 31/dez = ano da admissão)
An  = 31/12/(ANO(An-1)+1)   ENQUANTO  ANO(An-1) ≠ ANO(HOJE)  E  ANO(An-1) ≠ ANO(E17)
      senão ""  (para de gerar linhas)
```

**Colunas de apoio (por linha):**
| Col. | Fórmula (resumo) | Significado |
|---|---|---|
| `P` | `P28 = A28 − A22 + 1`; `Pn = An − An-1`; `0` se `A` vazio | dias do ano civil dentro do vínculo (1ª linha: do início até 31/dez, **inclusive**) |
| `R` | `R28 = P28`; `Rn = SE(Pn=0, 0, Rn-1 + Pn)` | dias acumulados desde o início |
| `N` | `SE(An < A22, 0, SE(An > B22, 0, SE(R > 366, P, R)))` | dias do ano **dentro do período declarado** (A22 = início, B22 = fim) |
| `O` | `SE(Nn-1 > 0, B22 − (An − Pn), 0)` | dias do **ano final parcial** (de 31/dez anterior até a data fim) |
| `M` | `SE(N = 0, O, N)` | **dias brutos do ano** (final do ano ou parcial final) |
| `Q` | `= P` | auxiliar |

**Deduções (`G` — soma das deduções do ano)** [FÓRMULA]:
```
G = B + E + F
  + [ MAX(0, ΣC_acum − 730) − MAX(0, ΣC_acum_anterior − 730) ]      ← T/S: só o que excede 730 dias acumulados
  + [ MAX(0, ΣD_acum − 180) − MAX(0, ΣD_acum_anterior − 180) ]      ← P/F: só o que excede 180 dias acumulados
```
Ou seja: **faltas, I/P e outros** são deduzidos integralmente; **T/S** só é deduzido após ultrapassar **730 dias (2 anos)** acumulados no vínculo; **P/F** só após **180 dias** acumulados. O excesso é deduzido no ano em que o limite é ultrapassado.

**Resultados por ano:**
| Col. | Fórmula | Significado |
|---|---|---|
| `K` | `M − G` | **Tempo de efetivo exercício** (descontados faltas, I/P, outros e excessos de T/S e P/F) |
| `L` | `M − (B + E + F)` | **Tempo de contribuição ao município** (T/S e P/F **não** são deduzidos) |

**Linha TOTAL (73):** soma de cada coluna (`B73…L73`). `M73 = SUM(M28:M69)`, `N73`, `P73` somam só até a linha 69 (ver §6). `O73 = N73 − F73`, `Q73 = P73 − G73`.

### 2.5 Cabeçalho "Período compreendido" (linha 22) [FÓRMULA]
| Célula | Regra |
|---|---|
| `A22` / `B22` | `= B17` / `= E17` (início e fim) |
| `C22` | `= M73` → **dias totais brutos** (sem nenhuma dedução) |
| `E22`, `I22`, `K22` | anos, meses e dias da conversão de `C22` pela regra §1.3 |

Cálculo inclusivo: `dias brutos = fim − início + 1`.

### 2.6 Totais para o texto da declaração (linhas 79–85) [FÓRMULA]
| Linha | Rótulo | Base (dias) | Texto |
|---|---|---|---|
| 79 | Tempo **total** de contribuição | `L73 + H73 + I73 + J73` | `L79` (vazio se `L73 = 0`) |
| 80 | Tempo de contribuição no município | `L73` | `L80` |
| 81 | Tempo de efetivo exercício na PMSL | `K73` | `L81` (vazio se `K73 = 0`) |
| 82 | Incorporação de **PB** | `H73` | `L82` |
| 83 | Incorporação de **PV** | `I73` | `L83` |
| 84 | Incorporação de **PB/PV** | `H73 + I73` | `L84` |
| 85 | Incorporação de **Licença-prêmio** | `J73` | `L85` |

Cada linha converte os dias para anos/meses/dias (§1.3) e gera o texto (§1.4).

### 2.7 `2º PÁG` — texto da declaração (condicionais) [FÓRMULA]

Cabeçalho fixo: "DECLARO, em face ao apurado, que o (a) interessado (a) conta com:" (`A39`). Em seguida, até 5 linhas dinâmicas (`A40` a `A44`):

| Ordem | Linha | Aparece quando | Texto |
|---|---|---|---|
| 1 | `A40` | `K73 ≠ 0` | `- Tempo de efetivo exercício: ` + `L81` |
| 2 | `A41` | `L73 ≠ 0` | `- Tempo de contribuição ao município: ` + `L80` |
| 3, 4, 5 | `A42`–`A44` | conforme tabela abaixo | incorporações e total |

Linhas 3–5 (`PB+PV` = `H73+I73`; `LP` = `J73`; total só aparece se `L73 ≠ 0`):

| `PB+PV` | `LP` | Linha 3 | Linha 4 | Linha 5 |
|:-:|:-:|---|---|---|
| = 0 | = 0 | Tempo **total** de contribuição (`L79`) | — | — |
| = 0 | ≠ 0 | Incorporação de **LICENÇA-PRÊMIO** (`L85`) | Tempo **total** de contribuição | — |
| ≠ 0 | = 0 | Incorporação de **PV-PB** (`L84`) | Tempo **total** de contribuição | — |
| ≠ 0 | ≠ 0 | Incorporação de **PV-PB** (`L84`) | Incorporação de **LICENÇA-PRÊMIO** (`L85`) | Tempo **total** de contribuição |

Regra geral: **o total de contribuição é sempre a última linha**; as incorporações só aparecem quando > 0, na ordem PB/PV → Licença-prêmio. (Se `L73 = 0` o total não é impresso.)

Texto livre da `2º PÁG` (digitado pelo analista, sem fórmula): *Contratação/Nomeação*, *Transposição/Enquadramento/Reenquadramento*, *Progressão*, *Informações Complementares* (`A1:A17` — caixa de ocorrências funcionais).

Rodapé de assinaturas:
- "São Luís - MA, " + data `_dt` (= `E17`), repetida nas três colunas de assinatura.
- Assinaturas: **Analista** (lavrou), **Coordenador(a) de Análise de Processos** (ratifica), **Secretário(a) Adjunto(a) Municipal de Administração**; mais "Assinatura do (a) Servidor (a)".
- Fundamento citado no cabeçalho: *Portaria MPS nº 154/2008-DOU de 16.05.2008*. Fonte: *SEMAD – Coordenação de Análise de Processos*.

### 2.8 Exemplo de verificação (valores reais gravados na planilha)
Servidor com admissão **17/06/1986**, fim **20/03/2026**, **1 dia de falta** (`B62 = 1`), sem licenças/incorporações:
- Dias brutos (`C22`) = **14.522** (= 14.521 + 1 do cálculo inclusivo) → cabeçalho 39 a, 9 m, 17 d.
- Efetivo exercício (`K73`) = Contribuição município (`L73`) = **14.521** → **39 anos, 09 meses e 16 dias**.
- `L79 = L80 = L81 =` "14.521 dias, que correspondem a 39 anos, 09 meses e 16 dias."
- Como `PB+PV = 0` e `LP = 0`, a 2ª página imprime 3 linhas: efetivo exercício, contribuição ao município, total.

> Note que o cabeçalho (`C22`) usa dias **brutos**, enquanto as linhas declaradas usam dias **líquidos** — por isso a diferença de 1 dia.

---

## 3. Modelo DTC IPAM — Declaração de Tempo de Contribuição (Anexo III)

Estrutura: 1 aba `Declaração` (capa/dados) + **uma aba de cálculo por período** (`1º Período` — *removida*, `2º`, `3º`, `4º Período`) + `Tempo de EE e Contribuicao` (consolidação). Base: servidores de **`SERVICO PRESTADO`**.

### 3.1 Aba `Declaração`

| Campo | Célula | Origem / regra |
|---|---|---|
| Matrícula | `K15` | **Entrada manual** (`MATRIC`) |
| Nome | `A15` | busca → `B` |
| RG | `A17` | busca → `N` (NUMRG) |
| Órgão expedidor | `F17` | busca → `P` (ORGAORG) |
| Data de expedição | `K17` | busca → `R` (EXPEDICAO) |
| CPF | `A19` | busca → `C` |
| Título de eleitor | `F19` | busca → `O` |
| PIS/PASEP | `K19` | busca → `M` |
| Data de nascimento | `A21` | busca → `D` |
| Nome da mãe | `F21` | busca → `E` |
| Endereço | `A23` | busca → `Q` |
| Cargo exercido | `A30` | [INFERIDO] busca → `H` (no modelo: `SERVIÇO PRESTADO - PROFESSOR`) |
| Processo nº | `J28` | Entrada manual |
| 1º a 4º período | linhas `50`–`53` | **Entrada manual**: início (col. `G`) e fim (col. `I`); `H` = "A" fixo |
| Texto dos períodos | `A32` | lista `dd/mm/aaaa A dd/mm/aaaa; dd/mm/aaaa A dd/mm/aaaa.` |
| Texto do total | `A33` | texto do tempo (§1.4) — no modelo está digitado, não calculado |
| Períodos no IPAM (observações) | `A54`–`A64` | texto livre, ex.: `JULHO/1998 A DEZEMBRO/2000` |
| Local e data | `A48` | `SÃO LUÍS - MA: dd/mm/aaaa` (digitado) |

> **[ESTRUTURA]** As células `A15, A17, A19, A21, A23, A30, A33, A48, F17, F19, F21, K17, K19` carregam a formatação condicional "Matrícula incorreta", o que indica que eram buscas por matrícula; hoje estão com **valores fixos de exemplo** (a fórmula foi perdida).
>
> Exemplo de dados fixos do arquivo: trecho com 3 anos/7 meses/6 dias ("1.311 dias") convivendo com períodos que somam muito mais — são **dados de exemplo desconexos**, não use como caso de teste.

**Blocos de totais** (`A34:K39`) — seis linhas, cada uma com ANOS / MESES / DIAS (mesma regra §1.3), hoje com `#REF!`:
1. Tempo Total de Contribuição
2. Tempo de Efetivo Exercício na PMSL
3. Tempo de Incorporação de PB
4. Tempo de Incorporação de PV
5. Tempo de Incorporação de PB/PV (`SUM` de dois valores)
6. Tempo de Incorporação de Licença-prêmio

Quadro de resumo `A26:K26` (Inicial / Final / Dias Total / Anos / Mês / Dias): também com `#REF!`; por analogia com as abas de período, `Dias total` = soma dos dias brutos (`M67`) dos períodos. [INFERIDO]

**Assinaturas:** *Responsável pelas informações*, *Visto*, *Assinatura do servidor*, *Assinatura e carimbo*; rodapé "ESTA DECLARAÇÃO NÃO CONTÉM EMENDAS NEM RASURAS".

### 3.2 Abas `2º`, `3º` e `4º Período` (idênticas entre si) [FÓRMULA]

Cada aba calcula **um período**. A única diferença entre elas é a linha de `Declaração` que alimenta o período:

| Aba | Início (`E16`) | Fim (`H16`) | Rótulo (`D15`) |
|---|---|---|---|
| 2º Período | `Declaração!G51` | `Declaração!I51` | `Declaração!A51` |
| 3º Período | `Declaração!G52` | `Declaração!I52` | `Declaração!A52` |
| 4º Período | `Declaração!G53` | `Declaração!I53` | `Declaração!A53` |
| *1º Período* (removida) | *[INFERIDO] linha 50* | | |

Cabeçalho pessoal: mesma busca por matrícula (`Nome`, `RG`, `Órgão exp.`, `Data exp.`, `CPF`, `Título`, `PIS/PASEP`, `Nascimento`, `Mãe`, `Endereço`, `Cargo`).

**Condicional da Referência/Padrão (`K13`):**
```
SE MATRIC vazia                          → ""
SENÃO SE matrícula inexistente           → "Matrícula incorreta"
SENÃO SE REFERENCIA começa com "DA"      → REFERENCIA completa      (ex.: "DAS5")
SENÃO                                    → último caractere de REFERENCIA   (ex.: "UNICA" → "A")
```
> Para a base IPAM (`UNICA` / `SERV00`), isso produz `A` / `0` — provavelmente indesejado; validar.

**Cabeçalho do período (linha 19):** `A19 = E16` (início), `B19 = H16` (fim), `C19 = M67` (dias brutos), `D19:K19` = conversão anos/meses/dias.

**Tabela anual (linhas 25–66, 42 anos)** — mesma lógica do DOF (§2.4), com diferenças:
- Primeira linha: `A25 = SE(E16="", "", 31/12/ANO(E16))` — o ano inicial vem do **início do período**, não da admissão.
- Parada das linhas: `ANO(An-1) = ANO(HOJE)` ou `ANO(An-1) = ANO(H16)`.
- Todas as colunas de apoio têm guarda `SE(A="", 0, …)`.
- **Não há colunas de incorporado (PB/PV/LIC-PRE)** nestas abas.

**Deduções — diferença-chave em relação ao DOF** [FÓRMULA]:
| Col. | Por ano | Total (linha 67) |
|---|---|---|
| `G` | `B + E + F` (faltas + I/P + outros) | `SUM(G) + MAX(0, C67 − 730) + MAX(0, D67 − 180)` |
| `H` (efetivo exercício) | `M − G` | `SUM(H) − [MAX(0, C67−730) + MAX(0, D67−180)]` |
| `K` (contribuição) | `M − G` | `SUM(K)` — **sem** deduzir excesso de T/S nem P/F |

Ou seja, **T/S (limite 730) e P/F (limite 180) são aplicados sobre o total de cada período** (e não de forma acumulada ao longo do vínculo, como no DOF), e afetam apenas o efetivo exercício, nunca a contribuição.

**Rodapé de cada aba (linhas 74–75):** converte `K67` (Tempo Total de Contribuição do período) e `H67` (Efetivo Exercício do período) em anos/meses/dias.

### 3.3 Aba `Tempo de EE e Contribuicao` (consolidação) [FÓRMULA]
| Linha | Base (dias) |
|---|---|
| 2 — Tempo Total de Contribuição | `K67(1º) + K67(2º) + K67(3º) + K67(4º)` |
| 3 — Tempo de Efetivo Exercício na PMSL | `H67(1º) + H67(2º) + H67(3º) + H67(4º)` |

Cada linha converte para anos/meses/dias (§1.3) e `L2`/`L3` guardam os dias somados. A referência ao `1º Período` está quebrada (`#REF!`) por a aba ter sido excluída.

### 3.4 Condicionais de destaque (campos vazios) [ESTRUTURA]
Formatação condicional que destaca o campo quando **vazio**: `K15:L15` (matrícula), `A32` (texto de períodos), `J28:L28` (processo), `A48` (local/data). Os campos `G51:G53` e `I51:I53` (início/fim dos períodos) são destacados quando os campos-base (`$A$32`, `$D$32`) estão vazios, isto é, **períodos só devem ser preenchidos depois dos dados-base**.

---

## 4. Modelo DTC Comissionado — Declaração de Tempo de Contribuição (INSS, Anexo VIII)

> **Estado do arquivo:** só a aba `Declaração` (layout), `Tempo de EE e Contribuicao`, `INCORPORADO` e `DadosFuncionais` sobreviveram. **Não há aba de cálculo de período** e **todas** as fórmulas de tempo estão com `#REF!`. Tudo abaixo sobre cálculo é **[INFERIDO]** por analogia com o IPAM/DOF, exceto os campos de busca (que seguem o mesmo padrão e a mesma `MATRIC = Declaração!K15`).

### 4.1 Cabeçalho e dados pessoais
- Órgão emitente: SEMAD — CNPJ `06.307102/0001-30`. Título: "Declaração de Tempo de Contribuição para fins de obtenção de benefício junto ao INSS".
- Campos (rótulos e formatação de "Matrícula incorreta" em `A15`, `K15`/`MATRIC`, `A17`, `F17`, `K17`, `A19`, `F19`, `K19`, `A21`, `F21`, `A23`): **mesmos do IPAM** (§3.1) — Nome, Matrícula, RG, Órgão expedidor, Data de expedição, CPF, Título de eleitor, PIS/PASEP, Nascimento, Mãe, Endereço. [INFERIDO]
- `Processo nº` na linha `28` (`J28:L28`).

### 4.2 Blocos de cargos em comissão (até 3) [ESTRUTURA]
Cada bloco repete os campos:

| Campo | Observação |
|---|---|
| Cargo em Comissão Exercido | mesclado em 3 linhas |
| Decreto de Nomeação | |
| Publicação no Diário Oficial (da nomeação) | |
| Data de Entrada em Exercício | |
| Decreto de Exoneração | |
| Publicação no Diário Oficial (da exoneração) | |
| Data de Encerramento / Afastamento | |

Posições: bloco 1 = linhas 29–32, bloco 2 = 33–36, bloco 3 = 37–40. Todos são **entrada manual** (não existem colunas para decretos na `DadosFuncionais`). `REFERENCIA` na base (DAI1…DAS7) identifica o nível do cargo comissionado.

### 4.3 Períodos e totais
- Quatro períodos "compreendidos nesta declaração" (linhas `59`–`62`): início em `G`, fim em `I`, `H` = "A".
  - Formatação condicional: **`G59`/`I59` são destacados quando vazios; `G60:G62` e `I60:I62` são destacados quando `$G$59` / `$I$59` estão vazios** → o 1º período é obrigatório e os demais só fazem sentido depois dele.
- `B64` (texto dos períodos) e `A66` (frase-modelo "___ DIAS, QUE CORRESPONDEM A ___ ANOS, ___ MESES E ___ DIAS.").
- Seis linhas de conversão (`H42:K47`, anos/meses/dias — rótulos perdidos). Pela posição, a linha 46 usa `SUM(…)` de duas referências, como "PB/PV" no IPAM → ordem provável: **42 Total de contribuição · 43 Efetivo exercício · 44 PB · 45 PV · 46 PB/PV · 47 Licença-prêmio**. [INFERIDO]
- `Tempo de EE e Contribuicao`: soma de **quatro** períodos (4 × `#REF!`) para Total de Contribuição e para Efetivo Exercício — mesma estrutura do IPAM. [INFERIDO]

### 4.4 Regras de cálculo a adotar [INFERIDO — validar]
Como não há aba de cálculo, a recomendação é reutilizar a **mesma engine do DOF/IPAM** (§2.4 / §3.2). A decisão a ser tomada pela SEMAD é **qual das duas regras de limite de licenças** usar (acumulado do vínculo como no DOF, ou por período como no IPAM).

Assinaturas: *Responsável pelas informações*, *Visto*, *Assinatura do servidor*, *Assinatura e carimbo*, e o campo **INSTITUTO DE PREVIDÊNCIA E ASSISTÊNCIA DO MUNICÍPIO – IPAM** (`A68`, área de uso do IPAM), mais "ESSA DECLARAÇÃO NÃO CONTÉM EMENDAS NEM RASURAS".

---

## 5. Quadro-resumo comparativo das regras de cálculo

| Regra | DOF | DTC IPAM | DTC Comissionado |
|---|---|---|---|
| Unidade de dias | inclusivo (`fim − início + 1`) | inclusivo | [inferido] inclusivo |
| Ano / mês | 365 / 30 | 365 / 30 | 365 / 30 |
| Dias brutos por ano | `M` | `M` | — |
| Faltas, I/P e Outros | deduz do EE **e** da contribuição | deduz do EE **e** da contribuição | — |
| T/S (tratamento de saúde) | deduz só o excedente a **730 dias acumulados** no vínculo; só do EE | deduz o excedente a **730 dias por período**; só do EE | — |
| P/F (pessoa da família) | idem com **180 dias** | idem com **180 dias por período** | — |
| Incorporações (PB, PV, LIC-PRE) | colunas `H`/`I`/`J` (manual) → somam ao **total** de contribuição | não existem nas abas de período; linhas de total existem na capa (refs. quebradas) | linhas de total existem (refs. quebradas) |
| Nº de períodos | 1 (período único; início até fim) | até 4 (abas separadas) | até 4 |
| Origem do ano inicial | ano da admissão | ano do início do período | — |
| Texto final | 3 a 5 linhas condicionais (§2.7) | texto dos períodos + total + 6 linhas de totais | idem IPAM |
| Total de contribuição | `L73 + H73 + I73 + J73` | `ΣK67` dos 4 períodos | idem IPAM |
| Efetivo exercício | `K73` | `ΣH67` dos 4 períodos | idem IPAM |

---

## 6. Pontos de atenção encontrados nas planilhas (corrigir ao migrar)

| # | Modelo | Achado | Impacto |
|---|---|---|---|
| 1 | DOF | `G66` tem fórmula digitada errada: `IF(SUM(C28:C66)>730, SUM(…)-7300)` (falta `,0` e o ajuste é `7300`, não `730`) | Erro de dedução de T/S se o acumulado passar de 730 dias naquele ano |
| 2 | DOF | `M73`, `N73` e `P73` somam só até a **linha 69** (as demais colunas vão até 72). Linha 69 = ano da admissão + 41 | Para servidores admitidos até 1984 com fim em 2026+, `C22` (dias brutos do cabeçalho) **perde o último ano** e fica menor que `K73`/`L73` |
| 3 | DOF | `B62 = 1` está digitado direto na tabela (1 dia de falta) | Dado do exemplo; limpar ao usar como template |
| 4 | DOF | Admissão em **31/12** seguida de ano **não bissexto** → `R = 366`, não é `> 366`, e `N` usa `R` (366) em vez de `P` (365) | +1 dia a mais em casos de borda |
| 5 | DOF | `J15` (Nível) usa `FIND("-")` sem tratamento de erro | `#VALUE!` para 136 referências sem hífen |
| 6 | DOF | Validações dependem de `K13` (vazia) | Impede validação real de datas |
| 7 | DOF | Cabeçalho usa dias **brutos** (`M73`), declaração usa **líquidos** | Diferença de dias entre cabeçalho e texto; confirmar se é desejado |
| 8 | IPAM | Limites de T/S (730) e P/F (180) são **por período** e não acumulados | Divergência com o DOF; definir regra única |
| 9 | IPAM | `K13`: para referências sem prefixo `DA` retorna o último caractere (`UNICA` → `A`) | Texto sem sentido para a base IPAM |
| 10 | IPAM | `O25` aponta para `T17` (célula fora da estrutura) em vez de `N24`; não impacta (vazia = 0), mas indica cópia errada | Sem efeito hoje |
| 11 | IPAM | Campos da `Declaração` foram sobrescritos por valores fixos; exemplo de texto de tempo (1.311 dias) não bate com os períodos digitados | Não usar como caso de teste |
| 12 | IPAM / Comissionado | `#REF!` em `Declaração` e `Tempo de EE e Contribuicao` (aba `1º Período` excluída; Comissionado sem nenhuma aba de período) | Totais da declaração hoje não calculam |
| 13 | Comissionado | Cabeçalho da coluna `R` em `DadosFuncionais` está como `ADMISSAO` (duplicado); no IPAM é `EXPEDICAO` | Confirmar que `R` é data de expedição do RG |
| 14 | Todos | `DadosFuncionais` não tem `SETOR` nem `DESLIGAMENTO` em uso; há matrículas duplicadas (8 no DOF) | Definir chave única no novo sistema |
| 15 | Todos | `INCORPORADO` não alimenta nenhuma aba | Incorporações são digitadas à mão (DOF) |
| 16 | Todos | Texto do tempo termina sem ponto quando dias = 0 | Padronizar pontuação |

---

## 7. Pseudocódigo de referência (motor de cálculo)

```text
entrada:  inicio, fim, anos[] com {faltas, ts, pf, ip, outros, pb, pv, lp}
          // pb/pv/lp apenas no DOF

dias_brutos_ano[a]:
    para cada ano civil a entre ano(inicio) e ano(fim):
        ini_a = max(inicio, 01/01/a)
        fim_a = min(fim,   31/12/a)
        dias_brutos_ano[a] = (fim_a - ini_a) + 1            // inclusivo

acum_ts = 0 ; acum_pf = 0
para cada ano a:
    acum_ts_ant = acum_ts ; acum_pf_ant = acum_pf
    acum_ts += ts[a]      ; acum_pf += pf[a]
    exc_ts = max(0, acum_ts - 730) - max(0, acum_ts_ant - 730)
    exc_pf = max(0, acum_pf - 180) - max(0, acum_pf_ant - 180)
    ded_contrib[a] = faltas[a] + ip[a] + outros[a]
    ded_ee[a]      = ded_contrib[a] + exc_ts + exc_pf

contribuicao_municipio = Σ (dias_brutos_ano[a] - ded_contrib[a])
efetivo_exercicio      = Σ (dias_brutos_ano[a] - ded_ee[a])
total_contribuicao     = contribuicao_municipio + Σpb + Σpv + Σlp     // DOF

// IPAM: calcular por período e aplicar limites 730/180 sobre o total do PERÍODO
//       (confirmar com a SEMAD se deve virar acumulado, como no DOF)
// IPAM total: Σ contribuição dos períodos; Σ efetivo exercício dos períodos

converter(dias):  anos = dias // 365
                  meses = (dias - anos*365) // 30
                  d = dias - anos*365 - meses*30
```

Caso de teste: `inicio = 17/06/1986`, `fim = 20/03/2026`, 1 falta ⇒ brutos **14.522**, contribuição = EE = **14.521** ⇒ **39 anos, 09 meses e 16 dias**.

---

## 8. Limites da evidência e decisões de implementação

1. **P/F e T/S:** usar as fórmulas descritas neste documento, não a omissão de
   P/F do plano arquivado. Limites 180/730 e perfis vínculo/período são regras
   de planilha **provisórias**, versionadas; o prompt define os perfis de referência
   para verificação. Emissão operacional depende de aprovação da regra aplicável.
2. **INSS:** não foi analisado nas três pastas Excel descritas aqui. Seus campos
   estão no anexo A.4 do prompt; texto/layout dependem de modelo limpo aprovado.
   Perfil IPAM para INSS/Comissionado é inferência provisória, não fórmula extraída.
3. **Incorporações:** distinguir entradas manuais de dias anuais (H/I/J) da
   calculadora de intervalos `INCORPORADO`. Esta usa `fim − início` sem `+1`
   e **não alimenta os totais automaticamente**. O cálculo principal é inclusivo.
   O antigo plano prescrevia soma inclusiva para incorporações; essa divergência
   permanece explícita. Não converter intervalos em dias silenciosamente:
   guardar convenção/origem e usar perfil provisório documentado até aprovação.
4. **IPAM anual versus total:** excessos T/S/P/F são abatidos do **total do
   período** na planilha IPAM, não das linhas anuais (§3.2). Se o motor distribuir
   excessos por ano para normalização, manter representação fiel do template,
   registrar diferença e testar equivalência do total. Não afirmar que a fórmula
   anual IPAM é igual à do DOF.
5. **Escopo vínculo DOF:** se o período declarado não cobre o vínculo inteiro,
   definir quais afastamentos anteriores entram no acumulado; o pseudocódigo
   isolado da seção 7 não resolve essa fronteira. Não reiniciar acumulador
   silenciosamente nem aplicar totais anuais a fração do ano sem decisão.
6. **Defeitos:** não copiar `7300`, soma até linha 69, falha de referência sem
   hífen, `#REF!`, valores fixos ou erro do primeiro ano após admissão em 31/12.
   Cada correção exige teste e diferença documentada em relação à planilha.
7. **Texto do tempo:** milhar, plural/singular, omissões e pontuação conforme §1.4.
   Qualquer padronização deve ter decisão/teste explícitos; zero retorna vazio.
8. **Dados reais:** números de contagens e descrições de fórmulas são evidência
   fornecida, não autorização para ler nomes/CPF/filiação dos arquivos preenchidos.
   Testes devem usar pessoas e identificadores inteiramente fictícios.

A instalação-alvo é exclusivamente de produção em Windows compatível e suportado,
sem ambiente de teste, homologação ou demonstração, conforme a diretriz inicial.
Perfis provisórios devem ser identificados e **bloquear a emissão operacional
afetada até aprovação**. Fixtures e artefatos de verificações automatizadas são descartáveis,
não entram na base operacional, histórico ou numeração oficiais e não têm
validade administrativa. Os critérios globais, GT e gates são os do prompt
ativo, sem necessidade de consultar os documentos arquivados.
