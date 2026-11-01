import type { RascunhoDof } from '@sisdoc/contratos';
import { useEffect, useRef, useState } from 'react';
import { api, ErroApi } from '../infraestrutura/api';

type Props = {
  rascunho: RascunhoDof;
  csrf: string;
  bloqueado: boolean;
  somenteLeitura: boolean;
  onAtualizar: (rascunho: RascunhoDof) => void;
  onOcupado: (valor: boolean) => void;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
};

export function ConfirmacaoInicioDof({
  rascunho, csrf, bloqueado, somenteLeitura, onAtualizar, onOcupado, onErro, onLimpar,
}: Props) {
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const ativa = useRef(true);

  useEffect(() => {
    ativa.current = true;
    return () => { ativa.current = false; };
  }, []);

  useEffect(() => { setConfirmar(false); }, [rascunho.id, rascunho.revisao]);

  async function confirmarAjuste() {
    try {
      onLimpar();
      setOcupado(true);
      onOcupado(true);
      const atualizado = await api.confirmarInicioDof(csrf, rascunho.id, { revisao: rascunho.revisao, confirmar: true });
      if (ativa.current) onAtualizar(atualizado);
    } catch (erro) {
      if (ativa.current) {
        onErro(erro instanceof ErroApi && erro.status === 0
          ? new ErroApi(0, 'Não foi possível confirmar a gravação. Reabra o rascunho e confira antes de tentar novamente.')
          : erro);
      }
    } finally {
      if (ativa.current) { setOcupado(false); onOcupado(false); }
    }
  }

  if (rascunho.entrada.inicio >= rascunho.resultado.admissaoConsiderada) return null;
  const fonteAlterada = rascunho.admissao !== rascunho.resultado.admissaoConsiderada;
  return (
    <section className="separado" aria-labelledby="confirmacao-inicio-titulo">
      <h4 id="confirmacao-inicio-titulo">Início ajustado à admissão</h4>
      <p>O início informado {rascunho.entrada.inicio} é anterior à admissão considerada{' '}
        {rascunho.resultado.admissaoConsiderada}; o cálculo usa a admissão como início efetivo.</p>
      {rascunho.inicioAjustadoConfirmado ? (
        <p role="status">O autor confirmou o ajuste para este cálculo. Isso não constitui conferência nem emissão.</p>
      ) : (
        <>
          {fonteAlterada && <p className="aviso erro">A admissão na fonte mudou; reabra e confira o cálculo antes de confirmar.</p>}
          {somenteLeitura
            ? <p>A confirmação deve ser feita pelo autor antes do encaminhamento.</p>
            : <>
              {bloqueado && !ocupado && <p className="aviso erro">Salve ou conclua as demais alterações antes de confirmar.</p>}
              <label className="marcador">
                <input type="checkbox" checked={confirmar} disabled={bloqueado || ocupado || fonteAlterada}
                  onChange={(evento) => setConfirmar(evento.target.checked)} />
                Confirmei que o início efetivo deve ser ajustado à admissão informada.
              </label>
              <button type="button" className="secundario" disabled={!confirmar || bloqueado || ocupado || fonteAlterada}
                onClick={() => void confirmarAjuste()}>
                {ocupado ? 'Confirmando...' : 'Confirmar ajuste do início'}
              </button>
            </>}
        </>
      )}
    </section>
  );
}
