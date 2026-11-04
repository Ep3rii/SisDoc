import { useState } from 'react';
import { relatorioImportacaoHistoricoSchema, type RegistroHistorico } from '@sisdoc/contratos';
import { ErroApi, validar } from '../infraestrutura/api';

export function TransferenciaHistorico({ pessoaId, vinculoId, csrf, onErro, onImportado }: {
  pessoaId: string; vinculoId: string; csrf: string; onErro: (erro: unknown) => void; onImportado: () => void;
}) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [origem, setOrigem] = useState('historico-planilha');
  const [aba, setAba] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [relatorio, setRelatorio] = useState<ReturnType<typeof relatorioImportacaoHistoricoSchema.parse> | null>(null);
  async function processar(modo: 'validar' | 'gravar') {
    if (!arquivo) { onErro(new ErroApi(400, 'Selecione um arquivo de histórico.')); return; }
    if (modo === 'gravar' && (!relatorio || !window.confirm(`Aplicar ${relatorio.inseridos} registros aceitos? ${relatorio.rejeitados} rejeitados e ${relatorio.divergentes} divergentes não serão aplicados. Edições manuais serão preservadas.`))) return;
    setOcupado(true);
    try {
      const query = new URLSearchParams({ vinculoId, origem, modo, ...(aba ? { aba } : {}),
        ...(modo === 'gravar' && relatorio ? { validacao: relatorio.validacao } : {}) });
      const resposta = await fetch(`/api/v1/servidores/${pessoaId}/historico/importar?${query}`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': csrf }, body: arquivo,
      });
      const dados: unknown = await resposta.json();
      if (!resposta.ok) throw new ErroApi(resposta.status, typeof dados === 'object' && dados !== null && 'detail' in dados && typeof dados.detail === 'string' ? dados.detail : 'Falha na importação do histórico.');
      setRelatorio(validar(relatorioImportacaoHistoricoSchema, dados));
      if (modo === 'gravar') { onImportado(); window.dispatchEvent(new Event('sisdoc:alteracao')); }
    } catch (erro: unknown) { setRelatorio(null); onErro(erro); }
    finally { setOcupado(false); }
  }
  function baixarModelo(grupo: RegistroHistorico['grupo']) {
    const cabecalho = grupo === 'financeiro'
      ? 'GRUPO;TIPO;SITUACAO;DESCRICAO;COMPETENCIA;RUBRICA;NATUREZA;VALOR;FOLHA;PAGAMENTO;COMPETENCIAORIGEM;IDORIGEM'
      : 'GRUPO;TIPO;SITUACAO;DESCRICAO;INICIO;FIM;AQUISITIVOINICIO;AQUISITIVOFIM;DIASINFORMADOS;ESPECIELICENCA;ATO;IDORIGEM';
    const url = URL.createObjectURL(new Blob([`\uFEFF${cabecalho}\r\n`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `modelo-historico-${grupo}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return <details className="grupo-formulario"><summary>Importar histórico deste vínculo — CSV, XLSX ou XML</summary>
    <p>Use o modelo canônico. A origem e o identificador de cada linha evitam duplicidades. XML usa a raiz SisDoc versão 1. Nenhuma linha é aplicada antes de validar e confirmar.</p>
    <div className="acoes"><button type="button" className="secundario" onClick={() => baixarModelo('funcional')}>Baixar cabeçalhos funcionais</button>
      <button type="button" className="secundario" onClick={() => baixarModelo('financeiro')}>Baixar cabeçalhos financeiros</button></div>
    <fieldset disabled={ocupado}><div className="grade">
      <label>Origem técnica<input value={origem} onChange={(e) => { setOrigem(e.target.value); setRelatorio(null); }} /></label>
      <label>Nome exato da aba XLSX (vazio = primeira aba)<input value={aba} onChange={(e) => { setAba(e.target.value); setRelatorio(null); }} /></label>
      <label>Arquivo<input type="file" accept=".csv,.xlsx,.xml" onChange={(e) => { setArquivo(e.target.files?.[0] ?? null); setRelatorio(null); }} /></label>
    </div><div className="acoes"><button type="button" disabled={!arquivo} onClick={() => void processar('validar')}>Validar histórico</button>
      <button type="button" disabled={!relatorio || relatorio.modo !== 'validar'} onClick={() => void processar('gravar')}>Confirmar importação</button></div></fieldset>
    {relatorio && <div role="status"><p>{relatorio.modo === 'validar' ? 'Validação sem gravação' : 'Importação concluída'}: {relatorio.inseridos} {relatorio.modo === 'validar' ? 'a inserir' : 'inseridos'}, {relatorio.inalterados} inalterados, {relatorio.divergentes} divergentes, {relatorio.rejeitados} rejeitados.</p>
      {relatorio.ocorrencias.map((item, i) => <p key={i}>Linha {item.linha}: {item.motivo}</p>)}
      {relatorio.loteId && <p>Lote protegido: {relatorio.loteId}.</p>}
    </div>}
  </details>;
}
