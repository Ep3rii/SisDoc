import { createHash, randomUUID } from 'node:crypto';
import {
  mascararCpf, mascararMatricula, normalizarNomeBusca, origemImportacaoSchema,
  type ConferenciaImportacao, type ContagensImportacao, type OcorrenciaImportacao, type RelatorioImportacao, type TipoImportacao,
} from '@sisdoc/contratos';
import { DatabaseError, type ClientBase } from 'pg';
import type { ProtetorDados } from '../seguranca/protecao-dados';
import {
  analisarLinhas, sugerirMapeamento,
  type AfastamentoArquivo, type CamposPessoa, type CamposVinculo, type EventoArquivo, type IncorporacaoArquivo,
  type PeriodoIpamArquivo, type ResultadoAnalise,
} from './formatos';

export const CHAVE_BLOQUEIO_IMPORTACAO = [1936286851, 3001] as const;
const TAMANHO_BLOCO = 1000;
const LIMITE_OCORRENCIAS = 1000;

export type CanalImportacao = 'cli' | 'tela' | 'legado';

export type OpcoesImportacao = {
  tipo: TipoImportacao;
  origem: string;
  canal: CanalImportacao;
  usuarioId: string;
  gravar: boolean;
  hashArquivo: Buffer;
  progresso?: (feitos: number, total: number) => void;
  antes?: (cliente: ClientBase) => Promise<void>;
  ip?: string | null;
  preservarExistentes?: boolean;
  referenciasCompletas?: boolean;
  preparar?: (cliente: ClientBase) => Promise<void>;
  loteLegadoId?: string;
  limiteOcorrencias?: number;
  revalidarExistente?: boolean;
};

export class ErroImportacao extends Error {}

export function hashArquivo(conteudo: Buffer): Buffer {
  return createHash('sha256').update(conteudo).digest();
}

type Estado = {
  cliente: ClientBase;
  protetor: ProtetorDados;
  loteId: string;
  origem: string;
  ocorrencias: OcorrenciaImportacao[];
  contagens: { inseridos: number; atualizados: number; inalterados: number; rejeitadosBanco: number };
  progresso: (avanco: number) => void;
  preservarExistentes: boolean;
};

type Coluna = readonly [nome: string, tipo: string];

async function inserirEmBloco(estado: Estado, tabela: string, colunas: readonly Coluna[], linhas: unknown[][]): Promise<void> {
  for (let inicio = 0; inicio < linhas.length; inicio += TAMANHO_BLOCO) {
    const bloco = linhas.slice(inicio, inicio + TAMANHO_BLOCO);
    const parametros = colunas.map((_, indice) => bloco.map((linha) => linha[indice]));
    await estado.cliente.query(`
      INSERT INTO nucleo.${tabela} (${colunas.map(([nome]) => nome).join(', ')}, lote_importacao_id, importado_em)
      SELECT *, $${colunas.length + 1}::uuid, now() FROM unnest(${colunas.map(([, tipo], indice) => `$${indice + 1}::${tipo}[]`).join(', ')})
    `, [...parametros, estado.loteId]);
    if (tabela === 'pessoa_origem') {
      await estado.cliente.query(`
        INSERT INTO nucleo.importacao_registro (lote_id, tabela, chave, acao)
        SELECT $1, 'pessoa_origem', jsonb_build_object('sistema_origem', s, 'id_origem', i), 'inserido'
        FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS x(s, i, ordem) ORDER BY ordem
      `, [estado.loteId, parametros[1], parametros[2]]);
    } else {
      await estado.cliente.query(`
        INSERT INTO nucleo.importacao_registro (lote_id, tabela, chave, acao)
        SELECT $1, $2, jsonb_build_object('id', i), 'inserido'
        FROM unnest($3::uuid[]) WITH ORDINALITY AS x(i, ordem) ORDER BY ordem
      `, [estado.loteId, tabela, parametros[0]]);
    }
    estado.progresso(tabela === 'pessoa_origem' ? 0 : bloco.length);
  }
}

async function registrarAnterior(estado: Estado, tabela: string, id: string): Promise<void> {
  await estado.cliente.query(`
    INSERT INTO nucleo.importacao_registro (lote_id, tabela, chave, acao, anterior)
    SELECT $1, $2, jsonb_build_object('id', t.id), 'atualizado', to_jsonb(t) FROM nucleo.${tabela} t WHERE t.id = $3
  `, [estado.loteId, tabela, id]);
}

function rejeitarNoBanco(estado: Estado, linha: number, motivo: string, referencia: string): void {
  estado.ocorrencias.push({ linha, tipo: 'rejeitada', motivo, referencia });
  estado.contagens.rejeitadosBanco += 1;
}

type CampoPessoa = { campo: keyof CamposPessoa; coluna: string; cifrado: boolean; data: boolean };
const CAMPOS_PESSOA: readonly CampoPessoa[] = [
  { campo: 'nome', coluna: 'nome', cifrado: false, data: false },
  { campo: 'nascimento', coluna: 'nascimento', cifrado: false, data: true },
  { campo: 'mae', coluna: 'nome_mae_cifrado', cifrado: true, data: false },
  { campo: 'pis', coluna: 'pis_pasep_cifrado', cifrado: true, data: false },
  { campo: 'rg', coluna: 'rg_numero_cifrado', cifrado: true, data: false },
  { campo: 'orgaoRg', coluna: 'rg_orgao', cifrado: false, data: false },
  { campo: 'expedicao', coluna: 'rg_expedicao', cifrado: false, data: true },
  { campo: 'titulo', coluna: 'titulo_eleitor_cifrado', cifrado: true, data: false },
  { campo: 'endereco', coluna: 'endereco_cifrado', cifrado: true, data: false },
];

type CampoVinculo = { campo: Exclude<keyof CamposVinculo, 'matriculaNorm'>; coluna: string; data: boolean };
const CAMPOS_VINCULO: readonly CampoVinculo[] = [
  { campo: 'matricula', coluna: 'matricula', data: false },
  { campo: 'regime', coluna: 'regime_juridico', data: false },
  { campo: 'cargo', coluna: 'cargo', data: false },
  { campo: 'referencia', coluna: 'referencia', data: false },
  { campo: 'setor', coluna: 'setor', data: false },
  { campo: 'orgao', coluna: 'orgao_nome', data: false },
  { campo: 'admissao', coluna: 'admissao', data: true },
  { campo: 'desligamento', coluna: 'desligamento', data: true },
];

