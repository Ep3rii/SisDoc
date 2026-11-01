# Instalação e estado atual — 01/11/2026

Este documento descreve a instalação de origem e os requisitos do release
atual. Não é um instalador automático nem evidência de homologação em outra
máquina. Para a **migração completa para Windows Server x64**, use o
[procedimento de migração](MIGRACAO_WINDOWS_SERVER.md).

## O que está implementado

- Monólito modular: API NestJS serve React/Vite por HTTPS em loopback;
  contratos, cálculo e templates compartilhados.
- Autenticação, usuários, auditoria, busca/cadastro e edição local autorizada.
- DOF e DTC IPAM/Comissionado/INSS: rascunho, prévia, conferência, emissão,
  numeração, snapshot cifrado, worker PDF, download, histórico e cancelamento.
- Importação/exportação CSV/XLSX, seleção Núcleo/Legado e conversão conferida
  Legado → Núcleo. Exportar planilhas **não equivale a migrar a instalação**.
- Setup para banco/raiz novos e `npm run migrar` para instalações existentes.
- Modelos v2 registrados; v1 e aprovações/PDFs históricos preservados.

Fatias 5–7 implementadas; recursos extras não estão automaticamente autorizados.
A revisão integral de serviços/telas/setup/testes permanece aberta.

## Verificação da origem nesta etapa

| Item | Estado observado |
|---|---|
| Código de referência antes desta preparação | `c440237`; worktree inicialmente limpa |
| Runtime | Windows x64; Node 24.20.0 / npm 11.19.0 |
| Banco | PostgreSQL 16, serviço `postgresql-x64-16` ativo, escuta local e login restrito |
| Histórico | Completo, de `000-fundacao` até `023-modelos-oficiais` |
| Configuração/TLS/lista de senhas/PDF | Arquivos externos acessíveis e Chromium iniciado/encerrado pelo diagnóstico |
| Processo | Um formato configurado; conferir seu conteúdo institucional localmente |
| Aprovação v2 | Pendente nos quatro tipos; não foi registrada por esta preparação |
| API | Inicialmente sem listener; na verificação final, HTTPS/página/health 200 e rota privada 401, sem iniciar/parar processos nesta etapa |

Não se inferiu quantidade/ausência de dados operacionais a partir do histórico.
O diagnóstico não expõe pessoas, senhas ou chaves e não certifica integridade
dos arquivos/dados, ACLs ou confiança do navegador.

## Separação obrigatória de código e instalação

| Recurso | Local da instalação de origem |
|---|---|
| Configuração, inclusive chaves cifra/HMAC | `C:\ProgramData\SisDoc\instalacao\config\aplicacao.json` |
| Provisionamento de migração | `C:\ProgramData\SisDoc\provisionamento\banco.json` |
| PDFs | `pdf.diretorio` da configuração; se ausente, `C:\ProgramData\SisDoc\instalacao\pdf` |
| Certificado e chave TLS | Caminhos em `tls.certificado`, `tls.chave` e `tls.ca` |
| Lista de senhas comuns | Caminho em `seguranca.listaSenhas`; preservar licença da lista |
| Credencial opcional de sincronização | Caminho em `sincronizacao.credencialArquivo`, se configurado |

Não copie esses arquivos para o Git/checkout. Banco cifrado **depende das
chaves originais**, e os PDFs são arquivos separados. O SID da conta da
máquina antiga não configura a conta do destino. Reaplique ACLs locais.

## Requisitos para Windows Server

- Windows Server x64 com Desktop Experience e suporte de segurança vigente,
  NTFS local e espaço para banco, PDFs, cópia protegida e validação.
- Node.js **24 x64**, npm e PostgreSQL **16 x64** com ferramentas
  `psql`, `pg_dump`, `pg_restore`. Não trocar o major na mesma migração.
- PostgreSQL somente em loopback, UTF-8 e autenticação SCRAM-SHA-256.
- Conta instaladora autorizada e conta executora sem privilégios administrativos,
  distinta do login proprietário/migrador do banco.
- TLS local confiável no Windows e arquivos privados com ACLs restritas.
- Chromium Playwright instalado para a conta executora ou em cache compartilhado
  protegido. A pasta `chromium` criada pelo setup não o instala automaticamente.

Windows Server/Server Core, execução desassistida e concorrência no destino
**não estão certificados pela suíte executada na origem**. Server Core exige
validação específica antes de adotar este guia. Serviço Windows da aplicação,
backup agendado e restauração automatizada não estão implementados.
Nenhum acesso LAN, proxy, firewall ou recurso externo foi autorizado.

## Instalação nova versus migração completa

**Instalação nova:** provisionar banco/papéis/TLS/lista de senhas e uma raiz
inexistente; depois `npm ci`, instalar Chromium e executar `npm run setup`
em terminal interativo. O setup aplica até `023-modelos-oficiais`, gera
chaves novas e administrador com troca obrigatória. Não cria PostgreSQL,
banco, papéis, certificado, confiança Windows nem serviço da aplicação.
A aprovação institucional continua separada.
Se instalar Chromium em cache dentro da nova raiz, faça isso **após o setup**:
criar `instalacao\chromium` antes faria a raiz existir e o instalador recusaria.

**Migração completa (opção escolhida):** restaurar banco e arquivos/chaves
originais. **Não executar setup sobre a restauração.** Ele criaria outra
identidade criptográfica e foi projetado para banco/raiz vazios.
Seguir [Migração Windows Server](MIGRACAO_WINDOWS_SERVER.md), sem inicializar
uma segunda base operacional ou regenerar chaves.

## Diagnóstico e início

Na raiz do checkout já compilado, com a conta que executará a aplicação:

```powershell
$env:SISDOC_CONFIG = 'C:\ProgramData\SisDoc\instalacao\config\aplicacao.json'
npm run verificar-instalacao
```

O comando é somente leitura: verifica arquivos, TLS, Chromium, PostgreSQL,
papel e sequência completa de migrações; informa máscaras e aprovações de
template. Não instala, exporta, restaura, aprova ou inicia a API.
Código de saída diferente de zero exige corrigir a etapa indicada.
Saída zero **não autoriza emissão nem substitui o aceite da restauração**.

Para ligar, veja [Como ligar](COMO_LIGAR.md). Atualizações autorizadas exigem
parar a aplicação, preservar cópia consistente, compilar e aplicar apenas
migrações conhecidas com `npm run migrar`. O bootstrap exige a versão 023.
Regressão anterior e validações desta preparação: [Progresso](PROGRESSO.md).
