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
conferência da DOF. A emissão da DOF e das DTCs IPAM, Comissionado e INSS
(numeração, PDF, histórico, cópia e cancelamento) está **liberada desde
31/10/2026**, após o registro da aprovação formal de cada tipo
([decisão 022](docs/decisoes/022-aprovacao-formal-e-emissao.md)). O modelo
INSS continua provisório e sai marcado como tal
([decisão 023](docs/decisoes/023-dtc-ipam-comissionado-inss.md)). A
importação de planilhas e da base legada está disponível ao administrador
([dados e importação](docs/DADOS_E_IMPORTACAO.md)); backup e serviço
automático da aplicação ainda não estão implementados.

## Estado atual

- PostgreSQL permanente em loopback, banco `sisdoc` e papéis separados.
- HTTPS local com certificado confiável no Windows.
- Administrador inicial com troca obrigatória de senha; dados reais ainda
  não importados (use `npm run importacao` ou a tela **Importação**).
- Autenticação, usuários, auditoria, busca e fluxo provisório de rascunhos DOF.
- Lista inicial de servidores por matrícula em ordem natural crescente,
  50 vínculos por página, com CPF completo e busca por nome/CPF/matrícula.
- Layout inspirado no [protótipo](Modelos%20e%20Documentação/prototipo_SistemaWEB.jpeg):
  menu lateral, busca global, abas, editor com prévia à direita e totais fixos.
- Emissão da DOF e das DTCs aprovada formalmente por tipo (o INSS com
  textos provisórios); sincronização opcional, configurada fora do Git;
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

- [Instalação local e próximas etapas](docs/INSTALACAO_LOCAL.md).
- [Operação, controles e uso da interface](docs/OPERACAO.md).
- [Dados e importação](docs/DADOS_E_IMPORTACAO.md).
- [Progresso e evidências de verificação](docs/PROGRESSO.md).
- [Contexto e convenções de construção](docs/ia/CONTEXTO.md).
- [Guia descritivo das declarações](Modelos%20e%20Documentação/guia_descritivo_declaracoes_funcionais_e_tempo_contribuicao.md).

Monorepo TypeScript: API NestJS em `apps/api`, interface React/Vite em
`apps/web`, contratos Zod, motor de cálculo e templates em `packages`.
O backend serve o build da interface por HTTPS somente em `127.0.0.1`.
