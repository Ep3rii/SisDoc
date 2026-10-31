# Modelo de dados

O modelo canônico separa pessoa, vínculo e eventos. As tabelas usam UUID para
entidades, datas funcionais sem hora e timestamps operacionais com fuso.
Campos, índices, restrições e regras detalhadas estão no anexo A.2 do prompt.

- `nucleo`: pessoa, vínculo, evento funcional, afastamento, incorporação,
  período IPAM, lote de sincronização e staging da API. Dados sincronizados
  preservam origem, identificador, hash, instante e remoção na fonte.
- `documentos`: documento, períodos, cargos comissionados, blocos e suas
  versões, versões de templates, numeração, emissão, job de PDF e ajustes
  justificados. Metadados do artefato PDF são associados ao job/emissão,
  sem alterar o snapshot. A conferência da DOF fica em `conferencia_dof`; a
  das DTCs em `conferencia_dtc`/`devolucao_conferido_dtc` (decisão 023), e
  `documento_periodo` guarda também `categoria` e `cargo` (DTC INSS).
  Aprovação formal e numeração são por tipo de documento.
- `seguranca`: usuário, sessão e auditoria append-only. Sessões armazenam hash,
  não o identificador opaco; o acesso ao banco segue menor privilégio.
- `legado`: cópia fiel importada, com lote e origem; tradução para o modelo
  canônico sem mutação funcional da fonte.

CPF normalizado é cifrado e seu HMAC é único. Matrícula é preservada original
e normalizada; as chaves de vínculo incluem origem. Datas ou campos ausentes
não podem ser inventados. Documento emitido conserva os dados e versões do
snapshot mesmo após mudanças na fonte.
