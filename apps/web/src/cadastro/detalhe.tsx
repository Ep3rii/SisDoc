import {
  type DetalheServidor
} from '@sisdoc/contratos';
import { useEffect, useState } from 'react';
import { CalculoDof } from '../dof/calculo-dof';
import { api } from '../infraestrutura/api';
import type { Props, ProtecaoEdicao } from './contexto';
import { Eventos } from './eventos';
import { Referencias } from './referencias';

/** Abre vínculos e referências da pessoa, preservando confirmação antes de mudar o contexto de edição. */
export function Detalhe({ pessoaId, vinculoInicial, csrf, podeSalvar, podeEditarCadastro, onCadastroAtualizado, onFechar, onErro, onLimpar, onPendente, confirmarSaida }: Props & ProtecaoEdicao & {
  pessoaId: string; vinculoInicial: string | null; csrf: string; podeSalvar: boolean; podeEditarCadastro: boolean;
  onCadastroAtualizado: () => void; onFechar: () => void;
}) {
  const [detalhe, setDetalhe] = useState<DetalheServidor | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [vinculoId, setVinculoId] = useState<string | null>(null);
  const [referenciaId, setReferenciaId] = useState<string | null>(null);
  const [vinculoCalculo, setVinculoCalculo] = useState<{ id: string; matricula: string; admissao: string } | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [versao, setVersao] = useState(0);
  /** Executa mudança de vínculo ou tela somente após confirmar descarte das pendências. */
  const trocarContexto = (acao: () => void) => {
    if (confirmarSaida()) { onPendente(false); acao(); }
  };
  useEffect(() => {
    let ativa = true;
    setDetalhe(null);
    setFalhou(false);
    setVinculoId(null);
    setReferenciaId(null);
    setVinculoCalculo(null);
    api.servidor(pessoaId, cursor).then((resultado) => {
      if (ativa) {
        setDetalhe(resultado);
        if (resultado.vinculos.some((vinculo) => vinculo.id === vinculoInicial)) setReferenciaId(vinculoInicial);
      }
    }).catch((erro: unknown) => {
      if (ativa) { setFalhou(true); onErro(erro); }
    });
    return () => { ativa = false; };
  }, [pessoaId, vinculoInicial, cursor, versao, onErro]);
  if (vinculoCalculo && detalhe) {
    return (
      <CalculoDof key={vinculoCalculo.id} pessoaId={pessoaId} vinculoId={vinculoCalculo.id}
        nome={detalhe.pessoa.nome} matricula={vinculoCalculo.matricula} admissao={vinculoCalculo.admissao}
        csrf={csrf} podeSalvar={podeSalvar} onFechar={() => setVinculoCalculo(null)} onErro={onErro} onLimpar={onLimpar}
        onPendente={onPendente} confirmarSaida={confirmarSaida} />
    );
  }
  return (
    <section className="painel separado" aria-labelledby="detalhe-titulo">
      <h3 id="detalhe-titulo">Detalhes do servidor</h3>
      <div className="acoes"><button type="button" className="secundario" onClick={() => trocarContexto(onFechar)}>Fechar detalhes</button></div>
      {falhou ? <button type="button" className="secundario" onClick={() => { onLimpar(); setVersao((atual) => atual + 1); }}>Tentar carregar detalhes novamente</button> : !detalhe ? <p role="status">Carregando detalhes...</p> : (
        <>
          <h4>{detalhe.pessoa.nome}</h4>
          <p>CPF: {detalhe.pessoa.cpf}</p>
          <label>Dados de referência do vínculo<select value={referenciaId ?? ''} onChange={(evento) => {
            const id = evento.target.value || null;
            trocarContexto(() => setReferenciaId(id));
          }}>
            <option value="">Selecionar para consultar dados completos</option>
            {detalhe.vinculos.map((vinculo) => <option key={vinculo.id} value={vinculo.id}>{vinculo.matricula} — {vinculo.sistemaOrigem}</option>)}
          </select></label>
          {referenciaId && <Referencias key={referenciaId} pessoaId={pessoaId} vinculoId={referenciaId}
            csrf={csrf} podeEditarCadastro={podeEditarCadastro} onErro={onErro} onPendente={onPendente}
            confirmarSaida={confirmarSaida} onAtualizado={() => {
              setVersao((atual) => atual + 1);
              onCadastroAtualizado();
            }} />}
          <details className="grupo-formulario" open><summary>Vínculos e ações</summary>
          <div className="tabela"><table>
            <thead><tr><th scope="col">Matrícula</th><th scope="col">Origem</th><th scope="col">Regime</th><th scope="col">Cargo / referência</th><th scope="col">Classe / nível</th><th scope="col">Órgão / setor</th><th scope="col">Admissão / desligamento</th><th scope="col">Vínculo anterior</th><th scope="col">Eventos</th><th scope="col">Cálculo</th></tr></thead>
            <tbody>{detalhe.vinculos.map((vinculo) => {
              const anterior = detalhe.vinculos.find((item) => item.id === vinculo.matriculaAnteriorId);
              const admissao = vinculo.admissao;
              return (
                <tr key={vinculo.id}>
                  <td>{vinculo.matricula}{vinculo.removidoNaFonte ? ' — removido na fonte' : ''}</td>
                  <td>{vinculo.sistemaOrigem}</td><td>{vinculo.regimeJuridico ?? 'Não informado'}</td>
                  <td>{[vinculo.cargo, vinculo.referencia].filter(Boolean).join(' / ') || 'Não informado'}</td>
                  <td>{[vinculo.classe, vinculo.nivel].filter(Boolean).join(' / ') || 'Não informado'}</td>
                  <td>{[vinculo.orgao, vinculo.setor].filter(Boolean).join(' / ') || 'Não informado'}</td>
                  <td>{vinculo.admissao ?? 'Não informada'} / {vinculo.desligamento ?? 'Não informado'}</td>
                  <td>{anterior?.matricula ?? (vinculo.matriculaAnteriorId ? 'Vínculo não visível nesta página' : '—')}</td>
                  <td><button type="button" className="secundario" onClick={() => trocarContexto(() => {
                    onLimpar(); setVinculoCalculo(null); setVinculoId(vinculo.id);
                  })}>Eventos <span className="sr-only">da matrícula {vinculo.matricula}</span></button></td>
                  <td>{admissao ? (
                    <button type="button" className="secundario" onClick={() => {
                      if (vinculoCalculo?.id === vinculo.id) return;
                      trocarContexto(() => {
                        onLimpar();
                        setVinculoId(null);
                        setVinculoCalculo({ id: vinculo.id, matricula: vinculo.matricula, admissao });
                      });
                    }}>Calcular DOF <span className="sr-only">da matrícula {vinculo.matricula}</span></button>
                  ) : 'Admissão ausente na fonte'}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
          <div className="acoes">
            <button type="button" className="secundario" disabled={!cursor} onClick={() => trocarContexto(() => setCursor(undefined))}>Primeira página de vínculos</button>
            <button type="button" className="secundario" disabled={!detalhe.proximoCursor}
              onClick={() => trocarContexto(() => setCursor(detalhe.proximoCursor ?? undefined))}>Próxima página de vínculos</button>
          </div>
          </details>
          {vinculoId && <Eventos key={vinculoId} pessoaId={pessoaId} vinculoId={vinculoId} onErro={onErro} onLimpar={onLimpar} />}
        </>
      )}
    </section>
  );
}
