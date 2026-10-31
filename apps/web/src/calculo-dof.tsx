import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  dataFuncionalSchema,
  solicitarCalculoDofSchema,
  type AnoCalculo,
  type ResultadoCalculoDof,
} from '@sisdoc/contratos';
import { api, ErroApi } from './api';

type Props = {
  pessoaId: string;
  vinculoId: string;
  nome: string;
  matricula: string;
  admissao: string;
  csrf: string;
  onFechar: () => void;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
};

const campos = [
  ['faltas', 'Faltas'], ['ts', 'T/S'], ['pf', 'P/F'], ['ip', 'I/P'],
  ['outros', 'Outros'], ['pb', 'PB'], ['pv', 'PV'], ['licencaPremio', 'Licença-prêmio'],
] as const;
type Campo = typeof campos[number][0];
type ValoresAno = Partial<Record<Campo, string>>;
type Tabela = { inicio: string; fim: string; anos: number[] };
const tamanhoPagina = 20;

export function CalculoDof({ pessoaId, vinculoId, nome, matricula, admissao, csrf, onFechar, onErro, onLimpar }: Props) {
  const [inicio, setInicio] = useState(admissao);
  const [fim, setFim] = useState('');
  const [tabela, setTabela] = useState<Tabela | null>(null);
  const [valores, setValores] = useState<Record<number, ValoresAno>>({});
  const [pagina, setPagina] = useState(0);
  const [confirmado, setConfirmado] = useState(false);
  const [resultado, setResultado] = useState<ResultadoCalculoDof | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const ativa = useRef(true);
  useEffect(() => {
    ativa.current = true;
    return () => { ativa.current = false; };
  }, []);

  function invalidar() {
    setConfirmado(false);
    setResultado(null);
  }

  function preparar() {
    const inicioValido = dataFuncionalSchema.safeParse(inicio);
    const fimValido = dataFuncionalSchema.safeParse(fim);
    if (!inicioValido.success || !fimValido.success || fim < inicio) {
      onErro(new ErroApi(400, 'Informe datas válidas e uma data final igual ou posterior à inicial.'));
      return;
    }
    const inicioEfetivo = inicio < admissao ? admissao : inicio;
    if (fim < inicioEfetivo) {
      onErro(new ErroApi(400, 'O período termina antes da admissão do vínculo.'));
      return;
    }
    const primeiroAno = Number(inicioEfetivo.slice(0, 4));
    const ultimoAno = Number(fim.slice(0, 4));
    const anos = Array.from({ length: ultimoAno - primeiroAno + 1 }, (_, indice) => primeiroAno + indice);
    setTabela({ inicio, fim, anos });
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
    if (!tabela || tabela.inicio !== inicio || tabela.fim !== fim) {
      onErro(new ErroApi(400, 'Prepare novamente a tabela para as datas informadas.'));
      return;
    }
    const formulario = new FormData(evento.currentTarget);
    const ano = (numero: number): AnoCalculo => {
      const preenchidos = valores[numero] ?? {};
      return {
        ano: numero,
        abrangencia: 'intervalo_declarado',
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
    const inicioEfetivo = inicio < admissao ? admissao : inicio;
    const numeroObrigatorio = (campo: string): number => {
      const valor = formulario.get(campo);
      return typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : Number.NaN;
    };
    const acumuladoAnterior = inicioEfetivo > admissao ? {
      ts: numeroObrigatorio('anteriorTs'),
      pf: numeroObrigatorio('anteriorPf'),
      origem: formulario.get('origemAnterior'),
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
      const calculado = await api.calcularDof(csrf, validacao.data);
      if (ativa.current) setResultado(calculado);
    } catch (erro) {
      if (ativa.current) onErro(erro);
    } finally {
      if (ativa.current) setOcupado(false);
    }
  }

  const inicioEfetivo = inicio < admissao ? admissao : inicio;
  const anosPagina = tabela?.anos.slice(pagina * tamanhoPagina, (pagina + 1) * tamanhoPagina) ?? [];
  return (
    <section className="painel separado" aria-labelledby="calculo-dof-titulo">
      <h4 id="calculo-dof-titulo">Cálculo de referência — DOF</h4>
      <p>{nome} — matrícula {matricula}. Admissão na fonte: {admissao}.</p>
      <p className="etiqueta">Regra provisória (planilha). Este cálculo não cria documento nem autoriza emissão.</p>
      <p>As ocorrências da fonte não são carregadas automaticamente. Confira os registros e informe os dias de cada intervalo; campos vazios serão tratados como zero somente após sua confirmação.</p>
      <form onSubmit={calcular}>
        <fieldset disabled={ocupado}>
          <div className="grade">
            <label>Início do período<input type="date" value={inicio} required onChange={(evento) => { setInicio(evento.target.value); setTabela(null); invalidar(); }} /></label>
            <label>Fim do período<input type="date" value={fim} required onChange={(evento) => { setFim(evento.target.value); setTabela(null); invalidar(); }} /></label>
          </div>
          <button type="button" className="secundario" onClick={preparar}>Preparar tabela anual</button>
          {tabela && (
            <>
              {inicio < admissao && <p className="aviso">O início será ajustado à admissão; confira o aviso no resultado.</p>}
              {inicioEfetivo > admissao && (
                <div className="grade separado">
                  <label>T/S acumulado antes do período<input name="anteriorTs" type="number" min="0" step="1" required onChange={invalidar} /></label>
                  <label>P/F acumulado antes do período<input name="anteriorPf" type="number" min="0" step="1" required onChange={invalidar} /></label>
                  <label>Origem do acumulado anterior<input name="origemAnterior" required onChange={invalidar} /></label>
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
                      <th scope="row">{ano}</th><td>{comeco} a {termino}</td>
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
              <label className="marcador"><input type="checkbox" checked={confirmado} required onChange={(evento) => setConfirmado(evento.target.checked)} />
                Confirmei todos os anos e intervalos parciais; campos vazios representam zero.</label>
              <button type="submit">{ocupado ? 'Calculando...' : 'Calcular DOF'}</button>
            </>
          )}
        </fieldset>
      </form>
      {resultado && (
        <section className="separado" aria-labelledby="resultado-dof-titulo">
          <h4 id="resultado-dof-titulo">Resultado provisório</h4>
          <p>Período efetivo: {resultado.periodo.inicioEfetivo} a {resultado.periodo.fim}. Regra {resultado.regra.codigo}, versão {resultado.regra.versao}.</p>
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
      <div className="acoes"><button type="button" className="secundario" onClick={onFechar}>Fechar cálculo</button></div>
    </section>
  );
}