function selecionarColuna(coluna: string, data: boolean): string {
  return data ? `to_char(${coluna}, 'YYYY-MM-DD') AS ${coluna}` : coluna;
}

function hashIgual(atual: Buffer | null, novo: Buffer): boolean {
  return atual !== null && atual.equals(novo);
}

async function gravarDadosFuncionais(
  estado: Estado,
  analise: Extract<ResultadoAnalise['analise'], { tipo: 'dados_funcionais' }>,
): Promise<void> {
  const { cliente, protetor, origem } = estado;
  const cifrar = (valor: string | null, tabela: string, id: string, campo: string): Buffer | null =>
    valor === null ? null : protetor.cifrar(Buffer.from(valor, 'utf8'), { schema: 'nucleo', tabela, registroId: id, campo });
  const hashes = analise.pessoas.map((pessoa) => protetor.hashCpf(pessoa.cpf));
  const existentes = new Map<string, string>();
  const origens = new Map<string, Buffer | null>();
  for (let inicio = 0; inicio < hashes.length; inicio += 5000) {
    const bloco = hashes.slice(inicio, inicio + 5000);
    const pessoas = await cliente.query<{ id: string; cpf_hash: Buffer }>(
      'SELECT id, cpf_hash FROM nucleo.pessoa WHERE cpf_hash = ANY($1::bytea[])', [bloco],
    );
    for (const linha of pessoas.rows) existentes.set(linha.cpf_hash.toString('hex'), linha.id);
    const registros = await cliente.query<{ id_origem: string; hash_conteudo: Buffer | null }>(
      'SELECT id_origem, hash_conteudo FROM nucleo.pessoa_origem WHERE sistema_origem = $1 AND id_origem = ANY($2::text[])',
      [origem, bloco.map((hash) => hash.toString('hex'))],
    );
    for (const linha of registros.rows) origens.set(linha.id_origem, linha.hash_conteudo);
  }

  const idPorCpf = new Map<string, string>();
  const novasPessoas: unknown[][] = [];
  const novasOrigens: unknown[][] = [];
  const verificar: Array<{ id: string; idOrigem: string; campos: CamposPessoa; hash: Buffer; linha: number }> = [];
  analise.pessoas.forEach((pessoa, indice) => {
    const idOrigem = hashes[indice].toString('hex');
    const hash = protetor.hashConteudo('importacao', 'pessoa', CAMPOS_PESSOA.map(({ campo }) => pessoa.campos[campo]));
    const existente = existentes.get(idOrigem);
    if (!existente) {
      const id = randomUUID();
      idPorCpf.set(pessoa.cpf, id);
      const c = pessoa.campos;
      novasPessoas.push([
        id, protetor.cifrar(Buffer.from(pessoa.cpf, 'ascii'), { schema: 'nucleo', tabela: 'pessoa', registroId: id, campo: 'cpf_cifrado' }),
        hashes[indice], c.nome, normalizarNomeBusca(c.nome), c.nascimento,
        cifrar(c.mae, 'pessoa', id, 'nome_mae_cifrado'), cifrar(c.pis, 'pessoa', id, 'pis_pasep_cifrado'),
        cifrar(c.rg, 'pessoa', id, 'rg_numero_cifrado'), c.orgaoRg, c.expedicao,
        cifrar(c.titulo, 'pessoa', id, 'titulo_eleitor_cifrado'), cifrar(c.endereco, 'pessoa', id, 'endereco_cifrado'),
      ]);
      novasOrigens.push([id, origem, idOrigem, hash]);
      estado.contagens.inseridos += 1;
      return;
    }
    idPorCpf.set(pessoa.cpf, existente);
    if (!estado.preservarExistentes && origens.has(idOrigem) && hashIgual(origens.get(idOrigem) ?? null, hash)) {
      estado.contagens.inalterados += 1;
      return;
    }
    verificar.push({ id: existente, idOrigem, campos: pessoa.campos, hash, linha: pessoa.linha });
  });

  await inserirEmBloco(estado, 'pessoa', [
    ['id', 'uuid'], ['cpf_cifrado', 'bytea'], ['cpf_hash', 'bytea'], ['nome', 'text'], ['nome_busca', 'text'],
    ['nascimento', 'date'], ['nome_mae_cifrado', 'bytea'], ['pis_pasep_cifrado', 'bytea'], ['rg_numero_cifrado', 'bytea'],
    ['rg_orgao', 'text'], ['rg_expedicao', 'date'], ['titulo_eleitor_cifrado', 'bytea'], ['endereco_cifrado', 'bytea'],
  ], novasPessoas);
  await inserirEmBloco(estado, 'pessoa_origem', [
    ['pessoa_id', 'uuid'], ['sistema_origem', 'text'], ['id_origem', 'text'], ['hash_conteudo', 'bytea'],
  ], novasOrigens);

  for (const item of verificar) {
    const atual = (await cliente.query<Record<string, string | Buffer | null>>(
      `SELECT ${CAMPOS_PESSOA.map(({ coluna, data }) => selecionarColuna(coluna, data)).join(', ')} FROM nucleo.pessoa WHERE id = $1 FOR UPDATE`,
      [item.id],
    )).rows[0];
    const alteracoes: Array<[string, unknown]> = [];
    for (const descritor of CAMPOS_PESSOA) {
      const novo = item.campos[descritor.campo];
      if (novo === null) continue;
      const bruto = atual[descritor.coluna];
      const valorAtual = descritor.cifrado && Buffer.isBuffer(bruto)
        ? protetor.decifrar(bruto, { schema: 'nucleo', tabela: 'pessoa', registroId: item.id, campo: descritor.coluna }).toString('utf8')
        : bruto;
      if (valorAtual === novo) continue;
      if (estado.preservarExistentes && valorAtual !== null && valorAtual !== '') {
        estado.ocorrencias.push({ linha: item.linha, tipo: 'divergencia',
          motivo: `Campo ${descritor.campo}: dado existente preservado; confira a origem e revise no cadastro local.`,
          referencia: 'pessoa existente' });
        continue;
      }
      alteracoes.push([descritor.coluna, descritor.cifrado ? cifrar(novo, 'pessoa', item.id, descritor.coluna) : novo]);
      if (descritor.campo === 'nome') alteracoes.push(['nome_busca', normalizarNomeBusca(novo)]);
    }
    if (alteracoes.length > 0) {
      await registrarAnterior(estado, 'pessoa', item.id);
      await cliente.query(`
        UPDATE nucleo.pessoa SET ${alteracoes.map(([coluna], indice) => `${coluna} = $${indice + 3}`).join(', ')},
          atualizado_em = now(), lote_importacao_id = $2, importado_em = now()
        WHERE id = $1
      `, [item.id, estado.loteId, ...alteracoes.map(([, valor]) => valor)]);
      estado.contagens.atualizados += 1;
    } else {
      estado.contagens.inalterados += 1;
    }
    if (origens.has(item.idOrigem)) {
      await estado.cliente.query(`
        INSERT INTO nucleo.importacao_registro (lote_id, tabela, chave, acao, anterior)
        SELECT $1, 'pessoa_origem', jsonb_build_object('sistema_origem', sistema_origem, 'id_origem', id_origem), 'atualizado', to_jsonb(o)
        FROM nucleo.pessoa_origem o WHERE sistema_origem = $2 AND id_origem = $3
      `, [estado.loteId, origem, item.idOrigem]);
      await cliente.query(`
        UPDATE nucleo.pessoa_origem SET hash_conteudo = $3, lote_importacao_id = $4, importado_em = now()
        WHERE sistema_origem = $1 AND id_origem = $2
      `, [origem, item.idOrigem, item.hash, estado.loteId]);
    } else {
      await inserirEmBloco(estado, 'pessoa_origem', [
        ['pessoa_id', 'uuid'], ['sistema_origem', 'text'], ['id_origem', 'text'], ['hash_conteudo', 'bytea'],
      ], [[item.id, origem, item.idOrigem, item.hash]]);
    }
    estado.progresso(1);
  }

  type VinculoBanco = Record<string, string | Buffer | null> & { id: string; pessoa_id: string; matricula_norm: string; hash_conteudo: Buffer | null };
  const vinculosExistentes = new Map<string, VinculoBanco>();
  const matriculas = analise.vinculos.map((vinculo) => vinculo.campos.matriculaNorm);
  for (let inicio = 0; inicio < matriculas.length; inicio += 5000) {
    const resultado = await cliente.query<VinculoBanco>(`
      SELECT id, pessoa_id, matricula_norm, hash_conteudo, ${CAMPOS_VINCULO.map(({ coluna, data }) => selecionarColuna(coluna, data)).join(', ')}
      FROM nucleo.vinculo WHERE sistema_origem = $1 AND matricula_norm = ANY($2::text[]) ORDER BY id FOR UPDATE
    `, [origem, matriculas.slice(inicio, inicio + 5000)]);
    for (const linha of resultado.rows) vinculosExistentes.set(linha.matricula_norm, linha);
  }
  const novosVinculos: unknown[][] = [];
  for (const vinculo of analise.vinculos) {
    const pessoaId = idPorCpf.get(vinculo.cpf);
    if (!pessoaId) throw new Error('Pessoa consolidada ausente durante a importação.');
    const c = vinculo.campos;
    const hash = protetor.hashConteudo('importacao', 'vinculo', CAMPOS_VINCULO.map(({ campo }) => c[campo]));
    const existente = vinculosExistentes.get(c.matriculaNorm);
    if (!existente) {
      novosVinculos.push([
        randomUUID(), pessoaId, c.matricula, c.matriculaNorm, origem, c.matriculaNorm, c.regime, c.cargo, c.referencia,
        c.setor, c.orgao, c.admissao, c.desligamento, hash,
      ]);
      estado.contagens.inseridos += 1;
      continue;
    }
    if (existente.pessoa_id !== pessoaId) {
      rejeitarNoBanco(estado, vinculo.linha, 'Matrícula já vinculada a outro CPF nesta origem; linha rejeitada.',
        `matrícula ${mascararMatricula(c.matricula)} / CPF ${mascararCpf(vinculo.cpf)}`);
      continue;
    }
    if (!estado.preservarExistentes && hashIgual(existente.hash_conteudo, hash)) {
      estado.contagens.inalterados += 1;
      continue;
    }
    const alteracoes: Array<[string, unknown]> = [];
    for (const descritor of CAMPOS_VINCULO) {
      const novo = c[descritor.campo];
      if (novo !== null && existente[descritor.coluna] !== novo && estado.preservarExistentes
        && existente[descritor.coluna] !== null && existente[descritor.coluna] !== '') {
        estado.ocorrencias.push({ linha: vinculo.linha, tipo: 'divergencia',
          motivo: `Campo ${descritor.campo}: dado existente preservado; confira a origem e revise no cadastro local.`,
          referencia: `matrícula ${mascararMatricula(c.matricula)}` });
        continue;
      }
      if (novo !== null && existente[descritor.coluna] !== novo) alteracoes.push([descritor.coluna, novo]);
    }
    if (alteracoes.length === 0) {
      estado.contagens.inalterados += 1;
      continue;
    }
    await registrarAnterior(estado, 'vinculo', existente.id);
    await cliente.query(`
      UPDATE nucleo.vinculo SET ${alteracoes.map(([coluna], indice) => `${coluna} = $${indice + 4}`).join(', ')},
        hash_conteudo = $3, lote_importacao_id = $2, importado_em = now()
      WHERE id = $1
    `, [existente.id, estado.loteId, hash, ...alteracoes.map(([, valor]) => valor)]);
    estado.contagens.atualizados += 1;
    estado.progresso(1);
  }
  await inserirEmBloco(estado, 'vinculo', [
    ['id', 'uuid'], ['pessoa_id', 'uuid'], ['matricula', 'text'], ['matricula_norm', 'text'], ['sistema_origem', 'text'],
    ['id_origem', 'text'], ['regime_juridico', 'text'], ['cargo', 'text'], ['referencia', 'text'], ['setor', 'text'],
    ['orgao_nome', 'text'], ['admissao', 'date'], ['desligamento', 'date'], ['hash_conteudo', 'bytea'],
  ], novosVinculos);
}

