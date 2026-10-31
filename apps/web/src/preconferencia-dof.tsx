import { useEffect, useRef, useState } from 'react';
import type { PreconferenciaDof, RascunhoDof } from '@sisdoc/contratos';
import { api, ErroApi } from './api';

type Props = {
  rascunho: RascunhoDof;
  bloqueado: boolean;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
};

export function VerificacaoConferenciaDof({ rascunho, bloqueado, onErro, onLimpar }: Props) {
  const [resultado, setResultado] = useState<PreconferenciaDof | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const ativa = useRef(true);
  const estadoAtual = useRef({ id: rascunho.id, revisao: rascunho.revisao, bloqueado });
  estadoAtual.current = { id: rascunho.id, revisao: rascunho.revisao, bloqueado };

  useEffect(() => {
    ativa.current = true;
    return () => { ativa.current = false; };
  }, []);

  useEffect(() => {
    setResultado(null);
  }, [rascunho.id, rascunho.revisao, bloqueado]);

  async function verificar() {
    try {
      onLimpar();
      setOcupado(true);
      setResultado(null);
      const resposta = await api.verificarPreconferenciaDof(rascunho.id);
      if (ativa.current) {
        if (resposta.documentoId !== estadoAtual.current.id || resposta.revisao !== estadoAtual.current.revisao
            || estadoAtual.current.bloqueado) {
          throw new ErroApi(409, 'O rascunho mudou durante a verificação. Salve ou reabra e verifique novamente.');
        }
        setResultado(resposta);
      }
    } catch (erro) {
      if (ativa.current) onErro(erro);
    } finally {
      if (ativa.current) setOcupado(false);
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
      {resultado && (
        <div role="status">
          <p>Rascunho não conferido — revisão {resultado.revisao}, verificada em{' '}
            {new Date(resultado.verificadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.
            Refaça a consulta após alterações no rascunho ou na fonte.</p>
          <h5>Bloqueios</h5>
          <ul>{resultado.bloqueios.map((item) => <li key={item.codigo}>{item.mensagem}</li>)}</ul>
          {resultado.avisos.length > 0 && (
            <><h5>Avisos</h5><ul>{resultado.avisos.map((item) => <li key={item.codigo}>{item.mensagem}</li>)}</ul></>
          )}
        </div>
      )}
    </section>
  );
}
