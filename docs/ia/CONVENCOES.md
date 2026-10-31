# Convenções

- Stack: Node.js 24.20.0 nesta máquina, TypeScript, NestJS, React/Vite,
  PostgreSQL 16, Zod, Vitest e Playwright/Chromium. Não substituir ferramentas
  globais nem introduzir Docker, Redis, microsserviços, CI ou SSO.
- Estrutura: `apps/api`, `apps/web`, `packages/calculo`, `packages/templates`,
  `packages/contratos`, `tools/`, `scripts/`, `docs/` e `referencias/`.
  O backend serve o build do frontend.
- API interna em `/api/v1`, erros Problem Details, paginação por cursor e
  limite máximo de 50. Rotas funcionais exigem autenticação e autorização.
- Datas funcionais são datas sem hora; timestamps operacionais têm fuso.
  Preservar matrícula original, normalizada, sufixo e origem.
- Validação e mensagens de erro são explícitas e acionáveis em português.
  Não ocultar dados ausentes, falhas de infraestrutura ou regras indefinidas.
- Templates, regras e blocos são versionados; snapshot registra suas versões.
  Texto oficial ausente não deve ser inventado.
- Testes usam PostgreSQL e arquivos descartáveis quando necessários e nunca
  chamam fontes reais. Verificar os limiares e fluxos completos exigidos,
  não apenas presença de componentes.
- Git local em `main`; commits pequenos em português após testes e varredura
  de segredos, com tag ao fim de cada fatia quando o gate estiver verde.
- Comentários de domínio explicam regras não óbvias e citam a seção pertinente
  do documento de regras. Decisões divergentes ficam em `docs/decisoes/`.
