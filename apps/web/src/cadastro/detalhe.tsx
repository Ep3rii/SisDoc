import { ROTULOS_DTC, type FichaServidor, type TipoDtc } from '@sisdoc/contratos';
import { useEffect, useState } from 'react';
import { dataTabela } from '../compartilhado/datas-tabela';
import { CalculoDof } from '../dof/calculo-dof';
import type { Servidor } from '../dtc/contexto';
import { api } from '../infraestrutura/api';
import type { Props, ProtecaoEdicao } from './contexto';
import { DocumentosDaPessoa } from './documentos-servidor';
import { Eventos } from './eventos';
import { HistoricoServidor } from './historico-servidor';
import { Referencias } from './referencias';

export function Detalhe({ pessoaId, vinculoInicial, csrf, podeSalvar, podeEditarCadastro, onCadastroAtualizado,
  onFechar, onNovaDtc, onErro, onLimpar, onPendente, confirmarSaida }: Props & ProtecaoEdicao & {
  pessoaId: string; vinculoInicial: string | null; csrf: string; podeSalvar: boolean; podeEditarCadastro: boolean;
  onCadastroAtualizado: () => void; onFechar: () => void; onNovaDtc: (tipo: TipoDtc, servidor: Servidor) => void;
}) {
  const [detalhe, setDetalhe] = useState<FichaServidor | null>(null);
  const [referenciaId, setReferenciaId] = useState<string | null>(null);
  const [eventosId, setEventosId] = useState<string | null>(null);
  const [vinculoDtc, setVinculoDtc] = useState('');
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const [historicoId, setHistoricoId] = useState('');
  const [vinculoCalculo, setVinculoCalculo] = useState<{ id: string; matricula: string; admissao: string } | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [versao, setVersao] = useState(0);
  const trocarContexto = (acao: () => void) => {
    if (confirmarSaida()) { onPendente(false); acao(); }
  };
  useEffect(() => {
    let ativa = true;
    setDetalhe(null); setFalhou(false);
    async function carregar() {
      const ficha = await api.fichaServidor(pessoaId);
      // A ficha apresenta todos os vínculos; a API mantém páginas limitadas.
      while (ficha.proximoCursor && ativa) {
        const pagina = await api.servidor(pessoaId, ficha.proximoCursor);
        ficha.vinculos.push(...pagina.vinculos);
        ficha.proximoCursor = pagina.proximoCursor;
      }
      if (!ativa) return;
      const selecionado = ficha.vinculos.find((item) => item.id === vinculoInicial)
        ?? (ficha.vinculos.length === 1 ? ficha.vinculos[0] : undefined);
      setVinculoDtc(selecionado?.id ?? '');
      setHistoricoId(selecionado?.id ?? ficha.vinculos[0]?.id ?? '');
      setDetalhe(ficha);
    }
    carregar().catch((erro: unknown) => { if (ativa) { setFalhou(true); onErro(erro); } });
    return () => { ativa = false; };
  }, [pessoaId, vinculoInicial, versao, onErro]);
  if (vinculoCalculo && detalhe) return <CalculoDof key={vinculoCalculo.id} pessoaId={pessoaId} vinculoId={vinculoCalculo.id}
    nome={detalhe.pessoa.nome} matricula={vinculoCalculo.matricula} admissao={vinculoCalculo.admissao}
    csrf={csrf} podeSalvar={podeSalvar} onFechar={() => setVinculoCalculo(null)} onErro={onErro} onLimpar={onLimpar}
    onPendente={onPendente} confirmarSaida={confirmarSaida} />;
  const selecionadoDtc = detalhe?.vinculos.find((item) => item.id === vinculoDtc);
  const opcoes = detalhe?.vinculos.map((item) => <option key={item.id} value={item.id}>{item.matricula} — {item.sistemaOrigem}</option>);
  return <section className="painel ficha-servidor" aria-labelledby="detalhe-titulo">
    <div className="ficha-cabecalho">
      <div><h2 id="detalhe-titulo">Ficha do servidor</h2>
        {detalhe && <><h3>{detalhe.pessoa.nome}</h3>
          <p>Matrícula: {detalhe.vinculos.find((item) => item.id === vinculoInicial)?.matricula
            ?? (detalhe.vinculos.map((item) => item.matricula).join(', ') || 'Não informada')} · {detalhe.totalVinculos} vínculos</p></>}
      </div>
      <button type="button" className="secundario" onClick={() => trocarContexto(onFechar)}>Trocar servidor</button>
    </div>
    {falhou ? <button type="button" className="secundario" onClick={() => { onLimpar(); setVersao((v) => v + 1); }}>Tentar carregar ficha novamente</button>
      : !detalhe ? <p role="status">Carregando ficha...</p> : <>
        <section aria-label="Vínculos">
          {detalhe.vinculos.length === 0 && <p>Nenhum vínculo cadastrado.</p>}
          {[...detalhe.vinculos].sort((a, b) => Number(b.id === vinculoInicial) - Number(a.id === vinculoInicial)).map((vinculo, indice) => {
            const admissao = vinculo.admissao;
            return <article className={`ficha-vinculo${vinculo.id === vinculoInicial ? ' selecionado' : ''}`} key={vinculo.id}
              aria-label={`Vínculo da matrícula ${vinculo.matricula}`}>
              <div><h3>{vinculo.matricula} — {[vinculo.cargo, vinculo.referencia].filter(Boolean).join(' / ') || 'Cargo não informado'}</h3>
                <p>{[vinculo.orgao, vinculo.setor].filter(Boolean).join(' / ') || 'Órgão / setor não informado'}</p>
                <p>Admissão: {admissao ? dataTabela(admissao) : 'Não informada'} · Desligamento: {vinculo.desligamento ? dataTabela(vinculo.desligamento) : 'Não informado'}</p>
                <p>{vinculo.sistemaOrigem} · {vinculo.regimeJuridico ?? 'Regime não informado'}
                  {vinculo.removidoNaFonte && ' · Removido na fonte'}</p>
                {(vinculo.classe || vinculo.nivel) && <p>Classe / nível: {[vinculo.classe, vinculo.nivel].filter(Boolean).join(' / ')}</p>}
                {vinculo.matriculaAnteriorId && <p>Vínculo anterior: {detalhe.vinculos.find((item) => item.id === vinculo.matriculaAnteriorId)?.matricula ?? 'Não encontrado'}</p>}
              </div>
              <button type="button" className={indice === 0 ? undefined : 'secundario'} disabled={!admissao} title={!admissao ? 'Admissão ausente na fonte' : undefined}
                onClick={() => { if (admissao) trocarContexto(() => { onLimpar(); setVinculoCalculo({ id: vinculo.id, matricula: vinculo.matricula, admissao }); }); }}>
                Calcular DOF <span className="sr-only">da matrícula {vinculo.matricula}</span>
              </button>
            </article>;
          })}
        </section>
        <section className="separado" aria-labelledby="outro-documento"><h3 id="outro-documento">Emitir outro documento</h3>
          {podeSalvar ? <>
            {detalhe.vinculos.length > 1 && <label>Vínculo para DTC<select value={vinculoDtc} onChange={(e) => trocarContexto(() => setVinculoDtc(e.target.value))}>
              <option value="">Escolha o vínculo</option>{opcoes}
            </select></label>}
            <div className="acoes">{(['DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS'] as const).map((tipo) =>
              <button type="button" className="secundario" key={tipo} disabled={!selecionadoDtc} onClick={() => {
                if (selecionadoDtc) trocarContexto(() => onNovaDtc(tipo, {
                  pessoaId, vinculoId: selecionadoDtc.id, nome: detalhe.pessoa.nome, matricula: selecionadoDtc.matricula,
                }));
              }}>{tipo === 'DTC_IPAM' ? 'Nova DTC IPAM' : ROTULOS_DTC[tipo]}</button>)}</div>
          </> : <p>Seu perfil permite consultar documentos existentes, mas não criar novos.</p>}
        </section>
        <DocumentosDaPessoa pessoaId={pessoaId} onErro={onErro} />
        <section className="separado">
          <button type="button" className="secundario" aria-expanded={historicoAberto} aria-controls="historico-da-ficha"
            onClick={() => trocarContexto(() => setHistoricoAberto((v) => !v))}>
            Histórico funcional ({detalhe.totalHistoricoFuncional} registros)
          </button>
          {historicoAberto && <div id="historico-da-ficha">
            <p>Contagem total dos registros funcionais do Núcleo. Consulta abaixo por vínculo; eventos da fonte ficam nas referências cadastrais.</p>
            <label>Vínculo do histórico<select value={historicoId} onChange={(e) => trocarContexto(() => setHistoricoId(e.target.value))}>{opcoes}</select></label>
            {historicoId && <HistoricoServidor key={historicoId} pessoaId={pessoaId} vinculoId={historicoId} csrf={csrf}
              podeEditar={podeEditarCadastro} onErro={onErro} onPendente={onPendente} confirmarSaida={confirmarSaida} />}
          </div>}
        </section>
        <section className="separado" aria-label="Referências e cadastro">
          <h3>Referências e cadastro local</h3>
          <label>Dados de referência do vínculo<select value={referenciaId ?? ''} onChange={(e) => trocarContexto(() => setReferenciaId(e.target.value || null))}>
            <option value="">Selecionar para consultar dados completos</option>{opcoes}
          </select></label>
          {referenciaId && <Referencias key={referenciaId} pessoaId={pessoaId} vinculoId={referenciaId} csrf={csrf}
            podeEditarCadastro={podeEditarCadastro} onErro={onErro} onPendente={onPendente} confirmarSaida={confirmarSaida}
            onAtualizado={() => { setVersao((v) => v + 1); onCadastroAtualizado(); }} />}
          <label>Eventos da fonte<select value={eventosId ?? ''} onChange={(e) => trocarContexto(() => setEventosId(e.target.value || null))}>
            <option value="">Selecionar vínculo</option>{opcoes}
          </select></label>
          {eventosId && <Eventos key={eventosId} pessoaId={pessoaId} vinculoId={eventosId} onErro={onErro} onLimpar={onLimpar} />}
        </section>
      </>}
  </section>;
}
