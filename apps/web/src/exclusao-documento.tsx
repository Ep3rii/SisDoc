import { useState, type FormEvent } from 'react';
import type { ResultadoExclusaoDocumento } from '@sisdoc/contratos';
import { api } from './api';

type Props = {
  csrf: string;
  documentoId: string;
  revisao: number;
  descricao: string;
  onErro: (erro: unknown) => void;
  onPendente: (valor: boolean) => void;
  onConcluido: (resultado: ResultadoExclusaoDocumento) => void;
};

export function ExclusaoDocumento({
  csrf, documentoId, revisao, descricao, onErro, onPendente, onConcluido,
}: Props) {
  const [motivo, setMotivo] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const frase = `EXCLUIR DOCUMENTO ${documentoId}`;

  async function excluir(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (confirmacao !== frase || motivo.trim().length < 15) return;
    try {
      setOcupado(true);
      const resultado = await api.excluirDocumento(csrf, documentoId, { revisao, motivo, confirmacao });
      onPendente(false);
      onConcluido(resultado);
      setMotivo('');
      setConfirmacao('');
    } catch (erro) {
      onErro(erro);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <details className="exclusao-documento">
      <summary>Excluir</summary>
      <form onSubmit={(evento) => void excluir(evento)}>
        <p>Exclusão física de {descricao}, revisão {revisao}. Esta ação é irreversível e não reutiliza números oficiais.</p>
        <p>Baixados, backups e outras cópias fora do SisDoc não são apagados.</p>
        <label>Motivo da exclusão
          <textarea value={motivo} maxLength={2000} required disabled={ocupado} onChange={(evento) => {
            setMotivo(evento.target.value);
            onPendente(evento.target.value.trim().length > 0 || confirmacao.length > 0);
          }} />
        </label>
        <label>Digite exatamente <code>{frase}</code>
          <input value={confirmacao} maxLength={100} required disabled={ocupado} onChange={(evento) => {
            setConfirmacao(evento.target.value);
            onPendente(evento.target.value.length > 0 || motivo.trim().length > 0);
          }} />
        </label>
        <button type="submit" className="perigo" disabled={ocupado || motivo.trim().length < 15 || confirmacao !== frase}>
          {ocupado ? 'Solicitando...' : 'Confirmar exclusão física'}
        </button>
      </form>
    </details>
  );
}
