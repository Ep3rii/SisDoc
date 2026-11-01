import { devolverRascunhoDofSchema, type RascunhoDof, type UltimaDevolucaoDof } from '@sisdoc/contratos';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ErroApi } from '../infraestrutura/api';

type ConsultaProps = {
  rascunho: RascunhoDof;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
};

export function UltimaDevolucaoDof({ rascunho, onErro, onLimpar }: ConsultaProps) {
  const [resultado, setResultado] = useState<UltimaDevolucaoDof | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const { id, revisao } = rascunho;

  useEffect(() => {
    let ativa = true;
    setResultado(null);
    setFalhou(false);
    api.ultimaDevolucaoDof(id).then((resposta) => {
      if (!ativa) return;
      if (resposta.documentoId !== id || resposta.revisao !== revisao) {
        throw new ErroApi(409, 'O rascunho mudou. Reabra-o antes de consultar a devolução.');
      }
      setResultado(resposta);
    }).catch((erro: unknown) => {
      if (ativa) { setFalhou(true); onErro(erro); }
    });
    return () => { ativa = false; };
  }, [id, revisao, tentativa, onErro]);

  if (falhou) {
    return (
      <p className="aviso erro">
        Não foi possível consultar a última devolução.{' '}
        <button type="button" className="secundario" onClick={() => { onLimpar(); setTentativa((atual) => atual + 1); }}>
          Tentar novamente
        </button>
      </p>
    );
  }
  if (!resultado || resultado.documentoId !== id || resultado.revisao !== revisao) {
    return <p role="status">Consultando devoluções...</p>;
  }
  if (!resultado.devolucao) return null;
  return (
    <section className="aviso" aria-labelledby="ultima-devolucao-titulo">
      <h4 id="ultima-devolucao-titulo">Última devolução para ajustes</h4>
      <p>
        Por {resultado.devolucao.coordenadorNome}, em{' '}
        {new Date(resultado.devolucao.devolvidoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.
        O documento permanece não conferido.
      </p>
      <p className="texto-devolucao">{resultado.devolucao.motivo}</p>
    </section>
  );
}

type DevolverProps = {
  rascunho: RascunhoDof;
  csrf: string;
  bloqueado: boolean;
  onPendente: (valor: boolean) => void;
  onOcupado: (valor: boolean) => void;
  onDevolvido: () => void;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
};

export function DevolverRascunhoDof({
  rascunho, csrf, bloqueado, onPendente, onOcupado, onDevolvido, onErro, onLimpar,
}: DevolverProps) {
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const ativa = useRef(true);
  useEffect(() => {
    ativa.current = true;
    return () => { ativa.current = false; };
  }, []);

  async function devolver(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = devolverRascunhoDofSchema.safeParse({ revisao: rascunho.revisao, motivo });
    if (!dados.success) {
      onErro(new ErroApi(400, 'Informe o motivo da devolução.'));
      return;
    }
    try {
      onLimpar();
      setOcupado(true);
      onOcupado(true);
      onPendente(true);
      const resposta = await api.devolverRascunhoDof(csrf, rascunho.id, dados.data);
      if (resposta.documentoId !== rascunho.id || resposta.revisao !== rascunho.revisao + 1) {
        throw new ErroApi(0, 'O servidor não confirmou a devolução esperada.');
      }
      if (ativa.current) {
        onPendente(false);
        onDevolvido();
      }
    } catch (erro) {
      if (ativa.current) {
        onPendente(motivo.length > 0);
        onErro(erro instanceof ErroApi && erro.status === 0
          ? new ErroApi(0, 'Não foi possível confirmar a devolução. Reabra os encaminhados e confira antes de tentar novamente.')
          : erro);
      }
    } finally {
      if (ativa.current) { setOcupado(false); onOcupado(false); }
    }
  }

  return (
    <section className="separado" aria-labelledby="devolucao-dof-titulo">
      <h4 id="devolucao-dof-titulo">Devolver para ajustes</h4>
      <p>O motivo será disponibilizado ao autor. A devolução encerra seu acesso ao encaminhamento e não registra conferência.</p>
      <form onSubmit={devolver}>
        <fieldset disabled={ocupado || bloqueado}>
          <label>Motivo da devolução
            <textarea value={motivo} maxLength={2000} required onChange={(evento) => {
              setMotivo(evento.target.value);
              onPendente(evento.target.value.length > 0);
            }} />
          </label>
          <button type="submit">{ocupado ? 'Devolvendo...' : 'Devolver rascunho'}</button>
        </fieldset>
      </form>
    </section>
  );
}