async function resolverVinculos(estado: Estado, matriculas: string[]): Promise<Map<string, string | 'ambigua'>> {
  const resultado = new Map<string, string | 'ambigua'>();
  const unicas = [...new Set(matriculas)];
  for (let inicio = 0; inicio < unicas.length; inicio += 5000) {
    const linhas = await estado.cliente.query<{ id: string; matricula_norm: string; sistema_origem: string }>(
      'SELECT id, matricula_norm, sistema_origem FROM nucleo.vinculo WHERE matricula_norm = ANY($1::text[]) ORDER BY matricula_norm',
      [unicas.slice(inicio, inicio + 5000)],
    );
    const porMatricula = new Map<string, Array<{ id: string; sistema_origem: string }>>();
    for (const linha of linhas.rows) {
      const lista = porMatricula.get(linha.matricula_norm) ?? [];
      lista.push(linha);
      porMatricula.set(linha.matricula_norm, lista);
    }
    for (const [matricula, lista] of porMatricula) {
      const mesmaOrigem = lista.find((item) => item.sistema_origem === estado.origem);
      resultado.set(matricula, mesmaOrigem ? mesmaOrigem.id : lista.length === 1 ? lista[0].id : 'ambigua');
    }
  }
  return resultado;
}

type Dependente = {
  tabela: 'afastamento' | 'incorporacao' | 'periodo_ipam' | 'evento_funcional';
  pai: 'vinculo_id' | 'pessoa_id';
  colunasInsercao: readonly Coluna[];
  colunasAtualizaveis: readonly string[];
};

