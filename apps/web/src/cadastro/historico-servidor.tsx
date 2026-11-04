import { useEffect, useState, type FormEvent } from 'react';
import { paginaHistoricoServidorSchema, resultadoHistoricoServidorSchema, salvarHistoricoSchema,
  somarValoresMonetarios, revisoesHistoricoSchema, type RegistroHistorico } from '@sisdoc/contratos';
import { requisitar, validar, ErroApi } from '../infraestrutura/api';
import { TransferenciaHistorico } from './transferencia-historico';

export const historicoVazio = (grupo: RegistroHistorico['grupo']): RegistroHistorico => ({
  grupo, tipo: grupo === 'funcional' ? 'ferias' : 'lancamento', situacao: 'informado',
  inicio: null, fim: null, aquisitivoInicio: null, aquisitivoFim: null, diasInformados: null,
  especieLicenca: null, ato: null, descricao: '', efeitoTempo: 'nao_informado', efeitoRemuneracao: 'nao_informado',
  competencia: null, competenciaOrigem: null, pagamento: null, rubrica: null,
  natureza: grupo === 'financeiro' ? 'provento' : null, valor: null,
  folha: grupo === 'financeiro' ? 'normal' : null, origem: 'manual-local', idOrigem: null, eventoId: null, relacionadoId: null,
});
const nomes: Record<RegistroHistorico['tipo'], string> = {
  ferias: 'Férias', licenca: 'Licença', abono_pecuniario: 'Abono pecuniário',
  abono_permanencia: 'Abono de permanência', outro: 'Outro fato', lancamento: 'Lançamento financeiro',
};

