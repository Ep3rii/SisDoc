import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  dataFuncionalSchema,
  criarRascunhoDofSchema,
  solicitarCalculoDofSchema,
  type AnoCalculo,
  type DadosFontePreviaDof,
  type ProvaFontePreviaDof,
  type RascunhoDof,
  type ResultadoCalculoDof,
  type SolicitarCalculoDof,
} from '@sisdoc/contratos';
import { api, ErroApi } from './api';
import { BlocosDof } from './blocos-dof';
import { ConfirmacaoInicioDof } from './confirmacao-inicio-dof';
import { DevolverRascunhoDof, UltimaDevolucaoDof } from './devolucao-dof';
import { EncaminhamentoDof } from './encaminhamento-dof';
import { VerificacaoConferenciaDof } from './preconferencia-dof';
import { ProcessoDof } from './processo-dof';

type Props = {
  pessoaId: string;
  vinculoId: string;
  nome: string;
  matricula: string;
  admissao: string | null;
  csrf: string;
  podeSalvar: boolean;
  somenteLeitura?: boolean;
  rascunhoInicial?: RascunhoDof;
  onFechar: (mensagem?: string) => void;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
  onPendente: (valor: boolean) => void;
  confirmarSaida: () => boolean;
};

const campos = [
  ['faltas', 'Faltas'], ['ts', 'T/S'], ['pf', 'P/F'], ['ip', 'I/P'],
  ['outros', 'Outros'], ['pb', 'PB'], ['pv', 'PV'], ['licencaPremio', 'Licença-prêmio'],
] as const;
type Campo = typeof campos[number][0];
type ValoresAno = Partial<Record<Campo, string>>;
type Tabela = { inicio: string; fim: string; anos: number[] };
const tamanhoPagina = 20;
const abas = [
  ['dados', 'Dados do servidor'], ['periodo', 'Período'], ['tabela', 'Tabela ano a ano'],
  ['blocos', 'Blocos de texto'], ['conferencia', 'Conferência'],
] as const;
type Aba = typeof abas[number][0];