type ItemDependente = {
  linha: number;
  referencia: string;
  paiChave: string;
  idOrigem: string;
  hashDados: unknown[];
  insercao: (id: string, paiId: string, hash: Buffer) => unknown[];
  atualizacao: (id: string) => unknown[];
};

async function gravarDependentes(estado: Estado, definicao: Dependente, itens: ItemDependente[], pais: Map<string, string | 'ambigua'>, semPai: string): Promise<void> {
  const { cliente, protetor, origem } = estado;
  const existentes = new Map<string, { id: string; pai: string; hash_conteudo: Buffer | null }>();
  for (let inicio = 0; inicio < itens.length; inicio += 5000) {
    const resultado = await cliente.query<{ id: string; id_origem: string; pai: string; hash_conteudo: Buffer | null }>(`
      SELECT id, id_origem, ${definicao.pai} AS pai, hash_conteudo FROM nucleo.${definicao.tabela}
      WHERE sistema_origem = $1 AND id_origem = ANY($2::text[])
    `, [origem, itens.slice(inicio, inicio + 5000).map((item) => item.idOrigem)]);
    for (const linha of resultado.rows) existentes.set(linha.id_origem, linha);
  }
  const novos: unknown[][] = [];
  for (const item of itens) {
    const pai = pais.get(item.paiChave);
    if (!pai) {
      rejeitarNoBanco(estado, item.linha, semPai, item.referencia);
      continue;
    }
    if (pai === 'ambigua') {
      rejeitarNoBanco(estado, item.linha, 'Matrícula existe em mais de uma origem; importe com a mesma origem dos dados funcionais.', item.referencia);
      continue;
    }
    const hash = protetor.hashConteudo('importacao', definicao.tabela, item.hashDados);
    const existente = existentes.get(item.idOrigem);
    if (!existente) {
      novos.push(item.insercao(randomUUID(), pai, hash));
      estado.contagens.inseridos += 1;
      continue;
    }
    if (existente.pai !== pai) {
      rejeitarNoBanco(estado, item.linha, 'Registro desta origem já pertence a outro servidor; linha rejeitada.', item.referencia);
      continue;
    }
    if (hashIgual(existente.hash_conteudo, hash)) {
      estado.contagens.inalterados += 1;
      continue;
    }
    if (estado.preservarExistentes) {
      estado.ocorrencias.push({ linha: item.linha, tipo: 'divergencia', referencia: item.referencia,
        motivo: 'Registro existente preservado; confira a origem e revise a referência antes de substituir.' });
      estado.contagens.inalterados += 1;
      continue;
    }
    await registrarAnterior(estado, definicao.tabela, existente.id);
    const valores = item.atualizacao(existente.id);
    await cliente.query(`
      UPDATE nucleo.${definicao.tabela} SET ${definicao.colunasAtualizaveis.map((coluna, indice) => `${coluna} = $${indice + 4}`).join(', ')},
        hash_conteudo = $3, lote_importacao_id = $2, importado_em = now()
      WHERE id = $1
    `, [existente.id, estado.loteId, hash, ...valores]);
    estado.contagens.atualizados += 1;
    estado.progresso(1);
  }
  await inserirEmBloco(estado, definicao.tabela, definicao.colunasInsercao, novos);
}

const SEM_VINCULO = 'Matrícula não encontrada; importe antes os dados funcionais.';

async function gravarAfastamentos(estado: Estado, registros: AfastamentoArquivo[]): Promise<void> {
  const pais = await resolverVinculos(estado, registros.map((registro) => registro.matriculaNorm));
  await gravarDependentes(estado, {
    tabela: 'afastamento',
    pai: 'vinculo_id',
    colunasInsercao: [
      ['id', 'uuid'], ['vinculo_id', 'uuid'], ['tipo', 'text'], ['data_inicio', 'date'], ['data_fim', 'date'],
      ['ano_ref', 'integer'], ['dias_ano', 'integer'], ['fonte', 'text'], ['sistema_origem', 'text'], ['id_origem', 'text'], ['hash_conteudo', 'bytea'],
    ],
    colunasAtualizaveis: ['dias_ano'],
  }, registros.map((registro) => ({
    linha: registro.linha,
    referencia: `matrícula ${mascararMatricula(registro.matriculaNorm)}`,
    paiChave: registro.matriculaNorm,
    idOrigem: registro.idOrigem,
    hashDados: [registro.tipo, registro.ano, registro.dias, registro.inicio, registro.fim],
    insercao: (id, pai, hash) => [id, pai, registro.tipo, registro.inicio, registro.fim, registro.ano, registro.dias, 'importacao', estado.origem, registro.idOrigem, hash],
    atualizacao: () => [registro.dias],
  })), pais, SEM_VINCULO);
}

async function gravarIncorporacoes(estado: Estado, registros: IncorporacaoArquivo[]): Promise<void> {
  const pais = await resolverVinculos(estado, registros.map((registro) => registro.matriculaNorm));
  await gravarDependentes(estado, {
    tabela: 'incorporacao',
    pai: 'vinculo_id',
    colunasInsercao: [
      ['id', 'uuid'], ['vinculo_id', 'uuid'], ['tipo', 'text'], ['data_inicio', 'date'], ['data_fim', 'date'], ['convencao', 'text'],
      ['origem', 'text'], ['sistema_origem', 'text'], ['id_origem', 'text'], ['hash_conteudo', 'bytea'],
    ],
    colunasAtualizaveis: ['data_fim'],
  }, registros.map((registro) => ({
    linha: registro.linha,
    referencia: `matrícula ${mascararMatricula(registro.matriculaNorm)}`,
    paiChave: registro.matriculaNorm,
    idOrigem: registro.idOrigem,
    hashDados: [registro.tipo, registro.inicio, registro.fim],
    insercao: (id, pai, hash) => [id, pai, registro.tipo, registro.inicio, registro.fim, 'inclusivo', 'importacao', estado.origem, registro.idOrigem, hash],
    atualizacao: () => [registro.fim],
  })), pais, SEM_VINCULO);
}

