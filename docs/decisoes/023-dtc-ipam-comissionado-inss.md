# Decisão 023 — DTC IPAM, DTC Comissionado e DTC INSS

> Registro histórico dos modelos v1. Layout/textos de saída v2 e aprovação
> separada estão descritos na [decisão 029](029-modelos-oficiais-versionados.md).

## Contexto

A fatia 6 (Anexo A do prompt de construção) exige as três DTCs de ponta a
ponta (rascunho → edição → prévia → conferência → emissão → PDF →
histórico/cópia/cancelamento), reaproveitando a infraestrutura da DOF
(decisão 022) sem alterá-la. O motor `@sisdoc/calculo` já calculava os quatro
tipos (escopo por período nas DTCs, até 4 períodos; aviso `perfil_inferido`
para Comissionado e INSS). Os textos oficiais do modelo INSS **não foram
extraídos** dos modelos de referência e não podem ser inventados.

## Decisão

### Dados (migração `014-dtc`)

- Reaproveita `documentos.documento` (tipos `DTC_*`), `documento_periodo`
  (ordem 1–4) e `documento_cargo_comissionado` (ordem 1–3). Novas colunas em
  `documento_periodo`: `categoria` (efetivo, comissionado, contratado,
  serviço prestado) e `cargo` (cargo/função do período), usadas só na DTC INSS.
  O conteúdo completo da DTC (períodos com anos, cargos, dados INSS) fica
  cifrado em `entrada_cifrada`; o resultado do cálculo em
  `resultado_calculo_cifrado`; o processo em `processo_cifrado`.
- Conferência generalizada sem tocar no fluxo DOF: `documentos.conferencia_dtc`
  e `documentos.devolucao_conferido_dtc` (imutáveis, validadas por trigger
  contra tipo, status, revisão, revisões da fonte e perfil), e o trigger
  `exigir_evento_conferencia_dtc` em `documento`, que exige o evento
  correspondente para rascunho→conferido e conferido→rascunho em DTCs (a DOF
  continua com `conferencia_dof` e seus triggers).
- Remoção de períodos permitida apenas para DTC (regravação na edição); a DOF
  continua sem remoção de período.
- Templates `emissao-dtc-ipam-1`, `emissao-dtc-comissionado-1` e
  `emissao-dtc-inss-provisorio-1` registrados em `template_versao`.
- GRANTs mínimos ao papel da aplicação: SELECT e INSERT por coluna nas duas
  tabelas novas; INSERT de `categoria`/`cargo` e DELETE em `documento_periodo`;
  INSERT por coluna e DELETE em `documento_cargo_comissionado`. Nenhum
  UPDATE/DELETE nas tabelas de evento.
- `npm run migrar` aplica `014-dtc` a instalações em `013-emissao`; o setup
  novo aplica até 014; a API recusa iniciar sem 014.

### API (`/api/v1/dtc`)

| Rota | Perfil |
| --- | --- |
| `GET /dtc?estado=rascunho\|conferido&tipo=` | analista (próprios) e coordenador |
| `POST /dtc` (201) | analista e coordenador |
| `GET /dtc/:id`, `GET /dtc/:id/previa` | autor ou coordenador |
| `PATCH /dtc/:id` (revisão + motivo; ajustes auditados) | somente autor |
| `POST /dtc/:id/conferir` (revisão, prova de fonte, `confirmar`) | autor analista ou coordenador |
| `POST /dtc/:id/devolver` (motivo cifrado) | coordenador |
| `POST /dtc/:id/emitir` (`Idempotency-Key`) | coordenador |
| `POST /dtc/:id/copia` (`confirmar`) | analista e coordenador |

Download, situação, histórico (`tipo=DTC`, cinco últimas próprias) e
cancelamento (`/documentos/:id/cancelar`, secretário adjunto e administrador)
reaproveitam as rotas genéricas da emissão.

- A emissão continua exigindo **aprovação formal por tipo**
  (`aprovacao_modelo`); aprovar a DOF não libera as DTCs.
  `npm run aprovar-modelo [DOF|DTC_IPAM|DTC_COMISSIONADO|DTC_INSS]` aceita os
  quatro tipos e exige a confirmação `APROVAR <TIPO>`.
- Numeração própria por tipo e ano, `N° {n}/{ano}` (sufixo vazio — ver
  pendências), reservada com `FOR UPDATE` na mesma transação do snapshot
  cifrado (`snapshotEmissaoDtcSchema`), com `emissao_aprovacao` e `job_pdf`.
- O worker de PDF processa os quatro tipos; nome do arquivo
  `NOME_DTC-IPAM|DTC-COMISSIONADO|DTC-INSS_AAAA-MM-DD.pdf`.

### Textos e layout (`packages/templates/src/emissao-dtc.ts`)

