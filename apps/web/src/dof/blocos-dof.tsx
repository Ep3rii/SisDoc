import {
  atualizarBlocosDofSchema,
  codigoBlocoDofSchema,
  TITULOS_BLOCOS_DOF,
  type BlocoRascunhoDof,
  type CodigoBlocoDof,
  type DadosFontePreviaDof,
  type ProvaFontePreviaDof,
  referenciaServidorSchema,
  type ReferenciaServidor,
  type RascunhoDof,
  aplicarAjustesCadastro, type AjustesCadastro, type ResultadoCalculoDof,
} from '@sisdoc/contratos';
import { renderizarPreviaDof } from '@sisdoc/templates';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, ErroApi, requisitar, validar } from '../infraestrutura/api';
import { PreviaDocumento } from '../compartilhado/previa-documento';

type Props = {
  rascunho: RascunhoDof;
  csrf: string;
  bloqueado: boolean;
  previaBloqueada?: boolean;
  somenteLeitura?: boolean;
  onAtualizar: (rascunho: RascunhoDof) => void;
  onPendente: (valor: boolean) => void;
  onPrevia: (prova: ProvaFontePreviaDof | null) => void;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
  destinoPrevia: HTMLDivElement | null;
  onFonte: (fonte: DadosFontePreviaDof | null) => void;
  previaLocal?: { resultado: ResultadoCalculoDof; erro?: undefined } | { erro: string; resultado?: undefined };
  ajustesCadastro?: AjustesCadastro;
  processoEdicao?: string | null;
  fonteEdicao?: Omit<DadosFontePreviaDof, 'documentoId' | 'revisao' | 'provaFonte'>;
};

