---
name: sisdoc-api-dados
description: Implementar e revisar mudancas tecnicas no monolito SisDoc, contratos Zod, API NestJS, PostgreSQL, calculos e PDFs, preservando autenticacao, auditoria e dados reais. Use para endpoints, regras, persistencia, migracoes ou falhas entre frontend e backend.
---

# API, contratos e dados do SisDoc

## Entender antes de alterar

Leia as [instrucoes](../../copilot-instructions.md),
[arquitetura](../../../docs/ARQUITETURA.md),
[invariantes](../../../docs/ia/INVARIANTES.md) e a decisao aplicavel.
Consulte a [recapitulacao](../../../docs/ia/RECAPITULACAO.md), mas confirme
estado atual no codigo e nao trate evidencia historica como estado vivo.

Trace um caso concreto entre `apps/web/src`, `packages/contratos/src`,
`apps/api/src` e o motor compartilhado em `packages/calculo`. Reutilize
validadores, helpers, transacoes e autorizacoes existentes. Preserve o
monolito modular; nao acrescente ORM, framework, MCP de banco, ambiente ou
abstracao sem necessidade demonstrada.

## Invariantes da implementacao

- Valide entradas no servidor com os contratos existentes. Mantenha tipos
  precisos e respostas de erro explicitas, sem casts amplos ou sucesso falso.
- Verifique permissao na API, nunca apenas escondendo botao. Preserve
  cookie seguro, sessao revogavel, verificacao de Origin e CSRF.
- Nao altere perfis, auditoria, calculos ou schema fora do pedido.
- Calculo recebe data de referencia e todas as entradas; nao consulta
  relogio, banco ou rede. Ajuste de documento nao modifica a fonte.
- Preserve idempotencia e atomicidade de numero, snapshot e job de PDF.
  Geracao ocorre depois do commit; retry reutiliza job/numero.
- Regra/template aprovado e snapshot versionado continuam obrigatorios.
  Nunca marque documento provisorio como oficial para liberar emissao.
- Proteja CPF/identificadores com os mecanismos existentes de cifra/HMAC;
  nao registre dados pessoais, credenciais, payloads reais ou chaves.
- Importacao deve explicitar conflitos, preservar edicoes manuais e provar
  estado da fonte. Nao resolva vinculo ambiguo por suposicao.

## Banco e operacao

A [instalacao unica](../../../docs/AMBIENTE_PRODUCAO.md) usa o mesmo
checkout editavel. Nao crie staging, banco operacional duplicado ou copia
do projeto. Os recursos descartaveis dos testes existentes continuam validos.

Esta habilidade nao autoriza migracao, importacao, restauracao ou operacao
administrativa. Se a tarefa exigir alterar schema/dados reais, siga o
procedimento documentado: estado atual registrado em commit e backup
verificado fora do Git antes da operacao; janela/parada quando necessario.
Nao inclua alteracoes de outro agente no commit sem revisao/autorizacao.
Nao execute `setup` em instalacao existente.

Nao leia configuracoes com segredos para imprimir seu conteudo. Prefira
health e diagnosticos redigidos; consultas sensiveis podem ser auditadas.
Nao conceda privilegios administrativos ao papel da aplicacao para fazer
uma consulta ou teste passar. Backend e banco permanecem em loopback.

## Validar

Use `sisdoc-testes-depuracao` com casos ficticios para sucesso, entrada
invalida, permissao negada e falhas de transacao/retry relevantes ao pedido.
Para alteracao de contrato, confira consumidor web e API juntos; para
calculo, confira equivalencia API/navegador; para PDF, confira conteudo e
versao, nao apenas existencia de arquivo.

Nao publique nem reinicie a aplicacao apenas por carregar esta habilidade.
Conclua com o efeito para o usuario e os limites reais da validacao.

Exemplo de uso:
`/sisdoc-api-dados investigue o contrato e a API da consulta DTC sem alterar o banco real`
