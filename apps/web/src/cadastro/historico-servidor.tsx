import { useEffect, useId, useState, type FormEvent } from 'react';
import { paginaHistoricoServidorSchema, resultadoHistoricoServidorSchema, salvarHistoricoSchema,
  consultaHistoricoServidorSchema, referenciaServidorSchema, revisoesHistoricoSchema, type RegistroHistorico } from '@sisdoc/contratos';
import { requisitar, validar, ErroApi } from '../infraestrutura/api';
import { TransferenciaHistorico } from './transferencia-historico';
import { dataTabela } from '../compartilhado/datas-tabela';

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
const rotulos: Record<keyof RegistroHistorico, string> = {
  grupo: 'Grupo', tipo: 'Tipo', situacao: 'Situação', inicio: 'Início', fim: 'Fim',
  aquisitivoInicio: 'Período aquisitivo — início', aquisitivoFim: 'Período aquisitivo — fim',
  diasInformados: 'Dias informados', especieLicenca: 'Espécie de licença', ato: 'Ato de referência',
  descricao: 'Descrição', efeitoTempo: 'Efeito no tempo', efeitoRemuneracao: 'Efeito na remuneração',
  competencia: 'Competência', competenciaOrigem: 'Competência de origem', pagamento: 'Data do pagamento',
  rubrica: 'Rubrica', natureza: 'Natureza', valor: 'Valor', folha: 'Modalidade da folha',
  origem: 'Origem', idOrigem: 'Identificador na origem', eventoId: 'Evento funcional relacionado', relacionadoId: 'Registro relacionado',
};
const valoresRotulados: Record<string, string> = {
  nao_informado: 'Não informado', sem_efeito: 'Sem efeito (informado)', com_efeito: 'Com efeito (informado)',
  abono_pecuniario: 'Abono pecuniário', abono_permanencia: 'Abono de permanência', lancamento: 'Lançamento financeiro',
};
const valorApresentado = (valor: unknown, campo?: string) => {
  if (typeof valor !== 'string') return String(valor ?? 'Não informado');
  if (['inicio', 'fim', 'aquisitivoInicio', 'aquisitivoFim', 'pagamento'].includes(campo ?? '')) return dataTabela(valor);
  if (['competencia', 'competenciaOrigem'].includes(campo ?? '') && /^\d{4}-\d{2}$/.test(valor)) {
    return `${valor.slice(5)}/${valor.slice(0, 4)}`;
  }
  return valoresRotulados[valor] ?? valor.replace(/_/g, ' ');
};
const dataRegistro = (registro: RegistroHistorico) => registro.competencia
  ? valorApresentado(registro.competencia, 'competencia')
  : registro.inicio ? dataTabela(registro.inicio) : 'Sem data';