export function HistoricoServidor({ pessoaId, vinculoId, csrf, podeEditar, onErro, onPendente, confirmarSaida }: {
  pessoaId: string; vinculoId: string; csrf: string; podeEditar: boolean;
  onErro: (erro: unknown) => void; onPendente: (valor: boolean) => void; confirmarSaida: () => boolean;
}) {
  const [pagina, setPagina] = useState<ReturnType<typeof paginaHistoricoServidorSchema.parse> | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [versao, setVersao] = useState(0);
  const [falhou, setFalhou] = useState(false);
  const [grupo, setGrupo] = useState<RegistroHistorico['grupo']>('funcional');
  const [filtro, setFiltro] = useState('');
  const [registro, setRegistro] = useState<RegistroHistorico | null>(null);
  const [edicao, setEdicao] = useState<{ id: string; revisao: number } | null>(null);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [exportando, setExportando] = useState(false);
  async function exportar() {
    setExportando(true);
    try {
      const resposta = await fetch(`/api/v1/servidores/${pessoaId}/historico/exportar`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ vinculoId }),
      });
      if (!resposta.ok) {
        const erro: unknown = await resposta.json();
        throw new ErroApi(resposta.status, typeof erro === 'object' && erro !== null && 'detail' in erro && typeof erro.detail === 'string' ? erro.detail : 'Falha ao exportar histórico.');
      }
      const url = URL.createObjectURL(await resposta.blob());
      const link = document.createElement('a'); link.href = url; link.download = 'historico-vinculo.xlsx'; link.click(); URL.revokeObjectURL(url);
    } catch (erro: unknown) { onErro(erro); }
    finally { setExportando(false); }
  }
  useEffect(() => {
    let ativa = true; setPagina(null); setFalhou(false);
    requisitar(`servidores/${pessoaId}/historico?${new URLSearchParams({ vinculoId, limite: '50', ...(cursor ? { cursor } : {}) })}`)
      .then((dados) => { if (ativa) setPagina(validar(paginaHistoricoServidorSchema, dados)); })
      .catch((erro: unknown) => { if (ativa) { setFalhou(true); onErro(erro); } });
    return () => { ativa = false; };
  }, [pessoaId, vinculoId, cursor, versao, onErro]);
  function alterar(mudanca: Partial<RegistroHistorico>) { setRegistro((atual) => atual ? { ...atual, ...mudanca } : atual); onPendente(true); }
  function fechar(): boolean {
    if (!confirmarSaida()) return false;
    setRegistro(null); setEdicao(null); setMotivo(''); onPendente(false);
    return true;
  }
  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    const dados = salvarHistoricoSchema.safeParse({ vinculoId, registro, motivo, ...(edicao ? { revisao: edicao.revisao } : {}) });
    if (!dados.success) {
      onErro(new ErroApi(400, dados.error.issues.map((item) => item.message).join(' '))); return;
    }
    setOcupado(true);
    try {
      const resultado = validar(resultadoHistoricoServidorSchema, await requisitar(`servidores/${pessoaId}/historico${edicao ? `/${edicao.id}` : ''}`,
        edicao ? 'PATCH' : 'POST', dados.data, csrf));
      setMensagem(`Histórico salvo na revisão ${resultado.item.revisao}. ${resultado.avisos.join(' ')}`);
      setRegistro(null); setEdicao(null); setMotivo(''); onPendente(false); setVersao((v) => v + 1);
    } catch (erro: unknown) { onErro(erro); }
    finally { setOcupado(false); }
  }
  const itens = pagina?.itens.filter((item) => item.registro.grupo === grupo &&
    `${item.registro.descricao} ${item.registro.competencia ?? ''} ${item.registro.rubrica ?? ''} ${nomes[item.registro.tipo]} ${item.registro.origem}`
      .toLocaleLowerCase('pt-BR').includes(filtro.toLocaleLowerCase('pt-BR'))) ?? [];
  const texto = (campo: keyof RegistroHistorico, rotulo: string, tipo = 'text') => (
    <label>{rotulo}<input type={tipo} value={String(registro?.[campo] ?? '')} maxLength={campo === 'descricao' ? 2000 : 200}
      onChange={(evento) => alterar({ [campo]: evento.target.value || null })} /></label>
  );
  return <section className="painel separado" aria-label="Histórico funcional e financeiro do vínculo">
    <h3>Histórico funcional e financeiro</h3>
    <p>Fatos, concessões e pagamentos são registros distintos. Saldos e efeitos são informados, sem cálculo de direitos ou folha. Alterações são locais e auditadas.</p>
    {podeEditar && <button type="button" className="secundario" disabled={exportando} onClick={() => void exportar()}>
      {exportando ? 'Exportando...' : 'Exportar histórico do vínculo (XLSX)'}
    </button>}
    <div className="acoes" role="group" aria-label="Tipo de histórico">
      <button type="button" className="secundario" aria-pressed={grupo === 'funcional'} onClick={() => { if (fechar()) setGrupo('funcional'); }}>Funcional</button>
      <button type="button" className="secundario" aria-pressed={grupo === 'financeiro'} onClick={() => { if (fechar()) setGrupo('financeiro'); }}>Financeiro</button>
    </div>
    <label>Filtrar registros carregados (descrição, competência, rubrica, origem)<input value={filtro} onChange={(e) => setFiltro(e.target.value)} /></label>
    {podeEditar && !registro && <button type="button" onClick={() => { setRegistro(historicoVazio(grupo)); setEdicao(null); setMensagem(''); }}>Adicionar registro {grupo}</button>}
    {podeEditar && !registro && <TransferenciaHistorico pessoaId={pessoaId} vinculoId={vinculoId} csrf={csrf}
      onErro={onErro} onImportado={() => setVersao((v) => v + 1)} />}
    {mensagem && <p role="status" className="aviso">{mensagem}</p>}
    {registro && podeEditar && <form onSubmit={salvar}><fieldset disabled={ocupado}>
      <h4>{edicao ? `Editar registro · revisão ${edicao.revisao}` : 'Novo registro'}</h4>
      <div className="grade-formulario">
        {grupo === 'funcional' && <label>Tipo<select value={registro.tipo} onChange={(e) => alterar({ tipo: e.target.value as RegistroHistorico['tipo'] })}>
          {Object.entries(nomes).filter(([tipo]) => tipo !== 'lancamento').map(([tipo, nome]) => <option key={tipo} value={tipo}>{nome}</option>)}</select></label>}
        <label>Situação<select value={registro.situacao} onChange={(e) => alterar({ situacao: e.target.value as RegistroHistorico['situacao'] })}>
          {(grupo === 'funcional' ? ['informado', 'concedido', 'gozado', 'cancelado'] : ['previsto', 'informado', 'pago', 'estornado']).map((situacao) => <option key={situacao} value={situacao}>{situacao}</option>)}</select></label>
        {grupo === 'funcional' ? <>
          {texto('inicio', 'Início', 'date')}{texto('fim', 'Fim', 'date')}
          {texto('aquisitivoInicio', 'Período aquisitivo — início', 'date')}{texto('aquisitivoFim', 'Período aquisitivo — fim', 'date')}
          <label>Dias/saldo informado<input type="number" min={0} max={3660} value={registro.diasInformados ?? ''} onChange={(e) => alterar({ diasInformados: e.target.value ? Number(e.target.value) : null })} /></label>
          {texto('especieLicenca', 'Espécie de licença')}
        </> : <>
          {texto('competencia', 'Competência de pagamento', 'month')}{texto('competenciaOrigem', 'Competência de origem (retroativos)', 'month')}
          {texto('pagamento', 'Data do pagamento', 'date')}{texto('rubrica', 'Código e descrição da rubrica')}
          <label>Natureza<select value={registro.natureza ?? ''} onChange={(e) => alterar({ natureza: e.target.value as 'provento' | 'desconto' })}>
            <option value="provento">Provento</option><option value="desconto">Desconto</option></select></label>
          <label>Valor (ex.: 1234.56)<input inputMode="decimal" value={registro.valor ?? ''} onChange={(e) => alterar({ valor: e.target.value || null })} /></label>
          <label>Modalidade da folha<select value={registro.folha ?? ''} onChange={(e) => alterar({ folha: e.target.value as RegistroHistorico['folha'] })}>
            <option value="normal">Normal</option><option value="complementar">Complementar</option><option value="retroativa">Retroativa</option></select></label>
        </>}
        {texto('ato', 'Ato/concessão de referência')}{texto('origem', 'Origem técnica')}{texto('idOrigem', 'Identificador na origem')}
        {texto('eventoId', 'UUID de evento funcional existente (opcional)')}
        <label>Registro histórico relacionado<select value={registro.relacionadoId ?? ''} onChange={(e) => alterar({ relacionadoId: e.target.value || null })}>
          <option value="">Sem relacionamento</option>{pagina?.itens.filter((item) => item.id !== edicao?.id).map((item) =>
            <option key={item.id} value={item.id}>{nomes[item.registro.tipo]} — {item.registro.descricao.slice(0, 80)} — {item.id}</option>)}
        </select></label>
        {(['efeitoTempo', 'efeitoRemuneracao'] as const).map((campo) => <label key={campo}>{campo === 'efeitoTempo' ? 'Efeito informado no tempo' : 'Efeito informado na remuneração'}
          <select value={registro[campo]} onChange={(e) => alterar({ [campo]: e.target.value })}>
            <option value="nao_informado">Não informado</option><option value="sem_efeito">Sem efeito (informado)</option><option value="com_efeito">Com efeito (informado)</option>
          </select></label>)}
      </div>
      <label>Descrição<textarea required maxLength={2000} value={registro.descricao} onChange={(e) => alterar({ descricao: e.target.value })} /></label>
      <label>Motivo (mínimo 15 caracteres)<textarea required minLength={15} maxLength={2000} value={motivo} onChange={(e) => { setMotivo(e.target.value); onPendente(true); }} /></label>
      <div className="acoes"><button type="submit">{ocupado ? 'Salvando...' : 'Salvar histórico local'}</button><button type="button" className="secundario" onClick={fechar}>Cancelar edição</button></div>
    </fieldset></form>}
    {falhou ? <button type="button" onClick={() => setVersao((v) => v + 1)}>Tentar carregar histórico</button> :
      !pagina ? <p role="status">Carregando histórico...</p> : <>
        {!itens.length && <p>Nenhum registro deste grupo nesta página.</p>}
        {itens.map((item) => <details key={item.id} className="grupo-formulario"><summary>
          {nomes[item.registro.tipo]} · {item.registro.competencia ?? item.registro.inicio ?? 'Sem data'} · {item.registro.situacao}
        </summary>
          <p>{item.registro.descricao}</p>
          <dl className="dados-servidor">{Object.entries(item.registro).filter(([, valor]) => valor !== null).map(([campo, valor]) =>
            <div key={campo}><dt>{campo}</dt><dd>{String(valor)}</dd></div>)}</dl>
          <p>Registro {item.id} · revisão {item.revisao} · atualizado em {new Date(item.atualizadoEm).toLocaleString('pt-BR')}.</p>
          <RevisoesHistorico pessoaId={pessoaId} id={item.id} revisao={item.revisao} onErro={onErro} />
          {podeEditar && !registro && <button type="button" className="secundario" onClick={() => { setRegistro(item.registro); setEdicao({ id: item.id, revisao: item.revisao }); setMotivo(''); }}>Editar com motivo</button>}
        </details>)}
        {grupo === 'financeiro' && <p>Subtotais brutos dos pagamentos visíveis nesta página — proventos: {somarValoresMonetarios(itens.flatMap((i) => i.registro.situacao === 'pago' && i.registro.natureza === 'provento' && i.registro.valor ? [i.registro.valor] : []))};
          descontos: {somarValoresMonetarios(itens.flatMap((i) => i.registro.situacao === 'pago' && i.registro.natureza === 'desconto' && i.registro.valor ? [i.registro.valor] : []))}.
          Não representa saldo líquido, direitos ou total do histórico; estornos são registros separados.</p>}
        <div className="acoes"><button type="button" disabled={!cursor || !!registro} onClick={() => setCursor(undefined)}>Primeira página de histórico</button>
          <button type="button" disabled={!pagina.proximoCursor || !!registro} onClick={() => setCursor(pagina.proximoCursor ?? undefined)}>Próxima página de histórico</button></div>
      </>}
  </section>;
}

