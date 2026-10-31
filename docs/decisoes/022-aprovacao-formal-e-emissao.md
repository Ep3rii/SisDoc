# Decisão 022 — Aprovação formal de modelo e emissão da DOF

## Contexto

A fatia 5 exige emissão da DOF com numeração, snapshot imutável, PDF,
download auditado, histórico, cópia e cancelamento (Anexo A.5 do prompt de
construção). A regra de cálculo (`REGRAS_E_BASES_DE_CALCULO_DOF_DTC.md` §2) e
o template da DOF continuam **provisórios** até validação formal pela área
responsável. Não pode existir chave, flag ou configuração que transforme um
modelo provisório em oficial.

## Decisão

### Aprovação formal (migração `013-emissao`)

- `documentos.aprovacao_modelo`: tipo do documento, versão de regra
  (`regra_versao_id`), versão de template (`template_versao_id`, coerente com
  o tipo), `aprovado_por`, `referencia_decisao`, `registrado_por`
  (`current_user`) e `aprovado_em`. Única por tipo+regra+template, imutável
  (UPDATE/DELETE/TRUNCATE bloqueados por trigger) e **gravável apenas pelo
  papel de migração**; o papel da aplicação tem somente SELECT.
- O registro é feito por `npm run aprovar-modelo`: comando interativo que
  mostra regra e template vigentes, pede aprovador e referência da decisão e
  exige a confirmação digitada `APROVAR DOF`. O registro é auditado
  (`modelo_aprovado`). Nenhuma aprovação foi registrada na instalação local.
- Sem aprovação da regra e do template vigentes, a emissão responde:
  "Emissão operacional bloqueada: regra/template provisórios ainda não
  aprovados. Registre a aprovação com npm run aprovar-modelo."

### Emissão

- `POST /api/documentos/:id/emitir`, somente coordenador, com cabeçalho
  `Idempotency-Key` obrigatório. A mesma chave para o mesmo documento devolve
  a mesma emissão; reuso da chave em outro documento ou revisão retorna 409.
- Revalida, na revisão atual: conferência, prova de fonte (pessoa, vínculo e
  revisões), regra vigente e aprovação do modelo.
- Numa única transação: `SELECT … FOR UPDATE` em `documentos.numeracao`
  (tipo, ano em São Paulo), reserva do próximo número (`N° {n}P/{ano}`),
  snapshot cifrado completo (dados da fonte, cálculo, blocos, processo,
  assinaturas, regra, template e aprovação; contexto
  `documentos/emissao/<id>/snapshot_cifrado`), inserção de `emissao`,
  `emissao_aprovacao` (vínculo imutável à aprovação usada, validado por
  trigger contra a regra/template da emissão) e `job_pdf`, e documento →
  `emitido`. Auditoria `dof_emitida`.
- Emissão oficial é apenas a que possui linha em `emissao_aprovacao`.

### PDF

- `WorkerPdfEmissao` inicia com a API (intervalo de 1 s, lote de até 10,
  posse de 2 min com `FOR UPDATE SKIP LOCKED`), generaliza o processamento por
  tipo e reprocessa jobs falhos com o **mesmo número** e espera crescente.
  `SISDOC_WORKER_PDF=desligado` desliga o worker (somente testes).
- Template oficial `packages/templates/src/emissao-dof.ts`: sem marca de
  prévia, página de declaração com seção DECLARO, local e data
  "São Luís - MA, dd/mm/aaaa", SEMAD/PMSL e assinaturas de Analista,
  Coordenador(a) de Análise de Processos, Secretário(a) Adjunto(a) e Servidor.
- Diretório: campo opcional `pdf.diretorio` em `aplicacao.json`; sem ele, usa
  `<raiz da instalação>\pdf`. Arquivos gravados com SHA-256 em
  `artefato_pdf`. Nome de download `NOME_TIPO_AAAA-MM-DD.pdf`, com `_2`, `_3`…
  para colisões do mesmo dia.

### Consulta, cópia e cancelamento

- `GET /api/emissoes/:id`: situação da emissão e do PDF.
- `GET /api/emissoes/:id/pdf`: autor, emitente, coordenador e secretário
  adjunto; demais recebem 404. Cada acesso é auditado (`pdf_baixado`,
  `pdf_nao_encontrado`, `pdf_indisponivel`).
- `GET /api/historico?tipo=DOF|DTC&escopo=proprio|todos`: últimas 5 emissões
  do usuário (próprio) ou gerais (coordenador, secretário adjunto e
  administrador, este com dados pessoais minimizados). Auditado.
- `POST /api/documentos/:id/copia`: analista ou coordenador; cria rascunho a
  partir do snapshot sem alterar a emissão.
- `POST /api/documentos/:id/cancelar`: secretário adjunto e administrador,
  motivo obrigatório cifrado (`motivo_cancelamento_cifrado`), quem e quando.
  O número não é reutilizado.

### Permissões do papel da aplicação

GRANTs de coluna mínimos: INSERT em `numeracao (tipo, ano, sufixo)` e UPDATE
de `ultimo_numero`; INSERT nas colunas de `emissao`, `emissao_aprovacao`,
`job_pdf` e `artefato_pdf`; UPDATE apenas das colunas de estado/posse do
`job_pdf`; UPDATE de `cancelado_por`, `cancelado_em` e
`motivo_cancelamento_cifrado` em `documento`. Nenhum acesso de escrita a
`aprovacao_modelo`.

### Atualização de instalação existente

`npm run migrar` lê `C:\ProgramData\SisDoc\provisionamento\banco.json` (ou
`SISDOC_PROVISIONAMENTO`), conecta com o papel de migração, aplica somente as
migrações pendentes registradas em `seguranca.migracao` e é idempotente.
Senhas nunca são impressas. Recusa banco sem histórico de migrações.

## Consequências

- A emissão existe, mas fica bloqueada até o registro da aprovação formal.
- A API recusa iniciar sem a migração 013; instalações existentes precisam
  executar `npm run build` e `npm run migrar` antes de reiniciar.
- O PDF exige o Chromium do Playwright disponível para a conta que executa a
  aplicação.
- DTCs permanecem fora desta decisão.
