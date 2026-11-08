/** Formata datas ISO para tabelas sem deslocar datas civis por fuso horário. */
export function dataTabela(valor: string | null | undefined): string {
  if (!valor) return '—';
  const dataCivil = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (dataCivil) return `${dataCivil[3]}/${dataCivil[2]}/${dataCivil[1]}`;

  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return valor;
  return data.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}
