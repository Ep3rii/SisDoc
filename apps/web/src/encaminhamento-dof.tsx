import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  encaminharRascunhoDofSchema,
  recolherRascunhoDofSchema,
  type PaginaCoordenadoresDof,
  type RascunhoDof,
} from '@sisdoc/contratos';
import { api, ErroApi } from './api';

type Props = {
  rascunho: RascunhoDof;
  csrf: string;
  bloqueado: boolean;
  onAtualizar: (rascunho: RascunhoDof) => void;
  onPendente: (valor: boolean) => void;
  onOcupado: (valor: boolean) => void;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
};

export function EncaminhamentoDof({
  rascunho, csrf, bloqueado, onAtualizar, onPendente, onOcupado, onErro, onLimpar,
}: Props) {
  const [pagina, setPagina] = useState<PaginaCoordenadoresDof | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [destinatarioId, setDestinatarioId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const ativa = useRef(true);
  useEffect(() => {
    ativa.current = true;
    return () => { ativa.current = false; };
  }, []);

  async function carregar(proximo?: string) {
    try {
      onLimpar();
      setOcupado(true);
      const resultado = await api.listarCoordenadoresDof(proximo);
      if (ativa.current) {
        setPagina(resultado);
        setCursor(proximo);
        setDestinatarioId('');
      }
    } catch (erro) {
      if (ativa.current) onErro(erro);
    } finally {
      if (ativa.current) setOcupado(false);
    }
  }

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const recolhendo = Boolean(rascunho.encaminhamento);
    const envio = encaminharRascunhoDofSchema.safeParse({ revisao: rascunho.revisao, destinatarioId });
    const recolhimento = recolherRascunhoDofSchema.safeParse({ revisao: rascunho.revisao, motivo });
    if ((!recolhendo && !envio.success) || (recolhendo && !recolhimento.success)) {
      onErro(new ErroApi(400, recolhendo ? 'Informe o motivo do recolhimento.' : 'Selecione um coordenador ativo.'));
      return;
    }
    try {
      onLimpar();
      setOcupado(true);
      onOcupado(true);
      onPendente(true);
      setMensagem('');
      const atualizado = recolhendo && recolhimento.success
        ? await api.recolherRascunhoDof(csrf, rascunho.id, recolhimento.data)
        : envio.success ? await api.encaminharRascunhoDof(csrf, rascunho.id, envio.data)
          : null;
      if (!atualizado) throw new ErroApi(400, 'Confira os dados do encaminhamento.');
      if (ativa.current) {
        setMotivo('');
        setPagina(null);
        setCursor(undefined);
        setDestinatarioId('');
        onAtualizar(atualizado);
        onPendente(false);
        setMensagem(recolhendo
          ? `Encaminhamento recolhido na revisão ${atualizado.revisao}. O rascunho pode voltar a ser editado.`
          : `Rascunho encaminhado na revisão ${atualizado.revisao}. Ele não foi conferido nem emitido.`);
      }
    } catch (erro) {
      if (ativa.current) {
        onPendente(motivo.length > 0);
        onErro(erro instanceof ErroApi && erro.status === 0
          ? new ErroApi(0, 'Não foi possível confirmar a operação. Reabra o rascunho e confira antes de tentar novamente.')
          : erro);
      }
    } finally {
      if (ativa.current) { setOcupado(false); onOcupado(false); }
    }
  }

  return (
    <section className="separado" aria-labelledby="encaminhamento-dof-titulo">
      <h4 id="encaminhamento-dof-titulo">Encaminhamento para análise</h4>
      <p>O coordenador escolhido poderá consultar o rascunho e a prévia ou devolvê-lo para ajustes. A conferência e a emissão ainda não estão disponíveis.</p>
      {bloqueado && <p className="aviso erro">Salve ou descarte as alterações de cálculo, processo e blocos antes de encaminhar.</p>}
      {rascunho.encaminhamento ? (
        <form onSubmit={salvar}>
          <p>Encaminhado a <strong>{rascunho.encaminhamento.destinatarioNome}</strong>. As edições estão bloqueadas até o recolhimento ou a devolução.</p>
          {!rascunho.encaminhamento.destinatarioDisponivel && (
            <p className="aviso erro" role="alert">O destinatário deixou de ser coordenador ativo e não pode acessar o rascunho. Recolha e escolha outro.</p>
          )}
          <fieldset disabled={ocupado || bloqueado}>
            <label>Motivo do recolhimento
              <textarea value={motivo} maxLength={2000} required onChange={(evento) => {
                setMotivo(evento.target.value);
                onPendente(evento.target.value.length > 0);
              }} />
            </label>
            <button type="submit">{ocupado ? 'Recolhendo...' : 'Recolher encaminhamento'}</button>
          </fieldset>
        </form>
      ) : (
        <form onSubmit={salvar}>
          {!pagina ? (
            <button type="button" className="secundario" disabled={ocupado || bloqueado}
              onClick={() => void carregar()}>Escolher coordenador</button>
          ) : (
            <fieldset disabled={ocupado || bloqueado}>
              {pagina.itens.length === 0 ? <p>Nenhum coordenador ativo disponível nesta página.</p> : (
                <label>Coordenador destinatário
                  <select value={destinatarioId} required onChange={(evento) => setDestinatarioId(evento.target.value)}>
                    <option value="">Selecione</option>
                    {pagina.itens.map((item) => <option key={item.id} value={item.id}>{item.nome} — {item.matricula}</option>)}
                  </select>
                </label>
              )}
              <div className="acoes">
                <button type="button" className="secundario" disabled={!cursor}
                  onClick={() => void carregar()}>Primeira página de coordenadores</button>
                <button type="button" className="secundario" disabled={!pagina.proximoCursor}
                  onClick={() => void carregar(pagina.proximoCursor ?? undefined)}>Próxima página de coordenadores</button>
                <button type="button" className="secundario" onClick={() => void carregar(cursor)}>Atualizar coordenadores</button>
              </div>
              <button type="submit" disabled={!destinatarioId}>{ocupado ? 'Encaminhando...' : 'Encaminhar rascunho'}</button>
            </fieldset>
          )}
        </form>
      )}
      {mensagem && <p className="aviso sucesso" role="status">{mensagem}</p>}
    </section>
  );
}
