# Contexto de construção

Fontes ativas: [prompt de construção](../../Modelos%20e%20Documentação/PROMPT_CONSTRUCAO_APLICACAO_DOF_DTC.md) e
[regras de cálculo](../../Modelos%20e%20Documentação/REGRAS_E_BASES_DE_CALCULO_DOF_DTC.md).
Este contexto é derivado dessas fontes e não substitui suas condições de aceite.

O objetivo é um monólito para criar, conferir e emitir DOF, DTC IPAM,
DTC Comissionado e DTC INSS, com PDF, histórico e auditoria. Busca, cálculo,
prévia e emissão usam dados locais; somente o módulo de sincronização acessa a
fonte externa. O cálculo é puro e compartilhado pelo servidor e navegador.

Há uma única instalação operacional, destinada à produção. O banco inicia
vazio; dados reais são importados por usuário autorizado. Testes usam apenas
recursos descartáveis e dados inteiramente fictícios, fora do banco, histórico
e numeração operacionais. Não existe ambiente permanente de demonstração,
teste ou homologação.

Modelos limpos e regras precisam ser aprovados antes da emissão operacional.
Inferências e perfis provisórios não constituem aprovação administrativa;
a emissão afetada permanece bloqueada. A imagem é referência visual, não fonte
de dados nem de texto oficial.

O trabalho segue as fatias e respectivos gates da seção 7 do prompt. O estado
efetivo e as evidências ficam em [PROGRESSO.md](../PROGRESSO.md).
