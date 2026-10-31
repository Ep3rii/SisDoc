import { REGRAS_PLANILHA } from '@sisdoc/calculo';
import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_RASCUNHO_DOF = '004-rascunho-dof';
export const TEMPLATE_DOF_PROVISORIO = 'referencia-sem-modelo-oficial-1';

export async function aplicarRascunhoDof(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_RASCUNHO_DOF, async (papel) => {
    await cliente.query(`
      ALTER TABLE documentos.documento
        ADD COLUMN revisao integer NOT NULL DEFAULT 1 CHECK (revisao > 0)
    `);
    await cliente.query(`
      INSERT INTO documentos.template_versao (tipo, versao, html, css, vigente_de)
      VALUES ('DOF', $1, '<!-- Modelo oficial não disponível; emissão bloqueada. -->', '', CURRENT_DATE)
    `, [TEMPLATE_DOF_PROVISORIO]);
    await cliente.query(`
      INSERT INTO documentos.regra_versao (codigo, versao, configuracao, evidencia, vigente_de)
      VALUES ($1, $2, $3::jsonb, 'formula', CURRENT_DATE)
    `, [REGRAS_PLANILHA.codigo, REGRAS_PLANILHA.versao, JSON.stringify(REGRAS_PLANILHA)]);
    await cliente.query(`
      GRANT INSERT (id, tipo, pessoa_id, vinculo_id, entrada_cifrada, resultado_calculo_cifrado,
        template_versao_id, regra_versao_id, criado_por, atualizado_por) ON documentos.documento TO ${papel};
      GRANT UPDATE (entrada_cifrada, resultado_calculo_cifrado, atualizado_por, atualizado_em, revisao)
        ON documentos.documento TO ${papel};
      GRANT INSERT (id, documento_id, ordem, inicio, fim) ON documentos.documento_periodo TO ${papel};
      GRANT UPDATE (inicio, fim) ON documentos.documento_periodo TO ${papel};
      GRANT INSERT (id, documento_id, campo, valor_original_cifrado, valor_novo_cifrado, motivo_cifrado, usuario_id)
        ON documentos.ajuste_campo TO ${papel};
    `);
  });
}