export function CalculoDof({
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

  function marcarCalculo(valor: boolean) {
    pendencias.current.calculo = valor;
    setCalculoPendente(valor);
    onPendente(valor || pendencias.current.blocos || pendencias.current.processo
      || pendencias.current.encaminhamento || pendencias.current.conferencia);
  }

  function marcarBlocos(valor: boolean) {
    pendencias.current.blocos = valor;
    setBlocosPendentes(valor);
    onPendente(valor || pendencias.current.calculo || pendencias.current.processo
      || pendencias.current.encaminhamento || pendencias.current.conferencia);
  }

  function marcarProcesso(valor: boolean) {
    pendencias.current.processo = valor;
    setProcessoPendente(valor);
    onPendente(valor || pendencias.current.calculo || pendencias.current.blocos
      || pendencias.current.encaminhamento || pendencias.current.conferencia);
  }

  function marcarEncaminhamento(valor: boolean) {
    pendencias.current.encaminhamento = valor;
    setEncaminhamentoPendente(valor);
    onPendente(valor || pendencias.current.calculo || pendencias.current.blocos
      || pendencias.current.processo || pendencias.current.conferencia);
  }

  function marcarConferencia(valor: boolean) {
    pendencias.current.conferencia = valor;
    setOperacaoConferencia(valor);
    onPendente(valor || pendencias.current.calculo || pendencias.current.blocos
      || pendencias.current.processo || pendencias.current.encaminhamento);
  }

  function invalidar() {
    marcarCalculo(true);
    setConfirmado(false);
    setResultado(null);
    setPedidoCalculado(null);
    setResultadoSalvo(false);
    setConfirmouRemocao(false);
    setMensagem('');
  }

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

  function atualizar(ano: number, campo: Campo, valor: string) {
    setValores((anteriores) => ({ ...anteriores, [ano]: { ...anteriores[ano], [campo]: valor } }));
    invalidar();
  }

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
  return (
    <section className="estudio-dof" aria-labelledby="calculo-dof-titulo">
      <div className="area-dof">
      <div className="editor-dof">
      <p className="identificador-documento">DOF · Declaração de Ocorrências Funcionais</p>
      <h2 id="calculo-dof-titulo">DOF — {rascunho?.nome ?? nome}</h2>
      <p>{rascunho?.nome ?? nome} — matrícula {rascunho?.matricula ?? matricula}. Admissão na fonte: {admissaoAtual ?? 'não informada'}.</p>
      {rascunho && <p>{somenteLeitura ? 'Rascunho encaminhado' : 'Rascunho'} — revisão {rascunho.revisao}. Ainda não conferido nem emitido.</p>}
      {rascunho && podeSalvar && !somenteLeitura
        && <UltimaDevolucaoDof rascunho={rascunho} onErro={onErro} onLimpar={onLimpar} />}
      {rascunho && admissaoAtual !== rascunho.resultado.admissaoConsiderada && (
        <p className="aviso erro" role="alert">
          A admissão considerada no resultado salvo foi {rascunho.resultado.admissaoConsiderada}, diferente da fonte atual.
          {somenteLeitura
            ? ' Solicite ao autor o recolhimento e a conferência dos dados.'
            : admissaoAtual ? ' Prepare a tabela e confira novamente antes de salvar.' : ' A edição está indisponível até a correção na fonte.'}
        </p>
      )}
      <details className="orientacoes-dof">
        <summary>Cálculo e prévia — salvar, conferir e emitir em etapas</summary>
        <p>Regra provisória (planilha). O cálculo não grava dados; salvar cria apenas um rascunho, sem conferir ou emitir.</p>
        <p>As ocorrências da fonte não são carregadas automaticamente. Confira os registros e informe os dias de cada intervalo; campos vazios serão tratados como zero somente após sua confirmação.</p>
      </details>
      <nav className="abas-dof" role="tablist" aria-label="Seções da DOF">
        {abas.map(([codigo, titulo], indice) => (
          <button key={codigo} type="button" role="tab" id={`${id}-aba-${codigo}`} aria-controls={`${id}-painel-${codigo}`}
            aria-selected={aba === codigo} tabIndex={aba === codigo ? 0 : -1} onClick={() => setAba(codigo)}
            onKeyDown={(evento) => {
              let destino: number;
              if (evento.key === 'ArrowRight') destino = (indice + 1) % abas.length;
              else if (evento.key === 'ArrowLeft') destino = (indice + abas.length - 1) % abas.length;
              else if (evento.key === 'Home') destino = 0;
              else if (evento.key === 'End') destino = abas.length - 1;
              else return;
              evento.preventDefault();
              setAba(abas[destino][0]);
              evento.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[destino]?.focus();
            }}>{titulo}</button>
        ))}
      </nav>
      <div role="tabpanel" id={`${id}-painel-dados`} aria-labelledby={`${id}-aba-dados`} hidden={aba !== 'dados'}>
        <dl className="dados-servidor">{dadosServidor.map(([rotulo, valor]) => (
          <div key={rotulo}><dt>{rotulo}</dt><dd>{valor}</dd></div>
        ))}</dl>
        <p>Os campos da fonte são somente leitura. A prévia auditada é carregada após salvar. Ajustes cadastrais exclusivos da declaração ainda não estão implementados.</p>
        {rascunho && (podeSalvar || somenteLeitura) && (
          <ProcessoDof rascunho={rascunho} csrf={csrf}
            bloqueado={calculoPendente || blocosPendentes || encaminhamentoPendente
              || operacaoEncaminhamento || operacaoConferencia || ocupado}
            somenteLeitura={edicaoIndisponivel}
            onAtualizar={setRascunho} onPendente={marcarProcesso} onErro={onErro} onLimpar={onLimpar} />
        )}
      </div>
      <div role="tabpanel" id={`${id}-painel-periodo`} aria-labelledby={`${id}-aba-periodo`} hidden={aba !== 'periodo'}>
        <fieldset disabled={bloqueioCalculo}>
          <div className="grade">
            <label>Início do período<input type="date" value={inicio} required onChange={(evento) => { setInicio(evento.target.value); setTabela(null); invalidar(); }} /></label>
            <label>Fim do período<input type="date" value={fim} required onChange={(evento) => { setFim(evento.target.value); setTabela(null); invalidar(); }} /></label>
          </div>
          <button type="button" className="secundario" onClick={preparar}>Preparar tabela anual</button>
        </fieldset>
      </div>
      <div role="tabpanel" id={`${id}-painel-tabela`} aria-labelledby={`${id}-aba-tabela`} hidden={aba !== 'tabela'}>
      <form onSubmit={calcular} noValidate>
        <fieldset disabled={bloqueioCalculo}>
          {!tabela && <p>Informe o período e prepare a tabela anual na aba Período.</p>}
          {tabela && (
            <>
              {admissaoAtual && inicio < admissaoAtual && <p className="aviso">O início será ajustado à admissão; confira o aviso no resultado.</p>}
              {admissaoAtual && inicioEfetivo > admissaoAtual && (
                <div className="grade separado">
                  <label>T/S acumulado antes do período<input type="number" min="0" step="1" required value={anteriorTs} onChange={(evento) => { setAnteriorTs(evento.target.value); invalidar(); }} /></label>
                  <label>P/F acumulado antes do período<input type="number" min="0" step="1" required value={anteriorPf} onChange={(evento) => { setAnteriorPf(evento.target.value); invalidar(); }} /></label>
                  <label>Origem do acumulado anterior<input required value={origemAnterior} onChange={(evento) => { setOrigemAnterior(evento.target.value); invalidar(); }} /></label>
                </div>
              )}
              <p>{tabela.anos.length} ano(s) no intervalo efetivo. Exibindo {pagina * tamanhoPagina + 1} a {Math.min((pagina + 1) * tamanhoPagina, tabela.anos.length)}. Valores são dias, não datas.</p>
              <div className="tabela"><table>
                <thead><tr><th scope="col">Ano</th><th scope="col">Intervalo</th>{campos.map(([campo, titulo]) => <th key={campo} scope="col">{titulo}</th>)}</tr></thead>
                <tbody>{anosPagina.map((ano) => {
                  const anoTexto = String(ano).padStart(4, '0');
                  const primeiroDia = `${anoTexto}-01-01`;
                  const ultimoDia = `${anoTexto}-12-31`;
                  const comeco = inicioEfetivo > primeiroDia ? inicioEfetivo : primeiroDia;
                  const termino = fim < ultimoDia ? fim : ultimoDia;
                  return (
                    <tr key={ano}>
                      <th scope="row">{ano}</th><td>{comeco} a {termino}{abrangencias[ano] === 'ano_civil' ? ' — lançamento anual integral' : ''}</td>
                      {campos.map(([campo, titulo]) => (
                        <td key={campo}><input className="dias-anuais" type="number" min="0" step="1" inputMode="numeric"
                          aria-label={`${titulo} em ${ano}`} value={valores[ano]?.[campo] ?? ''}
                          onChange={(evento) => atualizar(ano, campo, evento.target.value)} /></td>
                      ))}
                    </tr>
                  );
                })}</tbody>
              </table></div>
              <div className="acoes">
                <button type="button" className="secundario" disabled={pagina === 0} onClick={() => setPagina((atual) => atual - 1)}>Anos anteriores</button>
                <button type="button" className="secundario" disabled={(pagina + 1) * tamanhoPagina >= tabela.anos.length} onClick={() => setPagina((atual) => atual + 1)}>Próximos anos</button>
              </div>
              <label className="marcador"><input type="checkbox" checked={confirmado} required onChange={(evento) => {
                if (evento.target.checked) { setConfirmado(true); marcarCalculo(true); }
                else invalidar();
              }} />
                Confirmei todos os anos e intervalos parciais; campos vazios representam zero.</label>
              <button type="submit">{ocupado ? 'Calculando...' : 'Calcular DOF'}</button>
            </>
          )}
        </fieldset>
      </form>
      {resultado && (
        <section className="separado" aria-labelledby="resultado-dof-titulo">
          <h4 id="resultado-dof-titulo">{resultadoSalvo ? 'Resultado salvo' : 'Resultado provisório'}</h4>
          <p>Admissão considerada: {resultado.admissaoConsiderada}. Período efetivo: {resultado.periodo.inicioEfetivo} a {resultado.periodo.fim}. Regra {resultado.regra.codigo}, versão {resultado.regra.versao}.</p>
          <ul>{resultado.avisos.map((aviso, indice) => <li key={`${aviso.codigo}-${indice}`}>{aviso.mensagem}</li>)}</ul>
          <p>Dias do período: <strong>{resultado.totais.diasBrutos.toLocaleString('pt-BR')}</strong>. Tempo líquido de contribuição: <strong>{resultado.totais.totalContribuicao.toLocaleString('pt-BR')}</strong> dias. Efetivo exercício: <strong>{resultado.totais.efetivoExercicio.toLocaleString('pt-BR')}</strong> dias.</p>
          <div className="tabela"><table>
            <thead><tr><th scope="col">Ano</th><th scope="col">Dias do período</th><th scope="col">Faltas</th><th scope="col">T/S</th><th scope="col">P/F</th><th scope="col">I/P</th><th scope="col">Outros</th><th scope="col">Contribuição</th><th scope="col">Efetivo exercício</th><th scope="col">PB</th><th scope="col">PV</th><th scope="col">Licença-prêmio</th></tr></thead>
            <tbody>{resultado.periodo.linhas.map((linha) => (
              <tr key={linha.ano}><th scope="row">{linha.ano}</th><td>{linha.diasBrutos}</td><td>{linha.faltas}</td><td>{linha.ts}</td><td>{linha.pf}</td><td>{linha.ip}</td><td>{linha.outros}</td><td>{linha.contribuicao}</td><td>{linha.efetivoExercicio}</td><td>{linha.pb}</td><td>{linha.pv}</td><td>{linha.licencaPremio}</td></tr>
            ))}</tbody>
          </table></div>
          <h5>Linhas condicionais de referência</h5>
          {resultado.declaracao.length ? <ul>{resultado.declaracao.map((linha) => <li key={linha}>{linha}</li>)}</ul> : <p>Não há linhas para os totais informados.</p>}
        </section>
      )}
      {podeSalvar && resultado && pedidoCalculado && (
        <form id={`${id}-salvar`} className="separado" onSubmit={salvar} noValidate>
          <fieldset disabled={bloqueioSalvar}>
            {anosExcluidos.length > 0 && (
              <>
                <p className="aviso erro">
                  Salvar removerá {anosExcluidos.length} ano(s) do rascunho anterior:
                  {' '}{anosExcluidos.join(', ')}. Os valores anteriores permanecerão no registro de ajustes.
                </p>
                <label className="marcador">
                  <input type="checkbox" checked={confirmouRemocao} required
                    onChange={(evento) => { setConfirmouRemocao(evento.target.checked); marcarCalculo(true); }} />
                  Confirmo a remoção desses anos do rascunho.
                </label>
              </>
            )}
            <label>Motivo dos lançamentos ou da alteração
              <textarea value={motivo} onChange={(evento) => { setMotivo(evento.target.value); marcarCalculo(true); }} maxLength={2000} required />
            </label>
          </fieldset>
        </form>
      )}
      </div>
      <div role="tabpanel" id={`${id}-painel-blocos`} aria-labelledby={`${id}-aba-blocos`} hidden={aba !== 'blocos'}>
        {!rascunho && <p>Salve o rascunho para adicionar os blocos de texto.</p>}
      {rascunho && (podeSalvar || somenteLeitura) && (
        <BlocosDof rascunho={rascunho} csrf={csrf} destinoPrevia={destinoPrevia} onFonte={setFontePrevia}
          bloqueado={calculoPendente || processoPendente || encaminhamentoPendente
            || operacaoEncaminhamento || operacaoConferencia || ocupado}
          previaBloqueada={operacaoConferencia}
          somenteLeitura={edicaoIndisponivel}
          onAtualizar={setRascunho} onPendente={marcarBlocos} onPrevia={setProvaPrevia} onErro={onErro} onLimpar={onLimpar} />
      )}
      </div>
      <div role="tabpanel" id={`${id}-painel-conferencia`} aria-labelledby={`${id}-aba-conferencia`} hidden={aba !== 'conferencia'}>
      {!rascunho && <p>Salve o rascunho antes de encaminhar ou conferir a DOF.</p>}
      {rascunho && (podeSalvar || somenteLeitura) && (
        <ConfirmacaoInicioDof rascunho={rascunho} csrf={csrf}
          bloqueado={calculoPendente || blocosPendentes || processoPendente || encaminhamentoPendente
            || operacaoEncaminhamento || operacaoConferencia || ocupado}
          somenteLeitura={edicaoIndisponivel}
          onAtualizar={setRascunho} onOcupado={setOcupado} onErro={onErro} onLimpar={onLimpar} />
      )}
      {rascunho && (podeSalvar || somenteLeitura) && (
        <VerificacaoConferenciaDof rascunho={rascunho} csrf={csrf}
          provaFonte={provaPrevia?.documentoId === rascunho.id && provaPrevia.revisao === rascunho.revisao
            ? provaPrevia.provaFonte : undefined}
          bloqueado={calculoPendente || blocosPendentes || processoPendente || encaminhamentoPendente
            || operacaoEncaminhamento || ocupado}
          onOcupado={marcarConferencia}
          onConferido={() => {
            marcarConferencia(false);
            onFechar('DOF conferida. Consulte-a em DOFs conferidas para revisão e emissão pelo coordenador, conforme as aprovações do modelo e da regra.');
          }} onErro={onErro} onLimpar={onLimpar} />
      )}
      {rascunho && podeSalvar && !somenteLeitura && (
        <EncaminhamentoDof rascunho={rascunho} csrf={csrf}
          bloqueado={calculoPendente || blocosPendentes || processoPendente || operacaoConferencia || ocupado}
          onAtualizar={setRascunho} onPendente={marcarEncaminhamento} onOcupado={setOperacaoEncaminhamento}
          onErro={onErro} onLimpar={onLimpar} />
      )}
      {rascunho && somenteLeitura && rascunho.encaminhamento && (
        <DevolverRascunhoDof rascunho={rascunho} csrf={csrf}
          bloqueado={ocupado || operacaoConferencia} onPendente={marcarEncaminhamento} onOcupado={setOperacaoEncaminhamento}
          onDevolvido={() => onFechar('Rascunho devolvido para ajustes. Ele continua não conferido.')}
          onErro={onErro} onLimpar={onLimpar} />
      )}
      </div>
      </div>
      <aside className="painel-previa" aria-label="Prévia do documento">
        <p className="identificador-documento">Prévia do documento · sem validade oficial</p>
        {!rascunho && <p>Salve o rascunho para abrir a prévia auditada.</p>}
        <div ref={setDestinoPrevia} />
      </aside>
      </div>
      <footer className="barra-totais" aria-label="Totais calculados da DOF">
        <dl>
          <div><dt>Dias no período</dt><dd>{resultado?.totais.diasBrutos.toLocaleString('pt-BR') ?? '—'}</dd></div>
          <div><dt>Deduções de contribuição</dt><dd>{resultado?.periodo.linhas.reduce((total, linha) => total + linha.deducaoContribuicao, 0).toLocaleString('pt-BR') ?? '—'}</dd></div>
          <div><dt>Efetivo exercício</dt><dd>{resultado?.totais.efetivoExercicio.toLocaleString('pt-BR') ?? '—'}</dd></div>
          <div><dt>Contribuição</dt><dd>{resultado?.totais.totalContribuicao.toLocaleString('pt-BR') ?? '—'}</dd></div>
        </dl>
        <div className="acoes">
          {podeSalvar && resultado && pedidoCalculado && <button type="submit" form={`${id}-salvar`} className="secundario"
            disabled={bloqueioSalvar}>{ocupado ? 'Salvando...' : rascunho ? 'Salvar alterações' : 'Salvar rascunho'}</button>}
          <button type="button" disabled title="Após conferir, abra DOFs conferidas para revisão e emissão pelo coordenador">Emitir PDF · após conferir</button>
        </div>
      </footer>
      {mensagem && <p className="aviso sucesso" role="status">{mensagem}</p>}
      <div className="acoes"><button type="button" className="secundario" disabled={ocupado || operacaoEncaminhamento || operacaoConferencia} onClick={() => {
        if (confirmarSaida()) { onPendente(false); onFechar(); }
      }}>
        {somenteLeitura ? 'Voltar aos encaminhados' : rascunhoInicial ? 'Voltar aos rascunhos' : 'Fechar cálculo'}
      </button></div>
    </section>
  );
}