export function HistoricoServidor({ pessoaId, vinculoId, csrf, podeEditar, onErro, onPendente, confirmarSaida }: {
  pessoaId: string; vinculoId: string; csrf: string; podeEditar: boolean;
  onErro: (erro: unknown) => void; onPendente: (valor: boolean) => void; confirmarSaida: () => boolean;
}) {
  const importacaoId = useId();
  const [pagina, setPagina] = useState<ReturnType<typeof paginaHistoricoServidorSchema.parse> | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [versao, setVersao] = useState(0);
  const [falhou, setFalhou] = useState(false);
  const [grupo, setGrupo] = useState<RegistroHistorico['grupo']>('funcional');
  const [importacaoAberta, setImportacaoAberta] = useState(false);
  const [registro, setRegistro] = useState<RegistroHistorico | null>(null);
  const [edicao, setEdicao] = useState<{ id: string; revisao: number } | null>(null);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [exportando, setExportando] = useState(false);
  const [filtros, setFiltros] = useState({ competenciaInicio: '', competenciaFim: '', inicio: '', fim: '', rubrica: '' });
  const [aplicados, setAplicados] = useState(filtros);
  const [opcoes, setOpcoes] = useState<{ historico: NonNullable<typeof pagina>['itens']; eventos: Array<{ id: string; texto: string }> } | null>(null);
  const [falhaOpcoes, setFalhaOpcoes] = useState(false);
  const [tentativaOpcoes, setTentativaOpcoes] = useState(0);
  const editando = registro !== null;
  useEffect(() => {
    if (!editando) return;
    let ativa = true; setOpcoes(null); setFalhaOpcoes(false);
    async function carregar() {
      const historico: NonNullable<typeof pagina>['itens'] = [];
      const eventos: Array<{ id: string; texto: string }> = [];
      let proximo: string | null = null;
      do {
        const dados: NonNullable<typeof pagina> = validar(paginaHistoricoServidorSchema, await requisitar(`servidores/${pessoaId}/historico?${new URLSearchParams({
          vinculoId, limite: '100', ...(proximo ? { cursor: proximo } : {}),
        })}`));
        if (!ativa) return;
        historico.push(...dados.itens); proximo = dados.proximoCursor;
      } while (proximo);
      do {
        const dados: ReturnType<typeof referenciaServidorSchema.parse> = validar(referenciaServidorSchema, await requisitar(`servidores/${pessoaId}/referencias?${new URLSearchParams({
          vinculoId, tipo: 'eventos_funcionais', limite: '50', ...(proximo ? { cursor: proximo } : {}),
        })}`));
        if (!ativa) return;
        eventos.push(...dados.registros.filter((e) => e.campos.removido_na_fonte_em === null).map((e) => ({
          id: e.id, texto: Object.entries(e.campos).filter(([chave]) => !chave.endsWith('_id') && chave !== 'removido_na_fonte_em')
            .map(([, valor]) => valor).filter(Boolean).join(' · '),
        })));
        proximo = dados.proximoCursor;
      } while (proximo);
      if (ativa) setOpcoes({ historico, eventos });
    }
    void carregar().catch((erro: unknown) => { if (ativa) { setFalhaOpcoes(true); onErro(erro); } });
    return () => { ativa = false; };
  }, [pessoaId, vinculoId, editando, versao, tentativaOpcoes, onErro]);
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
    requisitar(`servidores/${pessoaId}/historico?${new URLSearchParams({ vinculoId, grupo, limite: '50',
      ...Object.fromEntries(Object.entries(aplicados).filter(([, valor]) => valor !== '')), ...(cursor ? { cursor } : {}) })}`)
      .then((dados) => { if (ativa) setPagina(validar(paginaHistoricoServidorSchema, dados)); })
      .catch((erro: unknown) => { if (ativa) { setFalhou(true); onErro(erro); } });
    return () => { ativa = false; };
  }, [pessoaId, vinculoId, grupo, aplicados, cursor, versao, onErro]);
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
  const itens = pagina?.itens ?? [];
  const texto = (campo: keyof RegistroHistorico, rotulo: string, tipo = 'text') => (
    <label>{rotulo}<input type={tipo} value={String(registro?.[campo] ?? '')} maxLength={campo === 'descricao' ? 2000 : 200}
      onChange={(evento) => alterar({ [campo]: evento.target.value || null })} /></label>
  );
  return <section className="painel separado" aria-label="Histórico funcional e financeiro do vínculo">
    <h3>Histórico funcional e financeiro</h3>
    <p>Fatos, concessões e pagamentos são registros distintos. Saldos e efeitos são informados, sem cálculo de direitos ou folha. Alterações são locais e auditadas.</p>
    {podeEditar && <div className="acoes" role="group" aria-label="Ações do histórico">
      {!registro && <>
        <button type="button" className="secundario" onClick={() => { setRegistro(historicoVazio(grupo)); setEdicao(null); setMensagem(''); }}>
          Adicionar registro {grupo}
        </button>
        <button type="button" className="secundario" aria-expanded={importacaoAberta} aria-controls={importacaoId}
          onClick={() => setImportacaoAberta((aberta) => !aberta)}>Importar CSV/XLSX/XML</button>
      </>}
      <button type="button" className="secundario" disabled={exportando} onClick={() => void exportar()}>
        {exportando ? 'Exportando...' : 'Exportar histórico do vínculo (XLSX)'}
      </button>
    </div>}
    <div className="acoes" role="group" aria-label="Tipo de histórico">
      <button type="button" className="secundario" aria-pressed={grupo === 'funcional'} onClick={() => { if (fechar()) { setGrupo('funcional'); setCursor(undefined); } }}>Funcional</button>
      <button type="button" className="secundario" aria-pressed={grupo === 'financeiro'} onClick={() => { if (fechar()) { setGrupo('financeiro'); setCursor(undefined); } }}>Financeiro</button>
    </div>
    {podeEditar && !registro && importacaoAberta && <div id={importacaoId}>
      <TransferenciaHistorico key={grupo} pessoaId={pessoaId} vinculoId={vinculoId} grupo={grupo} csrf={csrf}
        onErro={onErro} onImportado={() => setVersao((v) => v + 1)} />
    </div>}
    <form aria-label="Filtrar histórico" onSubmit={(evento) => {
      evento.preventDefault();
      const consulta = consultaHistoricoServidorSchema.safeParse({ vinculoId, grupo, ...Object.fromEntries(Object.entries(filtros).filter(([, valor]) => valor !== '')) });
      if (!consulta.success) { onErro(new ErroApi(400, 'Confira as competências e o intervalo dos filtros.')); return; }
      if (registro && !fechar()) return;
      setAplicados({ ...filtros }); setCursor(undefined);
    }}>
      <h4>Filtrar histórico</h4>
      <p>Período: sobreposição dos fatos funcionais ou data de pagamento. Competências e rubrica aplicam-se aos lançamentos financeiros.</p>
      <div className="grade-formulario">
        {(['competenciaInicio', 'competenciaFim', 'inicio', 'fim', 'rubrica'] as const).map((campo) => <label key={campo}>
          {{ competenciaInicio: 'Competência inicial', competenciaFim: 'Competência final', inicio: 'Período inicial', fim: 'Período final', rubrica: 'Rubrica contém' }[campo]}
          <input type={campo.startsWith('competencia') ? 'month' : campo === 'rubrica' ? 'text' : 'date'} maxLength={200}
            value={filtros[campo]} onChange={(e) => setFiltros((atual) => ({ ...atual, [campo]: e.target.value }))} />
        </label>)}
      </div>
      <div className="acoes">
        <button type="submit" className="secundario">Aplicar filtro</button>
        <button type="button" className="secundario" onClick={() => {
          if (registro && !fechar()) return;
          const vazios = { competenciaInicio: '', competenciaFim: '', inicio: '', fim: '', rubrica: '' };
          setFiltros(vazios); setAplicados(vazios); setCursor(undefined);
        }}>Limpar filtro</button>
      </div>
    </form>
    {mensagem && <p role="status" className="aviso">{mensagem}</p>}
    {registro && podeEditar && <form onSubmit={salvar}><fieldset disabled={ocupado}>
      <h4>{edicao ? `Editar registro · revisão ${edicao.revisao}` : 'Novo registro'}</h4>
      <div className="grade-formulario">
        {grupo === 'funcional' && <label>Tipo<select value={registro.tipo} onChange={(e) => alterar({ tipo: e.target.value as RegistroHistorico['tipo'] })}>
          {Object.entries(nomes).filter(([tipo]) => tipo !== 'lancamento').map(([tipo, nome]) => <option key={tipo} value={tipo}>{nome}</option>)}</select></label>}
        <label>Situação<select value={registro.situacao} onChange={(e) => alterar({ situacao: e.target.value as RegistroHistorico['situacao'] })}>
          {(grupo === 'funcional' ? ['informado', 'concedido', 'gozado', 'cancelado'] : ['previsto', 'informado', 'pago', 'estornado']).map((situacao) => <option key={situacao} value={situacao}>{valorApresentado(situacao)}</option>)}</select></label>
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
        <label>Evento funcional relacionado<select disabled={!opcoes} value={registro.eventoId ?? ''} onChange={(e) => alterar({ eventoId: e.target.value || null })}>
          <option value="">Sem evento relacionado</option>
          {registro.eventoId && !opcoes?.eventos.some((e) => e.id === registro.eventoId) && <option value={registro.eventoId}>Evento já relacionado (consulte a rastreabilidade)</option>}
          {opcoes?.eventos.map((item) => <option key={item.id} value={item.id}>{item.texto || 'Evento sem descrição'} · {item.id}</option>)}
        </select></label>
        <label>Registro histórico relacionado<select disabled={!opcoes} value={registro.relacionadoId ?? ''} onChange={(e) => alterar({ relacionadoId: e.target.value || null })}>
          <option value="">Sem relacionamento</option>
          {registro.relacionadoId && !opcoes?.historico.some((e) => e.id === registro.relacionadoId) && <option value={registro.relacionadoId}>Registro já relacionado (consulte a rastreabilidade)</option>}
          {opcoes?.historico.filter((item) => item.id !== edicao?.id && (registro.situacao !== 'estornado' ||
            (item.registro.situacao === 'pago' && item.registro.natureza === registro.natureza && item.registro.valor === registro.valor &&
              !opcoes.historico.some((outro) => outro.id !== edicao?.id && outro.registro.situacao === 'estornado' && outro.registro.relacionadoId === item.id)))).map((item) =>
            <option key={item.id} value={item.id}>{nomes[item.registro.tipo]} — {item.registro.descricao.slice(0, 80)} — {dataRegistro(item.registro)} — {item.registro.valor ?? ''}</option>)}
        </select></label>
        {!opcoes && <p role="status">{falhaOpcoes ? 'Não foi possível carregar os relacionamentos.' : 'Carregando todos os relacionamentos do vínculo...'}</p>}
        {falhaOpcoes && <button type="button" className="secundario" onClick={() => setTentativaOpcoes((v) => v + 1)}>Tentar carregar relacionamentos</button>}
        {(['efeitoTempo', 'efeitoRemuneracao'] as const).map((campo) => <label key={campo}>{campo === 'efeitoTempo' ? 'Efeito informado no tempo' : 'Efeito informado na remuneração'}
          <select value={registro[campo]} onChange={(e) => alterar({ [campo]: e.target.value })}>
            <option value="nao_informado">Não informado</option><option value="sem_efeito">Sem efeito (informado)</option><option value="com_efeito">Com efeito (informado)</option>
          </select></label>)}
      </div>
      <label>Descrição<textarea required maxLength={2000} value={registro.descricao} onChange={(e) => alterar({ descricao: e.target.value })} /></label>
      <label>Motivo (mínimo 15 caracteres)<textarea required minLength={15} maxLength={2000} value={motivo} onChange={(e) => { setMotivo(e.target.value); onPendente(true); }} /></label>
      <div className="acoes"><button type="submit">{ocupado ? 'Salvando...' : 'Salvar histórico local'}</button><button type="button" className="secundario" onClick={fechar}>Cancelar edição</button></div>
    </fieldset></form>}
    {falhou ? <button type="button" className="secundario" onClick={() => setVersao((v) => v + 1)}>Tentar carregar histórico</button> :
      !pagina ? <p role="status">Carregando histórico...</p> : <>
        {!itens.length && <p>Nenhum registro deste grupo nesta página.</p>}
        {itens.map((item) => <details key={item.id} className="grupo-formulario"><summary>
          {nomes[item.registro.tipo]} · {dataRegistro(item.registro)} · {item.registro.situacao}
        </summary>
          <p>{item.registro.descricao}</p>
          <dl className="dados-servidor">{Object.entries(item.registro).filter(([, valor]) => valor !== null).map(([campo, valor]) =>
            <div key={campo}><dt>{rotulos[campo as keyof RegistroHistorico]}</dt><dd>{valorApresentado(valor, campo)}</dd></div>)}</dl>
          <p>Registro {item.id} · revisão {item.revisao} · atualizado em {dataTabela(item.atualizadoEm)}.</p>
          <RevisoesHistorico pessoaId={pessoaId} id={item.id} revisao={item.revisao} onErro={onErro} />
          {podeEditar && !registro && <button type="button" className="secundario" onClick={() => { setRegistro(item.registro); setEdicao({ id: item.id, revisao: item.revisao }); setMotivo(''); }}>Editar com motivo</button>}
        </details>)}
        <p>{pagina.totais.registros} registros em todo o vínculo com o filtro aplicado.</p>
        {grupo === 'financeiro' && <p>Totais brutos filtrados — proventos pagos: {pagina.totais.proventosPagos};
          descontos pagos: {pagina.totais.descontosPagos}; proventos estornados: {pagina.totais.proventosEstornados};
          descontos estornados: {pagina.totais.descontosEstornados}. Não representa saldo líquido nem direitos; estornos são exibidos separadamente.</p>}
        <div className="acoes"><button type="button" className="secundario" disabled={!cursor || !!registro} onClick={() => setCursor(undefined)}>Primeira página de histórico</button>
          <button type="button" className="secundario" disabled={!pagina.proximoCursor || !!registro} onClick={() => setCursor(pagina.proximoCursor ?? undefined)}>Próxima página de histórico</button></div>
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
    {aberto && (falhou ? <button type="button" className="secundario" onClick={() => setTentativa((valor) => valor + 1)}>Tentar carregar revisões</button> :
      !pagina ? <p role="status">Carregando revisões...</p> : <>
        {pagina.itens.map((item) => <details key={item.id}><summary>{dataTabela(item.em)} · {item.autor}</summary>
          <p>Motivo: {item.alteracao.motivo}</p>
          <dl>{Object.entries(item.alteracao.novo).filter(([campo, valor]) =>
            Reflect.get(item.alteracao.anterior ?? {}, campo) !== valor).map(([campo, valor]) =>
            <div key={campo}><dt>{rotulos[campo as keyof RegistroHistorico]}</dt><dd>{valorApresentado(Reflect.get(item.alteracao.anterior ?? {}, campo), campo)} → {valorApresentado(valor, campo)}</dd></div>)}</dl>
        </details>)}
        <div className="acoes"><button type="button" className="secundario" disabled={!cursor} onClick={() => setCursor(undefined)}>Revisões recentes</button>
          <button type="button" className="secundario" disabled={!pagina.proximoCursor} onClick={() => setCursor(pagina.proximoCursor ?? undefined)}>Revisões anteriores</button></div>
      </>)}
  </section>;
}
