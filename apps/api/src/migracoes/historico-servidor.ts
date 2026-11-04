import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_HISTORICO_SERVIDOR = '025-historico-servidor';
export async function aplicarHistoricoServidor(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_HISTORICO_SERVIDOR, async (papel) => {
    await cliente.query(`
      CREATE TABLE nucleo.historico_servidor (
        id uuid PRIMARY KEY, pessoa_id uuid NOT NULL REFERENCES nucleo.pessoa(id), vinculo_id uuid NOT NULL,
        grupo text NOT NULL CHECK (grupo IN ('funcional','financeiro')),
        origem text NOT NULL, id_origem text, revisao integer NOT NULL CHECK (revisao > 0),
        conteudo_cifrado bytea NOT NULL CHECK (octet_length(conteudo_cifrado) > 0),
        lote_id uuid REFERENCES legado.planilha_lote(id), linha_origem integer CHECK (linha_origem > 0),
        criado_por uuid NOT NULL REFERENCES seguranca.usuario(id), atualizado_por uuid NOT NULL REFERENCES seguranca.usuario(id),
        criado_em timestamptz NOT NULL DEFAULT now(), atualizado_em timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (vinculo_id,pessoa_id) REFERENCES nucleo.vinculo(id,pessoa_id),
        UNIQUE (vinculo_id,origem,id_origem)
      );
      CREATE INDEX historico_servidor_pessoa ON nucleo.historico_servidor (pessoa_id,vinculo_id,id);
      CREATE TABLE nucleo.historico_servidor_revisao (
        id uuid PRIMARY KEY, historico_id uuid NOT NULL REFERENCES nucleo.historico_servidor(id),
        usuario_id uuid NOT NULL REFERENCES seguranca.usuario(id),
        conteudo_cifrado bytea NOT NULL CHECK (octet_length(conteudo_cifrado) > 0),
        em timestamptz NOT NULL DEFAULT now()
      );
      CREATE TRIGGER historico_servidor_revisao_sem_mutacao BEFORE UPDATE OR DELETE ON nucleo.historico_servidor_revisao
        FOR EACH ROW EXECUTE FUNCTION seguranca.bloquear_mutacao();
      REVOKE ALL ON nucleo.historico_servidor, nucleo.historico_servidor_revisao FROM PUBLIC;
      GRANT SELECT,INSERT ON nucleo.historico_servidor TO ${papel};
      GRANT UPDATE (grupo,origem,id_origem,revisao,conteudo_cifrado,atualizado_por,atualizado_em) ON nucleo.historico_servidor TO ${papel};
      GRANT SELECT,INSERT ON nucleo.historico_servidor_revisao TO ${papel};
    `);
  });
}
