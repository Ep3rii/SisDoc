# Decisão 021 — Autorização para uso operacional da instalação local

## Contexto

Em 31/10/2026, o responsável pelo projeto (@Ep3rii) autorizou expressamente o
uso operacional da instalação local inicializada nesta máquina
(`https://localhost:3443/`, banco `sisdoc` em `127.0.0.1:5432`). A aplicação
não será publicada para conexões externas; por isso, o certificado HTTPS local
autossinado, confiável no Windows para todos os usuários, foi aceito em lugar
de um certificado emitido por CA institucional.

## Decisão

A instalação local está **autorizada para uso operacional** nas funções que
existem e foram verificadas:

- autenticação, perfis, administração de usuários e auditoria;
- consulta de servidores por nome, CPF ou matrícula, vínculos e eventos;
- cálculo de referência da DOF, rascunhos, blocos de texto, prévia,
  encaminhamento, pré-conferência, conferência e devolução.

O objetivo é agilizar a busca de dados e a preparação das declarações descritas
no [guia descritivo](../../Modelos%20e%20Documentação/guia_descritivo_declaracoes_funcionais_e_tempo_contribuicao.md).

## Limites que permanecem

A autorização não cria funcionalidades inexistentes. Até sua implementação e
verificação, continuam indisponíveis: emissão com numeração, snapshot, PDF,
download e histórico; DTC IPAM, Comissionado e INSS; importação e
sincronização das fontes (o banco está sem pessoas); backup/restauração; e
execução da aplicação como serviço Windows. A prévia e as regras provisórias
permanecem identificadas como tal na interface; documentos oficiais devem ser
conferidos pelo responsável antes do uso.

O Windows 10 Pro 22H2 está fora do suporte regular; a cobertura por
atualizações estendidas deve ser confirmada pelo responsável.

## Consequências

- A interface deixa de exibir "uso operacional pendente" e passa a indicar a
  autorização e os recursos ainda indisponíveis.
- Novas instalações criadas por `npm run setup` continuam começando **sem**
  autorização; cada instalação exige registro próprio do responsável.
- Ao implementar emissão ou DTCs, a liberação dessas funções deve ser
  registrada em nova decisão.
