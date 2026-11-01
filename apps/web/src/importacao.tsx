import { useEffect, useRef, useState } from 'react';
import {
  conferenciaImportacaoSchema, paginaLotesImportacaoSchema, relatorioImportacaoSchema, exportarDadosSchema,
  type ConferenciaImportacao, type LoteImportacao, type PaginaLotesImportacao, type RelatorioImportacao, type TipoImportacao,
} from '@sisdoc/contratos';
import { ErroApi, requisitar, validar } from './api';

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
  async function exportar() {
    const dados = exportarDadosSchema.safeParse({ tipo, origem, formato, afastamentos });
    if (!dados.success) { onErro(new ErroApi(400, 'Confira o tipo, origem e formato da exportação.')); return; }
    if (!window.confirm('Exportar dados pessoais completos? Proteja o arquivo baixado e compartilhe apenas com pessoas autorizadas. O acesso será auditado.')) return;
    setEnviando(true);
    try {
      const resposta = await fetch('/api/v1/admin/importacoes/exportar', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(dados.data),
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
        link.download = `${dados.data.tipo}-${dados.data.origem}.${dados.data.formato}`;
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
    <p>CSV/XLSX nos formatos da importação, por origem, somente registros ativos. Exportação não substitui backup do banco ou dos PDFs.</p>
    <div className="grade-busca">
      <label>Tipo<select value={tipo} onChange={(e) => {
        const valor = exportarDadosSchema.shape.tipo.safeParse(e.target.value);
        if (valor.success) setTipo(valor.data);
      }}>{Object.entries(nomesTipo).map(([valor, nome]) => <option key={valor} value={valor}>{nome}</option>)}</select></label>
      <label>Origem<input required maxLength={63} value={origem} onChange={(e) => setOrigem(e.target.value)} /></label>
      <label>Formato<select value={formato} onChange={(e) => setFormato(e.target.value === 'csv' ? 'csv' : 'xlsx')}>
        <option value="xlsx">XLSX (recomendado)</option><option value="csv">CSV UTF-8</option>
      </select></label>
      {tipo === 'afastamentos' && <label>Modalidade<select value={afastamentos} onChange={(e) => setAfastamentos(e.target.value === 'intervalo' ? 'intervalo' : 'anual')}>
        <option value="anual">Totais anuais</option><option value="intervalo">Intervalos de datas</option>
      </select></label>}
    </div>
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

async function enviarArquivo(csrf: string, tipo: TipoImportacao, origem: string, modo: 'validar' | 'gravar', arquivo: File): Promise<RelatorioImportacao> {
  const consulta = new URLSearchParams({ tipo, origem, modo });
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
  return validar(relatorioImportacaoSchema, dados);
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
          <summary>{relatorio.ocorrencias.length + relatorio.ocorrenciasOmitidas} ocorrência(s) — CPF e matrícula mascarados</summary>
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
          {relatorio.ocorrenciasOmitidas > 0 && <p>Mais {relatorio.ocorrenciasOmitidas} ocorrência(s) omitidas; use a linha de comando com --relatorio para a lista completa.</p>}
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
  const [origem, setOrigem] = useState('planilha');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [relatorio, setRelatorio] = useState<RelatorioImportacao | null>(null);
  const [validadoPara, setValidadoPara] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pagina, setPagina] = useState<PaginaLotesImportacao | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [conferencia, setConferencia] = useState<ConferenciaImportacao | null>(null);
  const [versao, setVersao] = useState(0);
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

  const assinatura = arquivo ? `${tipo}|${origem}|${arquivo.name}|${arquivo.size}|${arquivo.lastModified}` : null;

  const processar = async (modo: 'validar' | 'gravar') => {
    if (!arquivo) return;
    if (arquivo.size > LIMITE_BYTES) {
      onErro(new ErroApi(413, 'O arquivo excede o limite de 64 MB.'));
      return;
    }
    if (modo === 'gravar' && !window.confirm(`Gravar ${nomesTipo[tipo]} da origem "${origem}" no banco local? O lote poderá ser desfeito apenas pelo administrador técnico (npm run importacao -- --rollback).`)) return;
    setEnviando(true);
    try {
      const resultado = await enviarArquivo(csrf, tipo, origem, modo, arquivo);
      setRelatorio(resultado);
      if (modo === 'validar') setValidadoPara(assinatura);
      else {
        setValidadoPara(null);
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
      <h2 id="importacao-titulo">Importação de dados</h2>
      <p>Carregue planilhas CSV ou XLSX no formato dos modelos em <code>referencias/modelos-importacao</code>. Valide primeiro; a gravação só é liberada após a validação do mesmo arquivo.</p>
      <div className="painel">
        <form className="formulario-importacao" onSubmit={(evento) => { evento.preventDefault(); void processar('validar'); }}>
          <label>Tipo de dado
            <select value={tipo} onChange={(evento) => { setTipo(evento.target.value as TipoImportacao); setRelatorio(null); }}>
              {(Object.keys(nomesTipo) as TipoImportacao[]).map((chave) => <option key={chave} value={chave}>{nomesTipo[chave]}</option>)}
            </select>
          </label>
          <label>Origem
            <input value={origem} maxLength={63} pattern="[a-z0-9][a-z0-9_.\-]*" required
              onChange={(evento) => { setOrigem(evento.target.value.toLowerCase()); setRelatorio(null); }} />
          </label>
          <label>Arquivo
            <input ref={campoArquivo} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required
              onChange={(evento) => { setArquivo(evento.target.files?.[0] ?? null); setRelatorio(null); }} />
          </label>
          <div className="acoes">
            <button type="submit" disabled={enviando || !arquivo}>{enviando ? 'Processando...' : 'Validar arquivo'}</button>
            <button type="button" disabled={enviando || !arquivo || validadoPara !== assinatura} onClick={() => void processar('gravar')}>Gravar importação</button>
          </div>
        </form>
      </div>
      {relatorio && <Relatorio relatorio={relatorio} />}
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
      {!pagina ? <p role="status">Carregando lotes...</p> : (
        <>
          <div className="tabela">
            <table>
              <thead><tr><th scope="col">Início</th><th scope="col">Tipo</th><th scope="col">Origem</th><th scope="col">Canal</th><th scope="col">Situação</th><th scope="col">Inseridos</th><th scope="col">Atualizados</th><th scope="col">Usuário</th><th scope="col">Lote</th></tr></thead>
              <tbody>
                {pagina.itens.length === 0 && <tr><td colSpan={9}>Nenhum lote registrado.</td></tr>}
                {pagina.itens.map((lote) => (
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
    </section>
  );
}
