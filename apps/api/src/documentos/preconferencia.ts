import { isDeepStrictEqual } from 'node:util';
import { nivelDof } from '@sisdoc/calculo';
import {
  normalizarMatricula,
  preconferenciaDofSchema,
  processoCorrespondeMascara,
  type PreconferenciaDof,
  type RascunhoDof,
} from '@sisdoc/contratos';
import { verificarVariaveisDof } from '@sisdoc/templates';
import type { PoolClient } from 'pg';
import { calcularDofNaTransacao } from '../calculos/calculos';
import type { SessaoAutenticada } from '../seguranca/autenticacao';
import type { ProtetorDados } from '../seguranca/protecao-dados';
import { lerCpfDof, lerNomeMaeDof } from './identidade-fonte-dof';

type LinhaFonte = {
  cpf_cifrado: Buffer;
  cpf_hash: Buffer;
  nascimento: string | null;
  nome_mae_cifrado: Buffer | null;
  matricula_norm: string;
  regime_juridico: string | null;
  cargo: string | null;
  referencia: string | null;
  orgao_nome: string | null;
  admissao: string | null;
  removido: boolean;
  sincronizado_em: Date | null;
  desatualizado: boolean | null;
  data_futura: boolean | null;
  verificado_em: Date;
};

export async function verificarPreconferenciaDof(
  cliente: PoolClient,
  sessao: SessaoAutenticada,
  ip: string,
  rascunho: RascunhoDof,
  regraAtual: boolean,
  protetor: ProtetorDados,
): Promise<PreconferenciaDof> {
  const consulta = await cliente.query<LinhaFonte>(`
    SELECT p.cpf_cifrado, p.cpf_hash, to_char(p.nascimento, 'YYYY-MM-DD') AS nascimento,
      p.nome_mae_cifrado,
      v.matricula_norm, v.regime_juridico, v.cargo, v.referencia, v.orgao_nome,
      to_char(v.admissao, 'YYYY-MM-DD') AS admissao, v.removido_na_fonte_em IS NOT NULL AS removido,
      v.sincronizado_em, v.sincronizado_em < now() - interval '24 hours' AS desatualizado,
      v.sincronizado_em > now() + interval '5 minutes' AS data_futura, now() AS verificado_em
    FROM nucleo.pessoa p JOIN nucleo.vinculo v ON v.pessoa_id = p.id
    WHERE p.id = $1 AND v.id = $2
  `, [rascunho.pessoaId, rascunho.vinculoId]);
  const fonte = consulta.rows[0];
  if (!fonte) throw new Error('Pessoa ou vínculo do rascunho deixou de existir.');
  const bloqueios: PreconferenciaDof['bloqueios'] = [
    { codigo: 'conferencia_indisponivel', mensagem: 'A transição para conferido ainda não foi implementada.' },
    { codigo: 'aprovacao_modelo_nao_verificada', mensagem: 'Não há verificação implementada de aprovação do modelo e dos campos obrigatórios.' },
  ];
  const avisos: PreconferenciaDof['avisos'] = [
    { codigo: 'regra_provisoria', mensagem: 'A regra de cálculo é provisória e depende de aprovação para emissão.' },
  ];

  const cpf = lerCpfDof(protetor, rascunho.pessoaId, fonte.cpf_cifrado, fonte.cpf_hash);
  if ('erro' in cpf) {
    const mensagens = {
      cpf_indisponivel: 'O CPF protegido não pôde ser lido. Solicite a verificação de integridade e das chaves ao administrador.',
      cpf_invalido: 'O CPF do vínculo é inválido. Solicite a correção na fonte.',
      cpf_hash_inconsistente: 'O CPF não corresponde ao identificador protegido. Solicite a verificação da fonte e das chaves.',
    } as const;
    bloqueios.push({ codigo: cpf.erro, mensagem: mensagens[cpf.erro] });
  }
  const nomeMae = lerNomeMaeDof(protetor, rascunho.pessoaId, fonte.nome_mae_cifrado);
  if ('erro' in nomeMae) {
    bloqueios.push({
      codigo: nomeMae.erro,
      mensagem: nomeMae.erro === 'nome_mae_indisponivel'
        ? 'O nome da mãe protegido não pôde ser lido. Solicite a verificação de integridade e das chaves ao administrador.'
        : 'O nome da mãe protegido está vazio ou contém texto inválido. Solicite a correção na fonte.',
    });
  }
  const nivel = nivelDof(fonte.referencia ?? '');
  if (nivel.avisos.length) {
    avisos.push({ codigo: 'nivel_referencia', mensagem: nivel.avisos.join(' ') });
  }

  if (!rascunho.matricula.trim() || normalizarMatricula(rascunho.matricula) !== fonte.matricula_norm) {
    bloqueios.push({
      codigo: 'matricula_inconsistente',
      mensagem: 'A matrícula e sua forma normalizada divergem. Solicite a correção na fonte.',
    });
  }
  const duplicados = await cliente.query<{ quantidade: string }>(`
    SELECT count(*) AS quantidade FROM nucleo.vinculo
    WHERE matricula_norm = $1 AND removido_na_fonte_em IS NULL
  `, [fonte.matricula_norm]);
  if (Number(duplicados.rows[0].quantidade) > 1) {
    bloqueios.push({
      codigo: 'matricula_ambigua',
      mensagem: 'Há mais de um vínculo ativo com esta matrícula. Resolva a ambiguidade antes da conferência.',
    });
  }
  if (fonte.removido) {
    bloqueios.push({ codigo: 'vinculo_removido', mensagem: 'O vínculo está marcado como removido na fonte. Verifique sua situação.' });
  }
  if (!fonte.admissao) {
    bloqueios.push({ codigo: 'admissao_ausente', mensagem: 'A admissão não está informada na fonte.' });
  } else if (fonte.admissao !== rascunho.resultado.admissaoConsiderada) {
    bloqueios.push({
      codigo: 'admissao_alterada',
      mensagem: 'A admissão atual difere da utilizada no cálculo. Recalcule e confira o rascunho.',
    });
  }
  if (fonte.nascimento && fonte.admissao && fonte.nascimento > fonte.admissao) {
    bloqueios.push({
      codigo: 'nascimento_inconsistente',
      mensagem: 'A data de nascimento é posterior à admissão. Solicite a correção na fonte.',
    });
  }
  const camposReferencia = [
    [fonte.nascimento, 'data de nascimento'],
    ['erro' in nomeMae || nomeMae.valor !== null, 'nome da mãe'],
    [fonte.regime_juridico?.trim(), 'regime jurídico'],
    [fonte.cargo?.trim(), 'cargo'],
    [fonte.referencia?.trim(), 'referência/padrão'],
    [fonte.orgao_nome?.trim(), 'órgão de origem'],
  ] as const;
  const ausentes = camposReferencia.filter(([valor]) => !valor).map(([, nome]) => nome);
  if (ausentes.length) {
    avisos.push({
      codigo: 'campos_referencia_ausentes',
      mensagem: `Dados presentes na referência, mas não informados na fonte: ${ausentes.join(', ')}. A obrigatoriedade depende do modelo aprovado.`,
    });
  }
  if (!fonte.sincronizado_em) {
    avisos.push({ codigo: 'dados_sem_data', mensagem: 'A data de sincronização do vínculo não está informada; não é possível determinar a idade dos dados.' });
  } else if (fonte.data_futura) {
    avisos.push({ codigo: 'data_fonte_futura', mensagem: 'A data de sincronização do vínculo está no futuro. Verifique os relógios e a origem.' });
  } else if (fonte.desatualizado) {
    avisos.push({ codigo: 'dados_antigos', mensagem: 'Os dados do vínculo têm mais de 24 horas. Confira a situação na fonte.' });
  }

  const periodos = await cliente.query<{ ordem: number; inicio: string; fim: string }>(`
    SELECT ordem, to_char(inicio, 'YYYY-MM-DD') AS inicio, to_char(fim, 'YYYY-MM-DD') AS fim
    FROM documentos.documento_periodo WHERE documento_id = $1 ORDER BY ordem
  `, [rascunho.id]);
  if (periodos.rows.length !== 1 || periodos.rows[0].ordem !== 1
      || periodos.rows[0].inicio !== rascunho.entrada.inicio || periodos.rows[0].fim !== rascunho.entrada.fim) {
    bloqueios.push({
      codigo: 'periodo_inconsistente',
      mensagem: 'O período gravado não corresponde à entrada do cálculo. Reabra e corrija o rascunho.',
    });
  }
  if (!regraAtual) {
    bloqueios.push({ codigo: 'regra_incompativel', mensagem: 'A versão da regra do rascunho não está disponível para validação.' });
  } else if (fonte.admissao && fonte.admissao === rascunho.resultado.admissaoConsiderada) {
    const calculo = await calcularDofNaTransacao(cliente, sessao, ip, rascunho.entrada, fonte.admissao);
    if ('erro' in calculo || 'conflito' in calculo) {
      bloqueios.push({ codigo: 'calculo_invalido', mensagem: 'O cálculo não passou na validação atual. Recalcule e confira os lançamentos.' });
    } else if (!isDeepStrictEqual(calculo.resultado, rascunho.resultado)) {
      bloqueios.push({
        codigo: 'calculo_divergente',
        mensagem: 'O resultado salvo difere do recálculo. Reabra e confira os lançamentos.',
      });
    }
  }
  if (rascunho.entrada.inicio < rascunho.resultado.admissaoConsiderada && !rascunho.inicioAjustadoConfirmado) {
    bloqueios.push({
      codigo: 'inicio_ajustado_sem_confirmacao',
      mensagem: 'O início foi ajustado à admissão; o autor deve confirmar explicitamente o ajuste.',
    });
  }
  if (!rascunho.processo) {
    bloqueios.push({ codigo: 'processo_ausente', mensagem: 'Informe o número do processo antes da conferência.' });
  }
  if (rascunho.mascarasProcesso.length === 0) {
    bloqueios.push({ codigo: 'mascaras_ausentes', mensagem: 'Nenhuma máscara de processo está configurada.' });
  } else if (rascunho.processo
      && !rascunho.mascarasProcesso.some((mascara) => processoCorrespondeMascara(rascunho.processo ?? '', mascara))) {
    bloqueios.push({ codigo: 'processo_invalido', mensagem: 'O processo salvo não corresponde às máscaras atuais.' });
  }
  const variaveis = verificarVariaveisDof({
    ...rascunho,
    fonte: {
      nome: rascunho.nome,
      matricula: rascunho.matricula,
      cpf: 'valor' in cpf ? cpf.valor : null,
      nascimento: fonte.nascimento,
      nomeMae: 'valor' in nomeMae ? nomeMae.valor : null,
      regimeJuridico: fonte.regime_juridico,
      cargo: fonte.cargo,
      nivel: nivel.nivel || null,
      referencia: fonte.referencia,
      orgao: fonte.orgao_nome,
    },
  });
  if (variaveis.indisponiveis.length) {
    bloqueios.push({
      codigo: 'variaveis_ausentes',
      mensagem: `Há variáveis indisponíveis em blocos ativos: ${variaveis.indisponiveis.join(', ')}.`,
    });
  }
  if (variaveis.malformadas) {
    bloqueios.push({
      codigo: 'variaveis_malformadas',
      mensagem: 'Há expressões de variáveis malformadas em blocos ativos. Confira as marcações na prévia.',
    });
  }

  return preconferenciaDofSchema.parse({
    documentoId: rascunho.id,
    revisao: rascunho.revisao,
    verificadoEm: fonte.verificado_em.toISOString(),
    status: 'nao_conferido',
    conferenciaDisponivel: false,
    bloqueios,
    avisos,
  });
}
