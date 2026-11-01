import { useEffect, useRef, useState } from 'react';
import {
  conferenciaImportacaoSchema, paginaLotesImportacaoSchema, relatorioImportacaoSchema, exportarDadosSchema,
  planilhasLegadoSchema, relatorioPlanilhaLegadoSchema,
  type LotePlanilhaLegado, type RelatorioPlanilhaLegado,
  type ConferenciaImportacao, type LoteImportacao, type PaginaLotesImportacao, type RelatorioImportacao, type TipoImportacao,
} from '@sisdoc/contratos';
import { ErroApi, requisitar, validar } from './api';
import { PromocaoLegado } from './promocao-legado';
import { Abas } from './abas';
import { FiltrosLista, useFiltroLista } from './filtros-lista';

const LIMITE_BYTES = 64 * 1024 * 1024;

const nomesTipo: Record<TipoImportacao, string> = {
  dados_funcionais: 'Dados funcionais (pessoas e vínculos)',
  afastamentos: 'Afastamentos',
  incorporacoes: 'Incorporações (PB/PV/licença-prêmio)',
  periodos_ipam: 'Períodos IPAM',
  eventos_funcionais: 'Eventos funcionais',
};

export function ExportacaoAdmin({ csrf, onErro, onMensagem }: {
  csrf: string; onErro: (erro: unknown) => void; onMensagem: (mensagem: string) => void;
}) {
  const [tipo, setTipo] = useState<TipoImportacao>('dados_funcionais');
  const [origem, setOrigem] = useState('planilha');
  const [formato, setFormato] = useState<'csv' | 'xlsx'>('xlsx');
  const [afastamentos, setAfastamentos] = useState<'anual' | 'intervalo'>('anual');
  const [enviando, setEnviando] = useState(false);
  const [destino, setDestino] = useState<'nucleo' | 'legado'>('nucleo');
  const [lotesLegado, setLotesLegado] = useState<LotePlanilhaLegado[]>([]);
  const [loteId, setLoteId] = useState('');
  const [erroLegado, setErroLegado] = useState(false);
  const [versaoLegado, setVersaoLegado] = useState(0);
  useEffect(() => {
    if (destino !== 'legado') return;
    let ativo = true;
    setErroLegado(false);
    requisitar('admin/importacoes/legado').then((dados) => {
      if (ativo) setLotesLegado(validar(planilhasLegadoSchema, dados));
    }).catch((erro: unknown) => { if (ativo) { setErroLegado(true); onErro(erro); } });
    return () => { ativo = false; };
  }, [destino, versaoLegado, onErro]);
  async function exportar() {
    const dados = exportarDadosSchema.safeParse({ tipo, origem, formato, afastamentos });
    if (destino === 'nucleo' && !dados.success) { onErro(new ErroApi(400, 'Confira o tipo, origem e formato da exportação.')); return; }
    if (destino === 'legado' && !loteId) { onErro(new ErroApi(400, 'Selecione uma planilha legada para exportar.')); return; }
    if (!window.confirm('Exportar dados pessoais completos? Proteja o arquivo baixado e compartilhe apenas com pessoas autorizadas. O acesso será auditado.')) return;
    setEnviando(true);
    try {
      const resposta = await fetch(destino === 'legado' ? '/api/v1/admin/importacoes/legado/exportar' : '/api/v1/admin/importacoes/exportar', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify(destino === 'legado' ? { loteId, formato } : dados.success ? dados.data : null),
      });
      if (!resposta.ok) {
        const problema: unknown = await resposta.json();
        const detalhe = typeof problema === 'object' && problema !== null && 'detail' in problema && typeof problema.detail === 'string'
          ? problema.detail : 'Não foi possível exportar os dados.';
        throw new ErroApi(resposta.status, detalhe);
      }
      const url = URL.createObjectURL(await resposta.blob());
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = destino === 'legado' ? `legado-${loteId}.${formato}` : `${tipo}-${origem}.${formato}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        onMensagem('Exportação baixada. Guarde o arquivo em local protegido; ele contém dados pessoais completos.');
      } finally { URL.revokeObjectURL(url); }
    } catch (erro) { onErro(erro); }
    finally { setEnviando(false); }
  }
  return <section className="painel separado" aria-labelledby="exportacao-titulo">
    <h3 id="exportacao-titulo">Exportação de dados</h3>
    <p>Núcleo: dados canônicos ativos. Legado: planilhas armazenadas com os cabeçalhos originais. Exportação não substitui backup.</p>
    <div className="grade-busca">
      <label>Schema de exportação<select value={destino} onChange={(e) => { setDestino(e.target.value === 'legado' ? 'legado' : 'nucleo'); setLoteId(''); }}>
        <option value="nucleo">Núcleo — dados canônicos</option><option value="legado">Legado — planilhas originais</option>
      </select></label>
      {destino === 'nucleo' && <><label>Tipo<select value={tipo} onChange={(e) => {
        const valor = exportarDadosSchema.shape.tipo.safeParse(e.target.value);
        if (valor.success) setTipo(valor.data);
      }}>{Object.entries(nomesTipo).map(([valor, nome]) => <option key={valor} value={valor}>{nome}</option>)}</select></label>
      <label>Origem<input required maxLength={63} value={origem} onChange={(e) => setOrigem(e.target.value)} /></label></>}
      {destino === 'legado' && <label>Planilha legada<select value={loteId} onChange={(e) => setLoteId(e.target.value)}>
        <option value="">Selecionar lote</option>
        {lotesLegado.map((lote) => <option key={lote.id} value={lote.id}>{lote.origem} — {lote.linhas} linhas — {dataHora(lote.importadoEm)}</option>)}
      </select></label>}
      <label>Formato<select value={formato} onChange={(e) => setFormato(e.target.value === 'csv' ? 'csv' : 'xlsx')}>
        <option value="xlsx">XLSX (recomendado)</option><option value="csv">CSV UTF-8</option>
      </select></label>
      {destino === 'nucleo' && tipo === 'afastamentos' && <label>Modalidade<select value={afastamentos} onChange={(e) => setAfastamentos(e.target.value === 'intervalo' ? 'intervalo' : 'anual')}>
        <option value="anual">Totais anuais</option><option value="intervalo">Intervalos de datas</option>
      </select></label>}
    </div>
    {destino === 'legado' && <button type="button" className="secundario" onClick={() => setVersaoLegado((v) => v + 1)}>
      {erroLegado ? 'Tentar carregar planilhas novamente' : 'Atualizar planilhas legadas'}
    </button>}
    <button type="button" disabled={enviando} onClick={() => void exportar()}>{enviando ? 'Exportando...' : 'Exportar dados completos'}</button>
  </section>;
}

const nomesStatus: Record<LoteImportacao['status'], string> = {
  processando: 'Em processamento',
  concluido: 'Concluído',
  falhou: 'Falhou',
  desfeito: 'Desfeito',
};

const nomesOcorrencia: Record<RelatorioImportacao['ocorrencias'][number]['tipo'], string> = {
  rejeitada: 'Rejeitada',
  quarentena: 'Quarentena',
  duplicada: 'Duplicada',
  divergencia: 'Divergência',
  anomalia: 'Anomalia',
};

function dataHora(valor: string | null): string {
  return valor ? new Date(valor).toLocaleString('pt-BR') : '—';
}

async function enviarArquivo(csrf: string, tipo: TipoImportacao, origem: string, modo: 'validar' | 'gravar', arquivo: File, destino: 'nucleo' | 'legado'): Promise<RelatorioImportacao | RelatorioPlanilhaLegado> {
  const consulta = new URLSearchParams({ tipo, origem, modo, destino });
  let resposta: Response;
  try {
    resposta = await fetch(`/api/v1/admin/importacoes?${consulta.toString()}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': csrf },
      body: arquivo,
    });
  } catch {
    throw new ErroApi(0, 'Não foi possível conectar ao SisDoc. Verifique a conexão e tente novamente.');
  }
  let dados: unknown;
  try {
    dados = await resposta.json();
  } catch {
    throw new ErroApi(resposta.status, 'O servidor retornou uma resposta inválida. Contate o administrador.');
  }
  if (!resposta.ok) {
    const detalhe = typeof dados === 'object' && dados !== null && 'detail' in dados && typeof dados.detail === 'string'
      ? dados.detail : 'Não foi possível processar o arquivo.';
    throw new ErroApi(resposta.status, detalhe);
  }
  return destino === 'legado' ? validar(relatorioPlanilhaLegadoSchema, dados) : validar(relatorioImportacaoSchema, dados);
}

