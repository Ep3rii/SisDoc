# Decisão 029 — Modelos de saída locais e versões de emissão

## Autorização e referência

Em 01/11/2026 o responsável indicou `Modelos e Documentação/imagens modelo`
como referência oficial de saída e autorizou aplicar os modelos aos
templates/prévias, validar e publicar. Também autorizou o cadastro das novas
versões em produção, **mantendo aprovação formal separada**.

As imagens completas permanecem ignoradas pelo Git: contêm exemplos de
documentos e não são fixtures. Apenas o brasão municipal do cabeçalho,
sem dados pessoais, foi recortado para incorporação no HTML sem rede.
Textos e exemplos pessoais dos documentos não foram copiados ao código.

## Formulários

- **DOF:** cabeçalho e brasão; identificação em grade; frequência com
  cabeçalhos agrupados para deduções, incorporações e tempo; nota das
  licenças; segunda página com blocos de ocorrências, declaração e três
  campos de assinatura.
- **DTC IPAM / Anexo III:** órgão emitente/CNPJ, dados pessoais, cargo,
  períodos/total, responsabilidade, visto, local/data e observações IPAM.
- **DTC Comissionado / Anexo VIII:** mesma base, atos de nomeação/exoneração
  por cargo, períodos e observações após a área de assinatura.
- **DTC INSS:** formulário RGPS com identificação e categorias por período;
  segunda página com licenças, documentação, observações e responsabilidade.
  Campos marcados vêm do conteúdo salvo, nunca das marcações do exemplo.
- **Demonstrativo DTC:** cálculo anual e totais permanecem disponíveis como
  anexo separado. Uma entrada nominal gera duas páginas para IPAM/Comissionado
  (formulário + anexo), três para INSS (duas + anexo). A DOF de 45 anos
  fictícia validada ocupa duas páginas. Conteúdo extenso pode gerar mais
  folhas; não há corte, escala global forçada nem limitação a duas páginas.

Datas, números, pessoas, cargo, períodos, deduções, blocos e marcações
continuam dinâmicos. O campo **Classe** da referência DOF fica vazio:
não existe fonte contratada para preenchê-lo; não se infere a classe a
partir de nível/referência. O cálculo e avisos de regras provisórias não
foram alterados nem formalmente aprovados por esta mudança de desenho.

## Versões e compatibilidade

A migração `023-modelos-oficiais` cadastra somente:

| Tipo | Nova versão |
|---|---|
| DOF | `emissao-dof-2` |
| DTC IPAM | `emissao-dtc-ipam-2` |
| DTC Comissionado | `emissao-dtc-comissionado-2` |
| DTC INSS | `emissao-dtc-inss-2` |

Templates e aprovações anteriores permanecem imutáveis. Os renderizadores
v1 foram preservados e selecionados pela versão registrada no snapshot;
PDFs antigos não são regravados. Versão desconhecida falha explicitamente.
Os modelos v2 são selecionados nas novas emissões e na CLI de aprovação.
A aprovação de um template v1 **não autoriza** seu equivalente v2, nem a
aprovação de um tipo autoriza outro.

As prévias utilizam os novos formulários imediatamente, mas conservam a
marca sem validade oficial, revisão salva, avisos e prova de fonte fora
do corpo. Não simulam número, data de emissão ou assinatura.

## Publicação e aprovação

Frontend, templates e API devem ser publicados juntos. A CSP autoriza o
CSS fixo por SHA-256 e imagens locais/data para o brasão; scripts e estilos
arbitrários continuam bloqueados no sandbox.

Com o serviço parado, o responsável executa `npm run migrar`; esta etapa
foi autorizada e não inclui cargas, edição de pessoas, documentos, números
ou aprovação. Depois da validação formal pela área responsável:

```powershell
npm run aprovar-modelo DOF
npm run aprovar-modelo DTC_IPAM
npm run aprovar-modelo DTC_COMISSIONADO
npm run aprovar-modelo DTC_INSS
```

Esses comandos são interativos e registram aprovação permanente.
**Não foram executados automaticamente nesta mudança.**
Emissões novas permanecem bloqueadas até aprovação específica. Consulta,
rascunhos, prévias, conferência e download de PDFs existentes continuam
disponíveis. Aprovações antigas e marca provisória INSS v1 são históricas,
não autorização nem marca do novo formulário.

## Evidências

`tests/modelos-oficiais.test.ts`: 12 casos aprovados cobrindo seleção v1,
recusa de versão desconhecida, prévias sem número/data, variáveis inválidas,
brasão carregado sem rede, escape e geometria/paginação A4 dos quatro tipos.
Regressões HTTPS/banco/PDF e editores verificam aprovação própria e
conteúdo nos limites; estado final em [Progresso](../PROGRESSO.md).
