import type { Client } from 'pg';
import { executarMigracao } from './executor';

export const VERSAO_MODELO = '001-modelo';

const sqlModelo = `
CREATE SCHEMA nucleo;
CREATE SCHEMA documentos;
CREATE SCHEMA legado;
CREATE SCHEMA extensoes;
CREATE EXTENSION pg_trgm WITH SCHEMA extensoes;

CREATE TABLE nucleo.pessoa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cpf_cifrado bytea NOT NULL CHECK (octet_length(cpf_cifrado) > 0),
  cpf_hash bytea NOT NULL UNIQUE CHECK (octet_length(cpf_hash) = 32),
  nome text NOT NULL CHECK (btrim(nome) <> ''),
  nome_busca text NOT NULL CHECK (btrim(nome_busca) <> ''),
  nascimento date,
  nome_mae_cifrado bytea,
  nome_pai_cifrado bytea,
  pis_pasep_cifrado bytea,
  rg_numero_cifrado bytea,
  rg_orgao text,
  rg_expedicao date,
  titulo_eleitor_cifrado bytea,
  endereco_cifrado bytea,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pessoa_nome_busca_trgm ON nucleo.pessoa USING gin (nome_busca extensoes.gin_trgm_ops);

CREATE TABLE nucleo.pessoa_origem (
  pessoa_id uuid NOT NULL REFERENCES nucleo.pessoa(id),
  sistema_origem text NOT NULL,
  id_origem text NOT NULL,
  hash_conteudo bytea CHECK (hash_conteudo IS NULL OR octet_length(hash_conteudo) = 32),
  sincronizado_em timestamptz,
  removido_na_fonte_em timestamptz,
  PRIMARY KEY (sistema_origem, id_origem)
);

CREATE TABLE nucleo.vinculo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pessoa_id uuid NOT NULL REFERENCES nucleo.pessoa(id),
  matricula text NOT NULL CHECK (btrim(matricula) <> ''),
  matricula_norm text NOT NULL CHECK (btrim(matricula_norm) <> ''),
  sistema_origem text NOT NULL,
  id_origem text NOT NULL,
  regime_juridico text,
  cargo text,
  classe text,
  nivel text,
  referencia text,
  setor text,
  orgao_codigo text,
  orgao_nome text,
  admissao date,
  desligamento date,
  matricula_anterior_id uuid,
  hash_conteudo bytea CHECK (hash_conteudo IS NULL OR octet_length(hash_conteudo) = 32),
  sincronizado_em timestamptz,
  removido_na_fonte_em timestamptz,
  UNIQUE (id, pessoa_id),
  UNIQUE (sistema_origem, matricula_norm),
  UNIQUE (sistema_origem, id_origem),
  FOREIGN KEY (matricula_anterior_id, pessoa_id) REFERENCES nucleo.vinculo(id, pessoa_id),
  CHECK (matricula_anterior_id IS NULL OR matricula_anterior_id <> id)
);
CREATE INDEX vinculo_matricula_norm ON nucleo.vinculo (matricula_norm);

CREATE TABLE nucleo.sincronizacao_lote (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origem text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('completa', 'incremental', 'servidor')),
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz,
  status text NOT NULL,
  lidos integer NOT NULL DEFAULT 0 CHECK (lidos >= 0),
  inseridos integer NOT NULL DEFAULT 0 CHECK (inseridos >= 0),
  atualizados integer NOT NULL DEFAULT 0 CHECK (atualizados >= 0),
  removidos integer NOT NULL DEFAULT 0 CHECK (removidos >= 0),
  erros_sanitizados jsonb NOT NULL DEFAULT '[]'::jsonb,
  cursor text
);

CREATE TABLE nucleo.evento_funcional (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vinculo_id uuid NOT NULL REFERENCES nucleo.vinculo(id),
  tipo text NOT NULL CHECK (tipo IN (
    'contratacao', 'nomeacao', 'transposicao', 'enquadramento', 'reenquadramento',
    'progressao', 'designacao', 'exoneracao', 'mudanca_matricula', 'outro'
  )),
  data_evento date,
  data_publicacao date,
  ato_tipo text,
  ato_numero text,
  descricao_origem_cifrada bytea,
  dados_cifrados bytea,
  fonte text NOT NULL,
  sistema_origem text,
  id_origem text,
  hash_conteudo bytea CHECK (hash_conteudo IS NULL OR octet_length(hash_conteudo) = 32),
  sincronizado_em timestamptz,
  removido_na_fonte_em timestamptz,
  CHECK ((sistema_origem IS NULL) = (id_origem IS NULL)),
  UNIQUE (sistema_origem, id_origem)
);
CREATE INDEX evento_vinculo_data ON nucleo.evento_funcional (vinculo_id, data_evento);

CREATE TABLE nucleo.afastamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vinculo_id uuid NOT NULL REFERENCES nucleo.vinculo(id),
  tipo text NOT NULL CHECK (tipo IN ('falta', 'licenca_ts', 'licenca_pf', 'licenca_ip', 'outro')),
  data_inicio date,
  data_fim date,
  ano_ref integer,
  dias_ano integer,
  observacao_cifrada bytea,
  fonte text NOT NULL,
  sistema_origem text,
  id_origem text,
  hash_conteudo bytea CHECK (hash_conteudo IS NULL OR octet_length(hash_conteudo) = 32),
  sincronizado_em timestamptz,
  removido_na_fonte_em timestamptz,
  CHECK ((sistema_origem IS NULL) = (id_origem IS NULL)),
  CHECK (
    (data_inicio IS NOT NULL AND data_fim IS NOT NULL AND data_fim >= data_inicio
      AND ano_ref IS NULL AND dias_ano IS NULL)
    OR
    (data_inicio IS NULL AND data_fim IS NULL AND ano_ref IS NOT NULL AND dias_ano IS NOT NULL
      AND ano_ref BETWEEN 1 AND 9999 AND dias_ano BETWEEN 0 AND 366)
  ),
  UNIQUE (sistema_origem, id_origem)
);
CREATE INDEX afastamento_vinculo_tipo_data ON nucleo.afastamento (vinculo_id, tipo, data_inicio);

CREATE TABLE nucleo.incorporacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vinculo_id uuid NOT NULL REFERENCES nucleo.vinculo(id),
  tipo text NOT NULL CHECK (tipo IN ('PB', 'PV', 'LIC_PREMIO')),
  data_inicio date,
  data_fim date,
  ano_ref integer,
  dias_entrada integer,
  convencao text CHECK (convencao IN ('inclusivo', 'exclusivo')),
  origem text NOT NULL,
  sistema_origem text,
  id_origem text,
  hash_conteudo bytea CHECK (hash_conteudo IS NULL OR octet_length(hash_conteudo) = 32),
  sincronizado_em timestamptz,
  removido_na_fonte_em timestamptz,
  CHECK ((sistema_origem IS NULL) = (id_origem IS NULL)),
  CHECK (
    (data_inicio IS NOT NULL AND data_fim IS NOT NULL AND data_fim >= data_inicio
      AND convencao IS NOT NULL AND ano_ref IS NULL AND dias_entrada IS NULL)
    OR
    (data_inicio IS NULL AND data_fim IS NULL AND convencao IS NULL
      AND ano_ref IS NOT NULL AND dias_entrada IS NOT NULL
      AND ano_ref BETWEEN 1 AND 9999 AND dias_entrada >= 0)
  ),
  UNIQUE (sistema_origem, id_origem)
);

CREATE TABLE nucleo.periodo_ipam (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pessoa_id uuid NOT NULL REFERENCES nucleo.pessoa(id),
  mes_inicio date NOT NULL CHECK (extract(day FROM mes_inicio) = 1),
  mes_fim date NOT NULL CHECK (extract(day FROM mes_fim) = 1 AND mes_fim >= mes_inicio),
  fonte text NOT NULL,
  sistema_origem text,
  id_origem text,
  hash_conteudo bytea CHECK (hash_conteudo IS NULL OR octet_length(hash_conteudo) = 32),
  sincronizado_em timestamptz,
  removido_na_fonte_em timestamptz,
  CHECK ((sistema_origem IS NULL) = (id_origem IS NULL)),
  UNIQUE (sistema_origem, id_origem)
);

CREATE TABLE nucleo.importacao_lote (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origem text NOT NULL,
  hash_arquivo bytea NOT NULL CHECK (octet_length(hash_arquivo) = 32),
  usuario_id uuid NOT NULL REFERENCES seguranca.usuario(id),
  status text NOT NULL,
  contagens jsonb NOT NULL DEFAULT '{}'::jsonb,
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz
);

CREATE TABLE nucleo.staging_api (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id uuid NOT NULL REFERENCES nucleo.sincronizacao_lote(id),
  id_origem text NOT NULL,
  payload_cifrado bytea NOT NULL CHECK (octet_length(payload_cifrado) > 0),
  recebido_em timestamptz NOT NULL DEFAULT now(),
  processado_em timestamptz
);

CREATE TABLE documentos.bloco_texto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  titulo text NOT NULL,
  tipos_documento text[] NOT NULL CHECK (
    cardinality(tipos_documento) > 0 AND
    tipos_documento <@ ARRAY['DOF', 'DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS']::text[]
  ),
  ativo boolean NOT NULL DEFAULT true
);
CREATE TABLE documentos.bloco_versao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bloco_id uuid NOT NULL REFERENCES documentos.bloco_texto(id),
  versao text NOT NULL,
  conteudo text NOT NULL,
  esquema_variaveis jsonb NOT NULL,
  vigente_de date NOT NULL,
  UNIQUE (bloco_id, versao)
);
CREATE TABLE documentos.template_versao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('DOF', 'DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS')),
  versao text NOT NULL,
  html text NOT NULL,
  css text NOT NULL,
  vigente_de date NOT NULL,
  UNIQUE (tipo, versao),
  UNIQUE (id, tipo)
);
CREATE TABLE documentos.regra_versao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  versao text NOT NULL,
  configuracao jsonb NOT NULL,
  evidencia text NOT NULL CHECK (evidencia IN ('formula', 'estrutura', 'inferido')),
  vigente_de date NOT NULL,
  UNIQUE (codigo, versao)
);

CREATE TABLE documentos.documento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('DOF', 'DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS')),
  pessoa_id uuid NOT NULL REFERENCES nucleo.pessoa(id),
  vinculo_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'conferido', 'emitido', 'cancelado')),
  processo_numero text,
  entrada_cifrada bytea NOT NULL CHECK (octet_length(entrada_cifrada) > 0),
  ajustes_cifrados bytea,
  resultado_calculo_cifrado bytea,
  template_versao_id uuid NOT NULL,
  regra_versao_id uuid NOT NULL REFERENCES documentos.regra_versao(id),
  substitui_id uuid REFERENCES documentos.documento(id),
  criado_por uuid NOT NULL REFERENCES seguranca.usuario(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid NOT NULL REFERENCES seguranca.usuario(id),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  conferido_por uuid REFERENCES seguranca.usuario(id),
  conferido_em timestamptz,
  cancelado_por uuid REFERENCES seguranca.usuario(id),
  cancelado_em timestamptz,
  motivo_cancelamento_cifrado bytea,
  FOREIGN KEY (vinculo_id, pessoa_id) REFERENCES nucleo.vinculo(id, pessoa_id),
  FOREIGN KEY (template_versao_id, tipo) REFERENCES documentos.template_versao(id, tipo),
  CHECK (substitui_id IS NULL OR substitui_id <> id),
  CHECK ((conferido_por IS NULL) = (conferido_em IS NULL)),
  CHECK (status <> 'rascunho' OR conferido_por IS NULL),
  CHECK (status NOT IN ('conferido', 'emitido') OR conferido_por IS NOT NULL),
  CHECK (
    (status = 'cancelado' AND cancelado_por IS NOT NULL AND cancelado_em IS NOT NULL
      AND motivo_cancelamento_cifrado IS NOT NULL AND octet_length(motivo_cancelamento_cifrado) > 0)
    OR
    (status <> 'cancelado' AND cancelado_por IS NULL AND cancelado_em IS NULL AND motivo_cancelamento_cifrado IS NULL)
  )
);
CREATE INDEX documento_pessoa_tipo ON documentos.documento (pessoa_id, tipo, criado_em DESC);

CREATE TABLE documentos.documento_periodo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id uuid NOT NULL REFERENCES documentos.documento(id),
  ordem integer NOT NULL CHECK (ordem BETWEEN 1 AND 4),
  inicio date NOT NULL,
  fim date NOT NULL CHECK (fim >= inicio),
  cargo text,
  categoria text,
  observacao_cifrada bytea,
  UNIQUE (documento_id, ordem)
);
CREATE TABLE documentos.documento_cargo_comissionado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id uuid NOT NULL REFERENCES documentos.documento(id),
  ordem integer NOT NULL CHECK (ordem BETWEEN 1 AND 3),
  cargo text NOT NULL CHECK (btrim(cargo) <> ''),
  decreto_nomeacao text NOT NULL CHECK (btrim(decreto_nomeacao) <> ''),
  publicacao_nomeacao text NOT NULL CHECK (btrim(publicacao_nomeacao) <> ''),
  data_entrada_exercicio date NOT NULL,
  decreto_exoneracao text,
  publicacao_exoneracao text,
  data_encerramento date,
  CHECK (
    (decreto_exoneracao IS NULL AND publicacao_exoneracao IS NULL AND data_encerramento IS NULL)
    OR
    (decreto_exoneracao IS NOT NULL AND btrim(decreto_exoneracao) <> ''
      AND publicacao_exoneracao IS NOT NULL AND btrim(publicacao_exoneracao) <> ''
      AND data_encerramento IS NOT NULL AND data_encerramento >= data_entrada_exercicio)
  ),
  UNIQUE (documento_id, ordem)
);
CREATE TABLE documentos.documento_bloco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id uuid NOT NULL REFERENCES documentos.documento(id),
  bloco_versao_id uuid NOT NULL REFERENCES documentos.bloco_versao(id),
  ordem integer NOT NULL CHECK (ordem > 0),
  ativo boolean NOT NULL DEFAULT true,
  variaveis_cifradas bytea,
  texto_final_cifrado bytea,
  UNIQUE (documento_id, ordem)
);
CREATE TABLE documentos.numeracao (
  tipo text NOT NULL CHECK (tipo IN ('DOF', 'DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS')),
  ano integer NOT NULL CHECK (ano BETWEEN 1 AND 9999),
  ultimo_numero bigint NOT NULL DEFAULT 0 CHECK (ultimo_numero >= 0),
  sufixo text NOT NULL,
  PRIMARY KEY (tipo, ano)
);
CREATE TABLE documentos.emissao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id uuid NOT NULL UNIQUE REFERENCES documentos.documento(id),
  tipo text NOT NULL CHECK (tipo IN ('DOF', 'DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS')),
  ano integer NOT NULL CHECK (ano BETWEEN 1 AND 9999),
  numero bigint NOT NULL CHECK (numero > 0),
  numero_formatado text NOT NULL CHECK (btrim(numero_formatado) <> ''),
  chave_idempotencia text NOT NULL UNIQUE CHECK (btrim(chave_idempotencia) <> ''),
  snapshot_cifrado bytea NOT NULL CHECK (octet_length(snapshot_cifrado) > 0),
  emitido_por uuid NOT NULL REFERENCES seguranca.usuario(id),
  emitido_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tipo, ano, numero)
);
CREATE TABLE documentos.job_pdf (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emissao_id uuid NOT NULL UNIQUE REFERENCES documentos.emissao(id),
  status text NOT NULL CHECK (status IN ('pendente', 'processando', 'concluido', 'falhou')),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  erro_sanitizado text,
  posse uuid,
  posse_expira_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, emissao_id),
  CHECK ((posse IS NULL) = (posse_expira_em IS NULL))
);
CREATE TABLE documentos.artefato_pdf (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emissao_id uuid NOT NULL UNIQUE REFERENCES documentos.emissao(id),
  job_id uuid NOT NULL UNIQUE,
  caminho_relativo text NOT NULL,
  sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, emissao_id) REFERENCES documentos.job_pdf(id, emissao_id)
);
CREATE TABLE documentos.ajuste_campo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id uuid NOT NULL REFERENCES documentos.documento(id),
  campo text NOT NULL,
  valor_original_cifrado bytea,
  valor_novo_cifrado bytea NOT NULL CHECK (octet_length(valor_novo_cifrado) > 0),
  motivo_cifrado bytea NOT NULL CHECK (octet_length(motivo_cifrado) > 0),
  usuario_id uuid NOT NULL REFERENCES seguranca.usuario(id),
  em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE seguranca.sessao (
  id_hash bytea PRIMARY KEY CHECK (octet_length(id_hash) = 32),
  usuario_id uuid NOT NULL REFERENCES seguranca.usuario(id),
  criada_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  ultimo_uso timestamptz NOT NULL,
  ip inet,
  user_agent text,
  CHECK (expira_em > criada_em)
);
CREATE INDEX sessao_expiracao ON seguranca.sessao (expira_em);
CREATE TABLE seguranca.auditoria (
  id bigserial PRIMARY KEY,
  usuario_id uuid REFERENCES seguranca.usuario(id),
  acao text NOT NULL,
  entidade text NOT NULL,
  entidade_id uuid,
  pessoa_id uuid REFERENCES nucleo.pessoa(id),
  ip inet,
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_pessoa_data ON seguranca.auditoria (pessoa_id, em);
CREATE INDEX auditoria_usuario_data ON seguranca.auditoria (usuario_id, em);

CREATE FUNCTION seguranca.bloquear_mutacao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Registro imutável não pode ser alterado ou apagado.' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER auditoria_imutavel BEFORE UPDATE OR DELETE ON seguranca.auditoria
  FOR EACH ROW EXECUTE FUNCTION seguranca.bloquear_mutacao();
CREATE TRIGGER emissao_imutavel BEFORE UPDATE OR DELETE ON documentos.emissao
  FOR EACH ROW EXECUTE FUNCTION seguranca.bloquear_mutacao();
CREATE TRIGGER ajuste_imutavel BEFORE UPDATE OR DELETE ON documentos.ajuste_campo
  FOR EACH ROW EXECUTE FUNCTION seguranca.bloquear_mutacao();
CREATE TRIGGER bloco_versao_imutavel BEFORE UPDATE OR DELETE ON documentos.bloco_versao
  FOR EACH ROW EXECUTE FUNCTION seguranca.bloquear_mutacao();
CREATE TRIGGER template_versao_imutavel BEFORE UPDATE OR DELETE ON documentos.template_versao
  FOR EACH ROW EXECUTE FUNCTION seguranca.bloquear_mutacao();
CREATE TRIGGER regra_versao_imutavel BEFORE UPDATE OR DELETE ON documentos.regra_versao
  FOR EACH ROW EXECUTE FUNCTION seguranca.bloquear_mutacao();
CREATE TRIGGER auditoria_sem_truncar BEFORE TRUNCATE ON seguranca.auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION seguranca.bloquear_mutacao();
CREATE TRIGGER emissao_sem_truncar BEFORE TRUNCATE ON documentos.emissao
  FOR EACH STATEMENT EXECUTE FUNCTION seguranca.bloquear_mutacao();
CREATE TRIGGER ajuste_sem_truncar BEFORE TRUNCATE ON documentos.ajuste_campo
  FOR EACH STATEMENT EXECUTE FUNCTION seguranca.bloquear_mutacao();
CREATE TRIGGER bloco_versao_sem_truncar BEFORE TRUNCATE ON documentos.bloco_versao
  FOR EACH STATEMENT EXECUTE FUNCTION seguranca.bloquear_mutacao();
CREATE TRIGGER template_versao_sem_truncar BEFORE TRUNCATE ON documentos.template_versao
  FOR EACH STATEMENT EXECUTE FUNCTION seguranca.bloquear_mutacao();
CREATE TRIGGER regra_versao_sem_truncar BEFORE TRUNCATE ON documentos.regra_versao
  FOR EACH STATEMENT EXECUTE FUNCTION seguranca.bloquear_mutacao();

CREATE FUNCTION documentos.validar_documento() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total_periodos integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'rascunho' THEN
      RAISE EXCEPTION 'Documento novo deve ser rascunho.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tipo IS DISTINCT FROM OLD.tipo
     OR NEW.pessoa_id IS DISTINCT FROM OLD.pessoa_id OR NEW.vinculo_id IS DISTINCT FROM OLD.vinculo_id
     OR NEW.criado_por IS DISTINCT FROM OLD.criado_por OR NEW.criado_em IS DISTINCT FROM OLD.criado_em THEN
    RAISE EXCEPTION 'Identidade do documento não pode ser alterada.' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'cancelado' OR (OLD.status = 'emitido' AND NEW.status <> 'cancelado') THEN
    RAISE EXCEPTION 'Documento encerrado não pode ser alterado.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'rascunho' AND NEW.status IN ('conferido', 'cancelado'))
    OR (OLD.status = 'conferido' AND NEW.status IN ('rascunho', 'emitido', 'cancelado'))
    OR (OLD.status = 'emitido' AND NEW.status = 'cancelado')
  ) THEN
    RAISE EXCEPTION 'Transição de documento inválida.' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'rascunho' AND ROW(
    NEW.tipo, NEW.pessoa_id, NEW.vinculo_id, NEW.processo_numero, NEW.entrada_cifrada,
    NEW.ajustes_cifrados, NEW.resultado_calculo_cifrado, NEW.template_versao_id,
    NEW.regra_versao_id, NEW.substitui_id, NEW.criado_por, NEW.criado_em
  ) IS DISTINCT FROM ROW(
    OLD.tipo, OLD.pessoa_id, OLD.vinculo_id, OLD.processo_numero, OLD.entrada_cifrada,
    OLD.ajustes_cifrados, OLD.resultado_calculo_cifrado, OLD.template_versao_id,
    OLD.regra_versao_id, OLD.substitui_id, OLD.criado_por, OLD.criado_em
  ) THEN
    RAISE EXCEPTION 'Conteúdo conferido não pode ser alterado.' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('conferido', 'emitido') AND NEW.status <> 'rascunho'
     AND ROW(NEW.conferido_por, NEW.conferido_em) IS DISTINCT FROM ROW(OLD.conferido_por, OLD.conferido_em) THEN
    RAISE EXCEPTION 'Conferência registrada não pode ser alterada.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'conferido' AND OLD.status <> 'conferido' THEN
    SELECT count(*) INTO total_periodos FROM documentos.documento_periodo WHERE documento_id = NEW.id;
    IF total_periodos < 1 OR (NEW.tipo = 'DOF' AND total_periodos <> 1) THEN
      RAISE EXCEPTION 'Quantidade de períodos inválida.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status = 'emitido' AND OLD.status <> 'emitido' AND NOT EXISTS (
    SELECT 1 FROM documentos.emissao WHERE documento_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Emissão requer snapshot registrado.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER documento_transicoes BEFORE INSERT OR UPDATE ON documentos.documento
  FOR EACH ROW EXECUTE FUNCTION documentos.validar_documento();

CREATE FUNCTION documentos.validar_filho() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE alvo uuid; tipo_documento text; estado text;
BEGIN
  IF TG_OP = 'DELETE' THEN alvo := OLD.documento_id; ELSE alvo := NEW.documento_id; END IF;
  IF TG_OP = 'UPDATE' AND NEW.documento_id <> OLD.documento_id THEN
    RAISE EXCEPTION 'Não é permitido mover item entre documentos.' USING ERRCODE = '23514';
  END IF;
  SELECT tipo, status INTO tipo_documento, estado
    FROM documentos.documento WHERE id = alvo FOR UPDATE;
  IF estado IS DISTINCT FROM 'rascunho' THEN
    RAISE EXCEPTION 'Itens só podem ser alterados em rascunho.' USING ERRCODE = '55000';
  END IF;
  IF TG_TABLE_NAME = 'documento_periodo' AND TG_OP <> 'DELETE' THEN
    IF tipo_documento = 'DOF' AND NEW.ordem <> 1 THEN
      RAISE EXCEPTION 'DOF permite apenas um período.' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM documentos.documento_periodo p
      WHERE p.documento_id = alvo AND p.id <> NEW.id
        AND daterange(p.inicio, p.fim, '[]') && daterange(NEW.inicio, NEW.fim, '[]')
    ) THEN
      RAISE EXCEPTION 'Períodos não podem se sobrepor.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'documento_cargo_comissionado' AND tipo_documento <> 'DTC_COMISSIONADO' THEN
    RAISE EXCEPTION 'Cargo comissionado incompatível com o tipo do documento.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER periodo_rascunho BEFORE INSERT OR UPDATE OR DELETE ON documentos.documento_periodo
  FOR EACH ROW EXECUTE FUNCTION documentos.validar_filho();
CREATE TRIGGER cargo_rascunho BEFORE INSERT OR UPDATE OR DELETE ON documentos.documento_cargo_comissionado
  FOR EACH ROW EXECUTE FUNCTION documentos.validar_filho();
CREATE TRIGGER bloco_rascunho BEFORE INSERT OR UPDATE OR DELETE ON documentos.documento_bloco
  FOR EACH ROW EXECUTE FUNCTION documentos.validar_filho();
CREATE TRIGGER ajuste_rascunho BEFORE INSERT ON documentos.ajuste_campo
  FOR EACH ROW EXECUTE FUNCTION documentos.validar_filho();

CREATE FUNCTION documentos.validar_emissao() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE estado text; tipo_documento text;
BEGIN
  SELECT status, tipo INTO estado, tipo_documento
    FROM documentos.documento WHERE id = NEW.documento_id FOR UPDATE;
  IF estado IS DISTINCT FROM 'conferido' OR tipo_documento IS DISTINCT FROM NEW.tipo THEN
    RAISE EXCEPTION 'Emissão exige documento conferido do mesmo tipo.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER emissao_documento BEFORE INSERT ON documentos.emissao
  FOR EACH ROW EXECUTE FUNCTION documentos.validar_emissao();

CREATE FUNCTION nucleo.validar_expurgo_staging() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE estado text;
BEGIN
  SELECT status INTO estado FROM nucleo.sincronizacao_lote WHERE id = OLD.lote_id FOR SHARE;
  IF estado IS DISTINCT FROM 'concluido' OR OLD.processado_em IS NULL
     OR OLD.recebido_em > now() - interval '30 days' THEN
    RAISE EXCEPTION 'Staging ainda não pode ser expurgado.' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER staging_retencao BEFORE DELETE ON nucleo.staging_api
  FOR EACH ROW EXECUTE FUNCTION nucleo.validar_expurgo_staging();
`;

