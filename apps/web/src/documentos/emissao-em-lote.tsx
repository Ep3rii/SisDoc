import type { SituacaoEmissao } from '@sisdoc/contratos';
import { useState } from 'react';
import { AvisoAprovacaoModelo } from '../compartilhado/aviso-aprovacao-modelo';
import { PainelEmissao } from './emissao';
import { PreviaDocumento } from '../compartilhado/previa-documento';
import { ErroApi } from '../infraestrutura/api';

export type DocumentoElegivelLote = { id: string; nome: string; matricula: string; revisao: number };
type PreviaLote = { documentoId: string; revisao: number; provaFonte: string; html: string; fonteElegivel: boolean };
type ItemLote = {
  documento: DocumentoElegivelLote;
  selecionado: boolean;
  chave: string;
  carregando: boolean;
  previa: PreviaLote | null;
  erroPrevia: string;
  visualizouPrevia: boolean;
  revisado: boolean;
  emitindo: boolean;
  situacao: SituacaoEmissao | null;
  erroEmissao: string;
};

function mensagemErro(erro: unknown): string {
  if (erro instanceof ErroApi) return erro.message;
  if (erro instanceof Error) return erro.message;
  return 'Falha inesperada. O item não foi confirmado como emitido.';
}

/** Reúne prévias conferidas e emite cada documento separadamente, sem rollback de números já reservados. */
export function EmissaoEmLote({ documentos, carregar, emitir, onConcluido, onErro, onLimpar, onPendente }: {
  documentos: DocumentoElegivelLote[];
  carregar: (documento: DocumentoElegivelLote) => Promise<PreviaLote>;
  emitir: (documento: DocumentoElegivelLote, chave: string, provaFonte: string) => Promise<SituacaoEmissao>;
  onConcluido: () => void;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
  onPendente: (valor: boolean) => void;
}) {
  const [itens, setItens] = useState<Record<string, ItemLote>>({});
  const [ocupado, setOcupado] = useState(false);
  const selecionados = Object.values(itens).filter((item) => item.selecionado && !item.situacao);
  const prontos = selecionados.length > 0 && selecionados.every((item) =>
    item.previa?.fonteElegivel && item.revisado && !item.carregando && !item.erroPrevia);

  function selecionar(documento: DocumentoElegivelLote, valor: boolean) {
    if (!valor) {
      setItens((atuais) => {
        const existente = atuais[documento.id];
        if (!existente) return atuais;
        if (existente.situacao) return { ...atuais, [documento.id]: { ...existente, selecionado: false } };
        const novos = { ...atuais };
        delete novos[documento.id];
        return novos;
      });
      return;
    }
    if (!globalThis.crypto?.randomUUID) {
      onErro(new ErroApi(0, 'Não foi possível gerar uma chave segura para a emissão.'));
      return;
    }
    const chave = globalThis.crypto.randomUUID();
    const item: ItemLote = {
      documento, selecionado: true, chave, carregando: true,
      previa: null, erroPrevia: '', visualizouPrevia: false, revisado: false,
      emitindo: false, situacao: null, erroEmissao: '',
    };
    setItens((atuais) => ({ ...atuais, [documento.id]: item }));
    void carregar(documento).then((previa) => {
      if (previa.documentoId !== documento.id || previa.revisao !== documento.revisao) {
        throw new ErroApi(409, 'O documento mudou. Atualize a lista e reabra a prévia.');
      }
      setItens((atuais) => {
        const atual = atuais[documento.id];
        return !atual?.selecionado || atual.chave !== chave ? atuais : {
          ...atuais, [documento.id]: { ...atual, carregando: false, previa, erroPrevia: '' },
        };
      });
    }).catch((erro: unknown) => {
      setItens((atuais) => {
        const atual = atuais[documento.id];
        return !atual?.selecionado || atual.chave !== chave ? atuais : {
          ...atuais, [documento.id]: { ...atual, carregando: false, erroPrevia: mensagemErro(erro) },
        };
      });
    });
  }

  async function emitirLote() {
    if (!prontos || ocupado) return;
    if (!window.confirm(`Emitir ${selecionados.length} documento(s)? Cada item terá conferência, número e resultado próprios. Falhas não cancelam os itens já emitidos.`)) return;
    onLimpar();
    onPendente(true);
    setOcupado(true);
    try {
      for (const item of selecionados) {
        setItens((atuais) => ({ ...atuais, [item.documento.id]: { ...atuais[item.documento.id], emitindo: true, erroEmissao: '' } }));
        try {
          const resultado = await emitir(item.documento, item.chave, item.previa!.provaFonte);
          if (resultado.documentoId !== item.documento.id || resultado.status !== 'emitido') {
            throw new ErroApi(0, 'A resposta não confirmou a emissão deste documento. Consulte o histórico antes de repetir.');
          }
          setItens((atuais) => ({ ...atuais, [item.documento.id]: {
            ...atuais[item.documento.id], emitindo: false, situacao: resultado,
          } }));
        } catch (erro: unknown) {
          setItens((atuais) => ({ ...atuais, [item.documento.id]: {
            ...atuais[item.documento.id], emitindo: false, erroEmissao: mensagemErro(erro),
          } }));
        }
      }
      onConcluido();
    } finally {
      setOcupado(false);
      onPendente(false);
    }
  }

  const resultados = Object.values(itens).filter((item) => item.situacao || item.erroEmissao);
  return <details className="emissao-lote">
    <summary>Emitir em lote · {documentos.length} documento(s) elegível(is) carregado(s)</summary>
    <AvisoAprovacaoModelo />
    <p>Selecione documentos conferidos, revise cada prévia e confirme individualmente. As emissões são sequenciais, mantêm números e auditoria próprios; uma falha não desfaz as anteriores.</p>
    {documentos.length === 0 ? <p>Nenhum documento elegível carregado.</p> : <fieldset disabled={ocupado}>
      <legend>Documentos conferidos carregados</legend>
      {documentos.map((documento) => <label className="marcador" key={documento.id}>
        <input type="checkbox" checked={Boolean(itens[documento.id]?.selecionado)}
          onChange={(evento) => selecionar(documento, evento.target.checked)} />
        {documento.nome} · matrícula {documento.matricula} · revisão {documento.revisao}
      </label>)}
      {selecionados.map((item) => <section key={item.documento.id} className="grupo-formulario">
        <h4>{item.documento.nome} · revisão {item.documento.revisao}</h4>
        {item.carregando ? <p role="status">Carregando prévia e conferindo a fonte atual...</p> : item.erroPrevia ? <>
          <p className="aviso erro" role="alert">{item.erroPrevia}</p>
          <button type="button" className="secundario" onClick={() => {
            onLimpar();
            selecionar(item.documento, true);
          }}>Tentar carregar prévia novamente</button>
        </> : item.previa && <>
          {!item.previa.fonteElegivel && <p className="aviso erro" role="alert">
            A fonte mudou ou não pôde ser validada após a conferência. Este documento não pode ser emitido; atualize e confira novamente.
          </p>}
          <details onToggle={(evento) => {
            if (evento.currentTarget.open) setItens((atuais) => {
              const atual = atuais[item.documento.id];
              return !atual ? atuais : {
                ...atuais, [item.documento.id]: { ...atual, visualizouPrevia: true },
              };
            });
          }}><summary>Revisar prévia individual</summary>
            <PreviaDocumento titulo={`Prévia de ${item.documento.nome}`} html={item.previa.html} />
          </details>
          {item.previa.fonteElegivel && <label className="marcador">
            <input type="checkbox" checked={item.revisado} disabled={!item.visualizouPrevia}
              onChange={(evento) => setItens((atuais) => {
                const atual = atuais[item.documento.id];
                return !atual ? atuais : {
                  ...atuais, [item.documento.id]: { ...atual, revisado: evento.target.checked },
                };
              })} />
            {item.visualizouPrevia ? 'Revisei esta prévia e autorizo a emissão deste documento'
              : 'Abra e revise a prévia para habilitar a confirmação deste documento'}
          </label>}
        </>}
      </section>)}
      <button type="button" disabled={!prontos || ocupado} onClick={() => void emitirLote()}>
        {ocupado ? 'Emitindo documentos...' : `Emitir ${selecionados.length} documento(s) selecionado(s)`}
      </button>
    </fieldset>}
    {resultados.length > 0 && <section aria-label="Resultado das emissões em lote">
      <h3>Resultado do lote</h3>
      {resultados.map((item) => <div key={item.documento.id} className="resultado-lote">
        <strong>{item.documento.nome} · matrícula {item.documento.matricula}</strong>
        {item.situacao ? <PainelEmissao situacao={item.situacao} onErro={onErro} onLimpar={onLimpar} /> :
          <p className="aviso erro" role="alert">{item.erroEmissao}</p>}
      </div>)}
    </section>}
  </details>;
}
