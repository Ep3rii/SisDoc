import {
  idOrigemApiSchema,
  type CampoCanonicoSincronizacao,
  type ConfiguracaoSincronizacao
} from '@sisdoc/contratos';

/** Renomeia somente campos mapeados, preservando entrada inválida para validação posterior. */
export function mapearItem(config: ConfiguracaoSincronizacao, bruto: unknown): unknown {
  const mapa = config.mapeamento;
  if (!mapa || typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) return bruto;
  const origem = bruto as Record<string, unknown>;
  /** Mantém nome canônico quando o operador não configurou alias para o campo. */
  const nome = (campo: CampoCanonicoSincronizacao) => mapa[campo] ?? campo;
  const resultado: Record<string, unknown> = {};
  const camposServidor: CampoCanonicoSincronizacao[] = [
    'id', 'alterado_em', 'cpf', 'nome', 'nascimento', 'nome_mae', 'nome_pai', 'pis_pasep', 'rg_numero', 'rg_orgao',
    'rg_expedicao', 'titulo_eleitor', 'endereco',
  ];
  for (const campo of camposServidor) {
    if (Object.hasOwn(origem, nome(campo))) resultado[campo] = origem[nome(campo)];
  }
  const vinculos = origem[nome('vinculos')];
  if (Array.isArray(vinculos)) {
    const camposVinculo = [
      'id', 'matricula', 'regime_juridico', 'cargo', 'classe', 'nivel', 'referencia', 'setor', 'orgao_codigo',
      'orgao_nome', 'admissao', 'desligamento',
    ] as const;
    resultado.vinculos = vinculos.map((vinculo: unknown) => {
      if (typeof vinculo !== 'object' || vinculo === null) return vinculo;
      const fonte = vinculo as Record<string, unknown>;
      const saida: Record<string, unknown> = {};
      for (const campo of camposVinculo) {
        const chave = mapa[`vinculo.${campo}`] ?? campo;
        if (Object.hasOwn(fonte, chave)) saida[campo] = fonte[chave];
      }
      return saida;
    });
  } else if (vinculos !== undefined) {
    resultado.vinculos = vinculos;
  }
  return resultado;
}

/** Extrai identificador canônico válido sem converter dados malformados em identificador fictício. */
export function idDoItem(mapeado: unknown): string | null {
  if (typeof mapeado !== 'object' || mapeado === null) return null;
  const id = idOrigemApiSchema.safeParse((mapeado as Record<string, unknown>).id);
  return id.success ? id.data : null;
}