export async function aplicarModelo(cliente: Client, usuarioAplicacao: string): Promise<boolean> {
  return executarMigracao(cliente, usuarioAplicacao, VERSAO_MODELO, async (papel) => {
    await cliente.query(sqlModelo);
    await cliente.query('REVOKE ALL ON SCHEMA nucleo, documentos, seguranca, legado, extensoes FROM PUBLIC');
    await cliente.query('REVOKE ALL ON ALL TABLES IN SCHEMA nucleo, documentos, seguranca, legado FROM PUBLIC');
    await cliente.query('REVOKE ALL ON ALL SEQUENCES IN SCHEMA nucleo, documentos, seguranca, legado FROM PUBLIC');
    await cliente.query(`REVOKE INSERT, UPDATE, DELETE ON seguranca.usuario FROM ${papel}`);
    await cliente.query(`GRANT USAGE ON SCHEMA nucleo, documentos, seguranca, legado, extensoes TO ${papel}`);
    await cliente.query(`GRANT SELECT ON ALL TABLES IN SCHEMA nucleo, documentos, seguranca, legado TO ${papel}`);
    await cliente.query(`GRANT INSERT ON seguranca.auditoria TO ${papel}`);
    await cliente.query(`GRANT USAGE, SELECT ON SEQUENCE seguranca.auditoria_id_seq TO ${papel}`);
  });
}
