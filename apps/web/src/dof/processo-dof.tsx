import { atualizarProcessoDofSchema, processoCorrespondeMascara, type RascunhoDof } from '@sisdoc/contratos';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ErroApi } from '../infraestrutura/api';

type Props = {
  rascunho: RascunhoDof;
  csrf: string;
  bloqueado: boolean;
  somenteLeitura?: boolean;
  onAtualizar: (rascunho: RascunhoDof) => void;
  onPendente: (valor: boolean) => void;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
};

export function ProcessoDof({ rascunho, csrf, bloqueado, somenteLeitura = false, onAtualizar, onPendente, onErro, onLimpar }: Props) {
  const [processo, setProcesso] = useState(rascunho.processo ?? '');
  const [motivo, setMotivo] = useState('');
  const [remover, setRemover] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const ativa = useRef(true);
  useEffect(() => {
    ativa.current = true;
    return () => { ativa.current = false; };
  }, []);

  function alterar(numero: string, justificativa: string, confirmarRemocao = remover) {
    setProcesso(numero);
    setMotivo(justificativa);
    setRemover(confirmarRemocao);
    setMensagem('');
    onPendente(confirmarRemocao || numero.trim().toUpperCase() !== (rascunho.processo ?? '') || justificativa.length > 0);
  }

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = atualizarProcessoDofSchema.safeParse({
      revisao: rascunho.revisao, processo: remover ? null : processo, motivo,
      ...(remover ? { confirmarRemocao: true } : {}),
    });
    if (!dados.success || (dados.data.processo !== null
        && !rascunho.mascarasProcesso.some((mascara) => processoCorrespondeMascara(processo, mascara)))) {
      onErro(new ErroApi(400, 'Confira o número do processo, as máscaras configuradas e o motivo da alteração.'));
      return;
    }
    try {
      onLimpar();
      setOcupado(true);
      const salvo = await api.atualizarProcessoDof(csrf, rascunho.id, dados.data);
      if (ativa.current) {
        setProcesso(salvo.processo ?? '');
        setMotivo('');
        setRemover(false);
        onAtualizar(salvo);
        onPendente(false);
        setMensagem(`Processo salvo na revisão ${salvo.revisao}. O rascunho não foi conferido nem emitido.`);
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

  const alterado = remover || processo.trim().toUpperCase() !== (rascunho.processo ?? '');
  return (
    <section className="separado" aria-labelledby="processo-dof-titulo">
      <h4 id="processo-dof-titulo">Processo do rascunho</h4>
      {rascunho.mascarasProcesso.length ? (
        <p>Máscaras configuradas: {rascunho.mascarasProcesso.join(', ')}. # representa um dígito, @ uma letra e * uma letra ou dígito.</p>
      ) : <p className="aviso erro">Nenhuma máscara de processo está configurada. Solicite a configuração ao administrador.
        {!somenteLeitura && ' Um processo salvo ainda pode ser removido com confirmação e motivo.'}</p>}
      {bloqueado && <p className="aviso erro">Salve ou descarte as alterações de cálculo e blocos antes de editar o processo.</p>}
      <form onSubmit={salvar}>
        <fieldset disabled={ocupado || bloqueado || somenteLeitura || (rascunho.mascarasProcesso.length === 0 && !rascunho.processo)}>
          <label>Número do processo
            <input value={processo} maxLength={100} required={!remover} disabled={remover || rascunho.mascarasProcesso.length === 0}
              onChange={(evento) => alterar(evento.target.value, motivo)} />
          </label>
          {rascunho.processo && <label className="marcador">
            <input type="checkbox" checked={remover} onChange={(evento) => alterar(processo, motivo, evento.target.checked)} />
            Confirmo a remoção do número de processo.
          </label>}
          <label>Motivo da alteração do processo
            <textarea value={motivo} maxLength={2000} required onChange={(evento) => alterar(processo, evento.target.value)} />
          </label>
          <button type="submit" disabled={!alterado}>{ocupado ? 'Salvando...' : 'Salvar processo'}</button>
        </fieldset>
      </form>
      {mensagem && <p className="aviso sucesso" role="status">{mensagem}</p>}
    </section>
  );
}
