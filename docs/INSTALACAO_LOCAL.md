# Instalação local — 31/10/2026

Esta é a instalação permanente preparada para a futura operação, inicialmente
vazia. Não é uma demonstração com dados fictícios. Está disponível para
configuração e uso local; **o uso operacional foi autorizado em 31/10/2026**
([decisão 021](decisoes/021-autorizacao-operacional.md)). A emissão com PDF
ainda não está implementada.

## Etapas concluídas

1. PostgreSQL instalado como serviço automático, restrito ao próprio
   computador.
2. Banco vazio e papéis de migração/aplicação provisionados separadamente.
3. HTTPS configurado e confiança local instalada com autorização para todos
   os usuários do Windows.
4. Setup executado com sucesso: estrutura versionada, chaves, configuração e
   administrador inicial.
5. Layout reorganizado conforme a referência visual, sem habilitar recursos
   que ainda não existem.

## Componentes e arquivos externos

| Componente | Configuração verificada |
|---|---|
| Node / npm | 24.20.0 / 11.19.0 |
| PostgreSQL | 16.15; serviço `postgresql-x64-16`, automático, `NetworkService` |
| Escuta do banco | `127.0.0.1:5432`, autenticação SCRAM-SHA-256 |
| Banco | `sisdoc`, UTF-8 |
| Proprietário / migração | `sisdoc_migracao` |
| Aplicação | `sisdoc_app`, login distinto, sem privilégios administrativos ou associações a papéis |
| Migrações aplicadas | 13 registros, até `012-conferencia-dof` |
| Configuração | `C:\ProgramData\SisDoc\instalacao\config\aplicacao.json` |
| Credenciais de provisionamento | `C:\ProgramData\SisDoc\provisionamento\banco.json` |
| Certificado / chave / confiança Node | `C:\ProgramData\SisDoc\tls\localhost.pem`, `localhost.key` e o mesmo PEM como âncora de confiança |
| Certificado Windows | `C:\ProgramData\SisDoc\tls\localhost.cer`, confiável em `LocalMachine\Root` |
| Lista de senhas comuns | `C:\ProgramData\SisDoc\seguranca\senhas-comuns.txt` |
| API e interface | `https://localhost:3443/`, escuta somente em `127.0.0.1` |

As senhas foram geradas/introduzidas localmente, sem inclusão no repositório.
O arquivo de provisionamento contém credenciais de migração e permite acesso
somente à conta instaladora e a SYSTEM. Não entregue esse arquivo à conta da
aplicação. A instalação protege seus arquivos com ACLs; não copie as chaves,
configuração ou credenciais para o checkout.

O SID `S-1-5-19` (`LocalService`) foi informado ao setup para as permissões da
futura conta de serviço. **Não foi instalado um serviço Windows do SisDoc**:
o processo atual foi iniciado manualmente. Isso é diferente do serviço
PostgreSQL, que inicia automaticamente.

A lista de senhas usa 99.999 entradas não vazias de
`xato-net-10-million-passwords-100000.txt`, do SecLists. A licença MIT foi
preservada no diretório externo de segurança como `LICENSE-SecLists`.

## Primeiro acesso e reinicialização

Acesse **https://localhost:3443/**. Use o administrador definido no setup e
troque a senha obrigatória no primeiro acesso. Não forneça senhas no chat,
em argumentos de comandos ou em variáveis de ambiente.

O administrador técnico gerencia usuários e auditoria; ele não recebe acesso
funcional à busca pelo seu perfil. Crie contas funcionais autorizadas conforme
[os controles de operação](OPERACAO.md). Nenhuma pessoa foi importada.

Após reiniciar o Windows, abra PowerShell na raiz do repositório:

```powershell
$env:SISDOC_CONFIG = 'C:\ProgramData\SisDoc\instalacao\config\aplicacao.json'
npm start
```

O terminal precisa permanecer aberto. Não execute `npm run setup` novamente
nem tente recriar o banco; o instalador recusa raiz existente e banco não
vazio. Não existe procedimento aprovado para atualizar o schema de
instalações existentes.

Para verificar a disponibilidade, sem ignorar erros de certificado:

```powershell
Get-Service postgresql-x64-16
Get-NetTCPConnection -State Listen -LocalPort 3443,5432 |
  Select-Object LocalAddress,LocalPort,OwningProcess
curl.exe --fail https://localhost:3443/api/v1/health
```

O health deve retornar `{"status":"ok"}` e as escutas devem ser locais.
Se a porta estiver ocupada, verifique o PID e sua linha de comando antes de
encerrar qualquer processo. Não encerre processos apenas pelo nome.

## HTTPS e limites de confiança

O certificado é uma folha autossinada RSA de 3.072 bits, SHA-256, com uso
`serverAuth` e SANs `localhost` e `127.0.0.1`. Não é uma CA emissora geral
(`cA:false`). A confiança foi instalada no computador, não apenas no perfil
do operador, conforme autorização expressa.

Validade até **31/10/2027**. Não há renovação automática implementada. Antes
da expiração, valide um procedimento de substituição do certificado, chave,
confiança do Node e confiança do Windows, seguido de reinício e teste HTTPS.
Para retirar uma confiança antiga, use o gerenciador de certificados do
computador (`certlm.msc`), confirme impressão digital e validade do
certificado específico e remova somente essa entrada. Nunca remova outras
raízes de confiança indiscriminadamente.

Não use `--insecure`, não desative TLS e não reduza os controles de sessão.
O HTTPS direto basta para o acesso local; Caddy/IIS não foram instalados.
Não publicar na LAN, abrir portas de firewall ou encaminhar conexões externas.

## Autorização operacional e pendências

O responsável autorizou o uso operacional desta instalação em 31/10/2026
([decisão 021](decisoes/021-autorizacao-operacional.md)). A autorização vale
para as funções existentes; os itens abaixo são as próximas etapas para
ampliar o que pode ser feito pelo sistema.

1. Confirmar modelos, campos obrigatórios, regras de EE/contribuição e
   formato institucional do número de processo. As máscaras ficaram
   **sem configuração**: inclusão/substituição de processo estão bloqueadas.
2. Definir e implementar o mapeamento e a importação autorizada das fontes,
   com reconciliação e auditoria; o banco permanece sem pessoas.
3. Concluir a DOF: ajustes cadastrais exclusivos da declaração, snapshot,
   numeração, emissão/PDF, processamento, download e histórico.
4. Implementar os fluxos e modelos distintos das DTCs IPAM, Comissionado e
   INSS, sem misturar as respectivas regras.
5. Implementar e testar backup/restauração, recuperação de chaves,
   atualizações, instalação como serviço e controles finais de operação.
6. Confirmar suporte de segurança do Windows e concluir revisão humana,
   validação institucional e aceite dos fluxos integrados.

O Windows 10 Pro 22H2 está fora do suporte regular desde 14/10/2025. A
cobertura por atualizações de segurança estendidas não foi verificada.

O [guia descritivo](../Modelos%20e%20Documentação/guia_descritivo_declaracoes_funcionais_e_tempo_contribuicao.md),
especialmente a seção 9, orienta ajustes durante a preparação da declaração.
Esses ajustes deverão pertencer ao documento/rascunho e sua auditoria, sem
sobrescrever a fonte importada. A imagem define o layout, não textos oficiais,
dados reais ou regras de cálculo. Consulte [progresso](PROGRESSO.md) para as
evidências e [operação](OPERACAO.md) para as limitações de cada fluxo.
