# Decisão 026 — Cadastro, Informática e transferência de dados

## Autorização e escopo

Em 31/10/2026 o responsável definiu o sistema como ferramenta do setor de
Cadastro de Pessoas. Analista e coordenador continuam sendo os perfis desse
setor, com consulta aos dados de referência necessários às DOF e DTCs.

O administrador é reservado à Informática. Por decisão explícita do
responsável, passa a consultar dados pessoais completos e documentos de
terceiros, editar rascunhos, conferir, emitir e cancelar. Essa permissão é
explícita, não uma hierarquia implícita de papéis. Aprovação formal por tipo,
CSRF, sessão ativa, revisão, auditoria, numeração e imutabilidade das
emissões continuam obrigatórios. Alterar permissões não aprova templates.

A migração `016-acesso-admin` atualiza os controles de perfil no banco sem
reescrever migrações já aplicadas. Instalações existentes devem parar a
aplicação e executar `npm run migrar` antes de reiniciar. As decisões antigas
de separação do administrador técnico ficam superadas apenas quanto aos
acessos explicitamente ampliados aqui.

## Referências e transferência

- A busca continua minimizada. Nos detalhes do servidor, selecionar um
  vínculo abre os dados pessoais completos e as referências paginadas de
  eventos, afastamentos, incorporações e períodos IPAM.
- O acesso completo é auditado; dados pessoais não entram em logs nem no
  armazenamento persistente do navegador.
- Administração → Sincronização reúne importação e exportação sem acesso
  direto à interface PostgreSQL. O atalho Importação continua disponível.
- Exportação é exclusiva do administrador, com confirmação explícita e
  auditoria `dados_exportados`. Gera CSV UTF-8 ou XLSX por origem, nos cinco
  formatos da importação, somente com registros ativos.
- Afastamentos anuais e por intervalo são exportados separadamente:
  selecione a modalidade e exporte ambas quando a origem tiver as duas.
- O arquivo conserva CPF, RG, PIS, título e demais campos pessoais completos.
  Esses arquivos deixam de estar cifrados pela aplicação: devem ficar em
  local protegido, fora do Git, e circular somente entre autorizados.
- XLSX grava células como texto. CSV com valores interpretáveis como fórmula
  é recusado explicitamente; use XLSX para não executar conteúdo nem alterar
  os dados. Incorporações anuais/exclusivas e afastamentos anuais ambíguos
  também são recusados, em vez de produzir uma exportação com perda silenciosa.
- Cada arquivo tem limite de 100 mil linhas e 64 MB, sem truncamento silencioso.
  A exportação é consistente em transação REPEATABLE READ.
- Exportação de dados canônicos não é backup integral: não inclui sessões,
  auditorias, PDFs, snapshots ou metadados técnicos da fonte.

## Capacidade

O limite de 50 é de itens por página, não de usuários ou sessões.
O teste em `tests/importacao.test.ts` cria 256 usuários distintos e sessões
reais por login HTTPS, com PostgreSQL descartável e 20 mil vínculos fictícios.
Executa 64 usuários concorrentes para cada perfil e um grupo misto, em três
ondas de autenticação da sessão, busca e leitura de referências (960
requisições). O pool usa 10 conexões e timeout de aquisição de 5 segundos,
como a configuração padrão da produção.

O aceite exige zero respostas de erro, p95 abaixo de 5 segundos, máximo
abaixo de 10 segundos e fila do pool drenada. É uma aferição local dessa
carga, não promessa de desempenho para toda operação: emissão simultânea
de PDFs, sessões prolongadas, dados reais e acesso por rede exigem aferição
própria. A instalação continua apenas em loopback; capacidade de sessões
não libera acesso de outras máquinas.

Aferição local em 31/10/2026, com 192 requisições por cenário e zero erros:

| Perfil (64 sessões concorrentes) | p95 | Máximo |
| --- | --- | --- |
| Analista | 870,9 ms | 952,0 ms |
| Coordenador | 844,1 ms | 915,6 ms |
| Secretário adjunto | 845,2 ms | 916,7 ms |
| Administrador | 854,6 ms | 929,8 ms |
| Misto (16 por perfil) | 851,3 ms | 918,6 ms |

Na execução posterior da suíte completa, os cinco cenários também passaram:
p95 entre 715,0 e 737,2 ms, máximo de 795,7 ms, sem respostas de erro.
