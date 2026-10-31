# Decisão 009 — Número de processo do rascunho DOF

## Contexto e escolha

O prompt exige um número de processo validado por máscara configurável, mas
não fornece formato institucional aprovado. O setup permite informar até dez
máscaras ou deixar a configuração ausente. Sem máscara, é impossível incluir
ou substituir o número; a aplicação apresenta uma orientação explícita. A
configuração de uma máscara não constitui aprovação de modelo, regra ou
emissão. O responsável deve obter a definição institucional antes de operar.

As máscaras usam `#` para um dígito, `@` para uma letra ASCII e `*` para letra
ou dígito. Os demais caracteres ASCII permitidos são literais. A comparação é
feita caractere a caractere, sem avaliar expressão regular fornecida por
configuração, e o número é normalizado para maiúsculas. Cada máscara e número
tem limite de 100 caracteres. O formato efetivo deve ser confirmado; a
notação ainda não suporta variações opcionais ou comprimento variável em uma
única máscara, mas aceita várias máscaras explícitas.

O número informado é cifrado na coluna `processo_cifrado`; a antiga coluna de
texto não é preenchida pela aplicação. Inserção, alteração e remoção usam a
mesma revisão do rascunho, exigem motivo e mantêm os valores anteriores e novos
cifrados em `ajuste_campo`. A remoção precisa de confirmação explícita e pode
ser feita mesmo quando a configuração de máscara estiver ausente. Um gatilho
impede alterar o processo quando o documento deixa de ser rascunho.

A prévia usa apenas o processo salvo e permite referenciá-lo por
`{{processo}}`; se ausente, a variável é destacada. A interface impede
edições concorrentes de cálculo, blocos e processo no mesmo editor e alerta
quando há gravação possivelmente em andamento. Conferência e emissão ainda
precisam validar novamente o número, o formato configurado e as demais
pré-condições.

## Evidência e limites

Os testes usam máscara e números exclusivamente sintéticos, PostgreSQL e
HTTPS descartáveis e Chromium com API simulada. Cobrem configuração ausente,
formatos inválidos, autorização, CSRF, revisão, conflitos concorrentes,
cifra, ajuste, remoção confirmada e imutabilidade do conteúdo após conferido.
A migração `006-processo-dof` só é aplicada pelo setup em banco novo; não há
procedimento aprovado para atualizar uma instalação existente.
