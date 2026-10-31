import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  MAXIMO_CARGOS_COMISSIONADOS,
  MAXIMO_PERIODOS_DTC,
  OBSERVACAO_PADRAO_INSS,
  ROTULOS_CATEGORIA_INSS,
  ROTULOS_DTC,
  validarConteudoDtc,
  type AnoCalculo,
  type CargoComissionado,
  type CategoriaFuncionalInss,
  type ConteudoDtc,
  type DadosInss,
  type DocumentoDtc,
  type PaginaBuscaServidores,
  type PaginaDtc,
  type PeriodoDtc,
  type PreviaDtc,
  type RespostaSessao,
  type SituacaoEmissao,
  type TipoDtc,
} from '@sisdoc/contratos';
import { renderizarPreviaDtc } from '@sisdoc/templates';
import { api, ErroApi } from './api';
import { PainelEmissao } from './emissao';

type Papel = RespostaSessao['usuario']['papel'];
type Servidor = { pessoaId: string; vinculoId: string; nome: string; matricula: string };
type Props = {
  tipo: TipoDtc;
  csrf: string;
  papel: Papel;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
  onPendente: (valor: boolean) => void;
  confirmarSaida: () => boolean;
};
type Modo =
  | { tela: 'lista' }
  | { tela: 'busca' }
  | { tela: 'novo'; servidor: Servidor }
  | { tela: 'documento'; id: string };

const DESCRICOES: Record<TipoDtc, string> = {
  DTC_IPAM: 'Anexo III · Portaria MPS nº 154/2008 · até 4 períodos e 6 linhas de totais.',
  DTC_COMISSIONADO: 'Anexo VIII · CNPJ 06.307102/0001-30 · até 3 cargos em comissão; totais inferidos (provisórios).',
  DTC_INSS: 'RGPS · até 4 períodos com categoria funcional. Modelo PROVISÓRIO: textos oficiais do INSS pendentes.',
};

function diasNoAno(ano: number): number {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0 ? 366 : 365;
}

/** Gera uma linha por ano coberto; anos parciais usam 'intervalo_declarado' e preservam valores já digitados. */
export function anosDoPeriodo(inicio: string, fim: string, existentes: AnoCalculo[]): AnoCalculo[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim) || fim < inicio) return existentes;
  const primeiro = Number(inicio.slice(0, 4));
  const ultimo = Number(fim.slice(0, 4));
  if (ultimo - primeiro > 199) return existentes;
  const linhas: AnoCalculo[] = [];
  for (let ano = primeiro; ano <= ultimo; ano += 1) {
    const anterior = existentes.find((linha) => linha.ano === ano);
    const completo = (ano > primeiro || inicio.endsWith('-01-01')) && (ano < ultimo || fim.endsWith('-12-31'));
    linhas.push({
      ano,
      abrangencia: completo ? 'ano_civil' : 'intervalo_declarado',
      faltas: anterior?.faltas ?? 0,
      ts: anterior?.ts ?? 0,
      pf: anterior?.pf ?? 0,
      ip: anterior?.ip ?? 0,
      outros: anterior?.outros ?? 0,
      pb: 0,
      pv: 0,
      licencaPremio: 0,
    });
  }
  return linhas;
}

function periodoVazio(tipo: TipoDtc): PeriodoDtc {
  return { inicio: '', fim: '', anos: [], categoria: tipo === 'DTC_INSS' ? 'efetivo' : null, cargo: tipo === 'DTC_INSS' ? '' : null };
}

function cargoVazio(): CargoComissionado {
  return {
    cargo: '', decretoNomeacao: '', publicacaoNomeacao: '', dataEntradaExercicio: '',
    decretoExoneracao: null, publicacaoExoneracao: null, dataEncerramento: null,
  };
}

function inssPadrao(): DadosInss {
  return {
    licencas: { possui: false, descricao: null },
    documentacao: { nomeacao: true, ctps: false, folha: true, frequencia: true, outros: null },
    observacao: OBSERVACAO_PADRAO_INSS,
  };
}

function conteudoInicial(tipo: TipoDtc): ConteudoDtc {
  return {
    periodos: [periodoVazio(tipo)],
    cargos: tipo === 'DTC_COMISSIONADO' ? [cargoVazio()] : [],
    inss: tipo === 'DTC_INSS' ? inssPadrao() : null,
    processo: null,
    confirmarInicioAjustado: false,
  };
}

