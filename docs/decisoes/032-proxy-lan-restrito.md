# Decisão 032 — Proxy Caddy com LAN restrita

## Escolha

Mantém-se o monólito SisDoc com banco e API em loopback (`127.0.0.1`), mas o
acesso de usuário passa a ser atendido pelo Caddy em HTTPS na interface LAN da
VM, com escopo de firewall restrito.

Configuração observada nesta etapa:
- API HTTPS em `127.0.0.1:3443`;
- Caddy HTTPS em `192.168.70.26:443`;
- `proxy.origemPublica` definido para `https://192.168.70.26`;
- regra de firewall de entrada liberando TCP/443 apenas no escopo de rede
  autorizado.

O proxy não deve reescrever `Origin` nem contornar validações CSRF. A API
continua validando origem HTTPS explícita e mantendo cookies seguros.

## Relação com decisões anteriores

Esta decisão substitui a restrição operacional de “somente localhost” descrita
na decisão 031, preservando seus princípios de segurança: upstream HTTPS,
validação de certificado, execução mínima de privilégios e separação de
configurações sensíveis fora do repositório.

## Evidência e limites

Validações desta etapa (somente leitura):
- `npm run verificar-instalacao` aprovado com histórico até migração 024;
- health em 200 e rota privada sem sessão em 401 no acesso direto e via proxy;
- Caddy e API executando como `NT AUTHORITY\LOCAL SERVICE`.

Pendências não encerradas por esta decisão:
- formalizar partida automática via serviços WinSW (atualmente processos
  diretos);
- concluir aceite funcional completo (login/troca inicial e operação assistida);
- aprovar formalmente os templates v2 por tipo (DOF, DTC IPAM, DTC
  Comissionado, DTC INSS).