async function gravarPeriodosIpam(estado: Estado, registros: PeriodoIpamArquivo[]): Promise<void> {
  const hashes = new Map(registros.map((registro) => [registro.cpf, estado.protetor.hashCpf(registro.cpf)]));
  const pais = new Map<string, string | 'ambigua'>();
  const lista = [...hashes.values()];
  for (let inicio = 0; inicio < lista.length; inicio += 5000) {
    const resultado = await estado.cliente.query<{ id: string; cpf_hash: Buffer }>(
      'SELECT id, cpf_hash FROM nucleo.pessoa WHERE cpf_hash = ANY($1::bytea[])', [lista.slice(inicio, inicio + 5000)],
    );
    for (const linha of resultado.rows) pais.set(linha.cpf_hash.toString('hex'), linha.id);
  }
  await gravarDependentes(estado, {
    tabela: 'periodo_ipam',
    pai: 'pessoa_id',
    colunasInsercao: [
      ['id', 'uuid'], ['pessoa_id', 'uuid'], ['mes_inicio', 'date'], ['mes_fim', 'date'], ['fonte', 'text'],
      ['sistema_origem', 'text'], ['id_origem', 'text'], ['hash_conteudo', 'bytea'],
    ],
    colunasAtualizaveis: ['mes_fim'],
  }, registros.map((registro) => {
    const chave = (hashes.get(registro.cpf) as Buffer).toString('hex');
    const idOrigem = `${chave}|${registro.inicio}`;
    return {
      linha: registro.linha,
      referencia: `CPF ${mascararCpf(registro.cpf)}`,
      paiChave: chave,
      idOrigem,
      hashDados: [registro.inicio, registro.fim],
      insercao: (id, pai, hash) => [id, pai, registro.inicio, registro.fim, 'importacao', estado.origem, idOrigem, hash],
      atualizacao: () => [registro.fim],
    };
  }), pais, 'CPF não encontrado; importe antes os dados funcionais.');
}

async function gravarEventos(estado: Estado, registros: EventoArquivo[]): Promise<void> {
  const pais = await resolverVinculos(estado, registros.map((registro) => registro.matriculaNorm));
  const descricao = (registro: EventoArquivo, id: string) => registro.descricao === null ? null
    : estado.protetor.cifrar(Buffer.from(registro.descricao, 'utf8'), {
      schema: 'nucleo', tabela: 'evento_funcional', registroId: id, campo: 'descricao_origem_cifrada',
    });
  await gravarDependentes(estado, {
    tabela: 'evento_funcional',
    pai: 'vinculo_id',
    colunasInsercao: [
      ['id', 'uuid'], ['vinculo_id', 'uuid'], ['tipo', 'text'], ['data_evento', 'date'], ['data_publicacao', 'date'],
      ['ato_numero', 'text'], ['descricao_origem_cifrada', 'bytea'], ['fonte', 'text'], ['sistema_origem', 'text'],
      ['id_origem', 'text'], ['hash_conteudo', 'bytea'],
    ],
    colunasAtualizaveis: ['data_publicacao', 'descricao_origem_cifrada'],
  }, registros.map((registro) => ({
    linha: registro.linha,
    referencia: `matrícula ${mascararMatricula(registro.matriculaNorm)}`,
    paiChave: registro.matriculaNorm,
    idOrigem: registro.idOrigem,
    hashDados: [registro.tipo, registro.data, registro.atoNumero, registro.dataPublicacao, registro.descricao],
    insercao: (id, pai, hash) => [
      id, pai, registro.tipo, registro.data, registro.dataPublicacao, registro.atoNumero, descricao(registro, id),
      'importacao', estado.origem, registro.idOrigem, hash,
    ],
    atualizacao: (id) => [registro.dataPublicacao, descricao(registro, id)],
  })), pais, SEM_VINCULO);
}

function totalRegistros(resultado: ResultadoAnalise): number {
  const analise = resultado.analise;
  return analise.tipo === 'dados_funcionais' ? analise.pessoas.length + analise.vinculos.length : analise.registros.length;
}

function montarContagens(resultado: ResultadoAnalise, ocorrencias: OcorrenciaImportacao[], banco: Estado['contagens'] | null): ContagensImportacao {
  const contar = (tipo: OcorrenciaImportacao['tipo']) => ocorrencias.filter((item) => item.tipo === tipo).length;
  return {
    lidos: resultado.lidos,
    validos: Math.max(0, resultado.validos - (banco?.rejeitadosBanco ?? 0)),
    rejeitados: contar('rejeitada'),
    duplicados: contar('duplicada'),
    quarentena: contar('quarentena'),
    anomalias: contar('anomalia') + contar('divergencia'),
    inseridos: banco?.inseridos ?? 0,
    atualizados: banco?.atualizados ?? 0,
    inalterados: banco?.inalterados ?? 0,
  };
}

function relatorio(
  resultado: ResultadoAnalise, opcoes: OpcoesImportacao, loteId: string | null, loteExistente: string | null,
  ocorrencias: OcorrenciaImportacao[], banco: Estado['contagens'] | null, inicio: number, linhas: string[][],
): RelatorioImportacao {
  const cabecalho = linhas.find((linha) => linha.some((valor) => valor.trim()));
  const mapeamento = cabecalho ? sugerirMapeamento(opcoes.tipo, cabecalho) : {};
  const ordenadas = [...ocorrencias].sort((a, b) => a.linha - b.linha).map((item) => {
    if (!opcoes.referenciasCompletas) return item;
    const linha = linhas[item.linha - 1];
    const campos = ['MATRICULA', 'NOME', 'CPF'].flatMap((campo) => {
      const indice = mapeamento[campo];
      return indice !== null && indice !== undefined && linha?.[indice] ? [`${campo}: ${linha[indice]}`] : [];
    });
    return campos.length ? { ...item, referencia: campos.join(' / ') } : item;
  });
  const limite = opcoes.limiteOcorrencias ?? LIMITE_OCORRENCIAS;
  return {
    loteId,
    tipo: opcoes.tipo,
    origem: opcoes.origem,
    modo: opcoes.gravar ? 'gravacao' : 'validacao',
    loteExistente,
    contagens: montarContagens(resultado, ocorrencias, banco),
    ocorrencias: ordenadas.slice(0, limite),
    ocorrenciasOmitidas: Math.max(0, ordenadas.length - limite),
    avisos: resultado.avisos,
    duracaoMs: Math.round(performance.now() - inicio),
  };
}

