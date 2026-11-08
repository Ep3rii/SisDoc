import { abaDocumentosSchema, type AbaDocumentos, type TipoDtc } from '@sisdoc/contratos';

export type Tela = 'busca' | 'dofs' | 'dtcs' | 'historico' | 'usuarios' | 'auditoria' | 'sincronizacao' | 'importacao';
export type Rota = { tela: Tela; aba: AbaDocumentos; tipo?: TipoDtc };
export const telaAdministrativa = (tela: Tela) => ['usuarios', 'auditoria', 'sincronizacao', 'importacao'].includes(tela);
const aliases: Record<string, AbaDocumentos> = {
  rascunhos: 'rascunhos', 'dofs-conferidas': 'conferidas', conferidos: 'conferidas',
  encaminhados: 'encaminhadas', 'todos-os-encaminhados': 'encaminhadas', 'todos-encaminhados': 'encaminhadas', 'encaminhados-a-mim': 'encaminhadas',
  retornos: 'devolvidas', 'retornos-para-ajustes': 'devolvidas',
};

export function lerRota(hash: string): Rota {
  const [caminho, parametros = ''] = hash.replace(/^#\/?/, '').split('?');
  const partes = caminho.toLowerCase().split('/').filter(Boolean);
  const base = partes[0];
  if (aliases[base]) return { tela: 'dofs', aba: aliases[base] };
  if (base === 'dtc_ipam' || base === 'dtc_comissionado' || base === 'dtc_inss') {
    return { tela: 'dtcs', aba: 'rascunhos', tipo: base === 'dtc_ipam' ? 'DTC_IPAM' : base === 'dtc_inss' ? 'DTC_INSS' : 'DTC_COMISSIONADO' };
  }
  if (base === 'dofs' || base === 'dtcs') {
    const aba = abaDocumentosSchema.safeParse(aliases[partes[1]] ?? partes[1] ?? 'rascunhos');
    const tipo = new URLSearchParams(parametros).get('tipo');
    return { tela: base, aba: aba.success ? aba.data : 'rascunhos',
      ...(base === 'dtcs' && (tipo === 'DTC_IPAM' || tipo === 'DTC_COMISSIONADO' || tipo === 'DTC_INSS') ? { tipo } : {}) };
  }
  if (base === 'administracao') {
    const tela = partes[1];
    return { tela: tela === 'auditoria' || tela === 'importacao' || tela === 'sincronizacao' ? tela : 'usuarios', aba: 'rascunhos' };
  }
  return { tela: base === 'historico' ? 'historico' : 'busca', aba: 'rascunhos' };
}

export function hashRota(rota: Rota): string {
  if (rota.tela === 'dofs' || rota.tela === 'dtcs') {
    return `#/${rota.tela}/${rota.aba}${rota.tela === 'dtcs' && rota.tipo ? `?tipo=${rota.tipo}` : ''}`;
  }
  return telaAdministrativa(rota.tela) ? `#/administracao/${rota.tela}` : `#/${rota.tela === 'busca' ? 'inicio' : rota.tela}`;
}
