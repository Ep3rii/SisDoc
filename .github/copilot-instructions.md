# SisDOC: instruções para o Copilot

## Contexto

Aplicação web interna e local para emitir DOFs e DTCs (IPAM, Comissionado, INSS) de servidores da SEMAD.
Produção é usada só pelo dev, sem usuários externos. Fluxo do analista: localizar servidor → conferir vínculos → calcular → revisar → emitir PDF.

## Ao iniciar ou retomar

- Leia [Recapitulação](../docs/ia/RECAPITULACAO.md) e consulte só o que a tarefa exigir.
- Antes de mudar comportamento, confira [Invariantes](../docs/ia/INVARIANTES.md) e a decisão aplicável em [Decisões](../docs/decisoes/).

## Código e produção

- Editar direto na fonte, em passos pequenos, sem camadas, flags ou ambientes extras.
- Manter o monólito modular local e o motor compartilhado API/navegador ([Arquitetura](../docs/ARQUITETURA.md)). Sem frameworks ou dependências novas sem necessidade.
- Não alterar regras de cálculo, banco, autenticação, permissões nem auditoria, a menos que a tarefa peça.
- Publicar em produção direto da fonte validada, com commit curto e sem aprovação intermediária.
- Só um cuidado fixo: fazer backup antes de migração ou alteração destrutiva no banco. Os dados de servidores são reais, então não gravar seeds ou importações fictícias na produção.
- Não gravar dados pessoais, credenciais ou arquivos operacionais nas memórias.
- Em caso de ambiguidade, escolher a opção mais simples e deixar um comentário curto com a decisão.

## Interface

- Navegação por tarefa, não por tipo de objeto. Estados (rascunho, encaminhada, devolvida, conferida) são abas ou filtros, nunca itens de menu.
- Seguir o fluxo do analista: a busca de servidor fica em destaque e cada tela leva ao próximo passo.
- Um único botão primário por tela. Vermelho só para erro e exclusão.
- Português, sentence case, sem ponto final em rótulos e botões. Datas em dd/mm/aaaa.
- Contraste mínimo de 4,5:1, navegação por teclado e foco visível.

## Ao concluir uma etapa

- Trabalhar uma etapa por vez e listar: arquivos alterados, o que mudou para o usuário e o que ficou pendente.
- Atualizar a [Recapitulação](../docs/ia/RECAPITULACAO.md) e o [Progresso](../docs/PROGRESSO.md), diferenciando implementado, testado, publicado e pendente. Confira o Git e a instalação antes de tratar um registro histórico como estado atual.