export async function importarLinhas(
  cliente: ClientBase, protetor: ProtetorDados, linhas: string[][], opcoes: OpcoesImportacao,
): Promise<RelatorioImportacao> {
  const inicio = performance.now();
  const origem = origemImportacaoSchema.parse(opcoes.origem);
  const resultado = analisarLinhas(opcoes.tipo, linhas);
  const total = Math.max(1, totalRegistros(resultado));
  let feitos = 0;
  const estado: Estado = {
    cliente, protetor, loteId: randomUUID(), origem, preservarExistentes: opcoes.preservarExistentes ?? false,
    ocorrencias: [...resultado.ocorrencias],
    contagens: { inseridos: 0, atualizados: 0, inalterados: 0, rejeitadosBanco: 0 },
    progresso: (avanco) => {
      feitos = Math.min(total, feitos + avanco);
      opcoes.progresso?.(feitos, total);
    },
  };
  await cliente.query('BEGIN');
  let aberta = true;
  try {
    if (opcoes.antes) await opcoes.antes(cliente);
    await cliente.query('SELECT pg_advisory_xact_lock($1, $2)', [...CHAVE_BLOQUEIO_IMPORTACAO]);
    if (opcoes.preparar) await opcoes.preparar(cliente);
    const usuario = await cliente.query("SELECT 1 FROM seguranca.usuario WHERE id = $1 AND ativo AND papel = 'admin'", [opcoes.usuarioId]);
    if (usuario.rowCount !== 1) throw new ErroImportacao('A importação exige um usuário administrador ativo.');
    const anterior = await cliente.query<{ id: string }>(`
      SELECT id FROM nucleo.importacao_lote
      WHERE tipo = $1 AND sistema_origem = $2 AND hash_arquivo = $3 AND status = 'concluido'
      ORDER BY iniciado_em DESC LIMIT 1
    `, [opcoes.tipo, origem, opcoes.hashArquivo]);
    if (anterior.rows[0] && !(opcoes.revalidarExistente && !opcoes.gravar)) {
      await cliente.query('ROLLBACK');
      aberta = false;
      const banco = { inseridos: 0, atualizados: 0, inalterados: totalRegistros(resultado), rejeitadosBanco: 0 };
      return relatorio(resultado, opcoes, null, anterior.rows[0].id, resultado.ocorrencias, banco, inicio, linhas);
    }
    await cliente.query(`
      INSERT INTO nucleo.importacao_lote (id, origem, hash_arquivo, usuario_id, status, tipo, sistema_origem, canal)
      VALUES ($1, $2, $3, $4, 'processando', $5, $6, $7)
    `, [estado.loteId, `${opcoes.canal}:${origem}`, opcoes.hashArquivo, opcoes.usuarioId, opcoes.tipo, origem, opcoes.canal]);
    const analise = resultado.analise;
    if (analise.tipo === 'dados_funcionais') await gravarDadosFuncionais(estado, analise);
    else if (analise.tipo === 'afastamentos') await gravarAfastamentos(estado, analise.registros);
    else if (analise.tipo === 'incorporacoes') await gravarIncorporacoes(estado, analise.registros);
    else if (analise.tipo === 'periodos_ipam') await gravarPeriodosIpam(estado, analise.registros);
    else await gravarEventos(estado, analise.registros);
    opcoes.progresso?.(total, total);
    const final = relatorio(resultado, opcoes, opcoes.gravar ? estado.loteId : null, anterior.rows[0]?.id ?? null, estado.ocorrencias, estado.contagens, inicio, linhas);
    if (!opcoes.gravar) {
      await cliente.query('ROLLBACK');
      aberta = false;
      return final;
    }
    await cliente.query(`
      UPDATE nucleo.importacao_lote SET status = 'concluido', contagens = $2::jsonb, concluido_em = now() WHERE id = $1
    `, [estado.loteId, JSON.stringify(final.contagens)]);
    await cliente.query(`
      INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, entidade_id, ip, detalhes)
      VALUES ($1, 'importacao_concluida', 'importacao_lote', $2, $3, $4::jsonb)
    `, [opcoes.usuarioId, estado.loteId, opcoes.ip ?? null, JSON.stringify({
      tipo: opcoes.tipo, origem, canal: opcoes.canal, contagens: final.contagens,
      ...(opcoes.loteLegadoId ? { loteLegadoId: opcoes.loteLegadoId, politica: 'preencher_vazios' } : {}),
    })]);
    await cliente.query('COMMIT');
    aberta = false;
    return final;
  } catch (erro) {
    if (aberta) await cliente.query('ROLLBACK').catch(() => undefined);
    const erroHttp = erro instanceof Error && 'getStatus' in erro;
    if (opcoes.gravar && !(erro instanceof ErroImportacao) && !erroHttp) await registrarFalha(cliente, opcoes, origem, resultado.lidos);
    throw erro;
  }
}

async function registrarFalha(cliente: ClientBase, opcoes: OpcoesImportacao, origem: string, lidos: number): Promise<void> {
  try {
    await cliente.query(`
      INSERT INTO nucleo.importacao_lote (origem, hash_arquivo, usuario_id, status, tipo, sistema_origem, canal, contagens, concluido_em)
      VALUES ($1, $2, $3, 'falhou', $4, $5, $6, $7::jsonb, now())
    `, [`${opcoes.canal}:${origem}`, opcoes.hashArquivo, opcoes.usuarioId, opcoes.tipo, origem, opcoes.canal, JSON.stringify({ lidos })]);
  } catch {
    // O registro da falha é complementar; a causa original é propagada ao chamador.
  }
}

const TABELAS_ROLLBACK = new Set(['pessoa', 'pessoa_origem', 'vinculo', 'afastamento', 'incorporacao', 'periodo_ipam', 'evento_funcional']);

