import { TEMPLATES_OFICIAIS } from '@sisdoc/templates';
import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_MODELOS_OFICIAIS = '023-modelos-oficiais';

/** Cadastra versões novas sem substituir templates/aprovações anteriores nem alterar documentos existentes. */
export async function aplicarModelosOficiais(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_MODELOS_OFICIAIS, async () => {
    for (const [tipo, versao] of Object.entries(TEMPLATES_OFICIAIS)) {
      await cliente.query(`
        INSERT INTO documentos.template_versao (tipo, versao, html, css, vigente_de)
        VALUES ($1, $2, $3, '', CURRENT_DATE)
      `, [tipo, versao, '<!-- Modelo de saída baseado nas referências locais; renderer v2 @sisdoc/templates. Exige aprovação formal própria. -->']);
    }
  });
}
