# Decisão 011 — Verificação preliminar de DOF

## Contexto e escolha

A consulta de pendências não é uma conferência. Apenas o autor ou o
coordenador destinatário do encaminhamento pode executá-la; o destinatário
continua sem acesso de edição. A resposta identifica revisão, instante,
bloqueios e avisos e informa explicitamente que a conferência não está
disponível. A consulta é auditada sem registrar CPF ou conteúdo dos blocos.
A interface descarta o resultado quando existem alterações locais ou quando
a revisão muda e rejeita uma resposta recebida para outra revisão.

São verificadas a integridade e consistência do CPF protegido e de seu HMAC,
a matrícula normalizada e a duplicidade entre vínculos ativos, situação de
remoção, admissão, nascimento posterior à admissão, período persistido,
versão de regra, recálculo, processo e máscaras atuais. Início anterior à
admissão permanece bloqueado sem a confirmação específica descrita na
[decisão 012](012-confirmacao-inicio-dof.md). O parser usado pela prévia também detecta variáveis sem
valor e expressões malformadas em blocos ativos. Campos presentes na
referência, mas ainda sem obrigatoriedade institucional definida, geram aviso.
Para o nome da mãe é verificada somente a presença do campo cifrado; seu
conteúdo e integridade não são validados. O vínculo sem data, antigo ou com
data futura gera aviso. A consulta não verifica todas as datas de origem da
pessoa nem confronta automaticamente afastamentos e incorporações.

O documento é bloqueado para leitura e a fonte é relida após a obtenção do
bloqueio. A migração `008-preconferencia-dof` instala gatilhos por comando em
`nucleo.pessoa` e `nucleo.vinculo`; cada escrita nessas tabelas adquire bloqueio
advisory transacional exclusivo global. A consulta tenta a versão compartilhada
sem esperar e retorna conflito se houver escrita em curso. Isso também impede
que uma matrícula duplicada seja inserida enquanto a consulta a verifica, sem
conceder escrita funcional à aplicação. O resultado é pontual, não uma reserva:
alterações posteriores exigem nova verificação.

O bloqueio global pode reduzir a concorrência de futuras importações ou
sincronizações, inclusive para registros não relacionados ao documento.
Seu desempenho, tratamento de falhas e protocolo de ordenação devem ser
reavaliados ao implementar esses recursos. O protocolo não protege outras
tabelas de fonte e não resolve a concorrência entre sincronização e gravação
de rascunhos descrita na decisão 007. O setup aplica a migração apenas a banco
novo; não há procedimento autorizado para atualizar uma instalação existente.

## Evidência e limites

Testes sintéticos em HTTPS e PostgreSQL descartáveis cobrem permissões,
identidade, regra incompatível, recálculo divergente, máscaras, bloqueio
concorrente de escritor e inserção de matrícula duplicada. A interface foi
exercitada em Chromium com API simulada, incluindo invalidação de resposta
obsoleta. A prévia com 45 anos, 200 blocos, 20.000 caracteres e milhares de
delimitadores malformados foi medida localmente abaixo de um segundo.
Não houve teste integrado com certificado operacional confiável nem revisão
humana. A verificação não substitui aprovação institucional ou conferência;
a emissão continua indisponível.