- Comuns: PMSL/SEMAD, "Portaria MPS nº 154/2008-DOU de 16.05.2008", dados do
  servidor, tabela de períodos, texto dos períodos e do total, demonstrativo
  anual por período, seis linhas de totais (total de contribuição, efetivo
  exercício, PB, PV, PB/PV, licença-prêmio) e "ESTA DECLARAÇÃO NÃO CONTÉM
  EMENDAS NEM RASURAS".
- IPAM (Anexo III): períodos de contribuição ao IPAM informados pela fonte.
- Comissionado (Anexo VIII): CNPJ 06.307102/0001-30, até três blocos de cargo
  (cargo, decreto/publicação de nomeação, entrada em exercício, decreto/
  publicação de exoneração e encerramento) e área de uso do IPAM.
- INSS: cargo/função e categoria funcional por período (rótulos do guia
  §6.4), licenças sim/não com descrição, documentação-base, observação
  padrão do guia §6.5 ("Contribuiu para o Instituto Nacional do Seguro
  Social — INSS, durante todo período contido nesta declaração.") e marca
  **"MODELO PROVISÓRIO — TEXTOS OFICIAIS DO INSS PENDENTES DE APROVAÇÃO"** em
  todas as emissões.

### Interface

Itens **DTC IPAM**, **DTC Comissionado** e **DTC INSS** habilitados no menu
para analista e coordenador (`apps/web/src/dtc.tsx`): lista de rascunhos e
conferidos, busca de servidor, editor de períodos (anos gerados
automaticamente), cargos ou dados INSS, processo, prévia em iframe,
conferência, devolução e emissão (coordenador) com painel de PDF. O
histórico exibe o tipo e copia DTCs pela rota própria.

O editor permite PB/PV/licença-prêmio anuais e preserva todos os lançamentos
ao editar datas, regenerar anos e salvar. O cálculo soma essas incorporações
ao tempo de contribuição, sem alterar o efetivo exercício, com aviso
`incorporacao_dtc_provisoria`; as linhas continuam marcadas como provisórias.
Conteúdo, demonstrativo e totais são preservados no snapshot cifrado.

A prova específica DTC inclui revisões pessoa/vínculo e todos os períodos
IPAM (inclusive removidos, versão MVCC e metadados), sem truncar a fonte
para assinar. Mais de 50 períodos ativos tornam a fonte inválida, em vez de
imprimir uma seleção silenciosa. A prova da revisão conferida fica cifrada
em `ajuste_campo`, no campo `dtc.provaFonte.<revisao>`, evento imutável
gravado na mesma transação da conferência. A migração
`021-revisao-periodos-ipam` instala `documentos.bloquear_periodos_ipam()`,
SECURITY DEFINER com `search_path = pg_catalog`, objetos qualificados,
REVOKE PUBLIC e EXECUTE somente para o aplicativo. Não amplia UPDATE.
Setup aplica 021 e a API exige esse gate antes de iniciar.
Prévia/conferência/emissão mantêm o bloqueio compartilhado pessoa/vínculo
e `LOCK TABLE nucleo.periodo_ipam IN SHARE MODE NOWAIT` até o commit,
protegendo também inserções, remoções, exclusões lógicas e truncamentos
concorrentes. Fonte ocupada retorna conflito sem esperar a importação.
Fonte diferente após conferência bloqueia emissão mesmo com prévia nova;
conferências antigas sem prova completa exigem devolução e reconferência.
O administrador continua proibido de criar/copiar, mas opera existentes.

## Itens provisórios e pendências

1. **Template INSS integralmente provisório**: títulos, cabeçalho, ordem dos
   blocos, rótulos de licenças e documentação-base e assinaturas foram
   inferidos; apenas a observação padrão e as categorias vêm do guia.
   Substituir pelos textos oficiais antes da aprovação do tipo.
2. **Totais do Comissionado e do INSS inferidos**: as seis linhas seguem a
   estrutura do IPAM e saem marcadas com `*`.
3. **Linhas de PB, PV, PB/PV e licença-prêmio** sempre provisórias nas DTCs
   (não há regra aprovada; os valores vêm de lançamentos anuais documentados).
4. **Numeração das DTCs** sem sufixo e independente por tipo; confirmar o
   formato oficial.
5. **Cargo/função por período na DTC INSS** é campo da declaração (não lido
   da fonte).
6. Os períodos IPAM impressos vêm de `nucleo.periodo_ipam` e entram na
   prova de fonte específica da conferência e emissão.
7. Nenhuma aprovação de DTC foi registrada na instalação local; as emissões
   ficam bloqueadas até a validação formal de cada tipo.

## Consequências

- Instalações existentes precisam de `npm run build` e `npm run migrar`
  (aplica `014-dtc`) antes de reiniciar.
- `tests/dtc.test.ts` cobre os três fluxos com aprovação sintética, máximos
  (4 períodos, 3 cargos), PDFs dos quatro tipos sem corte (pdfjs-dist),
  perfis, bloqueio sem aprovação, histórico, cópia, cancelamento e
  `migrar` 013→014.
