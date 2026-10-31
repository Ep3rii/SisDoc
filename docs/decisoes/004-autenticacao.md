# Decisão 004 — Autenticação e perfis

## Implementação e decisões

A migração `002-autenticacao` cria armazenamento para limites de tentativas
por IP e matrícula, obriga unicidade de matrículas de usuários normalizadas
por espaço e caixa e concede apenas as colunas de usuário necessárias à
autenticação e administração. As sessões podem ser inseridas, atualizadas e
revogadas pelo papel da aplicação; dados funcionais e emissões continuam sem
privilégio de escrita. A migração é transacional e pode falhar sem apagar
usuários preexistentes.

A matriz separa permissões por ação, sem hierarquia implícita de administrador.
Para edição de rascunho, exige autoria; para conferir ou emitir documento de
terceiro, o coordenador precisa recebê-lo encaminhado. Cancelamento de
rascunho segue a regra do autor habilitado ou coordenador. Essa interpretação
conservadora é provisória até a decisão sobre autoria e encaminhamento.

A autenticação usa Argon2id e mensagem única para credenciais inválidas.
São permitidas cinco falhas por matrícula e 20 por IP em janela de 15 minutos;
os identificadores dos limites são HMACs com separação de domínio. O bloqueio
por IP foi escolhido como limite adicional provisório, não como requisito de
proxy: o endereço obtido é o da conexão direta e cabeçalhos encaminhados não
são confiados.

Cada login cria token aleatório de 256 bits, armazena somente seu SHA-256 e
revoga o token anterior apresentado. Sessões expiram após 30 minutos de
inatividade ou oito horas; logout, alteração de perfil, desativação e
redefinição de senha revogam as sessões pertinentes. O cookie tem prefixo
`__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax` e `Path=/`. O CSRF é derivado
por HMAC da sessão com separação de domínio e permanece em memória na
interface. Escritas autenticadas exigem token e origem HTTPS configurada;
login também verifica a origem. Não há configuração segura de proxy ainda.

Rotas sem política são negadas por padrão; health e login são públicos de
forma explícita. A administração verifica novamente a sessão na transação,
serializa mudanças de administradores e impede desativar ou rebaixar o último
administrador ativo. A senha inicial é temporária e não há liberação de outras
rotas até sua troca. A lista local é obrigatória para alterar ou criar senhas.

Eventos administrativos e de acesso negado são auditados sem senhas, tokens
ou corpos de requisição. A consulta de auditoria retorna somente dados
minimizados e identifica o alvo apenas quando a entidade é um usuário; não
retorna identificadores de pessoas ou detalhes livres. A matriz foi testada
para todos os perfis e, nas rotas existentes, com chamadas HTTPS negativas.
As futuras rotas funcionais precisam aplicar ações e autoria e revalidar a
autorização na própria transação quando houver mutação.

A validação HTTPS foi feita com CA, nome, banco e contas descartáveis. O fluxo
da interface foi testado no navegador com API simulada; não foi demonstrado um
fluxo completo de navegador com CA operacional. A revisão humana, segurança
de proxy, limitação sob carga e a limpeza/retensão da tabela de limites
permanecem pendentes. Não há procedimento autorizado de atualização de
instalações anteriores.
