# Invariantes

- A emissão operacional exige autorização, dados conferidos e regra e template
  aprovados; aviso ou configuração não transforma material provisório em oficial.
- O cálculo recebe suas entradas, inclusive data de referência, e não acessa
  relógio, banco ou rede. Ajustes pertencem ao documento, nunca à fonte.
- Pessoas não são apagadas por ausência na API; remoção lógica só ocorre após
  reconciliação completa confiável. Importações e sincronizações são rastreáveis
  e idempotentes, sem resolver duplicidades ou vínculos ambíguos em silêncio.
- Número, snapshot e job de PDF são gravados atomicamente com idempotência.
  PDF é produzido após o commit; falha posterior reprocessa o mesmo job e
  número. Cancelamento preserva registro e número.
- Dados pessoais, segredos e certificados não entram no Git, em logs ou em
  serviços externos não autorizados. Fixtures são inteiramente fictícias.
- CPF é normalizado, cifrado e pesquisado por HMAC; demais identificadores
  exigidos são cifrados. Snapshots, staging, relatórios e backups também devem
  ser protegidos. Chaves ficam fora do banco e do repositório.
- Senhas usam Argon2id, mínimo de 12 caracteres e verificação local contra
  senhas comuns; cinco falhas bloqueiam por 15 minutos. Mensagem de falha é
  única. Sessões são mantidas no servidor, revogáveis, com cookie `__Host-`
  seguro e CSRF nas escritas autenticadas.
- Permissões são verificadas no servidor pela matriz do prompt; admin técnico
  não recebe acesso funcional por hierarquia. Consultas e ações sensíveis são
  auditadas; a aplicação não altera ou apaga registros de auditoria.
- Entrada é validada no servidor; HTML é escapado e prévia não executa scripts.
  Dados pessoais não são guardados em `localStorage` ou `sessionStorage`.
- Banco e backend escutam apenas em loopback; acesso operacional é HTTPS
  confiável. Serviços, firewall e fontes reais não são alterados sem autorização.
- Não se executam testes destrutivos, seeds fictícios ou ensaios de restauração
  sobre a base operacional.
