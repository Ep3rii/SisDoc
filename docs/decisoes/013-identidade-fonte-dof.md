# Decisão 013 — Integridade da filiação na pré-conferência

## Contexto e escolha

A referência da DOF inclui o nome da mãe, mas a consulta preliminar apenas
testava se havia bytes no banco. Isso não comprovava que a cifra era íntegra
nem que continha texto utilizável. A verificação agora autentica e decifra
esse campo com o contexto da pessoa, exige UTF-8 válido, conteúdo não vazio
e ausência de caracteres de controle. O limite técnico é de 2.000 caracteres.
Uma cifra corrompida ou texto inválido gera bloqueio explícito, sem incluir
o conteúdo na resposta ou na auditoria.

O formato da filiação protegida é texto UTF-8 diretamente no envelope
AES-256-GCM, não JSON. A importação e a sincronização futuras precisam seguir
esse contrato e verificar a compatibilidade das origens. O CPF continua
validado e comparado ao HMAC pelo mesmo componente de leitura da identidade.

O campo ausente bloqueia a conferência provisória por cautela; sua
obrigatoriedade institucional depende do modelo aprovado. Um campo presente e íntegro não comprova que
o nome corresponde à pessoa; é necessária conferência humana. A exibição
posterior na prévia está descrita na [decisão 014](014-dados-fonte-previa-dof.md).
A conferência é provisória, conforme a [decisão 017](017-conferencia-provisoria-dof.md);
a emissão não está habilitada.

## Evidência e limites

Testes sintéticos cobrem ausência, texto válido, contexto incorreto, cifra
corrompida, UTF-8 inválido, texto vazio, caractere de controle e limite
técnico. A verificação integrada em PostgreSQL e HTTPS descartáveis confirma
que o conteúdo não aparece no relatório. A consulta é pontual e não substitui
aprovação de regras ou modelo, nem revisão humana das fontes.