export function BlocosDof({
  rascunho, csrf, bloqueado, previaBloqueada = false, somenteLeitura = false, onAtualizar, onPendente, onPrevia, onErro, onLimpar,
  destinoPrevia, onFonte, previaLocal, ajustesCadastro, processoEdicao, fonteEdicao,
}: Props) {
  const [blocos, setBlocos] = useState(rascunho.blocos);
  const [tipo, setTipo] = useState<CodigoBlocoDof>('contratacao');
  const [motivo, setMotivo] = useState('');
  const [fonte, setFonte] = useState<DadosFontePreviaDof | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);
  const [falhaPrevia, setFalhaPrevia] = useState(false);
  const [atualizacaoPrevia, setAtualizacaoPrevia] = useState(0);
  const [eventos, setEventos] = useState<ReferenciaServidor['registros'] | null>(null);
  const [cursorEventos, setCursorEventos] = useState<string | undefined>();
  const [proximoCursorEventos, setProximoCursorEventos] = useState<string | null>(null);
  const [cursorFalhaEventos, setCursorFalhaEventos] = useState<string | undefined>();
  const [codigoSugestao, setCodigoSugestao] = useState<CodigoBlocoDof | ''>('');
  const [carregandoEventos, setCarregandoEventos] = useState(false);
  const [falhaEventos, setFalhaEventos] = useState(false);
  const requisicaoEventos = useRef(0);
  const ativa = useRef(true);
  const revisaoAtual = useRef({ id: rascunho.id, revisao: rascunho.revisao });
  revisaoAtual.current = { id: rascunho.id, revisao: rascunho.revisao };
  useEffect(() => {
    ativa.current = true;
    return () => { ativa.current = false; };
  }, []);
  useEffect(() => {
    let corrente = true;
    setFonte(null);
    onPrevia(null);
    onFonte(null);
    setFalhaPrevia(false);
    setCarregandoPrevia(true);
    api.obterPreviaDof(rascunho.id).then((resposta) => {
      if (!corrente) return;
      if (resposta.documentoId !== revisaoAtual.current.id || resposta.revisao !== revisaoAtual.current.revisao) {
        throw new ErroApi(409, 'O rascunho foi alterado. Reabra-o antes de visualizar a prévia.');
      }
      setFonte(resposta);
      onFonte(resposta);
      onPrevia({ documentoId: resposta.documentoId, revisao: resposta.revisao, provaFonte: resposta.provaFonte });
    }).catch((erro: unknown) => {
      if (corrente) { setFalhaPrevia(true); onErro(erro); }
    }).finally(() => {
      if (corrente) setCarregandoPrevia(false);
    });
    return () => { corrente = false; };
  }, [rascunho.id, rascunho.revisao, atualizacaoPrevia, onPrevia, onFonte, onErro]);

  function alterar(novos: BlocoRascunhoDof[], novoMotivo = motivo) {
    setBlocos(novos);
    setMensagem('');
    const mudou = JSON.stringify(novos) !== JSON.stringify(rascunho.blocos);
    setMotivo(mudou ? novoMotivo : '');
    onPendente(mudou);
  }

  function adicionar() {
    if (blocos.length >= 200) {
      onErro(new ErroApi(400, 'O limite técnico é de 200 blocos por rascunho.'));
      return;
    }
    if (!globalThis.crypto?.randomUUID) {
      onErro(new ErroApi(0, 'Não foi possível gerar um identificador seguro para o bloco.'));
      return;
    }
    alterar([...blocos, { id: globalThis.crypto.randomUUID(), codigo: tipo, ativo: true, texto: '' }]);
  }

  async function carregarEventos(cursor?: string) {
    const requisicao = ++requisicaoEventos.current;
    setCarregandoEventos(true);
    setFalhaEventos(false);
    try {
      const consulta = new URLSearchParams({
        vinculoId: rascunho.vinculoId, tipo: 'eventos_funcionais', limite: '50',
        ...(cursor ? { cursor } : {}),
      });
      const dados = validar(referenciaServidorSchema, await requisitar(
        `servidores/${rascunho.pessoaId}/referencias?${consulta.toString()}`,
      ));
      if (dados.pessoaId !== rascunho.pessoaId || dados.vinculoId !== rascunho.vinculoId) {
        throw new ErroApi(409, 'Os eventos consultados não correspondem ao vínculo deste rascunho.');
      }
      if (!ativa.current || requisicao !== requisicaoEventos.current) return;
      setEventos(dados.registros.filter((evento) => evento.campos.removido_na_fonte_em === null));
      setCursorEventos(cursor);
      setProximoCursorEventos(dados.proximoCursor);
      setCursorFalhaEventos(undefined);
    } catch (erro: unknown) {
      if (ativa.current && requisicao === requisicaoEventos.current) {
        setFalhaEventos(true);
        setCursorFalhaEventos(cursor);
        onErro(erro);
      }
    } finally {
      if (ativa.current && requisicao === requisicaoEventos.current) setCarregandoEventos(false);
    }
  }

  function adicionarSugestao(evento: ReferenciaServidor['registros'][number]) {
    if (!codigoSugestao) return;
    if (blocos.length >= 200) {
      onErro(new ErroApi(400, 'O limite técnico é de 200 blocos por rascunho.'));
      return;
    }
    if (!globalThis.crypto?.randomUUID) {
      onErro(new ErroApi(0, 'Não foi possível gerar um identificador seguro para o bloco.'));
      return;
    }
    const campo = (nome: string) => evento.campos[nome]?.replace(/\s+/g, ' ').trim() || null;
    const ato = [campo('ato_tipo'), campo('ato_numero')].filter((valor): valor is string => valor !== null).join(' ');
    const linhas = [
      campo('tipo') ? `Tipo registrado: ${campo('tipo')}` : null,
      campo('data_evento') ? `Data do evento: ${campo('data_evento')}` : null,
      ato ? `Ato: ${ato}` : null,
      campo('data_publicacao') ? `Data de publicação: ${campo('data_publicacao')}` : null,
      campo('descricao_origem') ? `Descrição de origem: ${campo('descricao_origem')}` : null,
      campo('fonte') ? `Fonte: ${campo('fonte')}` : null,
    ].filter((linha): linha is string => linha !== null);
    const texto = linhas.join('\n');
    if (texto.length === 0 || texto.length > 8000) {
      onErro(new ErroApi(400, 'O evento não tem campos utilizáveis ou excede o limite de texto do bloco.'));
      return;
    }
    alterar([...blocos, {
      id: globalThis.crypto.randomUUID(), codigo: codigoSugestao, ativo: false, texto,
    }]);
    setMensagem('Sugestão copiada para um bloco inativo. Revise e edite o texto antes de ativá-lo.');
  }

  function mover(indice: number, destino: number) {
    if (destino < 0 || destino >= blocos.length) return;
    const novos = [...blocos];
    [novos[indice], novos[destino]] = [novos[destino], novos[indice]];
    alterar(novos);
  }

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = atualizarBlocosDofSchema.safeParse({ revisao: rascunho.revisao, motivo, blocos });
    if (!dados.success) {
      onErro(new ErroApi(400, 'Confira o motivo, o conteúdo e os limites dos blocos.'));
      return;
    }
    try {
      onLimpar();
      setOcupado(true);
      const salvo = await api.atualizarBlocosDof(csrf, rascunho.id, dados.data);
      if (ativa.current) {
        setBlocos(salvo.blocos);
        setMotivo('');
        onAtualizar(salvo);
        onPendente(false);
        setMensagem(`Blocos salvos na revisão ${salvo.revisao}. O rascunho não foi conferido nem emitido.`);
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

  const alterados = JSON.stringify(blocos) !== JSON.stringify(rascunho.blocos);
  const salvos = new Set(rascunho.blocos.map((bloco) => bloco.id));
  return (
    <>
    <section aria-labelledby="blocos-dof-titulo">
      <h4 id="blocos-dof-titulo">Blocos provisórios da DOF</h4>
      <details><summary>Orientações e variáveis dos blocos</summary>
      <p>Os blocos começam vazios; nenhum texto oficial foi aprovado. As alterações exigem motivo e ficam apenas no rascunho. Limites técnicos: 200 blocos, 8.000 caracteres por bloco e 20.000 no total.</p>
      <p>Variáveis disponíveis: {'{{nome}}'}, {'{{matricula}}'}, {'{{cpf}}'}, {'{{nascimento}}'}, {'{{nome_mae}}'}, {'{{regime_juridico}}'}, {'{{cargo}}'}, {'{{nivel}}'}, {'{{referencia}}'}, {'{{orgao}}'}, {'{{processo}}'}, {'{{admissao}}'}, {'{{inicio}}'}, {'{{fim}}'}, {'{{dias_periodo}}'}, {'{{tempo_contribuicao}}'} e {'{{efetivo_exercicio}}'}. Variáveis indisponíveis e expressões malformadas são destacadas.</p>
      </details>
      {bloqueado && <p className="aviso erro">Salve ou descarte as alterações do cálculo e do processo antes de editar os blocos.</p>}
      <section className="separado" aria-labelledby="sugestoes-eventos-titulo">
        <h4 id="sugestoes-eventos-titulo">Sugestões revisáveis do histórico funcional</h4>
        <p>Extraia dados dos eventos para um bloco provisório. Escolha o tipo manualmente; a sugestão fica inativa e não calcula períodos ou direitos. Revise e edite antes de ativar. As regras de classificação e cálculo da página 2 ainda não foram homologadas.</p>
        <fieldset disabled={ocupado || bloqueado || somenteLeitura || carregandoEventos}>
          <label>Destino da sugestão
            <select value={codigoSugestao} onChange={(evento) => {
              const codigo = codigoBlocoDofSchema.safeParse(evento.target.value);
              if (codigo.success) setCodigoSugestao(codigo.data);
              else setCodigoSugestao('');
            }}>
              <option value="">Escolha o tipo de bloco</option>
              {Object.entries(TITULOS_BLOCOS_DOF).map(([codigo, titulo]) =>
                <option key={codigo} value={codigo}>{titulo}</option>)}
            </select>
          </label>
          {eventos === null && !falhaEventos && (
            <button type="button" className="secundario" onClick={() => { onLimpar(); void carregarEventos(); }}>
              {carregandoEventos ? 'Carregando eventos...' : 'Carregar eventos funcionais'}
            </button>
          )}
          {eventos !== null && <>
            <p role="status">{eventos.length} evento(s) ativo(s) nesta página do histórico funcional.</p>
            {eventos.length === 0 && <p>Nenhum evento ativo nesta página.</p>}
            {eventos.map((evento) => <section className="grupo-formulario" key={evento.id}>
              <h5>{evento.campos.tipo || 'Evento sem tipo informado'}</h5>
              <p>{[
                evento.campos.data_evento,
                [evento.campos.ato_tipo, evento.campos.ato_numero].filter(Boolean).join(' '),
                evento.campos.data_publicacao ? `Publicação ${evento.campos.data_publicacao}` : null,
              ].filter(Boolean).join(' · ') || 'Sem data ou ato informado'}</p>
              <button type="button" className="secundario" disabled={!codigoSugestao}
                onClick={() => adicionarSugestao(evento)}>Adicionar ao rascunho como bloco inativo</button>
            </section>)}
            <div className="acoes">
              <button type="button" className="secundario" disabled={!cursorEventos}
                onClick={() => { onLimpar(); void carregarEventos(); }}>Primeira página de eventos</button>
              <button type="button" className="secundario" disabled={!proximoCursorEventos}
                onClick={() => { onLimpar(); void carregarEventos(proximoCursorEventos ?? undefined); }}>Próxima página de eventos</button>
            </div>
          </>}
          {falhaEventos && <>
            <p className="aviso erro" role="alert">Não foi possível carregar esta página do histórico funcional.</p>
            <button type="button" className="secundario" onClick={() => { onLimpar(); void carregarEventos(cursorFalhaEventos); }}>
              Tentar carregar eventos novamente
            </button>
          </>}
        </fieldset>
      </section>
        <form onSubmit={salvar}>
          <fieldset disabled={ocupado || bloqueado || somenteLeitura}>
            <label>Tipo de bloco
              <select value={tipo} onChange={(evento) => {
                const codigo = codigoBlocoDofSchema.safeParse(evento.target.value);
                if (codigo.success) setTipo(codigo.data);
                else onErro(new ErroApi(400, 'Tipo de bloco inválido.'));
              }}>
                {Object.entries(TITULOS_BLOCOS_DOF).map(([codigo, titulo]) => <option key={codigo} value={codigo}>{titulo}</option>)}
              </select>
            </label>
            <button type="button" className="secundario" onClick={adicionar}>Adicionar bloco</button>
            {blocos.length === 0 && <p>Nenhum bloco adicionado.</p>}
            {blocos.map((bloco, indice) => (
              <section key={bloco.id} className="bloco" aria-label={`Bloco ${indice + 1}: ${TITULOS_BLOCOS_DOF[bloco.codigo]}`}>
                <h5>{indice + 1}. {TITULOS_BLOCOS_DOF[bloco.codigo]}</h5>
                <label className="marcador">
                  <input type="checkbox" checked={bloco.ativo} onChange={(evento) =>
                    alterar(blocos.map((atual) => atual.id === bloco.id ? { ...atual, ativo: evento.target.checked } : atual))} />
                  Ativar bloco {indice + 1}
                </label>
                <label>Texto do bloco {indice + 1}
                  <textarea maxLength={8000} value={bloco.texto} onChange={(evento) =>
                    alterar(blocos.map((atual) => atual.id === bloco.id ? { ...atual, texto: evento.target.value } : atual))} />
                </label>
                <div className="acoes">
                  <button type="button" className="secundario" disabled={indice === 0} onClick={() => mover(indice, indice - 1)}>Subir bloco {indice + 1}</button>
                  <button type="button" className="secundario" disabled={indice === blocos.length - 1} onClick={() => mover(indice, indice + 1)}>Descer bloco {indice + 1}</button>
                  {!salvos.has(bloco.id) && <button type="button" className="perigo"
                    onClick={() => alterar(blocos.filter((atual) => atual.id !== bloco.id))}>Remover bloco novo {indice + 1}</button>}
                </div>
              </section>
            ))}
            {alterados && <label>Motivo da alteração dos blocos
              <textarea value={motivo} maxLength={2000} required onChange={(evento) => alterar(blocos, evento.target.value)} />
            </label>}
            <button type="submit" disabled={!alterados || !motivo.trim()}>{ocupado ? 'Salvando...' : 'Salvar blocos'}</button>
          </fieldset>
        </form>
      {mensagem && <p className="aviso sucesso" role="status">{mensagem}</p>}
    </section>
    {destinoPrevia && createPortal(
        <div className="previa-documento">
          <details className="orientacoes-dof">
            <summary>Dados consultados ao abrir · proteja a prévia</summary>
            <p>Prévia de edição, sem validade oficial. Reflete os dados locais; não comprova gravação. Conferência usa exclusivamente revisão e fonte salvas. Contém dados pessoais integrais; proteja a tela.</p>
          </details>
          <button type="button" className="secundario" disabled={carregandoPrevia || previaBloqueada}
            onClick={() => { onLimpar(); setAtualizacaoPrevia((valor) => valor + 1); }}>
            {falhaPrevia ? 'Tentar carregar prévia novamente' : 'Atualizar prévia'}
          </button>
          {carregandoPrevia && <p role="status">Carregando prévia da revisão {rascunho.revisao}...</p>}
          {falhaPrevia && <p className="aviso erro">A prévia não pôde ser carregada. Tente novamente antes de conferir.</p>}
          {fonte && fonte.documentoId === rascunho.id && fonte.revisao === rascunho.revisao ? (
            <>
              {previaLocal?.erro ? <p className="aviso erro" role="status">{previaLocal.erro}</p> :
                <PreviaDocumento titulo="Prévia provisória da DOF" html={renderizarPreviaDof({
                  ...rascunho, blocos, resultado: previaLocal?.resultado ?? rascunho.resultado,
                  processo: processoEdicao === undefined ? rascunho.processo : processoEdicao,
                  fonte: fonteEdicao ?? aplicarAjustesCadastro(fonte, ajustesCadastro),
                })} />}
            </>
          ) : null}
        </div>
      , destinoPrevia)}
    </>
  );
}
