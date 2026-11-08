import { ROTULOS_DTC, type AbaDocumentos, type ConsultaListaDocumentos, type ListaDocumentos, type RascunhoDof, type TipoDtc } from '@sisdoc/contratos';
import { renderizarPreviaDof, renderizarPreviaDtc } from '@sisdoc/templates';
import { useEffect, useRef, useState } from 'react';
import type { Consulta } from '../cadastro/contexto';
import { dataTabela } from '../compartilhado/datas-tabela';
import { CalculoDof } from '../dof/calculo-dof';
import { ConferidosDof } from '../dof/conferidos-dof';
import { BuscaServidor } from '../dtc/busca-servidor';
import { conteudoInicial, type Papel, type Servidor } from '../dtc/contexto';
import { Documento } from '../dtc/documento';
import { Editor } from '../dtc/editor';
import { api } from '../infraestrutura/api';
import { EmissaoEmLote } from './emissao-em-lote';
import { ExclusaoDocumento } from './exclusao-documento';

export const abasDocumentos: ReadonlyArray<readonly [AbaDocumentos, string]> = [
  ['rascunhos', 'Rascunhos'], ['encaminhadas', 'Encaminhadas'],
  ['devolvidas', 'Devolvidas'], ['conferidas', 'Conferidas'],
];
type Item = ListaDocumentos['itens'][number];
type Props = {
  grupo: 'DOF' | 'DTC'; aba: AbaDocumentos; tipo?: TipoDtc; csrf: string; papel: Papel;
  servidorInicial?: Servidor;
  onNavegar: (aba: AbaDocumentos, tipo?: TipoDtc) => void;
  onBuscarServidor: () => void;
  onRegistrarBusca: (buscar: ((consulta: Consulta) => void) | null) => void;
  onErro: (erro: unknown) => void; onLimpar: () => void;
  onPendente: (valor: boolean) => void; confirmarSaida: () => boolean;
};

