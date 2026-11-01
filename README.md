# SisDoc

Sistema local para agilizar a busca de dados funcionais e a preparação de
declarações: DOF, DTC IPAM, DTC Comissionado e DTC INSS.

Destinado ao setor de Cadastro (analista/coordenador), com dados de referência
completos para DOF/DTC. O administrador da Informática tem acesso funcional
para revisão e operação de documentos existentes, mas não os cria.
A tela Importação reúne importação e exportação CSV/XLSX, com seleção de
schema Núcleo/Legado; Sincronização é separada. O cadastro é editado no
núcleo local com auditoria
([decisão 027](docs/decisoes/027-administracao-documentos-cadastro-legado.md)).

O assistente de Legado permite conferir colunas/valores, validar a conversão e
aplicar dados aceitos ao Núcleo para DOF/DTC, preservando valores existentes e
edições manuais. Dados de trabalho são exibidos completos a todos os perfis
autenticados; permissões de alteração/exportação permanecem separadas.
Veja [decisão 028](docs/decisoes/028-legado-operacional-e-conferencia.md).

**Autorizado para uso operacional local em 31/10/2026** ([decisão 021](docs/decisoes/021-autorizacao-operacional.md)),
nas funções existentes: consulta de servidores, cálculo, rascunhos, prévia e
conferência da DOF. As versões anteriores de emissão foram aprovadas em
31/10/2026 ([decisão 022](docs/decisoes/022-aprovacao-formal-e-emissao.md)).
Os novos formulários DOF/DTC seguem as referências oficiais locais, mas
**emissões v2 aguardam aprovação formal própria por tipo**; aprovações
anteriores e PDFs históricos foram preservados. Prévias novas estão
disponíveis sem validade oficial
([decisão 029](docs/decisoes/029-modelos-oficiais-versionados.md)). A
importação de planilhas e da base legada está disponível ao administrador
([dados e importação](docs/DADOS_E_IMPORTACAO.md)); backup e serviço
automático da aplicação ainda não estão implementados.

## Estado atual

- PostgreSQL permanente em loopback, banco `sisdoc` e papéis separados.
- HTTPS local com certificado confiável no Windows.
- Administrador inicial com troca obrigatória de senha; dados são carregados
  apenas por usuário autorizado (a existência de dados depende da instalação).
- Autenticação, usuários, auditoria, busca e fluxo provisório de rascunhos DOF.
- Lista inicial de servidores por matrícula em ordem natural crescente,
  50 vínculos por página, com CPF completo e busca por nome/CPF/matrícula.
- Layout inspirado no [protótipo](Modelos%20e%20Documentação/prototipo_SistemaWEB.jpeg):
  menu lateral, busca global, abas, editor com prévia à direita e totais fixos.
- Modelos de saída v2 cadastrados pela migração `023-modelos-oficiais`,
  sem aprovação automática; renderizadores v1 e PDFs antigos preservados.
- Sincronização opcional, configurada fora do Git;
  nenhuma fonte é alterada pela edição de rascunhos.

## Instalação e migração

- **Outra máquina, preservando a instalação:** siga
  [Migração completa para Windows Server](docs/MIGRACAO_WINDOWS_SERVER.md).
  Banco, configuração/chaves e PDFs precisam da mesma captura; não execute setup.
- **Instalação vazia:** siga [Requisitos e instalação](docs/INSTALACAO_LOCAL.md)
  e [Operação](docs/OPERACAO.md). `npm run setup` não instala PostgreSQL/TLS,
  não cria banco/papéis e não registra aprovação formal.
- **Uso diário:** [Como ligar](docs/COMO_LIGAR.md). HTTPS somente em loopback;
  não volta automaticamente após reiniciar o Windows.

Na raiz do checkout já compilado, com a conta executora:

```powershell
$env:SISDOC_CONFIG = 'C:\ProgramData\SisDoc\instalacao\config\aplicacao.json'
npm run verificar-instalacao
if ($LASTEXITCODE -ne 0) { throw 'Corrija o diagnóstico antes de iniciar.' }
npm start
```

Se usar cache Chromium compartilhado, mantenha `PLAYWRIGHT_BROWSERS_PATH`
igual na instalação, diagnóstico e início. O diagnóstico não exporta dados,
aplica migrações ou autoriza emissão. Atualizações de schema exigem serviço
parado e cópia consistente; `npm run migrar` usa o provisionamento externo,
não transfere a instalação. O release atual exige `023-modelos-oficiais`.
A aprovação formal da regra e do template, quando houver, é registrada por
tipo com `npm run aprovar-modelo -- DOF|DTC_IPAM|DTC_COMISSIONADO|DTC_INSS`; veja [operação](docs/OPERACAO.md). Não inicie outra
cópia enquanto a porta estiver ocupada. Configuração, senhas, certificados e
chaves ficam fora do Git; não publique nem cole seus conteúdos em logs.

## Desenvolvimento e testes

Node.js 24, npm e PostgreSQL 16. Em um novo checkout:

```powershell
npm ci
npx playwright install chromium
npm run typecheck
npm test
```

Os testes usam dados sintéticos e recursos descartáveis, nunca o banco
configurado da instalação. No Windows, checkout e temporários precisam de
caminhos ASCII ou 8.3; consulte [operação](docs/OPERACAO.md).

## Documentação

- [Pontos de memória e recapitulação rápida para agentes](docs/ia/RECAPITULACAO.md).
- [Arquitetura, revisão estrutural e etapas de modularização](docs/ARQUITETURA.md).
- [Avaliação técnica de UI/UX e melhorias por tela](docs/AVALIACAO_UI_UX.md).

- [Manual resumido: como ligar a aplicação](docs/COMO_LIGAR.md).
- [Instalação local e próximas etapas](docs/INSTALACAO_LOCAL.md).
- [Migração completa e aceite no Windows Server](docs/MIGRACAO_WINDOWS_SERVER.md).
- [Operação, controles e uso da interface](docs/OPERACAO.md).
- [Dados e importação](docs/DADOS_E_IMPORTACAO.md).
- [Progresso e evidências de verificação](docs/PROGRESSO.md).
- [Contexto e convenções de construção](docs/ia/CONTEXTO.md).
- [Guia descritivo das declarações](Modelos%20e%20Documentação/guia_descritivo_declaracoes_funcionais_e_tempo_contribuicao.md).

Monorepo TypeScript: API NestJS em `apps/api`, interface React/Vite em
`apps/web`, contratos Zod, motor de cálculo e templates em `packages`.
O backend serve o build da interface por HTTPS somente em `127.0.0.1`.
