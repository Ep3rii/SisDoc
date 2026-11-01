/** Versões de saída que exigem aprovação própria; versões antigas continuam renderizáveis. */
export const TEMPLATES_OFICIAIS = Object.freeze({
  DOF: 'emissao-dof-2',
  DTC_IPAM: 'emissao-dtc-ipam-2',
  DTC_COMISSIONADO: 'emissao-dtc-comissionado-2',
  DTC_INSS: 'emissao-dtc-inss-2',
} as const);

export const ESTILO_MODELOS_OFICIAIS = `
@page{size:A4;margin:12mm 10mm 15mm}
*{box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:9pt;color:#000;background:#fff;line-height:1.25;margin:0;overflow-wrap:anywhere}
.pagina-modelo{width:100%;margin:0 auto}
.pagina-modelo+.pagina-modelo{break-before:page;page-break-before:always}
.cabecalho-modelo{text-align:center;margin-bottom:6pt}
.brasao{width:32pt;height:40pt;object-fit:contain}
.cabecalho-modelo p{margin:2pt 0;font-weight:700;font-size:10pt}
h1{font-size:10pt;text-align:center;margin:6pt 0 2pt}h2{font-size:9pt;text-align:center;margin:0}
h3{font-size:9pt;margin:0 0 4pt}
.fundamento{font-style:italic;font-weight:700;text-align:center;margin:0 0 6pt}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th,td{border:1px solid #000;padding:3pt;vertical-align:top;text-align:left}
th{text-align:center}
.rotulo{display:block;font-weight:700;font-size:8pt}
.valor{display:block;min-height:12pt;margin-top:3pt;white-space:pre-wrap}
.dados-modelo .valor{color:#00376d;font-weight:700}
.secao-titulo{font-weight:700;text-align:center;margin-top:16pt;padding:3pt}
.frequencia{font-size:7pt;margin-top:8pt}
.frequencia th,.frequencia td{padding:1pt 2pt;text-align:center;vertical-align:middle}
.frequencia td{text-align:right}
.dof-modelo{font-size:8pt;line-height:1.15}
.dof-modelo .rotulo{font-size:7pt}
.dof-modelo .valor{min-height:10pt;margin-top:2pt}
.dof-modelo .frequencia{font-size:6.5pt;line-height:1}
.dof-modelo .frequencia th,.dof-modelo .frequencia td{padding:.5pt 1pt}
.frequencia tr{break-inside:avoid;page-break-inside:avoid}
thead{display:table-header-group}
.nota{font-size:7pt;font-weight:700;border:1px solid #000;border-top:0;padding:5pt}
.ocorrencias{border:1px solid #000;min-height:455pt;padding:5pt}
.ocorrencias section{margin:0 0 16pt}
.texto-modelo{white-space:pre-wrap;overflow-wrap:anywhere;margin:4pt 0;line-height:1.45}
.declaracao-modelo{border:1px solid #000;border-top:0;padding:8pt;min-height:85pt;font-weight:700;font-size:8pt}
.assinaturas-modelo{break-inside:avoid;page-break-inside:avoid}
.assinaturas-modelo td{height:76pt;font-size:8pt;font-weight:700;position:relative}
.assinaturas-modelo .linha-assinatura{display:block;border-top:1px solid #000;text-align:center;margin-top:30pt;padding-top:2pt}
.assinaturas-modelo tr:last-child:not(:first-child) td{height:auto}
.local-modelo{margin-top:8pt;text-align:center;font-size:7pt}
.observacoes-modelo{min-height:108pt;border:1px solid #000;border-top:0;padding:5pt}
.observacoes-modelo h2{margin-bottom:5pt}
.sem-emendas{font-size:7pt;font-weight:700;margin:2pt 0}
.aviso-modelo{color:#7d1717;border:1px solid #7d1717;padding:4pt;margin:4pt 0;font-size:8pt}
.prova-modelo{font-size:7pt;margin:3pt 0}
.cargo-modelo td{height:32pt}
.dtc-formulario{font-size:8.5pt;line-height:1.15}
.dtc-formulario .rotulo{font-size:7pt;line-height:1.1}
.dtc-formulario .valor{min-height:9pt;margin-top:2pt}
.dtc-formulario .secao-titulo{margin-top:12pt}
.dtc-formulario .cargo-modelo td{height:22pt}
.dtc-formulario .cargo-modelo .valor{min-height:6pt}
.dtc-formulario .observacoes-modelo p{margin:3pt 0}
.periodos-modelo td{border:0;padding:2pt 1pt;vertical-align:middle;font-size:7pt}
.rotulo-periodo{width:50%}.separador-periodo{width:5%}
.dtc-formulario .assinaturas-modelo tr:first-child td{height:60pt}
.dtc-formulario .secao-titulo{margin-top:8pt}
.inss-modelo{font-family:Arial,sans-serif;font-size:10pt}
.inss-modelo .cabecalho-modelo{margin-bottom:18pt}
.inss-modelo .secao-titulo{margin-top:22pt}
.inss-periodos td{height:65pt;vertical-align:middle}
.inss-periodos th{vertical-align:middle}
.categorias{font-size:8pt;line-height:1.4;white-space:pre-line}
.adicionais-modelo td{vertical-align:middle}
.adicionais-modelo td:first-child{width:28%;text-align:center}
.licencas-modelo{min-height:180pt;line-height:1.8}
.documentacao-modelo{min-height:125pt;line-height:1.5}
.responsabilidade{margin-top:16pt}
.responsabilidade td{height:105pt}
.responsabilidade tr:first-child td{height:auto}
.demonstrativo-modelo{margin-top:16pt}
@media screen{body{padding:12px}.pagina-modelo{max-width:760px}.pagina-modelo+.pagina-modelo{margin-top:24px;border-top:1px dashed #777;padding-top:12px}}
`;