export type ResultadoRollback = { loteId: string; removidos: number; restaurados: number };

// Requer o papel de migração: a aplicação não possui DELETE em dados pessoais.
export async function desfazerLote(cliente: ClientBase, loteId: string): Promise<ResultadoRollback> {
  await cliente.query('BEGIN');
  try {
    await cliente.query('SELECT pg_advisory_xact_lock($1, $2)', [...CHAVE_BLOQUEIO_IMPORTACAO]);
    const lote = (await cliente.query<{ status: string; iniciado_em: Date; tipo: string; sistema_origem: string }>(
      'SELECT status, iniciado_em, tipo, sistema_origem FROM nucleo.importacao_lote WHERE id = $1 FOR UPDATE', [loteId],
    )).rows[0];
    if (!lote) throw new ErroImportacao('Lote de importação não encontrado.');
    if (lote.status !== 'concluido') throw new ErroImportacao(`O lote está com situação "${lote.status}" e não pode ser desfeito.`);
    const posterior = await cliente.query<{ id: string }>(`
      SELECT id FROM nucleo.importacao_lote
      WHERE status = 'concluido' AND id <> $1
        AND iniciado_em >= (SELECT iniciado_em FROM nucleo.importacao_lote WHERE id = $1)
      ORDER BY iniciado_em DESC LIMIT 1
    `, [loteId]);
    if (posterior.rows[0]) {
      throw new ErroImportacao(`Desfaça antes o lote mais recente (${posterior.rows[0].id}); os lotes são desfeitos do mais novo para o mais antigo.`);
    }
    const emitidos = await cliente.query<{ total: string }>(`
      WITH registro AS (
        SELECT tabela, (chave->>'id')::uuid AS id FROM nucleo.importacao_registro WHERE lote_id = $1 AND tabela <> 'pessoa_origem'
      ), pessoas AS (
        SELECT id AS pessoa_id FROM registro WHERE tabela = 'pessoa'
        UNION SELECT v.pessoa_id FROM registro r JOIN nucleo.vinculo v ON v.id = r.id WHERE r.tabela = 'vinculo'
        UNION SELECT v.pessoa_id FROM registro r JOIN nucleo.afastamento a ON a.id = r.id JOIN nucleo.vinculo v ON v.id = a.vinculo_id WHERE r.tabela = 'afastamento'
        UNION SELECT v.pessoa_id FROM registro r JOIN nucleo.incorporacao i ON i.id = r.id JOIN nucleo.vinculo v ON v.id = i.vinculo_id WHERE r.tabela = 'incorporacao'
        UNION SELECT v.pessoa_id FROM registro r JOIN nucleo.evento_funcional e ON e.id = r.id JOIN nucleo.vinculo v ON v.id = e.vinculo_id WHERE r.tabela = 'evento_funcional'
        UNION SELECT p.pessoa_id FROM registro r JOIN nucleo.periodo_ipam p ON p.id = r.id WHERE r.tabela = 'periodo_ipam'
      )
      SELECT count(*) AS total FROM documentos.emissao e JOIN documentos.documento d ON d.id = e.documento_id
      WHERE d.pessoa_id IN (SELECT pessoa_id FROM pessoas)
    `, [loteId]);
    if (Number(emitidos.rows[0].total) > 0) {
      throw new ErroImportacao('Há documentos emitidos para servidores alterados por este lote; o lote não pode ser desfeito.');
    }
    const colunas = new Map<string, string[]>();
    const registros = await cliente.query<{ tabela: string; chave: Record<string, string>; acao: string; anterior: unknown }>(
      'SELECT tabela, chave, acao, anterior FROM nucleo.importacao_registro WHERE lote_id = $1 ORDER BY id DESC', [loteId],
    );
    let removidos = 0;
    let restaurados = 0;
    for (const registro of registros.rows) {
      if (!TABELAS_ROLLBACK.has(registro.tabela)) throw new Error('Registro de importação com tabela inesperada.');
      const porOrigem = registro.tabela === 'pessoa_origem';
      const condicao = porOrigem ? 'alvo.sistema_origem = $1 AND alvo.id_origem = $2' : 'alvo.id = $1::uuid';
      const chave = porOrigem ? [registro.chave.sistema_origem, registro.chave.id_origem] : [registro.chave.id];
      if (registro.acao === 'inserido') {
        await cliente.query(`DELETE FROM nucleo.${registro.tabela} AS alvo WHERE ${condicao}`, chave);
        removidos += 1;
        continue;
      }
      let lista = colunas.get(registro.tabela);
      if (!lista) {
        lista = (await cliente.query<{ column_name: string }>(`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'nucleo' AND table_name = $1 AND column_name NOT IN ('id', 'sistema_origem', 'id_origem', 'revisao_fonte')
          ORDER BY ordinal_position
        `, [registro.tabela])).rows.map((linha) => linha.column_name);
        colunas.set(registro.tabela, lista);
      }
      await cliente.query(`
        UPDATE nucleo.${registro.tabela} AS alvo SET ${lista.map((coluna) => `${coluna} = anterior.${coluna}`).join(', ')}
        FROM jsonb_populate_record(NULL::nucleo.${registro.tabela}, $${chave.length + 1}::jsonb) AS anterior
        WHERE ${condicao}
      `, [...chave, JSON.stringify(registro.anterior)]);
      restaurados += 1;
    }
    await cliente.query("UPDATE nucleo.importacao_lote SET status = 'desfeito', desfeito_em = now() WHERE id = $1", [loteId]);
    await cliente.query(`
      INSERT INTO seguranca.auditoria (usuario_id, acao, entidade, entidade_id, detalhes)
      VALUES (NULL, 'importacao_desfeita', 'importacao_lote', $1, $2::jsonb)
    `, [loteId, JSON.stringify({ tipo: lote.tipo, origem: lote.sistema_origem, removidos, restaurados, registradoPor: 'cli_importacao' })]);
    await cliente.query('COMMIT');
    return { loteId, removidos, restaurados };
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    if (erro instanceof DatabaseError && erro.code === '23503') {
      throw new ErroImportacao('Não é possível desfazer: documentos, auditorias ou registros posteriores dependem dos dados deste lote.');
    }
    throw erro;
  }
}

