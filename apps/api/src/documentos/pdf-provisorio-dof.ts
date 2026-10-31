import { dadosPdfProvisorioDofSchema, type DadosPdfProvisorioDof } from '@sisdoc/contratos';
import { renderizarPreviaDof } from '@sisdoc/templates';
import type { Browser } from 'playwright';

const cabecalho = '<div style="width:100%;text-align:center;font:8px Arial,sans-serif;color:#555">PRÉVIA PROVISÓRIA — SEM VALIDADE OFICIAL</div>';
const rodape = '<div style="width:100%;text-align:center;font:8px Arial,sans-serif;color:#555">Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>';

export async function renderizarPdfProvisorioDof(
  navegador: Browser, entrada: DadosPdfProvisorioDof,
): Promise<Buffer> {
  const dados = dadosPdfProvisorioDofSchema.parse(entrada);
  const contexto = await navegador.newContext({ javaScriptEnabled: false, acceptDownloads: false });
  let pdf: Buffer;
  try {
    await contexto.route('**/*', (rota) => rota.abort('blockedbyclient'));
    const pagina = await contexto.newPage();
    await pagina.setContent(renderizarPreviaDof(dados), { waitUntil: 'load', timeout: 10000 });
    await pagina.emulateMedia({ media: 'print' });
    pdf = await pagina.pdf({
      format: 'A4',
      margin: { top: '16mm', right: '9mm', bottom: '16mm', left: '9mm' },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: cabecalho,
      footerTemplate: rodape,
      tagged: true,
    });
  } catch (erro) {
    try {
      await contexto.close();
    } catch (erroFechamento) {
      throw new AggregateError([erro, erroFechamento], 'Falha ao gerar o PDF provisório e encerrar seu contexto.');
    }
    throw erro;
  }
  await contexto.close();
  return pdf;
}
