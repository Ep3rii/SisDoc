import {
  MAXIMO_CARGOS_COMISSIONADOS,
  MAXIMO_PERIODOS_DTC,
  ROTULOS_CATEGORIA_INSS,
  ROTULOS_DTC,
  validarConteudoDtc,
  type CargoComissionado,
  type CategoriaFuncionalInss,
  type ConteudoDtc,
  type DadosInss,
  type DocumentoDtc,
  type PeriodoDtc,
  type TipoDtc
} from '@sisdoc/contratos';
import { useState, type FormEvent } from 'react';
import { api } from '../infraestrutura/api';
import { anosDoPeriodo } from './anos-dtc';
import { cargoVazio, DESCRICOES, inssPadrao, periodoVazio, Servidor, textoOuNulo } from './contexto';

/** Edita conteúdo DTC local sem substituir a prévia da revisão salva antes da gravação. */
export function Editor({ tipo, inicial, documento, servidor, csrf, onSalvo, onCancelar, onErro, onLimpar, onPendente }: {
  tipo: TipoDtc;
  inicial: ConteudoDtc;
  documento: DocumentoDtc | null;
  servidor: Servidor;
  csrf: string;
  onSalvo: (documento: DocumentoDtc) => void;
  onCancelar: () => void;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
  onPendente: (valor: boolean) => void;
}) {
  const [conteudo, setConteudo] = useState<ConteudoDtc>(inicial);
  const [motivo, setMotivo] = useState('');
  const [confirmacao, setConfirmacao] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const problemas = validarConteudoDtc(tipo, conteudo);

  /** Atualiza conteúdo local e ativa a proteção global contra perda de edição. */
  function alterar(novo: ConteudoDtc) {
    setConteudo(novo);
    onPendente(true);
  }
  /** Recalcula a grade anual após mudar datas, preservando lançamentos dos anos mantidos. */
  function alterarPeriodo(indice: number, mudanca: Partial<PeriodoDtc>) {
    const periodos = conteudo.periodos.map((periodo, posicao) => {
      if (posicao !== indice) return periodo;
      const atualizado = { ...periodo, ...mudanca };
      return { ...atualizado, anos: anosDoPeriodo(atualizado.inicio, atualizado.fim, atualizado.anos) };
    });
    alterar({ ...conteudo, periodos });
  }
  /** Limita deduções anuais e mantém o limite próprio das incorporações provisórias. */
  function alterarAno(indice: number, ano: number, campo: 'faltas' | 'ts' | 'pf' | 'ip' | 'outros' | 'pb' | 'pv' | 'licencaPremio', valor: string) {
    const limite = ['pb', 'pv', 'licencaPremio'].includes(campo) ? Number.MAX_SAFE_INTEGER : 366;
    const numero = Math.max(0, Math.min(limite, Number.parseInt(valor, 10) || 0));
    alterarPeriodo(indice, {
      anos: conteudo.periodos[indice].anos.map((linha) => linha.ano === ano ? { ...linha, [campo]: numero } : linha),
    });
  }
  /** Altera somente o cargo escolhido sem compartilhar objetos entre formulários. */
  function alterarCargo(indice: number, mudanca: Partial<CargoComissionado>) {
    alterar({ ...conteudo, cargos: conteudo.cargos.map((cargo, posicao) => posicao === indice ? { ...cargo, ...mudanca } : cargo) });
  }
  /** Atualiza informações complementares INSS preservando os outros grupos do conteúdo. */
  function alterarInss(mudanca: Partial<DadosInss>) {
    alterar({ ...conteudo, inss: { ...(conteudo.inss ?? inssPadrao()), ...mudanca } });
  }

  /** Cria ou revisa rascunho usando CSRF; só libera a edição pendente após confirmação da API. */
  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    try {
      onLimpar();
      setOcupado(true);
      const salvo = documento
        ? await api.atualizarDtc(csrf, documento.id, { ...conteudo, revisao: documento.revisao, motivo })
        : await api.criarDtc(csrf, { ...conteudo, tipo, pessoaId: servidor.pessoaId, vinculoId: servidor.vinculoId, confirmacaoDados: true });
      onPendente(false);
      onSalvo(salvo);
    } catch (erro) {
      onErro(erro);
    } finally {
      setOcupado(false);
    }
  }

  const inss = conteudo.inss;
  return (
    <form className="editor-dof" onSubmit={(evento) => void salvar(evento)} aria-label={`Editor da ${ROTULOS_DTC[tipo]}`}
      onInvalidCapture={(evento) => {
        if (evento.target instanceof HTMLElement) {
          const grupo = evento.target.closest('details');
          if (grupo) grupo.open = true;
        }
      }}>
      <p className="identificador-documento">{documento ? `Rascunho · revisão ${documento.revisao}` : 'Novo rascunho'}</p>
      <h2>{ROTULOS_DTC[tipo]} — {servidor.nome}</h2>
      <p>Matrícula {servidor.matricula}. {DESCRICOES[tipo]}</p>
      <fieldset>
        <legend><strong>Períodos ({conteudo.periodos.length} de {MAXIMO_PERIODOS_DTC})</strong></legend>
        {conteudo.periodos.map((periodo, indice) => (
          <details className="grupo-formulario" key={indice} open>
            <summary>{indice + 1}º período — datas, deduções e incorporações</summary>
            <div className="grade-busca">
              <label>Início<input type="date" required value={periodo.inicio}
                onChange={(evento) => alterarPeriodo(indice, { inicio: evento.target.value })} /></label>
              <label>Fim<input type="date" required value={periodo.fim}
                onChange={(evento) => alterarPeriodo(indice, { fim: evento.target.value })} /></label>
              {tipo === 'DTC_INSS' && <>
                <label>Cargo/função<input value={periodo.cargo ?? ''} maxLength={200} required
                  onChange={(evento) => alterarPeriodo(indice, { cargo: evento.target.value })} /></label>
                <label>Categoria funcional<select value={periodo.categoria ?? 'efetivo'}
                  onChange={(evento) => alterarPeriodo(indice, { categoria: evento.target.value as CategoriaFuncionalInss })}>
                  {Object.entries(ROTULOS_CATEGORIA_INSS).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
                </select></label>
              </>}
            </div>
            {periodo.anos.length > 0 && <div className="tabela"><table>
              <caption className="sr-only">Ocorrências anuais do {indice + 1}º período</caption>
              <thead><tr><th scope="col">Ano</th><th scope="col">Faltas</th><th scope="col">TS</th><th scope="col">PF</th>
                <th scope="col">IP</th><th scope="col">Outros</th><th scope="col">PB *</th>
                <th scope="col">PV *</th><th scope="col">Licença-prêmio *</th></tr></thead>
              <tbody>{periodo.anos.map((linha) => (
                <tr key={linha.ano}><th scope="row">{linha.ano}{linha.abrangencia === 'intervalo_declarado' ? ' (parcial)' : ''}</th>
                  {(['faltas', 'ts', 'pf', 'ip', 'outros', 'pb', 'pv', 'licencaPremio'] as const).map((campo) => (
                    <td key={campo}><label className="sr-only" htmlFor={`p${indice}-${linha.ano}-${campo}`}>
                      {campo === 'licencaPremio' ? 'Licença-prêmio' : campo.toUpperCase()} em {linha.ano}</label>
                      <input id={`p${indice}-${linha.ano}-${campo}`} className="dias-anuais" type="number" min={0}
                        max={['pb', 'pv', 'licencaPremio'].includes(campo) ? Number.MAX_SAFE_INTEGER : 366}
                        value={linha[campo]} onChange={(evento) => alterarAno(indice, linha.ano, campo, evento.target.value)} /></td>
                  ))}
                </tr>
              ))}</tbody>
            </table><p>* Incorporações provisórias; informe os dias anuais conforme documentação conferida.</p></div>}
            {conteudo.periodos.length > 1 && <button type="button" className="perigo"
              onClick={() => alterar({ ...conteudo, periodos: conteudo.periodos.filter((_, posicao) => posicao !== indice) })}>
              Remover {indice + 1}º período</button>}
          </details>
        ))}
        {conteudo.periodos.length < MAXIMO_PERIODOS_DTC && <div className="acoes"><button type="button" className="secundario"
          onClick={() => alterar({ ...conteudo, periodos: [...conteudo.periodos, periodoVazio(tipo)] })}>Adicionar período</button></div>}
      </fieldset>
      {tipo === 'DTC_COMISSIONADO' && <fieldset className="separado">
        <legend><strong>Cargos em comissão ({conteudo.cargos.length} de {MAXIMO_CARGOS_COMISSIONADOS})</strong></legend>
        {conteudo.cargos.map((cargo, indice) => (
          <details className="grupo-formulario" key={indice} open>
            <summary>{indice + 1}º cargo — nomeação e exoneração</summary>
            <label>Cargo<input required maxLength={200} value={cargo.cargo} onChange={(evento) => alterarCargo(indice, { cargo: evento.target.value })} /></label>
            <div className="grade-busca">
              <label>Decreto de nomeação<input required maxLength={200} value={cargo.decretoNomeacao}
                onChange={(evento) => alterarCargo(indice, { decretoNomeacao: evento.target.value })} /></label>
              <label>Publicação da nomeação<input required maxLength={200} value={cargo.publicacaoNomeacao}
                onChange={(evento) => alterarCargo(indice, { publicacaoNomeacao: evento.target.value })} /></label>
              <label>Entrada em exercício<input type="date" required value={cargo.dataEntradaExercicio}
                onChange={(evento) => alterarCargo(indice, { dataEntradaExercicio: evento.target.value })} /></label>
              <label>Decreto de exoneração<input maxLength={200} value={cargo.decretoExoneracao ?? ''}
                onChange={(evento) => alterarCargo(indice, { decretoExoneracao: textoOuNulo(evento.target.value) })} /></label>
              <label>Publicação da exoneração<input maxLength={200} value={cargo.publicacaoExoneracao ?? ''}
                onChange={(evento) => alterarCargo(indice, { publicacaoExoneracao: textoOuNulo(evento.target.value) })} /></label>
              <label>Encerramento/afastamento<input type="date" value={cargo.dataEncerramento ?? ''}
                onChange={(evento) => alterarCargo(indice, { dataEncerramento: textoOuNulo(evento.target.value) })} /></label>
            </div>
            {conteudo.cargos.length > 1 && <button type="button" className="perigo"
              onClick={() => alterar({ ...conteudo, cargos: conteudo.cargos.filter((_, posicao) => posicao !== indice) })}>
              Remover {indice + 1}º cargo</button>}
          </details>
        ))}
        {conteudo.cargos.length < MAXIMO_CARGOS_COMISSIONADOS && <div className="acoes"><button type="button" className="secundario"
          onClick={() => alterar({ ...conteudo, cargos: [...conteudo.cargos, cargoVazio()] })}>Adicionar cargo</button></div>}
      </fieldset>}
      {tipo === 'DTC_INSS' && inss && <fieldset className="grupo-formulario">
        <legend><strong>Informações adicionais (textos provisórios)</strong></legend>
        <label className="marcador"><input type="checkbox" checked={inss.licencas.possui}
          onChange={(evento) => alterarInss({ licencas: { possui: evento.target.checked, descricao: evento.target.checked ? inss.licencas.descricao : null } })} />
          Houve licença não remunerada ou afastamento com suspensão do contrato</label>
        {inss.licencas.possui && <label>Datas, tipo e período/vínculo de cada ocorrência
          <textarea maxLength={2000} required value={inss.licencas.descricao ?? ''}
            onChange={(evento) => alterarInss({ licencas: { possui: true, descricao: textoOuNulo(evento.target.value) } })} /></label>}
      </fieldset>}
      {tipo === 'DTC_INSS' && inss && <fieldset className="grupo-formulario">
        <legend>Documentação-base e observações</legend>
        {([
          ['nomeacao', 'Atos de nomeação e exoneração'],
          ['ctps', 'Contrato de trabalho, CTPS ou ficha funcional'],
          ['folha', 'Folhas de pagamento ou ficha financeira'],
          ['frequencia', 'Registros de frequência'],
        ] as const).map(([campo, rotulo]) => (
          <label className="marcador" key={campo}><input type="checkbox" checked={inss.documentacao[campo]}
            onChange={(evento) => alterarInss({ documentacao: { ...inss.documentacao, [campo]: evento.target.checked } })} />{rotulo}</label>
        ))}
        <label>Outros documentos<input maxLength={200} value={inss.documentacao.outros ?? ''}
          onChange={(evento) => alterarInss({ documentacao: { ...inss.documentacao, outros: textoOuNulo(evento.target.value) } })} /></label>
        <label>Observações<textarea maxLength={2000} value={inss.observacao ?? ''}
          onChange={(evento) => alterarInss({ observacao: textoOuNulo(evento.target.value) })} /></label>
      </fieldset>}
      <fieldset className="grupo-formulario">
        <legend><strong>Processo e confirmações</strong></legend>
        <label>Número do processo{documento?.mascarasProcesso.length ? ` (${documento.mascarasProcesso.join(' ou ')})` : ''}
          <input maxLength={60} value={conteudo.processo ?? ''}
            onChange={(evento) => alterar({ ...conteudo, processo: textoOuNulo(evento.target.value) })} /></label>
        <label className="marcador"><input type="checkbox" checked={conteudo.confirmarInicioAjustado}
          onChange={(evento) => alterar({ ...conteudo, confirmarInicioAjustado: evento.target.checked })} />
          Confirmo o ajuste do início à data de posse, se o cálculo o indicar</label>
        {documento ? (
          <label>Motivo da alteração<textarea required maxLength={2000} value={motivo} onChange={(evento) => setMotivo(evento.target.value)} /></label>
        ) : (
          <label className="marcador"><input type="checkbox" checked={confirmacao} onChange={(evento) => setConfirmacao(evento.target.checked)} />
            Confirmo que conferi os dados do servidor e os períodos informados</label>
        )}
      </fieldset>
      {problemas.length > 0 && <ul className="aviso erro">{problemas.map((problema) => <li key={problema.caminho + problema.mensagem}>{problema.mensagem}</li>)}</ul>}
      <div className="acoes">
        <button type="submit" disabled={ocupado || problemas.length > 0 || (documento ? !motivo.trim() : !confirmacao)}>
          {ocupado ? 'Salvando...' : 'Salvar rascunho'}</button>
        <button type="button" className="secundario" disabled={ocupado} onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
