import { dataFuncionalSchema } from '@sisdoc/contratos';

const formatadorSaoPaulo = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo', calendar: 'gregory', numberingSystem: 'latn',
  era: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function dataEmSaoPaulo(instante: Date): string {
  if (!Number.isFinite(instante.getTime())) throw new Error('O instante informado é inválido.');
  const partes = formatadorSaoPaulo.formatToParts(instante);
  const ano = partes.find((parte) => parte.type === 'year')?.value;
  const mes = partes.find((parte) => parte.type === 'month')?.value;
  const dia = partes.find((parte) => parte.type === 'day')?.value;
  const era = partes.find((parte) => parte.type === 'era')?.value;
  if (!ano || !mes || !dia || era !== 'AD' || ano.length > 4) {
    throw new Error('A data local está fora do intervalo permitido.');
  }
  const data = dataFuncionalSchema.safeParse(`${ano.padStart(4, '0')}-${mes}-${dia}`);
  if (!data.success) throw new Error('A data local está fora do intervalo permitido.');
  return data.data;
}
