import {
  referenciaServidorSchema,
  type ReferenciaServidor,
  type ReferenciaServidorQuery
} from '@sisdoc/contratos';
import { useEffect, useState } from 'react';
import { requisitar, validar } from '../infraestrutura/api';
import type { Props, ProtecaoEdicao } from './contexto';
import { EditorCadastro } from './editor-cadastro';

/** Consulta referências completas auditadas do vínculo e permite edição local autorizada. */
export function Referencias({ pessoaId, vinculoId, csrf, podeEditarCadastro, onErro, onPendente, confirmarSaida, onAtualizado }: {
  pessoaId: string;
  vinculoId: string;
  csrf: string;
  podeEditarCadastro: boolean;
  onErro: Props['onErro'];
  onPendente: ProtecaoEdicao['onPendente'];
  confirmarSaida: ProtecaoEdicao['confirmarSaida'];
  onAtualizado: () => void;
}) {
  const [tipo, setTipo] = useState<ReferenciaServidorQuery['tipo']>('eventos_funcionais');
  const [cursor, setCursor] = useState<string | undefined>();
  const [dados, setDados] = useState<ReferenciaServidor | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [versao, setVersao] = useState(0);
  const [editando, setEditando] = useState(false);
  useEffect(() => {
    let ativa = true;
    setDados(null);
    setFalhou(false);
    const query = new URLSearchParams({ vinculoId, tipo, limite: '50' });
    if (cursor) query.set('cursor', cursor);
    requisitar(`servidores/${pessoaId}/referencias?${query}`).then((resultado) => {
      if (ativa) setDados(validar(referenciaServidorSchema, resultado));
    }).catch((erro: unknown) => {
      if (ativa) { setFalhou(true); onErro(erro); }
    });
    return () => { ativa = false; };
  }, [pessoaId, vinculoId, tipo, cursor, versao, onErro]);
  return <section className="separado" aria-label="Dados de referência para DOF e DTC">
    <h4>Dados de referência — DOF e DTCs</h4>
    <p className="aviso">Dados pessoais completos. Consulte apenas para atividades autorizadas do setor; o acesso é auditado.</p>
    <label>Referências<select value={tipo} onChange={(evento) => {
      const valor = evento.target.value;
      if (valor === 'eventos_funcionais' || valor === 'afastamentos' || valor === 'incorporacoes' || valor === 'periodos_ipam') {
        setTipo(valor); setCursor(undefined);
      }
    }}>
      <option value="eventos_funcionais">Eventos funcionais</option><option value="afastamentos">Afastamentos</option>
      <option value="incorporacoes">Incorporações</option><option value="periodos_ipam">Períodos IPAM</option>
    </select></label>
    {falhou ? <button type="button" onClick={() => setVersao((v) => v + 1)}>Tentar carregar referências novamente</button>
      : !dados ? <p role="status">Carregando referências...</p> : <>
        {podeEditarCadastro && !editando && <button type="button" className="secundario"
          onClick={() => setEditando(true)}>Editar cadastro local</button>}
        {podeEditarCadastro && editando && <EditorCadastro key={`${dados.revisaoPessoa}-${dados.revisaoVinculo}`}
          dados={dados} csrf={csrf} onErro={onErro} onPendente={onPendente} confirmarSaida={confirmarSaida}
          onAtualizado={() => { setEditando(false); onAtualizado(); setVersao((v) => v + 1); }} />}
        <details className="grupo-formulario" open><summary>Cadastro completo</summary>
        <dl className="dados-servidor">{Object.entries(dados.pessoa).map(([nome, valor]) => <div key={nome}><dt>{nome.replace(/_/g, ' ')}</dt><dd>{valor ?? 'Não informado'}</dd></div>)}</dl>
        </details>
        <details className="grupo-formulario" open><summary>Registros de referência</summary>
        {dados.registros.length === 0 && <p>Nenhum registro deste tipo.</p>}
        {dados.registros.map((registro) => <dl className="bloco" key={registro.id}>
          {Object.entries(registro.campos).map(([nome, valor]) => <div key={nome}><dt>{nome.replace(/_/g, ' ')}</dt><dd>{valor ?? 'Não informado'}</dd></div>)}
        </dl>)}
        <div className="acoes">
          <button type="button" disabled={!cursor} onClick={() => setCursor(undefined)}>Primeira página de referências</button>
          <button type="button" disabled={!dados.proximoCursor} onClick={() => setCursor(dados.proximoCursor ?? undefined)}>Próxima página de referências</button>
        </div>
        </details>
      </>}
  </section>;
}
