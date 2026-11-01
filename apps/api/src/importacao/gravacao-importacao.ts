import {
  mascararCpf, mascararMatricula, normalizarNomeBusca
} from '@sisdoc/contratos';
import { randomUUID } from 'node:crypto';
import type { Estado } from './estado-importacao';
import {
  type AfastamentoArquivo, type CamposPessoa, type CamposVinculo, type EventoArquivo, type IncorporacaoArquivo,
  type PeriodoIpamArquivo, type ResultadoAnalise
} from './formatos';

const TAMANHO_BLOCO = 1000;

type Coluna = readonly [nome: string, tipo: string];

/** Insere blocos limitados e registra chaves para rollback usando a transação já aberta. */
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

/** Captura a linha anterior, incluindo valores cifrados, antes de atualizar para permitir restauração. */
async function registrarAnterior(estado: Estado, tabela: string, id: string): Promise<void> {
  await estado.cliente.query(`
    INSERT INTO nucleo.importacao_registro (lote_id, tabela, chave, acao, anterior)
    SELECT $1, $2, jsonb_build_object('id', t.id), 'atualizado', to_jsonb(t) FROM nucleo.${tabela} t WHERE t.id = $3
  `, [estado.loteId, tabela, id]);
}

/** Registra rejeição de domínio e incrementa a contagem sem interromper as outras linhas válidas. */
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

export const CAMPOS_VINCULO: readonly CampoVinculo[] = [
  { campo: 'matricula', coluna: 'matricula', data: false },
  { campo: 'regime', coluna: 'regime_juridico', data: false },
  { campo: 'cargo', coluna: 'cargo', data: false },
  { campo: 'referencia', coluna: 'referencia', data: false },
  { campo: 'setor', coluna: 'setor', data: false },
  { campo: 'orgao', coluna: 'orgao_nome', data: false },
  { campo: 'admissao', coluna: 'admissao', data: true },
  { campo: 'desligamento', coluna: 'desligamento', data: true },
];

/** Formata apenas colunas de data descritas internamente, sem aceitar identificador vindo da interface. */
export function selecionarColuna(coluna: string, data: boolean): string {
  return data ? `to_char(${coluna}, 'YYYY-MM-DD') AS ${coluna}` : coluna;
}

/** Compara hashes de conteúdo para idempotência; ausência de hash exige revisar o registro. */
function hashIgual(atual: Buffer | null, novo: Buffer): boolean {
  return atual !== null && atual.equals(novo);
}

/** Consolida pessoas por CPF/HMAC e vínculos por origem/matrícula, preservando existentes quando solicitado. */
export async function gravarDadosFuncionais(
  estado: Estado,
  analise: Extract<ResultadoAnalise['analise'], { tipo: 'dados_funcionais' }>,
): Promise<void> {
  const { cliente, protetor, origem } = estado;
  /** Protege campo opcional com contexto do UUID que será gravado, sem cifrar ausência. */
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

/** Prioriza a mesma origem e sinaliza matrícula ambígua para não associar dados à pessoa errada. */
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

/** Grava dependentes por pai e origem, recusando troca de servidor e auditando valores anteriores. */
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

/** Persiste lançamentos anuais ou intervalos após resolver o vínculo, sem rateio ou mudança de origem. */
export async function gravarAfastamentos(estado: Estado, registros: AfastamentoArquivo[]): Promise<void> {
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

/** Persiste intervalos inclusivos de incorporação mantendo origem e histórico para rollback. */
export async function gravarIncorporacoes(estado: Estado, registros: IncorporacaoArquivo[]): Promise<void> {
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

/** Resolve pessoa por CPF/HMAC e grava períodos mensais com identidade estável por início. */
export async function gravarPeriodosIpam(estado: Estado, registros: PeriodoIpamArquivo[]): Promise<void> {
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

/** Resolve vínculo e cifra descrições com o UUID de destino antes da gravação de eventos. */
export async function gravarEventos(estado: Estado, registros: EventoArquivo[]): Promise<void> {
  const pais = await resolverVinculos(estado, registros.map((registro) => registro.matriculaNorm));
  /** Cifra descrição de evento com o UUID de inserção ou atualização, preservando ausência. */
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
