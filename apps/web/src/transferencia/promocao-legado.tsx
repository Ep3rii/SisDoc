import {
  planilhasLegadoSchema, previaLegadoSchema, relatorioPromocaoLegadoSchema, tipoImportacaoSchema,
  type LotePlanilhaLegado, type PreviaLegado, type RelatorioImportacao, type RelatorioPromocaoLegado, type TipoImportacao,
} from '@sisdoc/contratos';
import { useEffect, useState, type ReactNode } from 'react';
import { ErroApi, requisitar, validar } from '../infraestrutura/api';

const tipos: Record<TipoImportacao, string> = {
  dados_funcionais: 'Cadastro DOF/DTC — 18 campos',
  afastamentos: 'Afastamentos e frequência',
  incorporacoes: 'Incorporações PB/PV/licença-prêmio',
  periodos_ipam: 'Períodos IPAM',
  eventos_funcionais: 'Atos e eventos funcionais',
};

export function PromocaoLegado({ csrf, loteInicial, onErro, onAplicado, renderRelatorio }: {
  csrf: string;
  loteInicial: string | null;
  onErro: (erro: unknown) => void;
  onAplicado: () => void;
  renderRelatorio: (relatorio: RelatorioImportacao) => ReactNode;
}) {
  const [lotes, setLotes] = useState<LotePlanilhaLegado[] | null>(null);
  const [loteId, setLoteId] = useState(loteInicial ?? '');
  const [tipo, setTipo] = useState<TipoImportacao>('dados_funcionais');
  const [previa, setPrevia] = useState<PreviaLegado | null>(null);
  const [mapeamento, setMapeamento] = useState<Record<string, number | null>>({});
  const [resultado, setResultado] = useState<RelatorioPromocaoLegado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let ativa = true;
    setFalhou(false);
    requisitar('admin/importacoes/legado').then((dados) => {
      if (ativa) setLotes(validar(planilhasLegadoSchema, dados));
    }).catch((erro: unknown) => { if (ativa) { setFalhou(true); onErro(erro); } });
    return () => { ativa = false; };
  }, [versao, onErro]);

  useEffect(() => {
    let ativa = true;
    setPrevia(null);
    setResultado(null);
    if (!loteId) return;
    requisitar('admin/importacoes/legado/previa', 'POST', { loteId, tipo }, csrf).then((dados) => {
      if (!ativa) return;
      const nova = validar(previaLegadoSchema, dados);
      setPrevia(nova);
      setMapeamento(nova.mapeamento);
    }).catch((erro: unknown) => { if (ativa) onErro(erro); });
    return () => { ativa = false; };
  }, [loteId, tipo, csrf, versao, onErro]);

  async function processar(modo: 'validar' | 'gravar') {
    if (!previa || (modo === 'gravar' && resultado?.relatorio.modo !== 'validacao')) return;
    if (modo === 'gravar' && !window.confirm(
      `Aplicar o lote ${previa.loteId} da origem "${previa.origem}" no Núcleo? ` +
      'Linhas rejeitadas e em quarentena não serão aplicadas. Dados existentes serão preservados; divergências exigem revisão. ' +
      'Os dados aceitos ficarão disponíveis na busca e nas declarações.',
    )) return;
    setOcupado(true);
    try {
      const dados = await requisitar('admin/importacoes/legado/promover', 'POST', {
        loteId, tipo, mapeamento, modo, ...(modo === 'gravar' && resultado ? { validacao: resultado.validacao } : {}),
      }, csrf);
      const atual = validar(relatorioPromocaoLegadoSchema, dados);
      setResultado(atual);
      if (modo === 'gravar') onAplicado();
    } catch (erro: unknown) {
      setResultado(null);
      onErro(erro);
    } finally {
      setOcupado(false);
    }

  }

  async function baixarOcorrencias() {
    if (!previa) return;
    setOcupado(true);
    try {
      const resposta = await fetch('/api/v1/admin/importacoes/legado/ocorrencias', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ loteId, tipo, mapeamento, modo: 'validar' }),
      });
      if (!resposta.ok) {
        const problema: unknown = await resposta.json();
        throw new ErroApi(resposta.status, typeof problema === 'object' && problema !== null
          && 'detail' in problema && typeof problema.detail === 'string' ? problema.detail : 'Não foi possível baixar as ocorrências.');
      }
      const url = URL.createObjectURL(await resposta.blob());
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = `ocorrencias-legado-${loteId}.xlsx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally { URL.revokeObjectURL(url); }
    } catch (erro: unknown) {
      onErro(erro);
    } finally {
      setOcupado(false);
    }
  }

  const naoUtilizadas = previa?.cabecalhos.filter((_, indice) => !Object.values(mapeamento).includes(indice)) ?? [];
  return <section className="painel separado" aria-labelledby="conversao-legado-titulo">
    <h3 id="conversao-legado-titulo">Disponibilizar Legado para DOF e DTC</h3>
    <ol><li>Selecionar lote e tipo</li><li>Conferir prévia e mapeamento</li><li>Validar conversão</li><li>Confirmar aplicação no Núcleo</li></ol>
    <p>O lote original permanece cifrado no Legado. A conversão conserva a origem e preenche campos vazios,
      sem sobrescrever dados existentes ou edições manuais.</p>
    <div className="grade-busca">
      <label>Lote para disponibilizar<select value={loteId} disabled={ocupado} onChange={(evento) => {
        setPrevia(null); setResultado(null); setLoteId(evento.target.value);
      }}>
        <option value="">Selecionar lote legado</option>
        {lotes?.map((lote) => <option key={lote.id} value={lote.id}>{lote.origem} — {lote.linhas} linhas — {new Date(lote.importadoEm).toLocaleString('pt-BR')}</option>)}
      </select></label>
      <label>Conteúdo do lote<select value={tipo} disabled={ocupado} onChange={(evento) => {
        const novo = tipoImportacaoSchema.parse(evento.target.value);
        setPrevia(null); setResultado(null); setTipo(novo);
      }}>{Object.entries(tipos).map(([valor, nome]) => <option key={valor} value={valor}>{nome}</option>)}</select></label>
    </div>
    {!lotes && !falhou && <p role="status">Carregando lotes...</p>}
    {lotes?.length === 0 && <p>Nenhum lote no Legado. Valide e guarde primeiro um arquivo no schema Legado.</p>}
    <button type="button" className="secundario" disabled={ocupado} onClick={() => setVersao((atual) => atual + 1)}>
      {falhou ? 'Tentar carregar lotes novamente' : 'Atualizar lotes e prévia'}
    </button>
    {previa && <>
      <h4>Prévia completa — primeiras {previa.amostra.length} de {previa.linhas} linhas</h4>
      <p className="aviso">Dados pessoais completos para conferência operacional. O acesso é auditado.</p>
      <div className="tabela"><table>
        <thead><tr><th scope="col">Linha</th>{previa.cabecalhos.map((campo, indice) => <th scope="col" key={indice}>{campo}</th>)}</tr></thead>
        <tbody>{previa.amostra.map((linha, indice) => <tr key={indice}><td>{indice + 2}</td>
          {previa.cabecalhos.map((_, coluna) => <td key={coluna}>{linha[coluna] || 'Não informado'}</td>)}</tr>)}</tbody>
      </table></div>
      <h4>Mapeamento das colunas</h4>
      <div className="grade-formulario">{previa.colunas.map((campo) => <label key={campo}>{campo}
        <select aria-label={`Coluna de origem para ${campo}`} value={mapeamento[campo] ?? ''} disabled={ocupado} onChange={(evento) => {
          const valor = evento.target.value;
          setMapeamento((atual) => ({ ...atual, [campo]: valor === '' ? null : Number(valor) }));
          setResultado(null);
        }}><option value="">Não importar este campo</option>
          {previa.cabecalhos.map((cabecalho, indice) => <option key={indice} value={indice}>{indice + 1} — {cabecalho}</option>)}
        </select>
      </label>)}</div>
      {naoUtilizadas.length > 0 && <p className="aviso">Não utilizadas na conversão: {naoUtilizadas.join(', ')}.
        Essas colunas permanecem no lote original do Legado.</p>}
      <p>Cadastro exige matrícula, nome e CPF válido. As 18 colunas cadastrais não substituem frequência,
        atos funcionais ou períodos contributivos. Nenhum dado ausente é inventado.</p>
      <div className="acoes">
        <button type="button" disabled={ocupado} onClick={() => void processar('validar')}>{ocupado ? 'Processando conversão...' : 'Validar conversão'}</button>
        <button type="button" disabled={ocupado || resultado?.relatorio.modo !== 'validacao' || resultado.relatorio.contagens.validos === 0}
          onClick={() => void processar('gravar')}>Aplicar no Núcleo</button>
      </div>
      {resultado && <>
        {renderRelatorio(resultado.relatorio)}
        <button type="button" className="secundario" disabled={ocupado} onClick={() => void baixarOcorrencias()}>Baixar todas as ocorrências em XLSX</button>
        <p>O download revalida sem gravar e inclui todas as ocorrências, com dados completos.
          Guarde o arquivo em local protegido; ele não substitui backup.</p>
        {resultado.relatorio.modo === 'gravacao' && <p role="status">{resultado.relatorio.loteExistente
          ? 'Este lote/mapeamento já foi aplicado; nenhuma alteração.'
          : 'Conversão aplicada. Consulte os servidores por matrícula e confira os dados antes de criar uma declaração.'}</p>}
        <p>Divergências preservadas devem ser conferidas pela referência e linha indicadas no relatório.
          O administrador pode revisar o cadastro local com motivo; não há substituição automática.</p>
      </>}
    </>}
  </section>;
}
