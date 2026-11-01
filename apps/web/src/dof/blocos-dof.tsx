import {
  atualizarBlocosDofSchema,
  codigoBlocoDofSchema,
  TITULOS_BLOCOS_DOF,
  type BlocoRascunhoDof,
  type CodigoBlocoDof,
  type DadosFontePreviaDof,
  type ProvaFontePreviaDof,
  type RascunhoDof,
} from '@sisdoc/contratos';
import { renderizarPreviaDof } from '@sisdoc/templates';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, ErroApi } from '../infraestrutura/api';

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
};

export function BlocosDof({
  rascunho, csrf, bloqueado, previaBloqueada = false, somenteLeitura = false, onAtualizar, onPendente, onPrevia, onErro, onLimpar,
  destinoPrevia, onFonte,
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
    setMotivo(novoMotivo);
    setMensagem('');
    onPendente(JSON.stringify(novos) !== JSON.stringify(rascunho.blocos) || novoMotivo.length > 0);
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
      <p>Os blocos começam vazios; nenhum texto oficial foi aprovado. As alterações exigem motivo e ficam apenas no rascunho. Limites técnicos: 200 blocos, 8.000 caracteres por bloco e 20.000 no total.</p>
      <p>Variáveis disponíveis: {'{{nome}}'}, {'{{matricula}}'}, {'{{cpf}}'}, {'{{nascimento}}'}, {'{{nome_mae}}'}, {'{{regime_juridico}}'}, {'{{cargo}}'}, {'{{nivel}}'}, {'{{referencia}}'}, {'{{orgao}}'}, {'{{processo}}'}, {'{{admissao}}'}, {'{{inicio}}'}, {'{{fim}}'}, {'{{dias_periodo}}'}, {'{{tempo_contribuicao}}'} e {'{{efetivo_exercicio}}'}. Variáveis indisponíveis e expressões malformadas são destacadas.</p>
      {bloqueado && <p className="aviso erro">Salve ou descarte as alterações do cálculo e do processo antes de editar os blocos.</p>}
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
                  {!salvos.has(bloco.id) && <button type="button" className="secundario"
                    onClick={() => alterar(blocos.filter((atual) => atual.id !== bloco.id))}>Remover bloco novo {indice + 1}</button>}
                </div>
              </section>
            ))}
            <label>Motivo da alteração dos blocos
              <textarea value={motivo} maxLength={2000} required onChange={(evento) => alterar(blocos, evento.target.value)} />
            </label>
            <button type="submit" disabled={!alterados}>{ocupado ? 'Salvando...' : 'Salvar blocos'}</button>
          </fieldset>
        </form>
      {mensagem && <p className="aviso sucesso" role="status">{mensagem}</p>}
    </section>
    {destinoPrevia && createPortal(
        <div className="previa-documento">
          <details className="orientacoes-dof">
            <summary>Dados consultados ao abrir · proteja a prévia</summary>
            <p>Usa o cálculo e processo salvos e reflete os blocos locais, inclusive alterações ainda não salvas. Carrega automaticamente após salvar e reabrir o rascunho. Use Atualizar prévia para consultar novamente a fonte. Contém dados pessoais integrais; proteja a tela. Não possui validade oficial.</p>
          </details>
          <button type="button" className="secundario" disabled={carregandoPrevia || previaBloqueada}
            onClick={() => { onLimpar(); setAtualizacaoPrevia((valor) => valor + 1); }}>
            {falhaPrevia ? 'Tentar carregar prévia novamente' : 'Atualizar prévia'}
          </button>
          {carregandoPrevia && <p role="status">Carregando prévia da revisão {rascunho.revisao}...</p>}
          {falhaPrevia && <p className="aviso erro">A prévia não pôde ser carregada. Tente novamente antes de conferir.</p>}
          {fonte && fonte.documentoId === rascunho.id && fonte.revisao === rascunho.revisao ? (
            <>
              <iframe
                title="Prévia provisória da DOF"
                sandbox=""
                srcDoc={renderizarPreviaDof({ ...rascunho, blocos, fonte })}
              />
            </>
          ) : null}
        </div>
      , destinoPrevia)}
    </>
  );
}