function textoOuNulo(valor: string): string | null {
  return valor.trim() ? valor : null;
}

function dataBr(valor: string | null): string {
  return valor ? valor.split('-').reverse().join('/') : '—';
}

function Editor({ tipo, inicial, documento, servidor, csrf, onSalvo, onCancelar, onErro, onLimpar, onPendente }: {
  tipo: TipoDtc;
  inicial: ConteudoDtc;
  documento: DocumentoDtc | null;
  servidor: Servidor;
  csrf: string;
  onSalvo: (documento: DocumentoDtc) => void;
  onCancelar: () => void;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
  onPendente: (valor: boolean) => void;
}) {
  const [conteudo, setConteudo] = useState<ConteudoDtc>(inicial);
  const [motivo, setMotivo] = useState('');
  const [confirmacao, setConfirmacao] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const problemas = validarConteudoDtc(tipo, conteudo);

  function alterar(novo: ConteudoDtc) {
    setConteudo(novo);
    onPendente(true);
  }
  function alterarPeriodo(indice: number, mudanca: Partial<PeriodoDtc>) {
    const periodos = conteudo.periodos.map((periodo, posicao) => {
      if (posicao !== indice) return periodo;
      const atualizado = { ...periodo, ...mudanca };
      return { ...atualizado, anos: anosDoPeriodo(atualizado.inicio, atualizado.fim, periodo.anos) };
    });
    alterar({ ...conteudo, periodos });
  }
  function alterarAno(indice: number, ano: number, campo: 'faltas' | 'ts' | 'pf' | 'ip' | 'outros', valor: string) {
    const numero = Math.max(0, Math.min(366, Number.parseInt(valor, 10) || 0));
    alterarPeriodo(indice, {
      anos: conteudo.periodos[indice].anos.map((linha) => linha.ano === ano ? { ...linha, [campo]: numero } : linha),
    });
  }
  function alterarCargo(indice: number, mudanca: Partial<CargoComissionado>) {
    alterar({ ...conteudo, cargos: conteudo.cargos.map((cargo, posicao) => posicao === indice ? { ...cargo, ...mudanca } : cargo) });
  }
  function alterarInss(mudanca: Partial<DadosInss>) {
    alterar({ ...conteudo, inss: { ...(conteudo.inss ?? inssPadrao()), ...mudanca } });
  }

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    try {
      onLimpar();
      setOcupado(true);
      const salvo = documento
        ? await api.atualizarDtc(csrf, documento.id, { ...conteudo, revisao: documento.revisao, motivo })
        : await api.criarDtc(csrf, { ...conteudo, tipo, pessoaId: servidor.pessoaId, vinculoId: servidor.vinculoId, confirmacaoDados: true });
      onPendente(false);
      onSalvo(salvo);
    } catch (erro) {
      onErro(erro);
    } finally {
      setOcupado(false);
    }
  }

  const inss = conteudo.inss;
  return (
    <form className="editor-dof" onSubmit={(evento) => void salvar(evento)} aria-label={`Editor da ${ROTULOS_DTC[tipo]}`}>
      <p className="identificador-documento">{documento ? `Rascunho · revisão ${documento.revisao}` : 'Novo rascunho'}</p>
      <h2>{ROTULOS_DTC[tipo]} — {servidor.nome}</h2>
      <p>Matrícula {servidor.matricula}. {DESCRICOES[tipo]}</p>
      <fieldset>
        <legend><strong>Períodos ({conteudo.periodos.length} de {MAXIMO_PERIODOS_DTC})</strong></legend>
        {conteudo.periodos.map((periodo, indice) => (
          <div className="bloco" key={indice}>
            <h5>{indice + 1}º período</h5>
            <div className="grade-busca">
              <label>Início<input type="date" required value={periodo.inicio}
                onChange={(evento) => alterarPeriodo(indice, { inicio: evento.target.value })} /></label>
              <label>Fim<input type="date" required value={periodo.fim}
                onChange={(evento) => alterarPeriodo(indice, { fim: evento.target.value })} /></label>
              {tipo === 'DTC_INSS' && <>
                <label>Cargo/função<input value={periodo.cargo ?? ''} maxLength={200} required
                  onChange={(evento) => alterarPeriodo(indice, { cargo: evento.target.value })} /></label>
                <label>Categoria funcional<select value={periodo.categoria ?? 'efetivo'}
                  onChange={(evento) => alterarPeriodo(indice, { categoria: evento.target.value as CategoriaFuncionalInss })}>
                  {Object.entries(ROTULOS_CATEGORIA_INSS).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
                </select></label>
              </>}
            </div>
            {periodo.anos.length > 0 && <div className="tabela"><table>
              <caption className="sr-only">Ocorrências anuais do {indice + 1}º período</caption>
              <thead><tr><th scope="col">Ano</th><th scope="col">Faltas</th><th scope="col">TS</th><th scope="col">PF</th>
                <th scope="col">IP</th><th scope="col">Outros</th></tr></thead>
              <tbody>{periodo.anos.map((linha) => (
                <tr key={linha.ano}><th scope="row">{linha.ano}{linha.abrangencia === 'intervalo_declarado' ? ' (parcial)' : ''}</th>
                  {(['faltas', 'ts', 'pf', 'ip', 'outros'] as const).map((campo) => (
                    <td key={campo}><label className="sr-only" htmlFor={`p${indice}-${linha.ano}-${campo}`}>{campo} em {linha.ano}</label>
                      <input id={`p${indice}-${linha.ano}-${campo}`} className="dias-anuais" type="number" min={0} max={366}
                        value={linha[campo]} onChange={(evento) => alterarAno(indice, linha.ano, campo, evento.target.value)} /></td>
                  ))}
                </tr>
              ))}</tbody>
            </table></div>}
            {conteudo.periodos.length > 1 && <button type="button" className="secundario"
              onClick={() => alterar({ ...conteudo, periodos: conteudo.periodos.filter((_, posicao) => posicao !== indice) })}>
              Remover {indice + 1}º período</button>}
          </div>
        ))}
        {conteudo.periodos.length < MAXIMO_PERIODOS_DTC && <div className="acoes"><button type="button" className="secundario"
          onClick={() => alterar({ ...conteudo, periodos: [...conteudo.periodos, periodoVazio(tipo)] })}>Adicionar período</button></div>}
      </fieldset>
      {tipo === 'DTC_COMISSIONADO' && <fieldset className="separado">
        <legend><strong>Cargos em comissão ({conteudo.cargos.length} de {MAXIMO_CARGOS_COMISSIONADOS})</strong></legend>
        {conteudo.cargos.map((cargo, indice) => (
          <div className="bloco" key={indice}>
            <h5>{indice + 1}º cargo</h5>
            <label>Cargo<input required maxLength={200} value={cargo.cargo} onChange={(evento) => alterarCargo(indice, { cargo: evento.target.value })} /></label>
            <div className="grade-busca">
              <label>Decreto de nomeação<input required maxLength={200} value={cargo.decretoNomeacao}
                onChange={(evento) => alterarCargo(indice, { decretoNomeacao: evento.target.value })} /></label>
              <label>Publicação da nomeação<input required maxLength={200} value={cargo.publicacaoNomeacao}
                onChange={(evento) => alterarCargo(indice, { publicacaoNomeacao: evento.target.value })} /></label>
              <label>Entrada em exercício<input type="date" required value={cargo.dataEntradaExercicio}
                onChange={(evento) => alterarCargo(indice, { dataEntradaExercicio: evento.target.value })} /></label>
              <label>Decreto de exoneração<input maxLength={200} value={cargo.decretoExoneracao ?? ''}
                onChange={(evento) => alterarCargo(indice, { decretoExoneracao: textoOuNulo(evento.target.value) })} /></label>
              <label>Publicação da exoneração<input maxLength={200} value={cargo.publicacaoExoneracao ?? ''}
                onChange={(evento) => alterarCargo(indice, { publicacaoExoneracao: textoOuNulo(evento.target.value) })} /></label>
              <label>Encerramento/afastamento<input type="date" value={cargo.dataEncerramento ?? ''}
                onChange={(evento) => alterarCargo(indice, { dataEncerramento: textoOuNulo(evento.target.value) })} /></label>
            </div>
            {conteudo.cargos.length > 1 && <button type="button" className="secundario"
              onClick={() => alterar({ ...conteudo, cargos: conteudo.cargos.filter((_, posicao) => posicao !== indice) })}>
              Remover {indice + 1}º cargo</button>}
          </div>
        ))}
        {conteudo.cargos.length < MAXIMO_CARGOS_COMISSIONADOS && <div className="acoes"><button type="button" className="secundario"
          onClick={() => alterar({ ...conteudo, cargos: [...conteudo.cargos, cargoVazio()] })}>Adicionar cargo</button></div>}
      </fieldset>}
      {tipo === 'DTC_INSS' && inss && <fieldset className="separado">
        <legend><strong>Informações adicionais (textos provisórios)</strong></legend>
        <label className="marcador"><input type="checkbox" checked={inss.licencas.possui}
          onChange={(evento) => alterarInss({ licencas: { possui: evento.target.checked, descricao: evento.target.checked ? inss.licencas.descricao : null } })} />
          Houve licença não remunerada ou afastamento com suspensão do contrato</label>
        {inss.licencas.possui && <label>Datas, tipo e período/vínculo de cada ocorrência
          <textarea maxLength={2000} required value={inss.licencas.descricao ?? ''}
            onChange={(evento) => alterarInss({ licencas: { possui: true, descricao: textoOuNulo(evento.target.value) } })} /></label>}
        <p><strong>Documentação-base</strong></p>
        {([
          ['nomeacao', 'Atos de nomeação e exoneração'],
          ['ctps', 'Contrato de trabalho, CTPS ou ficha funcional'],
          ['folha', 'Folhas de pagamento ou ficha financeira'],
          ['frequencia', 'Registros de frequência'],
        ] as const).map(([campo, rotulo]) => (
          <label className="marcador" key={campo}><input type="checkbox" checked={inss.documentacao[campo]}
            onChange={(evento) => alterarInss({ documentacao: { ...inss.documentacao, [campo]: evento.target.checked } })} />{rotulo}</label>
        ))}
        <label>Outros documentos<input maxLength={200} value={inss.documentacao.outros ?? ''}
          onChange={(evento) => alterarInss({ documentacao: { ...inss.documentacao, outros: textoOuNulo(evento.target.value) } })} /></label>
        <label>Observações<textarea maxLength={2000} value={inss.observacao ?? ''}
          onChange={(evento) => alterarInss({ observacao: textoOuNulo(evento.target.value) })} /></label>
      </fieldset>}
      <fieldset className="separado">
        <legend><strong>Processo e confirmações</strong></legend>
        <label>Número do processo{documento?.mascarasProcesso.length ? ` (${documento.mascarasProcesso.join(' ou ')})` : ''}
          <input maxLength={60} value={conteudo.processo ?? ''}
            onChange={(evento) => alterar({ ...conteudo, processo: textoOuNulo(evento.target.value) })} /></label>
        <label className="marcador"><input type="checkbox" checked={conteudo.confirmarInicioAjustado}
          onChange={(evento) => alterar({ ...conteudo, confirmarInicioAjustado: evento.target.checked })} />
          Confirmo o ajuste do início à data de posse, se o cálculo o indicar</label>
        {documento ? (
          <label>Motivo da alteração<textarea required maxLength={2000} value={motivo} onChange={(evento) => setMotivo(evento.target.value)} /></label>
        ) : (
          <label className="marcador"><input type="checkbox" checked={confirmacao} onChange={(evento) => setConfirmacao(evento.target.checked)} />
            Confirmo que conferi os dados do servidor e os períodos informados</label>
        )}
      </fieldset>
      {problemas.length > 0 && <ul className="aviso erro">{problemas.map((problema) => <li key={problema.caminho + problema.mensagem}>{problema.mensagem}</li>)}</ul>}
      <div className="acoes">
        <button type="submit" disabled={ocupado || problemas.length > 0 || (documento ? !motivo.trim() : !confirmacao)}>
          {ocupado ? 'Salvando...' : 'Salvar rascunho'}</button>
        <button type="button" className="secundario" disabled={ocupado} onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}

function Documento({ id, tipo, csrf, papel, onVoltar, onErro, onLimpar, onPendente }: {
  id: string; tipo: TipoDtc; csrf: string; papel: Papel; onVoltar: () => void;
  onErro: (erro: unknown) => void; onLimpar: () => void; onPendente: (valor: boolean) => void;
}) {
  const [previa, setPrevia] = useState<PreviaDtc | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [versao, setVersao] = useState(0);
  const [editando, setEditando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [emissao, setEmissao] = useState<SituacaoEmissao | null>(null);
  const chave = useRef<{ revisao: number; valor: string } | null>(null);

  useEffect(() => {
    let corrente = true;
    setFalhou(false);
    api.previaDtc(id).then((resultado) => {
      if (corrente) setPrevia(resultado);
    }).catch((erro: unknown) => {
      if (corrente) { setFalhou(true); onErro(erro); }
    });
    return () => { corrente = false; };
  }, [id, versao, onErro]);

  async function executar(acao: () => Promise<void>) {
    try {
      onLimpar();
      setOcupado(true);
      await acao();
    } catch (erro) {
      onErro(erro);
    } finally {
      setOcupado(false);
    }
  }

  if (emissao) return <section className="painel"><PainelEmissao situacao={emissao} onErro={onErro} onLimpar={onLimpar} />
    <button type="button" className="secundario" onClick={onVoltar}>Voltar à lista</button></section>;
  if (falhou) return <button type="button" className="secundario" onClick={() => setVersao((atual) => atual + 1)}>Tentar novamente</button>;
  if (!previa) return <p role="status">Carregando prévia...</p>;
  const { documento, fonte } = previa;
  if (documento.tipo !== tipo) return <p className="aviso erro">Este documento não é uma {ROTULOS_DTC[tipo]}.</p>;
  const servidor = { pessoaId: documento.pessoaId, vinculoId: documento.vinculoId, nome: documento.nome, matricula: documento.matricula };
  const coordenador = papel === 'coordenador';

  if (editando) {
    return <Editor tipo={tipo} inicial={documento.conteudo} documento={documento} servidor={servidor} csrf={csrf}
      onSalvo={() => { setEditando(false); setPrevia(null); setVersao((atual) => atual + 1); }}
      onCancelar={() => { onPendente(false); setEditando(false); }} onErro={onErro} onLimpar={onLimpar} onPendente={onPendente} />;
  }

  return (
    <section className="area-dof">
      <div className="editor-dof">
        <p className="identificador-documento">{documento.status === 'rascunho' ? 'Rascunho' : 'Conferida'} · revisão {documento.revisao}</p>
        <h2>{ROTULOS_DTC[tipo]} — {documento.nome}</h2>
        <dl className="dados-servidor">
          <div><dt>Matrícula</dt><dd>{documento.matricula}</dd></div>
          <div><dt>Admissão</dt><dd>{dataBr(documento.admissao)}</dd></div>
          <div><dt>Autor</dt><dd>{documento.autorNome}</dd></div>
          <div><dt>Processo</dt><dd>{documento.conteudo.processo ?? '—'}</dd></div>
          {documento.resultado.linhasTotais.slice(0, 2).map((linha) => (
            <div key={linha.codigo}><dt>{linha.rotulo}{linha.provisoria ? ' (provisório)' : ''}</dt><dd>{linha.texto || '0 dias'}</dd></div>
          ))}
        </dl>
        {documento.resultado.avisos.length > 0 && <ul className="orientacoes-dof">
          {documento.resultado.avisos.map((aviso, indice) => <li key={indice}>{aviso.mensagem}</li>)}</ul>}
        {documento.pendencias.length > 0 && <ul className="aviso erro">{documento.pendencias.map((texto) => <li key={texto}>{texto}</li>)}</ul>}
        {previa.fonteSelecionadaAlterada && <p className="aviso erro">A fonte mudou após a conferência; devolva a DTC para nova conferência.</p>}
        {documento.status === 'rascunho' && <>
          <div className="acoes">
            <button type="button" className="secundario" disabled={ocupado} onClick={() => setEditando(true)}>Editar rascunho</button>
          </div>
          <label className="marcador"><input type="checkbox" checked={confirmado} onChange={(evento) => setConfirmado(evento.target.checked)} />
            Conferi a prévia com os documentos e confirmo os dados</label>
          <div className="acoes"><button type="button" disabled={ocupado || !confirmado || documento.pendencias.length > 0}
            onClick={() => void executar(async () => {
              await api.conferirDtc(csrf, id, { revisao: documento.revisao, provaFonte: fonte.provaFonte, confirmar: true });
              setConfirmado(false);
              setPrevia(null);
              setVersao((atual) => atual + 1);
            })}>Conferir</button></div>
        </>}
        {documento.status === 'conferido' && coordenador && <>
          <div className="acoes"><button type="button" disabled={ocupado} onClick={() => void executar(async () => {
            if (!window.confirm(`Emitir a ${ROTULOS_DTC[tipo]} de ${documento.nome}? Um número oficial será reservado.`)) return;
            if (chave.current?.revisao !== documento.revisao) chave.current = { revisao: documento.revisao, valor: crypto.randomUUID() };
            const resultado = await api.emitirDtc(csrf, id, chave.current.valor, { revisao: documento.revisao, provaFonte: fonte.provaFonte });
            if (resultado.documentoId !== id) throw new ErroApi(0, 'Não foi possível confirmar a emissão. Consulte o Histórico.');
            setEmissao(resultado);
          })}>Emitir</button></div>
          <label>Motivo da devolução<textarea maxLength={2000} value={motivo} onChange={(evento) => {
            setMotivo(evento.target.value);
            onPendente(evento.target.value.trim().length > 0);
          }} /></label>
          <div className="acoes"><button type="button" className="secundario" disabled={ocupado || !motivo.trim()}
            onClick={() => void executar(async () => {
              await api.devolverDtc(csrf, id, { revisao: documento.revisao, motivo });
              setMotivo('');
              onPendente(false);
              setPrevia(null);
              setVersao((atual) => atual + 1);
            })}>Devolver para rascunho</button></div>
        </>}
        <div className="acoes"><button type="button" className="secundario" onClick={onVoltar}>Voltar à lista</button></div>
      </div>
      <div className="painel-previa previa-documento">
        <p>Prévia sem validade oficial. {tipo === 'DTC_INSS' ? 'Modelo do INSS provisório.' : ''}</p>
        <iframe title={`Prévia da ${ROTULOS_DTC[tipo]}`} sandbox="" srcDoc={renderizarPreviaDtc({ documento, fonte })} />
      </div>
    </section>
  );
}

function BuscaServidor({ onSelecionar, onCancelar, onErro, onLimpar }: {
  onSelecionar: (servidor: Servidor) => void; onCancelar: () => void; onErro: (erro: unknown) => void; onLimpar: () => void;
}) {
  const [termo, setTermo] = useState('');
  const [criterio, setCriterio] = useState<'nome' | 'cpf' | 'matricula'>('nome');
  const [resultado, setResultado] = useState<PaginaBuscaServidores | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function buscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    try {
      onLimpar();
      setOcupado(true);
      setResultado(await api.buscarServidores(termo, criterio));
    } catch (erro) {
      onErro(erro);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="painel" aria-labelledby="busca-dtc-titulo">
      <h2 id="busca-dtc-titulo">Selecionar servidor</h2>
      <form className="grade-busca" onSubmit={(evento) => void buscar(evento)}>
        <label>Buscar por<select value={criterio} onChange={(evento) => setCriterio(evento.target.value as typeof criterio)}>
          <option value="nome">Nome</option><option value="cpf">CPF</option><option value="matricula">Matrícula</option>
        </select></label>
        <label>Termo<input required value={termo} onChange={(evento) => setTermo(evento.target.value)} /></label>
        <button type="submit" disabled={ocupado}>{ocupado ? 'Buscando...' : 'Buscar'}</button>
      </form>
      {resultado && (resultado.itens.length === 0 ? <p>Nenhum servidor encontrado.</p> : <div className="tabela"><table>
        <thead><tr><th scope="col">Nome</th><th scope="col">Matrícula</th><th scope="col">Órgão</th><th scope="col">Ação</th></tr></thead>
        <tbody>{resultado.itens.map((item) => (
          <tr key={item.vinculoId}><td>{item.nome}</td><td>{item.matricula}</td><td>{item.orgao ?? '—'}</td>
            <td><button type="button" className="secundario" disabled={item.removidoNaFonte}
              onClick={() => onSelecionar({ pessoaId: item.pessoaId, vinculoId: item.vinculoId, nome: item.nome, matricula: item.matricula })}>
              Selecionar <span className="sr-only">{item.nome}</span></button></td></tr>
        ))}</tbody>
      </table></div>)}
      <div className="acoes"><button type="button" className="secundario" onClick={onCancelar}>Voltar à lista</button></div>
    </section>
  );
}

export function TelaDtc({ tipo, csrf, papel, onErro, onLimpar, onPendente, confirmarSaida }: Props) {
  const [modo, setModo] = useState<Modo>({ tela: 'lista' });
  const [estado, setEstado] = useState<'rascunho' | 'conferido'>('rascunho');
  const [pagina, setPagina] = useState<PaginaDtc | null>(null);
  const [versao, setVersao] = useState(0);
  const voltar = useCallback(() => {
    if (!confirmarSaida()) return;
    onPendente(false);
    setModo({ tela: 'lista' });
    setVersao((atual) => atual + 1);
  }, [confirmarSaida, onPendente]);

  useEffect(() => {
    if (modo.tela !== 'lista') return undefined;
    let corrente = true;
    setPagina(null);
    api.listarDtc(estado, tipo).then((resultado) => {
      if (corrente) setPagina(resultado);
    }).catch((erro: unknown) => {
      if (corrente) onErro(erro);
    });
    return () => { corrente = false; };
  }, [modo.tela, estado, tipo, versao, onErro]);

  if (modo.tela === 'busca') {
    return <BuscaServidor onSelecionar={(servidor) => setModo({ tela: 'novo', servidor })} onCancelar={voltar}
      onErro={onErro} onLimpar={onLimpar} />;
  }
  if (modo.tela === 'novo') {
    return <div className="estudio-dof"><Editor tipo={tipo} inicial={conteudoInicial(tipo)} documento={null} servidor={modo.servidor} csrf={csrf}
      onSalvo={(documento) => setModo({ tela: 'documento', id: documento.id })} onCancelar={voltar}
      onErro={onErro} onLimpar={onLimpar} onPendente={onPendente} /></div>;
  }
  if (modo.tela === 'documento') {
    return <Documento key={modo.id} id={modo.id} tipo={tipo} csrf={csrf} papel={papel} onVoltar={voltar}
      onErro={onErro} onLimpar={onLimpar} onPendente={onPendente} />;
  }
  return (
    <section className="painel" aria-labelledby="dtc-titulo">
      <h2 id="dtc-titulo">{ROTULOS_DTC[tipo]}</h2>
      <p>{DESCRICOES[tipo]}</p>
      <div className="acoes">
        <button type="button" onClick={() => { onLimpar(); setModo({ tela: 'busca' }); }}>Nova {ROTULOS_DTC[tipo]}</button>
        <label>Situação<select value={estado} onChange={(evento) => setEstado(evento.target.value === 'conferido' ? 'conferido' : 'rascunho')}>
          <option value="rascunho">{papel === 'coordenador' ? 'Rascunhos' : 'Meus rascunhos'}</option>
          <option value="conferido">Conferidas</option>
        </select></label>
      </div>
      {!pagina ? <p role="status">Carregando...</p> : pagina.itens.length === 0 ? <p>Nenhum documento nesta situação.</p> : (
        <div className="tabela"><table>
          <thead><tr><th scope="col">Nome</th><th scope="col">Matrícula</th><th scope="col">Revisão</th>
            <th scope="col">Atualizado em</th><th scope="col">Autor</th><th scope="col">Ação</th></tr></thead>
          <tbody>{pagina.itens.map((item) => (
            <tr key={item.id}><td>{item.nome}</td><td>{item.matricula}</td><td>{item.revisao}</td>
              <td>{new Date(item.atualizadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</td><td>{item.autorNome}</td>
              <td><button type="button" className="secundario" onClick={() => { onLimpar(); setModo({ tela: 'documento', id: item.id }); }}>
                Abrir <span className="sr-only">{item.nome}</span></button></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}
