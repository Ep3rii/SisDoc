import { snapshotEmissaoDofSchema, type SnapshotEmissaoDof } from '@sisdoc/contratos';
import { renderizarEmissaoDof } from '@sisdoc/templates';
import type { Browser } from 'playwright';

const rodape = '<div style="width:100%;text-align:center;font:8px Arial,sans-serif;color:#333">Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>';

export async function renderizarPdfEmissaoDof(navegador: Browser, entrada: SnapshotEmissaoDof): Promise<Buffer> {
  const dados = snapshotEmissaoDofSchema.parse(entrada);
  const html = renderizarEmissaoDof(dados);
  const contexto = await navegador.newContext({ javaScriptEnabled: false, acceptDownloads: false });
  let pdf: Buffer;
  try {
    await contexto.route('**/*', (rota) => rota.abort('blockedbyclient'));
    const pagina = await contexto.newPage();
    await pagina.setContent(html, { waitUntil: 'load', timeout: 10000 });
    await pagina.emulateMedia({ media: 'print' });
    pdf = await pagina.pdf({
      format: 'A4',
      margin: { top: '14mm', right: '12mm', bottom: '16mm', left: '12mm' },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: rodape,
      tagged: true,
    });
  } catch (erro) {
    try {
      await contexto.close();
    } catch (erroFechamento) {
      throw new AggregateError([erro, erroFechamento], 'Falha ao gerar o PDF da emissão e encerrar seu contexto.');
    }
    throw erro;
  }
  await contexto.close();
  return pdf;
}
