---
name: sisdoc-inspecao-visual
description: Inspecionar e melhorar telas React do SisDoc com navegador, capturas, acessibilidade, responsividade e testes Playwright. Use para problemas de layout, formularios, navegacao ou revisao visual de DOF e DTC.
---

# Inspecao visual do SisDoc

## Preparar

1. Leia as [instrucoes do projeto](../../copilot-instructions.md), os
   [invariantes](../../../docs/ia/INVARIANTES.md) e o
   [ambiente unico](../../../docs/AMBIENTE_PRODUCAO.md).
2. Identifique a tela e seus componentes em `apps/web/src`. Consulte
   `apps/web/src/compartilhado/estilos.css` antes de criar estilos novos.
3. Verifique quais ferramentas de navegador o agente realmente possui.
   Prefira Integrated Browser do VS Code; use Playwright existente no
   projeto quando necessario. Esta habilidade nao instala nem disponibiliza
   um navegador ou MCP por si so. Se nao houver ferramenta, informe o limite;
   nao declare uma revisao visual com base apenas no codigo.
4. Confirme o endereco vigente e a confianca TLS. Nao ignore certificados,
   nao publique um preview externamente e nao altere Caddy/firewall para
   conseguir acesso. Pagina compartilhada pode conter sessao autenticada.

## Observar e corrigir

- Defina criterios observaveis antes de editar: tela, acao, estado esperado,
  resolucoes e comportamento por teclado.
- Na instalacao operacional, observe somente o que foi autorizado. Mesmo
  consultas podem produzir auditoria; nao prometa ausencia de escrita no
  banco. Nao efetue login, importacao, emissao, exclusao ou gravacao como
  parte de um smoke visual sem autorizacao para essas operacoes.
- Para exercitar escritas e estados autenticados, reutilize o preview com
  respostas interceptadas e dados ficticios dos testes de interface. Isso e
  um recurso descartavel de teste, nao uma segunda instalacao operacional.
  Nao encaminhe chamadas nao simuladas para a API real.
- Confira desktop (1366 px), tablet (768 px) e celular (390 px), ou as
  larguras pedidas. Observe sobreposicoes, cortes, rolagem, tabelas, estados
  vazios, carregamento, falha e o proximo passo do fluxo do analista.
- Confira foco visivel, ordem por Tab, nomes acessiveis, labels e contraste
  minimo de 4,5:1 para texto normal. Arvore de acessibilidade nao substitui
  captura visual; uma captura nao comprova acessibilidade completa.
- Preserve portugues, datas civis em dd/mm/aaaa, um botao primario por tela
  e vermelho reservado a erro/exclusao. Nao mude calculos ou permissoes para
  resolver um problema visual.
- Reproduza antes de corrigir. Faca alteracao coesa seguindo componentes e
  helpers existentes; confirme depois nas mesmas larguras e estados.

## Validar e apresentar

Use a habilidade `sisdoc-testes-depuracao` para selecionar e executar a
cobertura, especialmente [interface DTC](../../../tests/interface-dtc.test.ts)
e [interface DOF](../../../tests/interface-rascunhos.test.ts). Nao atualize
snapshots apenas para esconder uma regressao.

Capturas devem usar dados ficticios ou ser mantidas em armazenamento local
autorizado; nao coloque dados reais em Git, memoria ou servicos externos.
Registre tela/estado/largura, problema observado e resultado depois da
correcao. Diferencie observado, testado, compilado e nao verificado.

Exemplo de uso:
`/sisdoc-inspecao-visual inspecione o editor DTC em desktop e celular sem alterar dados`
