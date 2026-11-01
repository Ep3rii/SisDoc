import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_DESTINATARIO_COORDENADOR = '022-destinatario-coordenador';

export async function aplicarDestinatarioCoordenador(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_DESTINATARIO_COORDENADOR, async () => {
    await cliente.query(`
      CREATE FUNCTION documentos.exigir_destinatario_coordenador() RETURNS trigger
        LANGUAGE plpgsql SET search_path = pg_catalog AS $$
        BEGIN
          PERFORM 1 FROM seguranca.usuario
            WHERE id = NEW.destinatario_id AND ativo AND papel = 'coordenador' FOR SHARE;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Destinatário deve ser coordenador ativo.' USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $$;
      CREATE TRIGGER exigir_destinatario_coordenador
        BEFORE INSERT ON documentos.encaminhamento_dof
        FOR EACH ROW EXECUTE FUNCTION documentos.exigir_destinatario_coordenador();
    `);
  });
}