export function ListaDocumentosTela({ grupo, aba, tipo, csrf, papel, servidorInicial, onNavegar,
  onBuscarServidor, onRegistrarBusca, onErro, onLimpar, onPendente, confirmarSaida }: Props) {
  const [dados, setDados] = useState<ListaDocumentos | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [ordem, setOrdem] = useState<ConsultaListaDocumentos['ordem']>('atualizadoEm');
  const [direcao, setDirecao] = useState<'asc' | 'desc'>('desc');
  const [versao, setVersao] = useState(0);
  const [selecionado, setSelecionado] = useState<Item | null>(null);
  const [rascunho, setRascunho] = useState<RascunhoDof | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [exclusao, setExclusao] = useState<Item | null>(null);
  const [mensagem, setMensagem] = useState('');
  const [novo, setNovo] = useState<'busca' | Servidor | null>(servidorInicial && papel !== 'admin' ? servidorInicial : null);
  const ativa = useRef(true);
  const painelExclusao = useRef<HTMLElement | null>(null);
  const abrirId = useRef<string | null>(null);
  const podeEmitir = papel === 'admin' || papel === 'coordenador';
  const tipoNovo = tipo ?? 'DTC_IPAM';

  useEffect(() => {
    ativa.current = true;
    return () => { ativa.current = false; };
  }, []);
  useEffect(() => {
    if (exclusao) painelExclusao.current?.querySelector('textarea')?.focus();
  }, [exclusao]);
  useEffect(() => {
    if (!menu) return;
    function fecharMenu(evento: MouseEvent) {
      if (evento.target instanceof Element && !evento.target.closest('.menu-acoes-documento')) setMenu(null);
    }
    function tecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape') {
        setMenu(null);
        document.querySelector<HTMLButtonElement>(`button[aria-controls="acoes-${menu}"]`)?.focus();
      }
    }
    document.addEventListener('click', fecharMenu);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('click', fecharMenu); document.removeEventListener('keydown', tecla); };
  }, [menu]);
  useEffect(() => {
    if (selecionado || novo) return;
    let corrente = true;
    let sequencia = 0;
    async function atualizar() {
      const pedido = ++sequencia;
      try {
        const resultado = await api.listarDocumentos({ grupo, aba, tipo, pagina, ordem, direcao, limite: 50 });
        if (corrente && pedido === sequencia) { setDados(resultado); setFalhou(false); }
      } catch (erro) {
        if (corrente && pedido === sequencia) { setFalhou(true); setDados(null); onErro(erro); }
      }
    }
    setDados(null); setFalhou(false);
    void atualizar();
    const intervalo = window.setInterval(() => { if (document.visibilityState !== 'hidden') void atualizar(); }, 30000);
    window.addEventListener('sisdoc:alteracao', atualizar);
    window.addEventListener('focus', atualizar);
    return () => {
      corrente = false; window.clearInterval(intervalo);
      window.removeEventListener('sisdoc:alteracao', atualizar);
      window.removeEventListener('focus', atualizar);
    };
  }, [grupo, aba, tipo, pagina, ordem, direcao, versao, selecionado, novo, onErro]);

  function voltar(aviso?: string) {
    if (!confirmarSaida()) return;
    onPendente(false); setSelecionado(null); setRascunho(null); setNovo(null); setVersao((v) => v + 1);
    if (aviso) setMensagem(aviso);
  }
  function mudarPagina(destino: number) {
    if (!confirmarSaida()) return;
    setDados(null); setPagina(destino);
  }
  async function abrir(item: Item) {
    if (abrindo || !confirmarSaida()) return;
    onLimpar(); setMenu(null); setExclusao(null); onPendente(false);
    if (item.tipo !== 'DOF' || item.situacao === 'conferidas') { setSelecionado(item); return; }
    abrirId.current = item.id; setAbrindo(true);
    try {
      const documento = await api.obterRascunhoDof(item.id);
      if (ativa.current && abrirId.current === item.id) { setRascunho(documento); setSelecionado(item); }
    } catch (erro) { if (ativa.current) onErro(erro); }
    finally { if (ativa.current) setAbrindo(false); }
  }
  if (novo === 'busca') return <BuscaServidor onSelecionar={setNovo} onRegistrarBusca={onRegistrarBusca} onErro={onErro} />;
  if (novo) return <div className="estudio-dof"><Editor tipo={tipoNovo} inicial={conteudoInicial(tipoNovo)}
    documento={null} servidor={novo} csrf={csrf} onSalvo={(documento) => {
      setNovo(null);
      setSelecionado({ id: documento.id, tipo: documento.tipo, pessoaId: documento.pessoaId, vinculoId: documento.vinculoId,
        nome: documento.nome, matricula: documento.matricula, autorNome: documento.autorNome, revisao: documento.revisao,
        atualizadoEm: documento.atualizadoEm, situacao: 'rascunhos', somenteLeitura: false, conferenciaDof: null });
    }} onCancelar={voltar} onErro={onErro} onLimpar={onLimpar} onPendente={onPendente} /></div>;
  if (selecionado?.tipo !== 'DOF' && selecionado) return <Documento id={selecionado.id} tipo={selecionado.tipo}
    csrf={csrf} papel={papel} onVoltar={voltar} onErro={onErro} onLimpar={onLimpar} onPendente={onPendente} />;
  if (selecionado?.conferenciaDof) return <ConferidosDof documentoInicial={selecionado.conferenciaDof}
    onVoltarLista={voltar} csrf={csrf} administrador={papel === 'admin'} podeDevolver={podeEmitir} podeEmitir={podeEmitir}
    onErro={onErro} onLimpar={onLimpar} onPendente={onPendente} confirmarSaida={confirmarSaida} />;
  if (selecionado && rascunho) return <CalculoDof pessoaId={rascunho.pessoaId} vinculoId={rascunho.vinculoId}
    nome={rascunho.nome} matricula={rascunho.matricula} admissao={rascunho.admissao} rascunhoInicial={rascunho}
    csrf={csrf} podeSalvar={!selecionado.somenteLeitura} somenteLeitura={selecionado.somenteLeitura} onFechar={voltar}
    onErro={onErro} onLimpar={onLimpar} onPendente={onPendente} confirmarSaida={confirmarSaida} />;

  const colunas: ReadonlyArray<readonly [ConsultaListaDocumentos['ordem'], string]> = [
    ['nome', 'Servidor'], ['matricula', 'Matrícula'], ['autor', 'Autor'], ['situacao', 'Situação'], ['atualizadoEm', 'Atualizado'],
  ];
  return <section className="painel" aria-labelledby="lista-documentos-titulo">
    <div className="ficha-cabecalho">
      <h2 id="lista-documentos-titulo">{grupo === 'DOF' ? 'DOFs' : 'DTCs'}</h2>
      {papel !== 'admin' && <button type="button" onClick={() => {
        if (!confirmarSaida()) return;
        if (grupo === 'DOF') onBuscarServidor(); else setNovo('busca');
      }}>{grupo === 'DOF' ? 'Nova DOF' : `Nova ${ROTULOS_DTC[tipoNovo]}`}</button>}
    </div>
    {grupo === 'DTC' && <label className="filtro-tipo-documento">Tipo de DTC
      <select value={tipo ?? ''} onChange={(e) => {
        const valor = e.target.value;
        onNavegar(aba, valor === 'DTC_IPAM' || valor === 'DTC_COMISSIONADO' || valor === 'DTC_INSS' ? valor : undefined);
      }}>
        <option value="">Todos os tipos</option><option value="DTC_IPAM">IPAM</option>
        <option value="DTC_COMISSIONADO">Comissionado</option><option value="DTC_INSS">INSS</option>
      </select>
    </label>}
    <nav className="abas-documentos" aria-label={`Situações de ${grupo === 'DOF' ? 'DOFs' : 'DTCs'}`}>
      {abasDocumentos.map(([codigo, rotulo]) => <button key={codigo} type="button" className="secundario"
        aria-current={codigo === aba ? 'page' : undefined} onClick={() => onNavegar(codigo, tipo)}>
        {rotulo} <span className="contador-aba" aria-label={dados ? `${dados.contagens[codigo]} documentos` : 'Contagem indisponível'}>
          {dados ? dados.contagens[codigo] : '—'}
        </span>
      </button>)}
    </nav>
    {mensagem && <p role="status" className="aviso sucesso">{mensagem}</p>}
    {abrindo && <p role="status">Abrindo documento...</p>}
    {exclusao && <section ref={painelExclusao} className="confirmacao-exclusao" aria-label={`Excluir documento de ${exclusao.nome}`}>
      <ExclusaoDocumento key={exclusao.id} inicialmenteAberto csrf={csrf} documentoId={exclusao.id} revisao={exclusao.revisao}
        descricao={`${exclusao.tipo} de ${exclusao.nome}`} onErro={onErro} onPendente={onPendente} onConcluido={(resultado) => {
          setExclusao(null); setVersao((v) => v + 1);
          setMensagem(resultado.estado === 'concluido' ? 'Documento apagado; auditoria preservada.'
            : 'Solicitação registrada e pendente de remoção segura do PDF ou liberação de dependências.');
        }} />
      <button type="button" className="secundario" onClick={() => {
        if (confirmarSaida()) { setExclusao(null); onPendente(false); }
      }}>Cancelar exclusão</button>
    </section>}
    {aba === 'conferidas' && podeEmitir && <EmissaoEmLote
        documentos={(dados?.itens ?? []).filter((item) => !item.conferenciaDof?.fonteSelecionadaAlterada)}
        carregar={async (item) => {
          if (grupo === 'DOF') {
            const previa = await api.obterPreviaConferidaDof(item.id);
            return { documentoId: previa.documentoId, revisao: previa.revisao, provaFonte: previa.fonte.provaFonte,
              fonteElegivel: !previa.fonteSelecionadaAlterada, html: renderizarPreviaDof(previa) };
          }
          const previa = await api.previaDtc(item.id);
          return { documentoId: previa.documento.id, revisao: previa.documento.revisao, provaFonte: previa.fonte.provaFonte,
            fonteElegivel: previa.fonteSelecionadaAlterada === false,
            html: renderizarPreviaDtc({ documento: previa.documento, fonte: previa.fonte }) };
        }}
        emitir={(item, chave, provaFonte) => grupo === 'DOF'
          ? api.emitirDof(csrf, item.id, chave, { revisao: item.revisao, provaFonte })
          : api.emitirDtc(csrf, item.id, chave, { revisao: item.revisao, provaFonte })}
        onConcluido={() => setVersao((v) => v + 1)} onErro={onErro} onLimpar={onLimpar} onPendente={onPendente} />}
    {falhou ? <button type="button" className="secundario" onClick={() => {
      onLimpar(); setVersao((v) => v + 1);
    }}>Tentar carregar documentos novamente</button> : !dados ? <p role="status">Carregando documentos...</p> : <>
      {aba === 'encaminhadas' && grupo === 'DTC' && <p>Nenhuma DTC encaminhada. O fluxo atual de DTC não possui encaminhamento.</p>}
      {!dados.itens.length ? <div className="estado-vazio"><p>Nenhum documento nesta aba.</p>
        <button type="button" className="secundario" onClick={onBuscarServidor}>Buscar servidor</button>
        {pagina > 1 && <button type="button" className="secundario" onClick={() => mudarPagina(1)}>Primeira página</button>}
      </div> : <div className="tabela tabela-documentos"><table>
        <thead><tr>{colunas.map(([campo, rotulo]) => <th key={campo} scope="col"
          aria-sort={ordem === campo ? (direcao === 'asc' ? 'ascending' : 'descending') : 'none'}>
          <button type="button" className="secundario ordenar-coluna" onClick={() => {
            if (!confirmarSaida()) return;
            setDados(null);
            setOrdem(campo); setDirecao(ordem === campo ? (direcao === 'asc' ? 'desc' : 'asc') : 'asc');
            setPagina(1);
          }}>{rotulo}{ordem === campo && <span aria-hidden="true">{direcao === 'asc' ? ' ↑' : ' ↓'}</span>}</button>
        </th>)}{papel === 'admin' && <th scope="col"><span className="sr-only">Ações</span></th>}</tr></thead>
        <tbody>{dados.itens.map((item) => <tr key={item.id} className="linha-documento" onClick={() => void abrir(item)}>
          <td><button type="button" className="secundario abrir-documento" disabled={abrindo}
            onClick={(e) => { e.stopPropagation(); void abrir(item); }} aria-label={`Abrir ${item.tipo} de ${item.nome}`}>
            {item.nome}</button>{item.tipo !== 'DOF' && <small>{ROTULOS_DTC[item.tipo]}</small>}</td>
          <td>{item.matricula}</td><td>{item.autorNome}</td>
          <td>{abasDocumentos.find(([codigo]) => codigo === item.situacao)?.[1]}</td><td>{dataTabela(item.atualizadoEm)}</td>
          {papel === 'admin' && <td className="menu-acoes-documento" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="secundario" aria-label={`Ações de ${item.nome}`}
              aria-expanded={menu === item.id} aria-controls={`acoes-${item.id}`} onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); setMenu(null); }
              }} onClick={() => setMenu(menu === item.id ? null : item.id)}>⋯</button>
            {menu === item.id && <div id={`acoes-${item.id}`} className="menu-documento">
              <button type="button" className="perigo" onClick={() => {
                if (confirmarSaida()) { setExclusao(item); setMenu(null); onPendente(false); }
              }}>Excluir</button>
            </div>}
          </td>}
        </tr>)}</tbody>
      </table></div>}
      <div className="acoes paginacao-documentos">
        <button type="button" className="secundario" disabled={pagina === 1} onClick={() => mudarPagina(pagina - 1)}>Anterior</button>
        <span role="status">{dados.total} documentos · Página {dados.pagina} de {Math.max(1, dados.totalPaginas)}</span>
        <button type="button" className="secundario" disabled={pagina >= dados.totalPaginas} onClick={() => mudarPagina(pagina + 1)}>Próxima</button>
      </div>
    </>}
  </section>;
}
