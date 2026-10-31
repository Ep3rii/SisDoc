import { useEffect, useRef, useState } from 'react';
import type { PreconferenciaDof, RascunhoDof } from '@sisdoc/contratos';
import { api, ErroApi } from './api';

type Props = {
  rascunho: RascunhoDof;
  bloqueado: boolean;
  provaFonte?: string;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
};

export function VerificacaoConferenciaDof({ rascunho, bloqueado, provaFonte, onErro, onLimpar }: Props) {
  const [resultado, setResultado] = useState<{ relatorio: PreconferenciaDof; provaFonte?: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const ativa = useRef(true);
  const estadoAtual = useRef({ id: rascunho.id, revisao: rascunho.revisao, bloqueado, provaFonte });
  estadoAtual.current = { id: rascunho.id, revisao: rascunho.revisao, bloqueado, provaFonte };

  useEffect(() => {
    ativa.current = true;
    return () => { ativa.current = false; };
  }, []);

  useEffect(() => {
    setResultado(null);
  }, [rascunho.id, rascunho.revisao, bloqueado, provaFonte]);

  async function verificar() {
    try {
      onLimpar();
      setOcupado(true);
      setResultado(null);
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
          <ul>{relatorio.bloqueios.map((item) => <li key={item.codigo}>{item.mensagem}</li>)}</ul>
          {relatorio.avisos.length > 0 && (
            <><h5>Avisos</h5><ul>{relatorio.avisos.map((item) => <li key={item.codigo}>{item.mensagem}</li>)}</ul></>
          )}
        </div>
      )}
    </section>
  );
}