async function listarLotes(cursor?: string): Promise<PaginaLotesImportacao> {
  const consulta = new URLSearchParams({ limite: '20' });
  if (cursor) consulta.set('cursor', cursor);
  return validar(paginaLotesImportacaoSchema, await requisitar(`admin/importacoes?${consulta.toString()}`));
}

async function carregarConferencia(): Promise<ConferenciaImportacao> {
  return validar(conferenciaImportacaoSchema, await requisitar('admin/importacoes/conferencia'));
}

function Relatorio({ relatorio }: { relatorio: RelatorioImportacao }) {
  const c = relatorio.contagens;
  return (
    <div className="painel relatorio-importacao" role="status">
      <h3>{relatorio.modo === 'gravacao' ? 'Importação gravada' : 'Validação concluída — nada foi gravado'}</h3>
      {relatorio.loteExistente && <p className="aviso">Este arquivo já foi importado (lote {relatorio.loteExistente}); nenhuma alteração foi feita.</p>}
      <dl className="contagens">
        <div><dt>Lidos</dt><dd>{c.lidos}</dd></div>
        <div><dt>Válidos</dt><dd>{c.validos}</dd></div>
        <div><dt>Rejeitados</dt><dd>{c.rejeitados}</dd></div>
        <div><dt>Duplicados</dt><dd>{c.duplicados}</dd></div>
        <div><dt>Quarentena</dt><dd>{c.quarentena}</dd></div>
        <div><dt>Anomalias</dt><dd>{c.anomalias}</dd></div>
        <div><dt>Inseridos</dt><dd>{c.inseridos}</dd></div>
        <div><dt>Atualizados</dt><dd>{c.atualizados}</dd></div>
        <div><dt>Inalterados</dt><dd>{c.inalterados}</dd></div>
      </dl>
      {relatorio.avisos.map((aviso) => <p key={aviso} className="aviso">{aviso}</p>)}
      {relatorio.ocorrencias.length > 0 && (
        <details open={relatorio.ocorrencias.length <= 20}>
          <summary>{relatorio.ocorrencias.length + relatorio.ocorrenciasOmitidas} ocorrência(s) — referências completas para conferência</summary>
          <div className="tabela">
            <table>
              <thead><tr><th scope="col">Linha</th><th scope="col">Tipo</th><th scope="col">Referência</th><th scope="col">Motivo</th></tr></thead>
              <tbody>
                {relatorio.ocorrencias.map((item, indice) => (
                  <tr key={indice}><td>{item.linha}</td><td>{nomesOcorrencia[item.tipo]}</td><td><code>{item.referencia}</code></td><td>{item.motivo}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {relatorio.ocorrenciasOmitidas > 0 && <p>Mais {relatorio.ocorrenciasOmitidas} ocorrência(s) fora desta prévia.
            Na conversão do Legado, baixe todas as ocorrências em XLSX para revisar o lote completo.</p>}
        </details>
      )}
      <p className="discreta">Processado em {(relatorio.duracaoMs / 1000).toFixed(1)} s.</p>
    </div>
  );
}

export function ImportacaoAdmin({ csrf, onErro, onMensagem }: {
  csrf: string;
  onErro: (erro: unknown) => void;
  onMensagem: (mensagem: string) => void;
}) {
  const [tipo, setTipo] = useState<TipoImportacao>('dados_funcionais');
  const [destino, setDestino] = useState<'nucleo' | 'legado'>('nucleo');
  const [origem, setOrigem] = useState('planilha');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [relatorio, setRelatorio] = useState<RelatorioImportacao | null>(null);
  const [relatorioLegado, setRelatorioLegado] = useState<RelatorioPlanilhaLegado | null>(null);
  const [validadoPara, setValidadoPara] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pagina, setPagina] = useState<PaginaLotesImportacao | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [conferencia, setConferencia] = useState<ConferenciaImportacao | null>(null);
  const [versao, setVersao] = useState(0);
  const [loteParaConverter, setLoteParaConverter] = useState<string | null>(null);
  const [aba, setAba] = useState('importar');
  const filtro = useFiltroLista(pagina?.itens ?? [], (lote) =>
    `${dataHora(lote.iniciadoEm)} ${nomesTipo[lote.tipo]} ${lote.origem} ${lote.canal} ${nomesStatus[lote.status]} ${lote.usuario} ${lote.id}`);
  const campoArquivo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let ativa = true;
    Promise.all([listarLotes(cursor), carregarConferencia()]).then(([lotes, totais]) => {
      if (!ativa) return;
      setPagina(lotes);
      setConferencia(totais);
    }).catch((erro: unknown) => {
      if (ativa) onErro(erro);
    });
    return () => { ativa = false; };
  }, [cursor, versao, onErro]);

  const assinatura = arquivo ? `${destino}|${tipo}|${origem}|${arquivo.name}|${arquivo.size}|${arquivo.lastModified}` : null;

  const processar = async (modo: 'validar' | 'gravar') => {
    if (!arquivo) return;
    if (arquivo.size > LIMITE_BYTES) {
      onErro(new ErroApi(413, 'O arquivo excede o limite de 64 MB.'));
      return;
    }
    if (modo === 'gravar' && !window.confirm(`Gravar a planilha da origem "${origem}" no schema ${destino}? ${destino === 'legado' ? 'Cabeçalhos e linhas serão preservados, sem conversão para o núcleo.' : 'Os dados serão validados e consolidados no núcleo.'}`)) return;
    setEnviando(true);
    try {
      const resultado = await enviarArquivo(csrf, tipo, origem, modo, arquivo, destino);
      if ('destino' in resultado) { setRelatorioLegado(resultado); setRelatorio(null); }
      else { setRelatorio(resultado); setRelatorioLegado(null); }
      if (modo === 'validar') setValidadoPara(assinatura);
      else {
        setValidadoPara(null);
        if ('destino' in resultado) setLoteParaConverter(resultado.loteId ?? resultado.loteExistente);
        onMensagem(resultado.loteExistente ? 'Arquivo já importado anteriormente; nada foi alterado.' : 'Importação gravada com sucesso.');
        setCursor(undefined);
        setVersao((atual) => atual + 1);
      }
    } catch (erro) {
      onErro(erro);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <section aria-labelledby="importacao-titulo">
      <h2 id="importacao-titulo">Importação e exportação de dados</h2>
      <p>Legado: guarde o XLSX/CSV original e use o assistente abaixo para disponibilizar os dados para DOF/DTC.
        Núcleo: importação direta no formato canônico. Valide e confira o relatório antes de confirmar qualquer gravação.</p>
      <p className="aviso">Dados existentes e edições manuais são preservados. Campos vazios podem ser completados;
        divergências ficam indicadas para revisão, sem substituição automática.</p>
      <Abas atual={aba} onSelecionar={setAba} rotulo="Transferência de dados" itens={[
        { id: 'importar', titulo: 'Importar', conteudo: <>
      <p className="etiqueta">1. Selecionar arquivo → 2. Validar e revisar → 3. Confirmar gravação</p>
      <div className="painel">
        <form className="formulario-importacao" onSubmit={(evento) => { evento.preventDefault(); void processar('validar'); }}>
          <label>Schema de destino<select value={destino} onChange={(e) => {
            setDestino(e.target.value === 'legado' ? 'legado' : 'nucleo'); setRelatorio(null); setRelatorioLegado(null); setValidadoPara(null);
          }}>
            <option value="nucleo">Núcleo — pessoas e referências</option><option value="legado">Legado — preservar cabeçalhos da planilha</option>
          </select></label>
          {destino === 'nucleo' && <label>Tipo de dado
            <select value={tipo} onChange={(evento) => { setTipo(evento.target.value as TipoImportacao); setRelatorio(null); }}>
              {(Object.keys(nomesTipo) as TipoImportacao[]).map((chave) => <option key={chave} value={chave}>{nomesTipo[chave]}</option>)}
            </select>
          </label>}
          <label>Origem
            <input value={origem} maxLength={63} pattern="[a-z0-9][a-z0-9_.\-]*" required
              onChange={(evento) => { setOrigem(evento.target.value.toLowerCase()); setRelatorio(null); setRelatorioLegado(null); setValidadoPara(null); }} />
          </label>
          <label>Arquivo
            <input ref={campoArquivo} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required
              onChange={(evento) => { setArquivo(evento.target.files?.[0] ?? null); setRelatorio(null); setRelatorioLegado(null); setValidadoPara(null); }} />
          </label>
          <div className="acoes">
            <button type="submit" disabled={enviando || !arquivo}>{enviando ? 'Processando...' : 'Validar arquivo'}</button>
            <button type="button" disabled={enviando || !arquivo || validadoPara !== assinatura} onClick={() => void processar('gravar')}>Gravar importação</button>
          </div>
        </form>
      </div>
      {relatorio && <Relatorio relatorio={relatorio} />}
      {relatorioLegado && <div className="painel" role="status">
        <h3>{relatorioLegado.modo === 'validar' ? 'Legado validado — nada foi gravado' : 'Planilha no legado'}</h3>
        <p>{relatorioLegado.linhas} linha(s), {relatorioLegado.cabecalhos.length} coluna(s).</p>
        <p>Cabeçalhos preservados: {relatorioLegado.cabecalhos.join(' · ')}</p>
        {relatorioLegado.loteId && <p>Lote: {relatorioLegado.loteId}</p>}
        {relatorioLegado.loteExistente && <p>Arquivo já importado: {relatorioLegado.loteExistente}. Nenhuma alteração.</p>}
      </div>}
      {loteParaConverter && <button type="button" onClick={() => setAba('legado')}>Disponibilizar lote Legado para DOF/DTC</button>}
      </> },
        { id: 'legado', titulo: 'Disponibilizar Legado', conteudo: <PromocaoLegado key={`conversao-${loteParaConverter ?? 'selecionar'}`} csrf={csrf} loteInicial={loteParaConverter}
        onErro={onErro} onAplicado={() => {
          setCursor(undefined); setVersao((atual) => atual + 1);
          onMensagem('Conversão do Legado aplicada ao Núcleo. Confira o relatório e os servidores antes de emitir documentos.');
        }} renderRelatorio={(dados) => <Relatorio relatorio={dados} />} /> },
        { id: 'exportar', titulo: 'Exportar', conteudo: <ExportacaoAdmin key={`exportacao-${versao}`} csrf={csrf} onErro={onErro} onMensagem={onMensagem} /> },
        { id: 'historico', titulo: 'Histórico', conteudo: <>
      {conferencia && (
        <div className="painel">
          <h3>Conferência por origem</h3>
          <p>Total no banco: {conferencia.totais.pessoas} pessoa(s) e {conferencia.totais.vinculos} vínculo(s).</p>
          <div className="tabela">
            <table>
              <thead><tr><th scope="col">Origem</th><th scope="col">Pessoas</th><th scope="col">Vínculos</th><th scope="col">Afastamentos</th><th scope="col">Incorporações</th><th scope="col">Períodos IPAM</th><th scope="col">Eventos</th></tr></thead>
              <tbody>
                {conferencia.origens.length === 0 && <tr><td colSpan={7}>Nenhum dado importado ainda.</td></tr>}
                {conferencia.origens.map((linha) => (
                  <tr key={linha.origem}><td>{linha.origem}</td><td>{linha.pessoas}</td><td>{linha.vinculos}</td><td>{linha.afastamentos}</td><td>{linha.incorporacoes}</td><td>{linha.periodosIpam}</td><td>{linha.eventos}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <h3>Lotes de importação</h3>
      <FiltrosLista filtro={filtro} onAtualizar={() => setVersao((atual) => atual + 1)} />
      {!pagina ? <p role="status">Carregando lotes...</p> : (
        <>
          <div className="tabela">
            <table>
              <thead><tr><th scope="col">Início</th><th scope="col">Tipo</th><th scope="col">Origem</th><th scope="col">Canal</th><th scope="col">Situação</th><th scope="col">Inseridos</th><th scope="col">Atualizados</th><th scope="col">Usuário</th><th scope="col">Lote</th></tr></thead>
              <tbody>
                {pagina.itens.length === 0 && <tr><td colSpan={9}>Nenhum lote registrado.</td></tr>}
                {filtro.itens.map((lote) => (
                  <tr key={lote.id}>
                    <td>{dataHora(lote.iniciadoEm)}</td><td>{nomesTipo[lote.tipo]}</td><td>{lote.origem}</td><td>{lote.canal}</td>
                    <td>{nomesStatus[lote.status]}{lote.desfeitoEm && ` em ${dataHora(lote.desfeitoEm)}`}</td>
                    <td>{lote.contagens.inseridos ?? '—'}</td><td>{lote.contagens.atualizados ?? '—'}</td><td>{lote.usuario}</td>
                    <td><code title={lote.id}>{lote.id.slice(0, 8)}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="acoes">
            <button type="button" className="secundario" disabled={!cursor} onClick={() => setCursor(undefined)}>Primeira página</button>
            <button type="button" className="secundario" disabled={!pagina.proximoCursor} onClick={() => setCursor(pagina.proximoCursor ?? undefined)}>Próxima página</button>
            <button type="button" className="secundario" onClick={() => setVersao((atual) => atual + 1)}>Atualizar</button>
          </div>
        </>
      )}
      </> }]} />
    </section>
  );
}
