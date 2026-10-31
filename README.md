# SisDoc

Sistema local para agilizar a busca de dados funcionais e a preparação de
declarações: DOF, DTC IPAM, DTC Comissionado e DTC INSS.

**Autorizado para uso operacional local em 31/10/2026** ([decisão 021](docs/decisoes/021-autorizacao-operacional.md)),
nas funções existentes: consulta de servidores, cálculo, rascunhos, prévia e
conferência da DOF. A emissão da DOF com numeração, PDF, histórico, cópia e
cancelamento está implementada, mas **bloqueada até a aprovação formal** da
regra e do template ([decisão 022](docs/decisoes/022-aprovacao-formal-e-emissao.md)).
DTCs, importação das fontes, backup e serviço automático da aplicação ainda
não estão implementados.

## Estado atual

- PostgreSQL permanente em loopback, banco `sisdoc` e papéis separados.
- HTTPS local com certificado confiável no Windows.
- Administrador inicial com troca obrigatória de senha; banco sem pessoas
  importadas.
- Autenticação, usuários, auditoria, busca e fluxo provisório de rascunhos DOF.
- Layout inspirado no [protótipo](Modelos%20e%20Documentação/prototipo_SistemaWEB.jpeg):
  menu lateral, busca global, abas, editor com prévia à direita e totais fixos.
- Emissão da DOF dependente de aprovação formal; sincronização indisponível;
  nenhuma fonte é alterada pela edição de rascunhos.

## Acesso à instalação desta máquina

Endereço: **https://localhost:3443/**. A aplicação foi iniciada manualmente e
não volta automaticamente após reiniciar o Windows.

Para iniciar novamente, execute na raiz deste repositório, sem executar setup:

```powershell
$env:SISDOC_CONFIG = 'C:\ProgramData\SisDoc\instalacao\config\aplicacao.json'
npm start
```

Se o código mudou, pare a aplicação, execute `npm run build` e
`npm run migrar` (aplica só migrações pendentes, com o papel de migração
lido de `C:\ProgramData\SisDoc\provisionamento\banco.json`) antes de iniciar.
A aprovação formal da regra e do template, quando houver, é registrada com
`npm run aprovar-modelo`; veja [operação](docs/OPERACAO.md). Não inicie outra
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

- [Instalação local e próximas etapas](docs/INSTALACAO_LOCAL.md).
- [Operação, controles e uso da interface](docs/OPERACAO.md).
- [Progresso e evidências de verificação](docs/PROGRESSO.md).
- [Contexto e convenções de construção](docs/ia/CONTEXTO.md).
- [Guia descritivo das declarações](Modelos%20e%20Documentação/guia_descritivo_declaracoes_funcionais_e_tempo_contribuicao.md).

Monorepo TypeScript: API NestJS em `apps/api`, interface React/Vite em
`apps/web`, contratos Zod, motor de cálculo e templates em `packages`.
O backend serve o build da interface por HTTPS somente em `127.0.0.1`.
