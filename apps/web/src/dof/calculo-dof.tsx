import { BlocosDof } from './blocos-dof';
import { ConfirmacaoInicioDof } from './confirmacao-inicio-dof';
import { abas, campos, tamanhoPagina, type Props } from './contexto-editor-dof';
import { DevolverRascunhoDof, UltimaDevolucaoDof } from './devolucao-dof';
import { EncaminhamentoDof } from './encaminhamento-dof';
import { VerificacaoConferenciaDof } from './preconferencia-dof';
import { ProcessoDof } from './processo-dof';
import { useEditorDof } from './use-editor-dof';

/** Apresenta editor e prévia DOF sem desmontar painéis ocultos ou perder edições pendentes. */
export function CalculoDof(props: Props) {
  const { id, rascunho, nome, matricula, admissaoAtual, somenteLeitura, podeSalvar, onErro, onLimpar, resultado, aba, setAba, dadosServidor, csrf, calculoPendente, blocosPendentes, encaminhamentoPendente, operacaoEncaminhamento, operacaoConferencia, ocupado, edicaoIndisponivel, setRascunho, onPendente, marcarProcesso, bloqueioCalculo, inicio, setInicio, setTabela, invalidar, fim, setFim, preparar, calcular, tabela, inicioEfetivo, anteriorTs, setAnteriorTs, anteriorPf, setAnteriorPf, origemAnterior, setOrigemAnterior, pagina, anosPagina, abrangencias, valores, atualizar, setPagina, confirmado, setConfirmado, marcarCalculo, resultadoSalvo, mensagem, pedidoCalculado, salvar, bloqueioSalvar, anosExcluidos, confirmouRemocao, setConfirmouRemocao, motivo, setMotivo, destinoPrevia, setFontePrevia, processoPendente, marcarBlocos, setProvaPrevia, setOcupado, provaPrevia, marcarConferencia, onFechar, marcarEncaminhamento, setOperacaoEncaminhamento, setDestinoPrevia, confirmarSaida, rascunhoInicial } = useEditorDof(props);
  return (
    <section className="estudio-dof" aria-labelledby="calculo-dof-titulo">
      <div className="area-dof">
      <div className="editor-dof">
      <p className="identificador-documento">DOF · Declaração de Ocorrências Funcionais</p>
      <h2 id="calculo-dof-titulo">DOF — {rascunho?.nome ?? nome}</h2>
      <p>{rascunho?.nome ?? nome} — matrícula {rascunho?.matricula ?? matricula}. Admissão na fonte: {admissaoAtual ?? 'não informada'}.</p>
      {rascunho && <p>{somenteLeitura ? 'Rascunho encaminhado' : 'Rascunho'} — revisão {rascunho.revisao}. Ainda não conferido nem emitido.</p>}
      {rascunho && podeSalvar && !somenteLeitura
        && <UltimaDevolucaoDof rascunho={rascunho} onErro={onErro} onLimpar={onLimpar} />}
      {rascunho && admissaoAtual !== rascunho.resultado.admissaoConsiderada && (
        <p className="aviso erro" role="alert">
          A admissão considerada no resultado salvo foi {rascunho.resultado.admissaoConsiderada}, diferente da fonte atual.
          {somenteLeitura
            ? ' Solicite ao autor o recolhimento e a conferência dos dados.'
            : admissaoAtual ? ' Prepare a tabela e confira novamente antes de salvar.' : ' A edição está indisponível até a correção na fonte.'}
        </p>
      )}
      <details className="orientacoes-dof">
        <summary>Cálculo e prévia — salvar, conferir e emitir em etapas</summary>
        <p>Regra provisória (planilha). O cálculo não grava dados; salvar cria apenas um rascunho, sem conferir ou emitir.</p>
        <p>As ocorrências da fonte não são carregadas automaticamente. Confira os registros e informe os dias de cada intervalo; campos vazios serão tratados como zero somente após sua confirmação.</p>
      </details>
      <nav className="abas-dof" role="tablist" aria-label="Seções da DOF">
        {abas.map(([codigo, titulo], indice) => (
          <button key={codigo} type="button" role="tab" id={`${id}-aba-${codigo}`} aria-controls={`${id}-painel-${codigo}`}
            aria-selected={aba === codigo} tabIndex={aba === codigo ? 0 : -1} onClick={() => setAba(codigo)}
            onKeyDown={(evento) => {
              let destino: number;
              if (evento.key === 'ArrowRight') destino = (indice + 1) % abas.length;
              else if (evento.key === 'ArrowLeft') destino = (indice + abas.length - 1) % abas.length;
              else if (evento.key === 'Home') destino = 0;
              else if (evento.key === 'End') destino = abas.length - 1;
              else return;
              evento.preventDefault();
              setAba(abas[destino][0]);
              evento.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[destino]?.focus();
            }}>{titulo}</button>
        ))}
      </nav>
      <div role="tabpanel" id={`${id}-painel-dados`} aria-labelledby={`${id}-aba-dados`} hidden={aba !== 'dados'}>
        <dl className="dados-servidor">{dadosServidor.map(([rotulo, valor]) => (
          <div key={rotulo}><dt>{rotulo}</dt><dd>{valor}</dd></div>
        ))}</dl>
        <p>Os campos da fonte são somente leitura. A prévia auditada é carregada após salvar. Ajustes cadastrais exclusivos da declaração ainda não estão implementados.</p>
        {rascunho && (podeSalvar || somenteLeitura) && (
          <ProcessoDof rascunho={rascunho} csrf={csrf}
            bloqueado={calculoPendente || blocosPendentes || encaminhamentoPendente
              || operacaoEncaminhamento || operacaoConferencia || ocupado}
            somenteLeitura={edicaoIndisponivel}
            onAtualizar={setRascunho} onPendente={marcarProcesso} onErro={onErro} onLimpar={onLimpar} />
        )}
      </div>
      <div role="tabpanel" id={`${id}-painel-periodo`} aria-labelledby={`${id}-aba-periodo`} hidden={aba !== 'periodo'}>
        <fieldset disabled={bloqueioCalculo}>
          <div className="grade">
            <label>Início do período<input type="date" value={inicio} required onChange={(evento) => { setInicio(evento.target.value); setTabela(null); invalidar(); }} /></label>
            <label>Fim do período<input type="date" value={fim} required onChange={(evento) => { setFim(evento.target.value); setTabela(null); invalidar(); }} /></label>
          </div>
          <button type="button" className="secundario" onClick={preparar}>Preparar tabela anual</button>
        </fieldset>
      </div>
      <div role="tabpanel" id={`${id}-painel-tabela`} aria-labelledby={`${id}-aba-tabela`} hidden={aba !== 'tabela'}>
      <form onSubmit={calcular} noValidate>
        <fieldset disabled={bloqueioCalculo}>
          {!tabela && <p>Informe o período e prepare a tabela anual na aba Período.</p>}
          {tabela && (
            <>
              {admissaoAtual && inicio < admissaoAtual && <p className="aviso">O início será ajustado à admissão; confira o aviso no resultado.</p>}
              {admissaoAtual && inicioEfetivo > admissaoAtual && (
                <div className="grade separado">
                  <label>T/S acumulado antes do período<input type="number" min="0" step="1" required value={anteriorTs} onChange={(evento) => { setAnteriorTs(evento.target.value); invalidar(); }} /></label>
                  <label>P/F acumulado antes do período<input type="number" min="0" step="1" required value={anteriorPf} onChange={(evento) => { setAnteriorPf(evento.target.value); invalidar(); }} /></label>
                  <label>Origem do acumulado anterior<input required value={origemAnterior} onChange={(evento) => { setOrigemAnterior(evento.target.value); invalidar(); }} /></label>
                </div>
              )}
              <p>{tabela.anos.length} ano(s) no intervalo efetivo. Exibindo {pagina * tamanhoPagina + 1} a {Math.min((pagina + 1) * tamanhoPagina, tabela.anos.length)}. Valores são dias, não datas.</p>
              <div className="tabela"><table>
                <thead><tr><th scope="col">Ano</th><th scope="col">Intervalo</th>{campos.map(([campo, titulo]) => <th key={campo} scope="col">{titulo}</th>)}</tr></thead>
                <tbody>{anosPagina.map((ano) => {
                  const anoTexto = String(ano).padStart(4, '0');
                  const primeiroDia = `${anoTexto}-01-01`;
                  const ultimoDia = `${anoTexto}-12-31`;
                  const comeco = inicioEfetivo > primeiroDia ? inicioEfetivo : primeiroDia;
                  const termino = fim < ultimoDia ? fim : ultimoDia;
                  return (
                    <tr key={ano}>
                      <th scope="row">{ano}</th><td>{comeco} a {termino}{abrangencias[ano] === 'ano_civil' ? ' — lançamento anual integral' : ''}</td>
                      {campos.map(([campo, titulo]) => (
                        <td key={campo}><input className="dias-anuais" type="number" min="0" step="1" inputMode="numeric"
                          aria-label={`${titulo} em ${ano}`} value={valores[ano]?.[campo] ?? ''}
                          onChange={(evento) => atualizar(ano, campo, evento.target.value)} /></td>
                      ))}
                    </tr>
                  );
                })}</tbody>
              </table></div>
              <div className="acoes">
                <button type="button" className="secundario" disabled={pagina === 0} onClick={() => setPagina((atual) => atual - 1)}>Anos anteriores</button>
                <button type="button" className="secundario" disabled={(pagina + 1) * tamanhoPagina >= tabela.anos.length} onClick={() => setPagina((atual) => atual + 1)}>Próximos anos</button>
              </div>
              <label className="marcador"><input type="checkbox" checked={confirmado} required onChange={(evento) => {
                if (evento.target.checked) { setConfirmado(true); marcarCalculo(true); }
                else invalidar();
              }} />
                Confirmei todos os anos e intervalos parciais; campos vazios representam zero.</label>
              <button type="submit">{ocupado ? 'Calculando...' : 'Calcular DOF'}</button>
            </>
          )}
        </fieldset>
      </form>
      {resultado && (
        <section className="separado" aria-labelledby="resultado-dof-titulo">
          <h4 id="resultado-dof-titulo">{resultadoSalvo ? 'Resultado salvo' : 'Resultado provisório'}</h4>
          <p>Admissão considerada: {resultado.admissaoConsiderada}. Período efetivo: {resultado.periodo.inicioEfetivo} a {resultado.periodo.fim}. Regra {resultado.regra.codigo}, versão {resultado.regra.versao}.</p>
          <ul>{resultado.avisos.map((aviso, indice) => <li key={`${aviso.codigo}-${indice}`}>{aviso.mensagem}</li>)}</ul>
          <p>Dias do período: <strong>{resultado.totais.diasBrutos.toLocaleString('pt-BR')}</strong>. Tempo líquido de contribuição: <strong>{resultado.totais.totalContribuicao.toLocaleString('pt-BR')}</strong> dias. Efetivo exercício: <strong>{resultado.totais.efetivoExercicio.toLocaleString('pt-BR')}</strong> dias.</p>
          <div className="tabela"><table>
            <thead><tr><th scope="col">Ano</th><th scope="col">Dias do período</th><th scope="col">Faltas</th><th scope="col">T/S</th><th scope="col">P/F</th><th scope="col">I/P</th><th scope="col">Outros</th><th scope="col">Contribuição</th><th scope="col">Efetivo exercício</th><th scope="col">PB</th><th scope="col">PV</th><th scope="col">Licença-prêmio</th></tr></thead>
            <tbody>{resultado.periodo.linhas.map((linha) => (
              <tr key={linha.ano}><th scope="row">{linha.ano}</th><td>{linha.diasBrutos}</td><td>{linha.faltas}</td><td>{linha.ts}</td><td>{linha.pf}</td><td>{linha.ip}</td><td>{linha.outros}</td><td>{linha.contribuicao}</td><td>{linha.efetivoExercicio}</td><td>{linha.pb}</td><td>{linha.pv}</td><td>{linha.licencaPremio}</td></tr>
            ))}</tbody>
          </table></div>
          <h5>Linhas condicionais de referência</h5>
          {resultado.declaracao.length ? <ul>{resultado.declaracao.map((linha) => <li key={linha}>{linha}</li>)}</ul> : <p>Não há linhas para os totais informados.</p>}
        </section>
      )}
      {podeSalvar && resultado && pedidoCalculado && (
        <form id={`${id}-salvar`} className="separado" onSubmit={salvar} noValidate>
          <fieldset disabled={bloqueioSalvar}>
            {anosExcluidos.length > 0 && (
              <>
                <p className="aviso erro">
                  Salvar removerá {anosExcluidos.length} ano(s) do rascunho anterior:
                  {' '}{anosExcluidos.join(', ')}. Os valores anteriores permanecerão no registro de ajustes.
                </p>
                <label className="marcador">
                  <input type="checkbox" checked={confirmouRemocao} required
                    onChange={(evento) => { setConfirmouRemocao(evento.target.checked); marcarCalculo(true); }} />
                  Confirmo a remoção desses anos do rascunho.
                </label>
              </>
            )}
            <label>Motivo dos lançamentos ou da alteração
              <textarea value={motivo} onChange={(evento) => { setMotivo(evento.target.value); marcarCalculo(true); }} maxLength={2000} required />
            </label>
          </fieldset>
        </form>
      )}
      </div>
      <div role="tabpanel" id={`${id}-painel-blocos`} aria-labelledby={`${id}-aba-blocos`} hidden={aba !== 'blocos'}>
        {!rascunho && <p>Salve o rascunho para adicionar os blocos de texto.</p>}
      {rascunho && (podeSalvar || somenteLeitura) && (
        <BlocosDof rascunho={rascunho} csrf={csrf} destinoPrevia={destinoPrevia} onFonte={setFontePrevia}
          bloqueado={calculoPendente || processoPendente || encaminhamentoPendente
            || operacaoEncaminhamento || operacaoConferencia || ocupado}
          previaBloqueada={operacaoConferencia}
          somenteLeitura={edicaoIndisponivel}
          onAtualizar={setRascunho} onPendente={marcarBlocos} onPrevia={setProvaPrevia} onErro={onErro} onLimpar={onLimpar} />
      )}
      </div>
      <div role="tabpanel" id={`${id}-painel-conferencia`} aria-labelledby={`${id}-aba-conferencia`} hidden={aba !== 'conferencia'}>
      {!rascunho && <p>Salve o rascunho antes de encaminhar ou conferir a DOF.</p>}
      {rascunho && (podeSalvar || somenteLeitura) && (
        <ConfirmacaoInicioDof rascunho={rascunho} csrf={csrf}
          bloqueado={calculoPendente || blocosPendentes || processoPendente || encaminhamentoPendente
            || operacaoEncaminhamento || operacaoConferencia || ocupado}
          somenteLeitura={edicaoIndisponivel}
          onAtualizar={setRascunho} onOcupado={setOcupado} onErro={onErro} onLimpar={onLimpar} />
      )}
      {rascunho && (podeSalvar || somenteLeitura) && (
        <VerificacaoConferenciaDof rascunho={rascunho} csrf={csrf}
          provaFonte={provaPrevia?.documentoId === rascunho.id && provaPrevia.revisao === rascunho.revisao
            ? provaPrevia.provaFonte : undefined}
          bloqueado={calculoPendente || blocosPendentes || processoPendente || encaminhamentoPendente
            || operacaoEncaminhamento || ocupado}
          onOcupado={marcarConferencia}
          onConferido={() => {
            marcarConferencia(false);
            onFechar('DOF conferida. Consulte-a em DOFs conferidas para revisão e emissão pelo coordenador, conforme as aprovações do modelo e da regra.');
          }} onErro={onErro} onLimpar={onLimpar} />
      )}
      {rascunho && podeSalvar && !somenteLeitura && (
        <EncaminhamentoDof rascunho={rascunho} csrf={csrf}
          bloqueado={calculoPendente || blocosPendentes || processoPendente || operacaoConferencia || ocupado}
          onAtualizar={setRascunho} onPendente={marcarEncaminhamento} onOcupado={setOperacaoEncaminhamento}
          onErro={onErro} onLimpar={onLimpar} />
      )}
      {rascunho && somenteLeitura && rascunho.encaminhamento && (
        <DevolverRascunhoDof rascunho={rascunho} csrf={csrf}
          bloqueado={ocupado || operacaoConferencia} onPendente={marcarEncaminhamento} onOcupado={setOperacaoEncaminhamento}
          onDevolvido={() => onFechar('Rascunho devolvido para ajustes. Ele continua não conferido.')}
          onErro={onErro} onLimpar={onLimpar} />
      )}
      </div>
      </div>
      <aside className="painel-previa" aria-label="Prévia do documento">
        <p className="identificador-documento">Prévia do documento · sem validade oficial</p>
        {!rascunho && <p>Salve o rascunho para abrir a prévia auditada.</p>}
        <div ref={setDestinoPrevia} />
      </aside>
      </div>
      <footer className="barra-totais" aria-label="Totais calculados da DOF">
        <dl>
          <div><dt>Dias no período</dt><dd>{resultado?.totais.diasBrutos.toLocaleString('pt-BR') ?? '—'}</dd></div>
          <div><dt>Deduções de contribuição</dt><dd>{resultado?.periodo.linhas.reduce((total, linha) => total + linha.deducaoContribuicao, 0).toLocaleString('pt-BR') ?? '—'}</dd></div>
          <div><dt>Efetivo exercício</dt><dd>{resultado?.totais.efetivoExercicio.toLocaleString('pt-BR') ?? '—'}</dd></div>
          <div><dt>Contribuição</dt><dd>{resultado?.totais.totalContribuicao.toLocaleString('pt-BR') ?? '—'}</dd></div>
        </dl>
        <div className="acoes">
          {podeSalvar && resultado && pedidoCalculado && <button type="submit" form={`${id}-salvar`} className="secundario"
            disabled={bloqueioSalvar}>{ocupado ? 'Salvando...' : rascunho ? 'Salvar alterações' : 'Salvar rascunho'}</button>}
          <button type="button" disabled title="Após conferir, abra DOFs conferidas para revisão e emissão pelo coordenador">Emitir PDF · após conferir</button>
        </div>
      </footer>
      {mensagem && <p className="aviso sucesso" role="status">{mensagem}</p>}
      <div className="acoes"><button type="button" className="secundario" disabled={ocupado || operacaoEncaminhamento || operacaoConferencia} onClick={() => {
        if (confirmarSaida()) { onPendente(false); onFechar(); }
      }}>
        {somenteLeitura ? 'Voltar aos encaminhados' : rascunhoInicial ? 'Voltar aos rascunhos' : 'Fechar cálculo'}
      </button></div>
    </section>
  );
}
