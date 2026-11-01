/** Escapa caracteres HTML em texto e atributos antes de inserir valores no documento. */
export function escapar(valor: string | number): string {
  return String(valor).replace(/[&<>"']/g, (caractere) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[caractere] ?? caractere);
}

/** Converte a data ISO já validada pelo contrato para dia/mês/ano, sem conversão de fuso horário. */
export function data(dataIso: string): string {
  const [ano, mes, dia] = dataIso.split('-');
  return `${dia}/${mes}/${ano}`;
}

/** Escapa campo informado e mantém espaço não separável para valores vazios do modelo impresso. */
export function campo(valor: string | null | undefined): string {
  return valor?.trim() ? escapar(valor) : '&nbsp;';
}
