# Contexto de construção

Fontes ativas: [prompt de construção](../../Modelos%20e%20Documentação/PROMPT_CONSTRUCAO_APLICACAO_DOF_DTC.md) e
[regras de cálculo](../../Modelos%20e%20Documentação/REGRAS_E_BASES_DE_CALCULO_DOF_DTC.md),
[guia descritivo](../../Modelos%20e%20Documentação/guia_descritivo_declaracoes_funcionais_e_tempo_contribuicao.md)
e [protótipo visual](../../Modelos%20e%20Documentação/prototipo_SistemaWEB.jpeg).
Este contexto é derivado dessas fontes e não substitui suas condições de aceite.

O objetivo principal é agilizar a busca de dados locais e a preparação das
declarações. O sistema é um monólito para criar, conferir e emitir DOF, DTC IPAM,
DTC Comissionado e DTC INSS, com PDF, histórico e auditoria. Busca, cálculo,
prévia e emissão usam dados locais; somente o módulo de sincronização acessa a
fonte externa. O cálculo é puro e compartilhado pelo servidor e navegador.

O setor usuário é Cadastro de Pessoas (analista/coordenador). O administrador
é da Informática e possui acesso funcional completo, por autorização explícita
na [decisão 026](../decisoes/026-cadastro-informatica-e-exportacao.md).
A [decisão 027](../decisoes/027-administracao-documentos-cadastro-legado.md)
separa Sincronização da transferência por arquivos (Importação/Exportação),
permite edição do cadastro local, retira criação/cópia de documentos do
administrador e autoriza exclusão física controlada.

A [decisão 028](../decisoes/028-legado-operacional-e-conferencia.md) habilita
conversão de lotes cifrados do Legado para o Núcleo, com mapeamento, prévia
completa, validação assinada e confirmação. Preserva dados existentes e
edições manuais, preenche vazios e indica divergências para revisão explícita.
Dados de trabalho são completos para todos os perfis autenticados; isso não
amplia permissões de escrita ou exportação. A carga real requer confirmação
após conferência e não ocorre durante os testes.

Há uma única instalação operacional, destinada à produção. O banco inicia
vazio; dados reais são importados por usuário autorizado. Testes usam apenas
recursos descartáveis e dados inteiramente fictícios, fora do banco, histórico
e numeração operacionais. Não existe ambiente permanente de demonstração,
teste ou homologação.

Modelos limpos e regras precisam ser aprovados antes da emissão operacional.
Inferências e perfis provisórios não constituem aprovação administrativa;
a emissão afetada permanece bloqueada. A imagem é referência visual, não fonte
de dados nem de texto oficial.

O guia distingue EE de contribuição e exige modelos e fluxos próprios para
cada declaração. Os ajustes de campos durante a preparação, previstos na
seção 9, deverão ser exclusivos do documento/rascunho, com auditoria e sem
sobrescrita da fonte. Essa edição cadastral ainda não foi implementada.
Regras ambíguas continuam dependendo de validação da área responsável.

O layout usa menu lateral escuro, busca global, abas, editor com prévia
auditada à direita e totais fixos. Recursos ausentes são sinalizados, não
simulados. A instalação local foi inicializada vazia e autorizada para uso
operacional pelo responsável em 31/10/2026
([decisão 021](../decisoes/021-autorizacao-operacional.md)); emissão com PDF
foi implementada e aprovada por tipo na
[decisão 022](../decisoes/022-aprovacao-formal-e-emissao.md), mantendo a
identificação provisória do modelo INSS.
Estado, confiança HTTPS e próxima etapa estão em
[INSTALACAO_LOCAL.md](../INSTALACAO_LOCAL.md).

O trabalho segue as fatias e respectivos gates da seção 7 do prompt. O estado
efetivo e as evidências ficam em [PROGRESSO.md](../PROGRESSO.md).

## Modularização autorizada

A interface também foi organizada por domínio, com transporte HTTP separado
dos clientes tipados e componentes Cadastro/DTC decompostos. Estado, guardas
de edição e prévias permanecem compatíveis. Serviços maiores e documentação
integral das funções ainda estão em revisão; evidências e árvore atual em
[ARQUITETURA.md](../ARQUITETURA.md).

A refatoração de 01/11/2026 preserva o monólito local e é publicada por
etapas validadas. A composição da API usa módulos NestJS por domínio, sem
exportar seus serviços indiscriminadamente; somente pool/configuração são
recursos globais. Guarda, transações e encerramento dos workers continuam
obrigatórios. A organização, invariantes, limites da revisão e etapas
pendentes estão em [ARQUITETURA.md](../ARQUITETURA.md).

Documentar cada função nomeada e método com JSDoc durante a revisão do
respectivo módulo, explicando contratos e referências não óbvias. Não
considerar a revisão ou documentação global concluída apenas pela extração
dos módulos de composição.
