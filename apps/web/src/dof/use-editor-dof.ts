import {
  criarRascunhoDofSchema,
  dataFuncionalSchema,
  solicitarCalculoDofSchema,
  type AnoCalculo,
  type DadosFontePreviaDof,
  type ProvaFontePreviaDof,
  type RascunhoDof,
  type ResultadoCalculoDof,
  type SolicitarCalculoDof,
} from '@sisdoc/contratos';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, ErroApi } from '../infraestrutura/api';
import { campos, tamanhoPagina, type Aba, type Campo, type Props, type Tabela, type ValoresAno } from './contexto-editor-dof';

/** Coordena cálculo, gravação, revisões e pendências; o estado da prévia continua montado ao trocar abas. */
export function useEditorDof({
  pessoaId, vinculoId, nome, matricula, admissao, csrf, podeSalvar, somenteLeitura = false, rascunhoInicial,
  onFechar, onErro, onLimpar, onPendente, confirmarSaida,
}: Props) {
  const id = useId();
  const [aba, setAba] = useState<Aba>(rascunhoInicial ? 'tabela' : 'periodo');
  const [destinoPrevia, setDestinoPrevia] = useState<HTMLDivElement | null>(null);
  const [fontePrevia, setFontePrevia] = useState<DadosFontePreviaDof | null>(null);
  const admissaoAlterada = Boolean(rascunhoInicial && admissao !== rascunhoInicial.resultado.admissaoConsiderada);
  const [admissaoAtual, setAdmissaoAtual] = useState(admissao);
  const [inicio, setInicio] = useState(rascunhoInicial?.entrada.inicio ?? admissao ?? '');
  const [fim, setFim] = useState(rascunhoInicial?.entrada.fim ?? '');
  const [tabela, setTabela] = useState<Tabela | null>(() => {
    if (!rascunhoInicial || (admissaoAlterada && admissao)) return null;
    return {
      inicio: rascunhoInicial.entrada.inicio,
      fim: rascunhoInicial.entrada.fim,
      anos: rascunhoInicial.entrada.anos.map((ano) => ano.ano),
    };
  });
  const [valores, setValores] = useState<Record<number, ValoresAno>>(() => {
    const registros: Record<number, ValoresAno> = {};
    for (const ano of rascunhoInicial?.entrada.anos ?? []) {
      const preenchidos: ValoresAno = {};
      for (const [campo] of campos) preenchidos[campo] = String(ano[campo]);
      registros[ano.ano] = preenchidos;
    }
    return registros;
  });
  const [abrangencias] = useState<Record<number, AnoCalculo['abrangencia']>>(() =>
    Object.fromEntries((rascunhoInicial?.entrada.anos ?? []).map((ano) => [ano.ano, ano.abrangencia])));
  const [anteriorTs, setAnteriorTs] = useState(rascunhoInicial?.entrada.acumuladoAnterior?.ts.toString() ?? '');
  const [anteriorPf, setAnteriorPf] = useState(rascunhoInicial?.entrada.acumuladoAnterior?.pf.toString() ?? '');
  const [origemAnterior, setOrigemAnterior] = useState(rascunhoInicial?.entrada.acumuladoAnterior?.origem ?? '');
  const [pagina, setPagina] = useState(0);
  const [confirmado, setConfirmado] = useState(Boolean(rascunhoInicial && !admissaoAlterada));
  const [resultado, setResultado] = useState<ResultadoCalculoDof | null>(rascunhoInicial?.resultado ?? null);
  const [pedidoCalculado, setPedidoCalculado] = useState<SolicitarCalculoDof | null>(
    rascunhoInicial && !admissaoAlterada ? rascunhoInicial.entrada : null,
  );
  const [rascunho, setRascunho] = useState<RascunhoDof | null>(rascunhoInicial ?? null);
  const [provaPrevia, setProvaPrevia] = useState<ProvaFontePreviaDof | null>(null);
  const [resultadoSalvo, setResultadoSalvo] = useState(Boolean(rascunhoInicial));
  const [motivo, setMotivo] = useState('');
  const [confirmouRemocao, setConfirmouRemocao] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [calculoPendente, setCalculoPendente] = useState(false);
  const [blocosPendentes, setBlocosPendentes] = useState(false);
  const [processoPendente, setProcessoPendente] = useState(false);
  const [encaminhamentoPendente, setEncaminhamentoPendente] = useState(false);
  const [operacaoEncaminhamento, setOperacaoEncaminhamento] = useState(false);
  const [operacaoConferencia, setOperacaoConferencia] = useState(false);
  const pendencias = useRef({ calculo: false, blocos: false, processo: false, encaminhamento: false, conferencia: false });
  const ativa = useRef(true);
  useEffect(() => {
    ativa.current = true;
    return () => { ativa.current = false; };
  }, []);

  /** Atualiza pendência de cálculo e comunica a soma de pendências sem apagar as de outras seções. */
  function marcarCalculo(valor: boolean) {
    pendencias.current.calculo = valor;
    setCalculoPendente(valor);
    onPendente(valor || pendencias.current.blocos || pendencias.current.processo
      || pendencias.current.encaminhamento || pendencias.current.conferencia);
  }

  /** Atualiza pendência de blocos mantendo o bloqueio de saída se outra seção ainda está pendente. */
  function marcarBlocos(valor: boolean) {
    pendencias.current.blocos = valor;
    setBlocosPendentes(valor);
    onPendente(valor || pendencias.current.calculo || pendencias.current.processo
      || pendencias.current.encaminhamento || pendencias.current.conferencia);
  }

  /** Atualiza pendência do processo e preserva as demais pendências do editor. */
  function marcarProcesso(valor: boolean) {
    pendencias.current.processo = valor;
    setProcessoPendente(valor);
    onPendente(valor || pendencias.current.calculo || pendencias.current.blocos
      || pendencias.current.encaminhamento || pendencias.current.conferencia);
  }

  /** Registra edição pendente do encaminhamento e mantém a proteção global de saída. */
  function marcarEncaminhamento(valor: boolean) {
    pendencias.current.encaminhamento = valor;
    setEncaminhamentoPendente(valor);
    onPendente(valor || pendencias.current.calculo || pendencias.current.blocos
      || pendencias.current.processo || pendencias.current.conferencia);
  }

  /** Sinaliza operação de conferência e protege saída/edição enquanto ela estiver ativa. */
  function marcarConferencia(valor: boolean) {
    pendencias.current.conferencia = valor;
    setOperacaoConferencia(valor);
    onPendente(valor || pendencias.current.calculo || pendencias.current.blocos
      || pendencias.current.processo || pendencias.current.encaminhamento);
  }

  /** Invalida resultado e confirmação locais sem apagar a revisão já salva utilizada pela prévia. */
  function invalidar() {
    marcarCalculo(true);
    setConfirmado(false);
    setResultado(null);
    setPedidoCalculado(null);
    setResultadoSalvo(false);
    setConfirmouRemocao(false);
    setMensagem('');
  }

  /** Valida datas/admissão e prepara intervalo anual mantendo valores já digitados para conferência. */
  function preparar() {
    if (!admissaoAtual) {
      onErro(new ErroApi(400, 'A admissão não está informada na fonte. Reabra o vínculo após a correção.'));
      return;
    }
    const inicioValido = dataFuncionalSchema.safeParse(inicio);
    const fimValido = dataFuncionalSchema.safeParse(fim);
    if (!inicioValido.success || !fimValido.success || fim < inicio) {
      onErro(new ErroApi(400, 'Informe datas válidas e uma data final igual ou posterior à inicial.'));
      return;
    }
    const inicioEfetivo = inicio < admissaoAtual ? admissaoAtual : inicio;
    if (fim < inicioEfetivo) {
      onErro(new ErroApi(400, 'O período termina antes da admissão do vínculo.'));
      return;
    }
    const primeiroAno = Number(inicioEfetivo.slice(0, 4));
    const ultimoAno = Number(fim.slice(0, 4));
    const anos = Array.from({ length: ultimoAno - primeiroAno + 1 }, (_, indice) => primeiroAno + indice);
    setTabela({ inicio, fim, anos });
    setAba('tabela');
    setPagina(0);
    invalidar();
    onLimpar();
  }

  /** Altera uma célula anual e exige novo cálculo e confirmação antes da gravação. */
  function atualizar(ano: number, campo: Campo, valor: string) {
    setValores((anteriores) => ({ ...anteriores, [ano]: { ...anteriores[ano], [campo]: valor } }));
    invalidar();
  }

  /** Valida todos os lançamentos e consulta cálculo sem gravar; admissão divergente exige nova preparação. */
  async function calcular(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!admissaoAtual) {
      onErro(new ErroApi(400, 'A admissão não está informada na fonte. Reabra o vínculo após a correção.'));
      return;
    }
    if (!tabela || tabela.inicio !== inicio || tabela.fim !== fim) {
      onErro(new ErroApi(400, 'Prepare novamente a tabela para as datas informadas.'));
      return;
    }
    /** Converte células vazias confirmáveis em zero e preserva abrangência do ano do rascunho. */
    const ano = (numero: number): AnoCalculo => {
      const preenchidos = valores[numero] ?? {};
      return {
        ano: numero,
        abrangencia: abrangencias[numero] ?? 'intervalo_declarado',
        faltas: Number(preenchidos.faltas || 0),
        ts: Number(preenchidos.ts || 0),
        pf: Number(preenchidos.pf || 0),
        ip: Number(preenchidos.ip || 0),
        outros: Number(preenchidos.outros || 0),
        pb: Number(preenchidos.pb || 0),
        pv: Number(preenchidos.pv || 0),
        licencaPremio: Number(preenchidos.licencaPremio || 0),
      };
    };
    const inicioEfetivo = inicio < admissaoAtual ? admissaoAtual : inicio;
    /** Retorna NaN para acumulado omitido, permitindo ao contrato recusar campo obrigatório ausente. */
    const numeroObrigatorio = (valor: string): number => valor.trim() !== '' ? Number(valor) : Number.NaN;
    const acumuladoAnterior = inicioEfetivo > admissaoAtual ? {
      ts: numeroObrigatorio(anteriorTs),
      pf: numeroObrigatorio(anteriorPf),
      origem: origemAnterior,
    } : undefined;
    const validacao = solicitarCalculoDofSchema.safeParse({
      pessoaId, vinculoId, inicio, fim, anos: tabela.anos.map(ano),
      ...(acumuladoAnterior ? { acumuladoAnterior } : {}),
      confirmacaoDados: confirmado,
    });
    if (!validacao.success) {
      onErro(new ErroApi(400, 'Confira os valores anuais, o acumulado anterior e a confirmação dos dados.'));
      return;
    }
    try {
      onLimpar();
      setOcupado(true);
      setResultado(null);
      setPedidoCalculado(null);
      setResultadoSalvo(false);
      setMensagem('');
      const calculado = await api.calcularDof(csrf, validacao.data);
      if (ativa.current && calculado.admissaoConsiderada !== admissaoAtual) {
        setAdmissaoAtual(calculado.admissaoConsiderada);
        setTabela(null);
        invalidar();
        onErro(new ErroApi(409, 'A admissão mudou na fonte. Prepare a tabela novamente e confira todos os valores.'));
      } else if (ativa.current) {
        setResultado(calculado);
        setPedidoCalculado(validacao.data);
      }
    } catch (erro) {
      if (ativa.current) onErro(erro);
    } finally {
      if (ativa.current) setOcupado(false);
    }
  }

  /** Grava entrada calculada com revisão e confirmação dos anos removidos; falha de rede exige conferir antes de repetir. */
  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!pedidoCalculado || !resultado || !podeSalvar) {
      onErro(new ErroApi(400, 'Calcule e confira os lançamentos antes de salvar.'));
      return;
    }
    if (anosExcluidos.length > 0 && !confirmouRemocao) {
      onErro(new ErroApi(400, 'Confirme os anos removidos antes de salvar o rascunho.'));
      return;
    }
    const validacao = criarRascunhoDofSchema.safeParse({
      calculo: pedidoCalculado, admissaoEsperada: resultado.admissaoConsiderada, motivo,
    });
    if (!validacao.success) {
      onErro(new ErroApi(400, 'Informe o motivo dos lançamentos ou da alteração, com até 2.000 caracteres.'));
      return;
    }
    try {
      onLimpar();
      setOcupado(true);
      setMensagem('');
      const salvo = rascunho
        ? await api.atualizarRascunhoDof(csrf, rascunho.id, {
          ...validacao.data, revisao: rascunho.revisao,
          ...(anosExcluidos.length > 0 ? { anosRemovidosConfirmados: anosExcluidos } : {}),
        })
        : await api.criarRascunhoDof(csrf, validacao.data);
      if (ativa.current) {
        setRascunho(salvo);
        marcarCalculo(false);
        setAdmissaoAtual(salvo.admissao);
        setResultado(salvo.resultado);
        setResultadoSalvo(true);
        setMotivo('');
        setConfirmouRemocao(false);
        if (salvo.admissao !== salvo.resultado.admissaoConsiderada) {
          setTabela(null);
          setConfirmado(false);
          setPedidoCalculado(null);
          setMensagem(`Rascunho salvo na revisão ${salvo.revisao}, mas a admissão mudou. Reabra o vínculo e confira novamente.`);
        } else {
          setPedidoCalculado(salvo.entrada);
          setMensagem(`Rascunho salvo na revisão ${salvo.revisao}. Ele não foi conferido nem emitido.`);
        }
      }
    } catch (erro) {
      if (ativa.current) {
        onErro(erro instanceof ErroApi && erro.status === 0
          ? new ErroApi(0, 'Não foi possível confirmar a gravação. Reabra seus rascunhos e confira antes de tentar novamente.')
          : erro);
      }
    } finally {
      if (ativa.current) setOcupado(false);
    }
  }

  const admissaoParaTabela = admissaoAtual ?? rascunho?.resultado.admissaoConsiderada ?? inicio;
  const inicioEfetivo = inicio < admissaoParaTabela ? admissaoParaTabela : inicio;
  const anosPagina = tabela?.anos.slice(pagina * tamanhoPagina, (pagina + 1) * tamanhoPagina) ?? [];
  const anosTabela = new Set(tabela?.anos ?? []);
  const anosExcluidos = rascunho && tabela
    ? rascunho.entrada.anos.filter((ano) => !anosTabela.has(ano.ano)).map((ano) => ano.ano)
    : [];
  const edicaoIndisponivel = somenteLeitura || Boolean(rascunho?.encaminhamento);
  const bloqueioCalculo = ocupado || blocosPendentes || processoPendente || encaminhamentoPendente
    || operacaoEncaminhamento || operacaoConferencia || edicaoIndisponivel || !admissaoAtual;
  const bloqueioSalvar = ocupado || blocosPendentes || processoPendente || encaminhamentoPendente
    || operacaoEncaminhamento || operacaoConferencia || edicaoIndisponivel;
  const dadosServidor = [
    ['Nome', fontePrevia?.nome ?? rascunho?.nome ?? nome],
    ['Matrícula', fontePrevia?.matricula ?? rascunho?.matricula ?? matricula],
    ['CPF', fontePrevia?.cpf ?? 'Disponível na prévia auditada'],
    ['Nascimento', fontePrevia ? fontePrevia.nascimento ?? 'Não informado' : 'Não consultado'],
    ['Nome da mãe', fontePrevia ? fontePrevia.nomeMae ?? 'Não informado' : 'Não consultado'],
    ['Cargo', fontePrevia ? fontePrevia.cargo ?? 'Não informado' : 'Não consultado'],
    ['Regime jurídico', fontePrevia ? fontePrevia.regimeJuridico ?? 'Não informado' : 'Não consultado'],
    ['Nível / referência', fontePrevia ? [fontePrevia.nivel, fontePrevia.referencia].filter(Boolean).join(' / ') || 'Não informado' : 'Não consultado'],
    ['Admissão na fonte', admissaoAtual ?? 'Não informado'],
    ['Órgão de origem', fontePrevia ? fontePrevia.orgao ?? 'Não informado' : 'Não consultado'],
  ];
  return { id, rascunho, nome, matricula, admissaoAtual, somenteLeitura, podeSalvar, onErro, onLimpar, resultado, aba, setAba, dadosServidor, csrf, calculoPendente, blocosPendentes, encaminhamentoPendente, operacaoEncaminhamento, operacaoConferencia, ocupado, edicaoIndisponivel, setRascunho, onPendente, marcarProcesso, bloqueioCalculo, inicio, setInicio, setTabela, invalidar, fim, setFim, preparar, calcular, tabela, inicioEfetivo, anteriorTs, setAnteriorTs, anteriorPf, setAnteriorPf, origemAnterior, setOrigemAnterior, pagina, anosPagina, abrangencias, valores, atualizar, setPagina, confirmado, setConfirmado, marcarCalculo, resultadoSalvo, mensagem, pedidoCalculado, salvar, bloqueioSalvar, anosExcluidos, confirmouRemocao, setConfirmouRemocao, motivo, setMotivo, destinoPrevia, setFontePrevia, processoPendente, marcarBlocos, setProvaPrevia, setOcupado, provaPrevia, marcarConferencia, onFechar, marcarEncaminhamento, setOperacaoEncaminhamento, setDestinoPrevia, confirmarSaida, rascunhoInicial };
}