function RevisoesHistorico({ pessoaId, id, revisao, onErro }: {
  pessoaId: string; id: string; revisao: number; onErro: (erro: unknown) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>();
  const [pagina, setPagina] = useState<ReturnType<typeof revisoesHistoricoSchema.parse> | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    if (!aberto) return;
    let ativa = true; setPagina(null); setFalhou(false);
    requisitar(`servidores/${pessoaId}/historico/${id}/revisoes?${new URLSearchParams({ limite: '10', ...(cursor ? { cursor } : {}) })}`)
      .then((dados) => { if (ativa) setPagina(validar(revisoesHistoricoSchema, dados)); })
      .catch((erro: unknown) => { if (ativa) { setFalhou(true); onErro(erro); } });
    return () => { ativa = false; };
  }, [pessoaId, id, revisao, aberto, cursor, tentativa, onErro]);
  return <section aria-label="Revisões do registro histórico">
    <button type="button" className="secundario" aria-expanded={aberto} onClick={() => setAberto((valor) => !valor)}>
      {aberto ? 'Ocultar revisões' : 'Consultar revisões e motivos'}
    </button>
    {aberto && (falhou ? <button type="button" onClick={() => setTentativa((valor) => valor + 1)}>Tentar carregar revisões</button> :
      !pagina ? <p role="status">Carregando revisões...</p> : <>
        {pagina.itens.map((item) => <details key={item.id}><summary>{new Date(item.em).toLocaleString('pt-BR')} · {item.autor}</summary>
          <p>Motivo: {item.alteracao.motivo}</p>
          <dl>{Object.entries(item.alteracao.novo).filter(([campo, valor]) =>
            Reflect.get(item.alteracao.anterior ?? {}, campo) !== valor).map(([campo, valor]) =>
            <div key={campo}><dt>{campo}</dt><dd>{String(Reflect.get(item.alteracao.anterior ?? {}, campo) ?? 'Não informado')} → {String(valor ?? 'Não informado')}</dd></div>)}</dl>
        </details>)}
        <div className="acoes"><button type="button" disabled={!cursor} onClick={() => setCursor(undefined)}>Revisões recentes</button>
          <button type="button" disabled={!pagina.proximoCursor} onClick={() => setCursor(pagina.proximoCursor ?? undefined)}>Revisões anteriores</button></div>
      </>)}
  </section>;
}
