# Decisão 001 — Referências e estado inicial

## Contexto

O prompt consolida conflitos históricos e exige preservar recursos existentes.
Neste workspace, antes da construção, foram encontrados apenas as duas
referências ativas e os modelos originais; não foi encontrada a base de código
demonstrativa mencionada no anexo A.6. PostgreSQL e Caddy não foram encontrados
no PATH, nos caminhos usuais examinados ou como serviços. Isso não prova que
não existam em outro local.

## Decisões de referência

| Tema | Escolha do prompt | Condição |
|---|---|---|
| P/F | excedente acima de 180 entra na dedução | provisório, versionado |
| Escopo T/S e P/F | vínculo no DOF; período no IPAM; perfil IPAM inferido para Comissionado/INSS | aprovação pendente |
| Cabeçalho DOF | exibir dias brutos e tempo líquido com rótulos distintos | não alterar textos oficiais |
| Referência sem hífen | nível vazio e aviso | não reproduzir `#VALUE!` |
| Totais após 41 anos | somar todos os anos | não reproduzir o limite da planilha |

O cálculo principal é inclusivo; a calculadora auxiliar de incorporação é
exclusiva. A convenção de intervalos de incorporação e os afastamentos anteriores
a períodos parciais continuam pendentes de validação. No IPAM, a planilha
aplica o excesso de licenças ao total, não às linhas anuais.

## Consequências

Não presumir que a instalação descrita no prompt exista neste checkout, nem
apagar bancos, trocar certificados ou instalar serviços para reconciliar a
divergência. Verificar componentes e usar recursos descartáveis para testes.
Regras e layouts não aprovados bloqueiam emissão operacional.

Na verificação com PostgreSQL 16 no Windows, iniciar `initdb` com codificação
UTF-8 a partir de um caminho de binários contendo acento falhou. Os testes usam
caminhos ASCII/8.3 tanto para os binários quanto para o diretório descartável,
sem trocar a codificação do banco. Se os caminhos curtos não estiverem
disponíveis, é necessária uma raiz compatível escolhida explicitamente; o
executor de testes não move arquivos nem altera ferramentas globais.
Para verificar isolamento e localização de segredos, caminhos curtos e longos
são resolvidos pela API nativa do Windows antes da comparação.