export async function conferenciaGeral(cliente: ClientBase): Promise<ConferenciaImportacao> {
  const resultado = await cliente.query<{
    origem: string; pessoas: number; vinculos: number; afastamentos: number; incorporacoes: number;
    periodos_ipam: number; eventos: number; removidos: number;
  }>(`
    WITH origens AS (
      SELECT sistema_origem FROM nucleo.vinculo UNION SELECT sistema_origem FROM nucleo.pessoa_origem
      UNION SELECT sistema_origem FROM nucleo.afastamento WHERE sistema_origem IS NOT NULL
      UNION SELECT sistema_origem FROM nucleo.incorporacao WHERE sistema_origem IS NOT NULL
      UNION SELECT sistema_origem FROM nucleo.periodo_ipam WHERE sistema_origem IS NOT NULL
      UNION SELECT sistema_origem FROM nucleo.evento_funcional WHERE sistema_origem IS NOT NULL
    )
    SELECT o.sistema_origem AS origem,
      (SELECT count(*)::int FROM nucleo.pessoa_origem x WHERE x.sistema_origem = o.sistema_origem) AS pessoas,
      (SELECT count(*)::int FROM nucleo.vinculo x WHERE x.sistema_origem = o.sistema_origem) AS vinculos,
      (SELECT count(*)::int FROM nucleo.afastamento x WHERE x.sistema_origem = o.sistema_origem) AS afastamentos,
      (SELECT count(*)::int FROM nucleo.incorporacao x WHERE x.sistema_origem = o.sistema_origem) AS incorporacoes,
      (SELECT count(*)::int FROM nucleo.periodo_ipam x WHERE x.sistema_origem = o.sistema_origem) AS periodos_ipam,
      (SELECT count(*)::int FROM nucleo.evento_funcional x WHERE x.sistema_origem = o.sistema_origem) AS eventos,
      (SELECT count(*)::int FROM nucleo.vinculo x WHERE x.sistema_origem = o.sistema_origem AND x.removido_na_fonte_em IS NOT NULL) AS removidos
    FROM origens o ORDER BY o.sistema_origem
  `);
  const totais = await cliente.query<{ pessoas: number; vinculos: number }>(
    'SELECT (SELECT count(*)::int FROM nucleo.pessoa) AS pessoas, (SELECT count(*)::int FROM nucleo.vinculo) AS vinculos',
  );
  return {
    origens: resultado.rows.map((linha) => ({
      origem: linha.origem,
      pessoas: linha.pessoas,
      vinculos: linha.vinculos,
      afastamentos: linha.afastamentos,
      incorporacoes: linha.incorporacoes,
      periodosIpam: linha.periodos_ipam,
      eventos: linha.eventos,
      removidosNaFonte: linha.removidos,
    })),
    totais: totais.rows[0],
  };
}

export type ResultadoConferenciaArquivo = {
  tipo: TipoImportacao;
  origem: string;
  noArquivo: number;
  noBanco: number;
  ausentes: number;
  amostra: Array<{ referencia: string; campos: Record<string, 'confere' | 'difere' | 'vazio no arquivo'> }>;
};

export async function conferirArquivo(
  cliente: ClientBase, protetor: ProtetorDados, tipo: TipoImportacao, origemInformada: string, linhas: string[][], tamanhoAmostra: number,
): Promise<ResultadoConferenciaArquivo> {
  const origem = origemImportacaoSchema.parse(origemInformada);
  const { analise } = analisarLinhas(tipo, linhas);
  if (analise.tipo !== 'dados_funcionais') {
    const tabela = { afastamentos: 'afastamento', incorporacoes: 'incorporacao', periodos_ipam: 'periodo_ipam', eventos_funcionais: 'evento_funcional' }[analise.tipo];
    const ids = analise.tipo === 'periodos_ipam'
      ? analise.registros.map((registro) => `${protetor.hashCpf(registro.cpf).toString('hex')}|${registro.inicio}`)
      : analise.registros.map((registro) => registro.idOrigem);
    const presentes = await cliente.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM nucleo.${tabela} WHERE sistema_origem = $1 AND id_origem = ANY($2::text[])`, [origem, ids],
    );
    return { tipo, origem, noArquivo: ids.length, noBanco: presentes.rows[0].total, ausentes: ids.length - presentes.rows[0].total, amostra: [] };
  }
  const matriculas = analise.vinculos.map((vinculo) => vinculo.campos.matriculaNorm);
  const banco = await cliente.query<Record<string, string | null> & { matricula_norm: string; nome: string; cpf_hash: Buffer }>(`
    SELECT v.matricula_norm, p.nome, p.cpf_hash, ${CAMPOS_VINCULO.map(({ coluna, data }) => selecionarColuna(`v.${coluna}`, data).replace(/AS v\./, 'AS ')).join(', ')}
    FROM nucleo.vinculo v JOIN nucleo.pessoa p ON p.id = v.pessoa_id
    WHERE v.sistema_origem = $1 AND v.matricula_norm = ANY($2::text[])
  `, [origem, matriculas]);
  const porMatricula = new Map(banco.rows.map((linha) => [linha.matricula_norm, linha]));
  const pessoasPorCpf = new Map(analise.pessoas.map((pessoa) => [pessoa.cpf, pessoa]));
  const sorteados = [...analise.vinculos].sort(() => Math.random() - 0.5).slice(0, Math.max(0, tamanhoAmostra));
  const amostra = sorteados.map((vinculo) => {
    const linha = porMatricula.get(vinculo.campos.matriculaNorm);
    const referencia = `matrícula ${mascararMatricula(vinculo.campos.matricula)} / CPF ${mascararCpf(vinculo.cpf)}`;
    const campos: Record<string, 'confere' | 'difere' | 'vazio no arquivo'> = {};
    const comparar = (rotulo: string, arquivo: string | null, valorBanco: string | null | undefined) => {
      campos[rotulo] = arquivo === null ? 'vazio no arquivo' : arquivo === valorBanco ? 'confere' : 'difere';
    };
    comparar('CPF', vinculo.cpf, linha && linha.cpf_hash.equals(protetor.hashCpf(vinculo.cpf)) ? vinculo.cpf : null);
    comparar('NOME', pessoasPorCpf.get(vinculo.cpf)?.campos.nome ?? null, linha?.nome);
    for (const descritor of CAMPOS_VINCULO) comparar(descritor.coluna.toUpperCase(), vinculo.campos[descritor.campo], linha?.[descritor.coluna]);
    return { referencia, campos };
  });
  return { tipo, origem, noArquivo: matriculas.length, noBanco: porMatricula.size, ausentes: matriculas.length - porMatricula.size, amostra };
}
