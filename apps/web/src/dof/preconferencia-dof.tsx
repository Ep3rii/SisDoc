import type { PreconferenciaDof, RascunhoDof } from '@sisdoc/contratos';
import { useEffect, useRef, useState } from 'react';
import { api, ErroApi } from '../infraestrutura/api';

type Props = {
  rascunho: RascunhoDof;
  csrf: string;
  bloqueado: boolean;
  provaFonte?: string;
  onOcupado: (valor: boolean) => void;
  onConferido: () => void;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
};

export function VerificacaoConferenciaDof({
  rascunho, csrf, bloqueado, provaFonte, onOcupado, onConferido, onErro, onLimpar,
}: Props) {
  const [resultado, setResultado] = useState<{ relatorio: PreconferenciaDof; provaFonte?: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmou, setConfirmou] = useState(false);
  const ativa = useRef(true);
  const estadoAtual = useRef({ id: rascunho.id, revisao: rascunho.revisao, bloqueado, provaFonte });
  estadoAtual.current = { id: rascunho.id, revisao: rascunho.revisao, bloqueado, provaFonte };

  useEffect(() => {
    ativa.current = true;
    return () => { ativa.current = false; };
  }, []);

  useEffect(() => {
    setResultado(null);
    setConfirmou(false);
  }, [rascunho.id, rascunho.revisao, bloqueado, provaFonte]);

  async function verificar() {
    try {
      onLimpar();
      setOcupado(true);
      setResultado(null);
      setConfirmou(false);
      const resposta = await api.verificarPreconferenciaDof(rascunho.id, provaFonte);
      if (ativa.current) {
        if (resposta.documentoId !== estadoAtual.current.id || resposta.revisao !== estadoAtual.current.revisao
            || estadoAtual.current.bloqueado || estadoAtual.current.provaFonte !== provaFonte
            || resposta.fontePreviaValidada !== (provaFonte !== undefined)) {
          throw new ErroApi(409, 'O rascunho mudou durante a verificação ou a prévia foi alterada. Reabra e verifique novamente.');
        }
        setResultado({ relatorio: resposta, provaFonte });
      }
    } catch (erro) {
      if (ativa.current) onErro(erro);
    } finally {
      if (ativa.current) setOcupado(false);
    }
  }

  const relatorio = resultado && resultado.provaFonte === provaFonte && !bloqueado
    && resultado.relatorio.documentoId === rascunho.id && resultado.relatorio.revisao === rascunho.revisao
    ? resultado.relatorio : null;

  async function conferir() {
    if (!relatorio || !provaFonte || !relatorio.provaRelatorio || !confirmou || relatorio.bloqueios.length > 0) return;
    try {
      onLimpar();
      setOcupado(true);
      onOcupado(true);
      const resposta = await api.conferirDof(csrf, rascunho.id, {
        revisao: rascunho.revisao, provaFonte, provaRelatorio: relatorio.provaRelatorio, confirmar: true,
      });
      if (ativa.current) {
        if (resposta.documentoId !== rascunho.id || resposta.revisao !== rascunho.revisao + 1) {
          throw new ErroApi(0, 'Não foi possível confirmar a conferência. Consulte as DOFs conferidas antes de tentar novamente.');
        }
        onConferido();
      }
    } catch (erro) {
      if (ativa.current) {
        setResultado(null);
        setConfirmou(false);
        onErro(erro instanceof ErroApi && erro.status === 0
          ? new ErroApi(0, 'Não foi possível confirmar a conferência. Consulte as DOFs conferidas antes de tentar novamente.')
          : erro);
      }
    } finally {
      if (ativa.current) { setOcupado(false); onOcupado(false); }
    }
  }

  return (
    <section className="separado" aria-labelledby="preconferencia-titulo">
      <h4 id="preconferencia-titulo">Verificação de pendências</h4>
      <p>Esta consulta é preliminar: não registra conferência, não aprova o modelo e não autoriza emissão.</p>
      {bloqueado && <p className="aviso erro">Salve ou descarte as alterações pendentes antes de verificar.</p>}
      <button type="button" className="secundario" disabled={ocupado || bloqueado} onClick={() => void verificar()}>
        {ocupado ? 'Verificando...' : 'Verificar pendências para conferência'}
      </button>
      {relatorio && (
        <div role="status">
          <p>Rascunho não conferido — revisão {relatorio.revisao}, verificada em{' '}
            {new Date(relatorio.verificadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.
            Refaça a consulta após alterações no rascunho ou na fonte.</p>
          <p>{relatorio.fontePreviaValidada
            ? 'A prévia aberta e esta consulta usaram as mesmas revisões da pessoa e do vínculo. Isso não registra revisão humana.'
            : 'Esta consulta não foi vinculada a uma prévia aberta. Abra a prévia para comparar a fonte exibida.'}</p>
          <h5>Bloqueios</h5>
          {relatorio.bloqueios.length
            ? <ul>{relatorio.bloqueios.map((item) => <li key={item.codigo}>{item.mensagem}</li>)}</ul>
            : <p>Nenhum bloqueio técnico identificado nesta consulta.</p>}
          {relatorio.avisos.length > 0 && (
            <><h5>Avisos</h5><ul>{relatorio.avisos.map((item) => <li key={item.codigo}>{item.mensagem}</li>)}</ul></>
          )}
          {relatorio.bloqueios.length === 0 && provaFonte && relatorio.provaRelatorio && (
            <>
              <p>A conferência registra sua revisão dos dados e avisos disponíveis. Ela é provisória, não aprova regras ou modelo e não autoriza emissão.</p>
              <label className="marcador">
                <input type="checkbox" checked={confirmou} disabled={ocupado || bloqueado}
                  onChange={(evento) => setConfirmou(evento.target.checked)} />
                Revisei a prévia, os dados, os lançamentos e todos os avisos desta verificação.
              </label>
              <button type="button" disabled={!confirmou || ocupado || bloqueado} onClick={() => void conferir()}>
                {ocupado ? 'Conferindo...' : 'Conferir DOF provisória'}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
