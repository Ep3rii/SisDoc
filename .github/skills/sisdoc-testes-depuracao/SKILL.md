---
name: sisdoc-testes-depuracao
description: Reproduzir bugs e validar alteracoes do SisDoc com TypeScript, Vitest, Playwright e PostgreSQL descartavel, selecionando testes focados sem atingir a base real. Use ao depurar falhas ou verificar codigo alterado.
---

# Testes e depuracao do SisDoc

## Identificar a falha

1. Leia as [instrucoes](../../copilot-instructions.md) e os
   [invariantes](../../../docs/ia/INVARIANTES.md). Confira `git status` e
   preserve alteracoes anteriores. Nao reverta arquivos para obter teste verde.
2. Reproduza o sintoma com entradas ficticias e identifique o caminho
   componente React -> contrato -> controlador/servico -> banco ou calculo.
   Leia somente o contexto necessario e use testes existentes como prior art.
3. Escolha a menor cobertura que verifica o requisito real. Nao substitua
   um teste de comportamento por mera compilacao.

## Executar no Windows

Confira os scripts atuais em [package.json](../../../package.json). Node
deve respeitar `engines`; execute na raiz `C:\SisDoc` com PowerShell.
Os comandos abaixo nao concedem autorizacao para instalar dependencias,
alterar servicos ou publicar mudancas.

O executor [executar-testes.cjs](../../../scripts/executar-testes.cjs)
valida destinos temporarios e remove `SISDOC_CONFIG` e variaveis `PG*` do
processo de testes. Use esse executor, nao chame Vitest diretamente nem
redirecione fixtures para PostgreSQL operacional.

Se o build necessario ja estiver atualizado:

```powershell
Set-Location 'C:\SisDoc'
node scripts\executar-testes.cjs tests\interface-dtc.test.ts tests\interface-rascunhos.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Os testes focados falharam.' }
```

Quando testes importam `dist`, atualize os workspaces necessarios antes de
executar. Para um build completo seguido apenas dos testes selecionados:

```powershell
npm.cmd test -- tests\interface-dtc.test.ts tests\interface-rascunhos.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Build ou testes focados falharam.' }
```

O build escreve os assets da instalacao unica. Nao trate esse comando como
somente leitura, nao execute enquanto outro agente estiver compilando e nao
o rode apenas para testar esta habilidade. Para mudanca apenas em Markdown,
confira links, formato e diff; nao compile nem execute suite funcional.

Para TypeScript, use `npm.cmd run typecheck`, ou o script do workspace
afetado quando suas dependencias compiladas estiverem atualizadas. Escale
para suite completa apenas quando o alcance da mudanca justificar.

## Selecionar cobertura

- Layout/editor: `interface-dtc.test.ts`, `interface-rascunhos.test.ts`.
- Calculos compartilhados: `calculo.test.ts`, `calculo-navegador.test.ts`,
  `dtc.test.ts`; preserve datas civis e entradas explicitas.
- Autenticacao/permissoes: `tokens.test.ts`, `permissoes.test.ts`,
  `politica-senhas.test.ts`.
- Emissao/PDF: `emissao.test.ts`, `armazenamento-pdf.test.ts`,
  `resultado-transacao.test.ts`.
- Importacao: selecione `importacao*.test.ts` e a cobertura do mapeamento
  alterado; jamais use planilhas ou dados reais como fixtures.

Confirme esses nomes no checkout antes de executar. Falha de caminho
ASCII/8.3, Chromium ou isolamento deve ser corrigida conforme o executor,
sem desabilitar suas protecoes. Instale dependencias apenas quando uma
validacao exigir algo ausente ou o manifesto mudar.

## Depurar e fechar

Use breakpoints em processo descartavel de teste; conectar debugger ao
servico operacional pode pausa-lo e exige autorizacao especifica. Nao
reinicie servicos nem mate processos por nome para liberar portas.

Adicione regressao para o bug, corrija a causa e repita os mesmos criterios.
Reporte comandos, resultado e limites quando solicitado; nunca declare
passou se o comando nao rodou. Limpe apenas temporarios que voce criou.
Atualize o registro do projeto distinguindo implementado, testado e servido.

Exemplo de uso:
`/sisdoc-testes-depuracao reproduza a falha de datas no editor DTC e execute a cobertura focada`
