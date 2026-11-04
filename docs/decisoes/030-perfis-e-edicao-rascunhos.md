# Decisão 030 — Perfis ativos e edição de rascunhos

## Escolha

O perfil Secretário Adjunto deixa de existir. A migração `024-perfil-secretario-adjunto`
converte contas antigas para analista, inativa essas contas, revoga suas sessões
e registra a alteração na auditoria. Nenhuma permissão exclusiva é transferida
para outro perfil; ações administrativas permanecem restritas ao administrador.

Analista, coordenador e administrador podem consultar e editar rascunhos de DOF
e DTC independentemente da autoria. A autorização é revalidada no servidor e
continua limitada a documentos em estado `rascunho`. Um encaminhamento DOF
ativo mantém o bloqueio de edição até ser recolhido ou devolvido.

Esta decisão não amplia conferência, emissão, cancelamento, encaminhamento,
consulta de documentos conferidos, nem transições de estado. Permanecem os
locks, revisões concorrentes, auditoria, validação de fonte e proteções de cifra.
As decisões 007, 010 e 023 descrevem o comportamento anterior e ficam como
histórico; esta decisão as substitui somente nos pontos explicitados acima.

## Evidência e implantação

Testes devem cobrir acesso e edição entre perfis em rascunhos, rejeição de
edição após mudança de estado e migração de contas/sessões antigas. A migração
é obrigatória para iniciar o novo build. Antes de aplicá-la numa instalação,
parar a aplicação, obter backup validado e confirmar o estado da base.
