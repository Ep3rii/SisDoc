import {
  ROTULOS_DTC,
  type PreviaDtc,
  type SituacaoEmissao,
  type TipoDtc
} from '@sisdoc/contratos';
import { renderizarPreviaDtc } from '@sisdoc/templates';
import { useEffect, useRef, useState } from 'react';
import { PainelEmissao } from '../documentos/emissao';
import { api, ErroApi } from '../infraestrutura/api';
import { dataBr, Papel } from './contexto';
import { Editor } from './editor';

/** Exibe revisão salva e coordena edição, conferência, devolução e emissão autorizadas. */
export function Documento({ id, tipo, csrf, papel, onVoltar, onErro, onLimpar, onPendente }: {
  id: string; tipo: TipoDtc; csrf: string; papel: Papel; onVoltar: () => void;
  onErro: (erro: unknown) => void; onLimpar: () => void; onPendente: (valor: boolean) => void;
}) {
  const [previa, setPrevia] = useState<PreviaDtc | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [versao, setVersao] = useState(0);
  const [editando, setEditando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [emissao, setEmissao] = useState<SituacaoEmissao | null>(null);
  const chave = useRef<{ revisao: number; valor: string } | null>(null);

  useEffect(() => {
    let corrente = true;
    setFalhou(false);
    api.previaDtc(id).then((resultado) => {
      if (corrente) setPrevia(resultado);
    }).catch((erro: unknown) => {
      if (corrente) { setFalhou(true); onErro(erro); }
    });
    return () => { corrente = false; };
  }, [id, versao, onErro]);

  /** Expõe estado ocupado e erros das transições sem representar falhas como sucesso. */
  async function executar(acao: () => Promise<void>) {
    try {
      onLimpar();
      setOcupado(true);
      await acao();
    } catch (erro) {
      onErro(erro);
    } finally {
      setOcupado(false);
    }
  }

  if (emissao) return <section className="painel"><PainelEmissao situacao={emissao} onErro={onErro} onLimpar={onLimpar} />
    <button type="button" className="secundario" onClick={onVoltar}>Voltar à lista</button></section>;
  if (falhou) return <button type="button" className="secundario" onClick={() => setVersao((atual) => atual + 1)}>Tentar novamente</button>;
  if (!previa) return <p role="status">Carregando prévia...</p>;
  const { documento, fonte } = previa;
  if (documento.tipo !== tipo) return <p className="aviso erro">Este documento não é uma {ROTULOS_DTC[tipo]}.</p>;
  const servidor = { pessoaId: documento.pessoaId, vinculoId: documento.vinculoId, nome: documento.nome, matricula: documento.matricula };
  const podeEmitir = papel === 'coordenador' || papel === 'admin';

  if (editando) {
    return <section className="area-dof">
      <div className="editor-dof"><Editor tipo={tipo} inicial={documento.conteudo} documento={documento} servidor={servidor} csrf={csrf}
      onSalvo={() => { setEditando(false); setPrevia(null); setVersao((atual) => atual + 1); }}
      onCancelar={() => { onPendente(false); setEditando(false); }} onErro={onErro} onLimpar={onLimpar} onPendente={onPendente} /></div>
      <aside className="painel-previa previa-documento" aria-label="Prévia do documento">
        <p>Prévia da revisão salva {documento.revisao}. Alterações do formulário aparecem após salvar.</p>
        <iframe title={`Prévia da ${ROTULOS_DTC[tipo]}`} sandbox="" srcDoc={renderizarPreviaDtc({ documento, fonte })} />
      </aside>
    </section>;
  }

  return (
    <section className="area-dof">
      <div className="editor-dof">
        <p className="identificador-documento">{documento.status === 'rascunho' ? 'Rascunho' : 'Conferida'} · revisão {documento.revisao}</p>
        <h2>{ROTULOS_DTC[tipo]} — {documento.nome}</h2>
        <dl className="dados-servidor">
          <div><dt>Matrícula</dt><dd>{documento.matricula}</dd></div>
          <div><dt>Admissão</dt><dd>{dataBr(documento.admissao)}</dd></div>
          <div><dt>Autor</dt><dd>{documento.autorNome}</dd></div>
          <div><dt>Processo</dt><dd>{documento.conteudo.processo ?? '—'}</dd></div>
          {documento.resultado.linhasTotais.slice(0, 2).map((linha) => (
            <div key={linha.codigo}><dt>{linha.rotulo}{linha.provisoria ? ' (provisório)' : ''}</dt><dd>{linha.texto || '0 dias'}</dd></div>
          ))}
        </dl>
        {documento.resultado.avisos.length > 0 && <ul className="orientacoes-dof">
          {documento.resultado.avisos.map((aviso, indice) => <li key={indice}>{aviso.mensagem}</li>)}</ul>}
        {documento.pendencias.length > 0 && <ul className="aviso erro">{documento.pendencias.map((texto) => <li key={texto}>{texto}</li>)}</ul>}
        {previa.fonteSelecionadaAlterada && <p className="aviso erro">A fonte mudou após a conferência; devolva a DTC para nova conferência.</p>}
        {documento.status === 'rascunho' && <>
          <div className="acoes">
            <button type="button" className="secundario" disabled={ocupado} onClick={() => setEditando(true)}>Editar rascunho</button>
          </div>
          <label className="marcador"><input type="checkbox" checked={confirmado} onChange={(evento) => setConfirmado(evento.target.checked)} />
            Conferi a prévia com os documentos e confirmo os dados</label>
          <div className="acoes"><button type="button" disabled={ocupado || !confirmado || documento.pendencias.length > 0}
            onClick={() => void executar(async () => {
              await api.conferirDtc(csrf, id, { revisao: documento.revisao, provaFonte: fonte.provaFonte, confirmar: true });
              setConfirmado(false);
              setPrevia(null);
              setVersao((atual) => atual + 1);
            })}>Conferir</button></div>
        </>}
        {documento.status === 'conferido' && podeEmitir && <>
          <div className="acoes"><button type="button" disabled={ocupado} onClick={() => void executar(async () => {
            if (!window.confirm(`Emitir a ${ROTULOS_DTC[tipo]} de ${documento.nome}? Um número oficial será reservado.`)) return;
            if (chave.current?.revisao !== documento.revisao) chave.current = { revisao: documento.revisao, valor: crypto.randomUUID() };
            const resultado = await api.emitirDtc(csrf, id, chave.current.valor, { revisao: documento.revisao, provaFonte: fonte.provaFonte });
            if (resultado.documentoId !== id) throw new ErroApi(0, 'Não foi possível confirmar a emissão. Consulte o Histórico.');
            setEmissao(resultado);
          })}>Emitir</button></div>
          <section className="zona-perigo"><h3>Devolução para ajustes</h3>
          <label>Motivo da devolução<textarea maxLength={2000} value={motivo} onChange={(evento) => {
            setMotivo(evento.target.value);
            onPendente(evento.target.value.trim().length > 0);
          }} /></label>
          <div className="acoes"><button type="button" className="perigo" disabled={ocupado || !motivo.trim()}
            onClick={() => void executar(async () => {
              await api.devolverDtc(csrf, id, { revisao: documento.revisao, motivo });
              setMotivo('');
              onPendente(false);
              setPrevia(null);
              setVersao((atual) => atual + 1);
            })}>Devolver para rascunho</button></div></section>
        </>}
        <div className="acoes"><button type="button" className="secundario" onClick={onVoltar}>Voltar à lista</button></div>
      </div>
      <div className="painel-previa previa-documento">
        <p>Prévia sem validade oficial. {tipo === 'DTC_INSS' ? 'Modelo do INSS provisório.' : ''}</p>
        <iframe title={`Prévia da ${ROTULOS_DTC[tipo]}`} sandbox="" srcDoc={renderizarPreviaDtc({ documento, fonte })} />
      </div>
    </section>
  );
}
