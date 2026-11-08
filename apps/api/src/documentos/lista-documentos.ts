import { listaDocumentosSchema, type ConsultaListaDocumentos, type ListaDocumentos } from '@sisdoc/contratos';
import type { Pool } from 'pg';
import { transacao } from '../banco';
import { auditarConsultaFuncional } from '../seguranca/auditoria-funcional';
import type { SessaoAutenticada } from '../seguranca/autenticacao';
import { papeisPermitidos } from '../seguranca/permissoes';
import { confirmarSessao } from '../seguranca/sessao-transacao';
import { consultaRetornosDocumentos } from './interacoes';

const colunas = { nome: 'nome', matricula: 'matricula', autor: 'autor_nome', situacao: 'situacao', atualizadoEm: 'atualizado_em' } as const;

export class ListaDocumentosService {
  constructor(private readonly banco: Pool) {}

  async listar(sessao: SessaoAutenticada, ip: string, consulta: ConsultaListaDocumentos): Promise<ListaDocumentos> {
    return transacao(this.banco, async (cliente) => {
      await confirmarSessao(cliente, sessao, papeisPermitidos('consultar_documentos'));
      // Contagens e página usam o mesmo snapshot e os mesmos predicados de autorização.
      const resultado = await cliente.query<{ dados: ListaDocumentos }>(`
        WITH classificados AS (
          SELECT d.id, d.pessoa_id, d.vinculo_id, d.tipo, p.nome, v.matricula, autor.nome AS autor_nome,
            d.criado_por, d.revisao, d.atualizado_em, e.destinatario_id,
            c.conferido_em, conferente.nome AS conferido_por_nome,
            (c.revisao_pessoa <> p.revisao_fonte OR c.revisao_vinculo <> v.revisao_fonte) AS fonte_alterada,
            CASE WHEN d.status = 'conferido' THEN 'conferidas'
              WHEN e.documento_id IS NOT NULL THEN 'encaminhadas'
              WHEN r.em IS NOT NULL AND d.atualizado_em <= r.em THEN 'devolvidas'
              ELSE 'rascunhos' END AS situacao
          FROM documentos.documento d
          JOIN nucleo.pessoa p ON p.id = d.pessoa_id
          JOIN nucleo.vinculo v ON v.id = d.vinculo_id AND v.pessoa_id = d.pessoa_id
          JOIN seguranca.usuario autor ON autor.id = d.criado_por
          LEFT JOIN documentos.encaminhamento_dof e ON e.documento_id = d.id AND e.recolhido_em IS NULL AND d.tipo = 'DOF'
          LEFT JOIN (${consultaRetornosDocumentos}) r ON r.documento_id = d.id
          LEFT JOIN documentos.conferencia_dof c ON c.documento_id = d.id AND c.revisao_documento = d.revisao AND d.tipo = 'DOF'
          LEFT JOIN seguranca.usuario conferente ON conferente.id = c.conferido_por
          WHERE d.status IN ('rascunho', 'conferido')
            AND (($1 = 'DOF' AND d.tipo = 'DOF') OR ($1 = 'DTC' AND d.tipo IN ('DTC_IPAM','DTC_COMISSIONADO','DTC_INSS')))
            AND ($2::text IS NULL OR d.tipo = $2)
            AND NOT EXISTS (SELECT 1 FROM documentos.exclusao_documento x WHERE x.documento_id = d.id AND x.status = 'pendente')
        ), visiveis AS (
          SELECT * FROM classificados
          WHERE CASE
            WHEN situacao = 'rascunhos' THEN criado_por = $3 OR $4::boolean OR $5::boolean
            WHEN situacao = 'devolvidas' THEN criado_por = $3 OR $4::boolean
            WHEN situacao = 'encaminhadas' THEN criado_por = $3 OR $4::boolean OR (destinatario_id = $3 AND $5::boolean)
            WHEN tipo <> 'DOF' THEN criado_por = $3 OR $4::boolean OR $5::boolean
            ELSE conferido_em IS NOT NULL AND (criado_por = $3 OR $4::boolean OR (destinatario_id = $3 AND $5::boolean))
          END
        ), contagens AS (
          SELECT count(*) FILTER (WHERE situacao = 'rascunhos')::int AS rascunhos,
            count(*) FILTER (WHERE situacao = 'encaminhadas')::int AS encaminhadas,
            count(*) FILTER (WHERE situacao = 'devolvidas')::int AS devolvidas,
            count(*) FILTER (WHERE situacao = 'conferidas')::int AS conferidas FROM visiveis
        ), pagina AS (
          SELECT * FROM visiveis WHERE situacao = $6
          ORDER BY ${colunas[consulta.ordem]} ${consulta.direcao === 'asc' ? 'ASC' : 'DESC'}, id ASC
          LIMIT $7 OFFSET $8
        )
        SELECT jsonb_build_object(
          'itens', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', id, 'pessoaId', pessoa_id, 'vinculoId', vinculo_id, 'tipo', tipo,
            'nome', nome, 'matricula', matricula, 'autorNome', autor_nome,
            'situacao', situacao, 'revisao', revisao,
            'somenteLeitura', situacao = 'encaminhadas' AND criado_por <> $3 AND NOT $4::boolean,
            'atualizadoEm', to_char(atualizado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'conferenciaDof', CASE WHEN tipo = 'DOF' AND situacao = 'conferidas' THEN jsonb_build_object(
              'id', id, 'pessoaId', pessoa_id, 'vinculoId', vinculo_id, 'nome', nome, 'matricula', matricula,
              'revisao', revisao, 'autorNome', autor_nome,
              'atualizadoEm', to_char(atualizado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'conferidoPorNome', conferido_por_nome,
              'conferidoEm', to_char(conferido_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'fonteSelecionadaAlterada', fonte_alterada) ELSE NULL END
          ) ORDER BY ${colunas[consulta.ordem]} ${consulta.direcao === 'asc' ? 'ASC' : 'DESC'}, id ASC) FROM pagina), '[]'::jsonb),
          'contagens', (SELECT to_jsonb(contagens) FROM contagens),
          'pagina', $9::int,
          'total', (SELECT count(*)::int FROM visiveis WHERE situacao = $6),
          'totalPaginas', (SELECT ceil(count(*)::numeric / $7)::int FROM visiveis WHERE situacao = $6)
        ) AS dados`,
      [consulta.grupo, consulta.tipo ?? null, sessao.usuario.id, sessao.usuario.papel === 'admin',
        sessao.usuario.papel === 'coordenador', consulta.aba, consulta.limite,
        (consulta.pagina - 1) * consulta.limite, consulta.pagina]);
      await auditarConsultaFuncional(cliente, sessao, 'lista_documentos_consultada', 'documento', null, null, ip);
      return listaDocumentosSchema.parse(resultado.rows[0].dados);
    });
  }
}
