import { useEffect, useState } from 'react';
import { retornosDeclaracoesSchema, type RascunhoDof, type TipoDtc } from '@sisdoc/contratos';
import { dataTabela } from '../compartilhado/datas-tabela';
import { api, requisitar, validar } from '../infraestrutura/api';
import { CalculoDof } from '../dof/calculo-dof';
import { Documento } from '../dtc/documento';

export function Retornos({ csrf, papel, onErro, onLimpar, onPendente, confirmarSaida }: {
  csrf: string; papel: 'analista' | 'coordenador' | 'admin';
  onErro: (erro: unknown) => void; onLimpar: () => void;
  onPendente: (valor: boolean) => void; confirmarSaida: () => boolean;
}) {
  const [pagina, setPagina] = useState<ReturnType<typeof retornosDeclaracoesSchema.parse> | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [versao, setVersao] = useState(0);
  const [falhou, setFalhou] = useState(false);
  const [dof, setDof] = useState<RascunhoDof | null>(null);
  const [dtc, setDtc] = useState<{ id: string; tipo: TipoDtc } | null>(null);
  useEffect(() => {
    let ativa = true; setPagina(null); setFalhou(false);
    requisitar(`notificacoes/retornos?${new URLSearchParams({ limite: '50', ...(cursor ? { cursor } : {}) })}`)
      .then((dados) => { if (ativa) setPagina(validar(retornosDeclaracoesSchema, dados)); })
      .catch((erro: unknown) => { if (ativa) { setFalhou(true); onErro(erro); } });
    return () => { ativa = false; };
  }, [cursor, versao, onErro]);
  const voltar = () => { setDof(null); setDtc(null); setVersao((v) => v + 1); onPendente(false); };
  if (dof) return <CalculoDof pessoaId={dof.pessoaId} vinculoId={dof.vinculoId} nome={dof.nome}
    matricula={dof.matricula} admissao={dof.admissao} rascunhoInicial={dof} csrf={csrf} podeSalvar
    onFechar={voltar} onErro={onErro} onLimpar={onLimpar} onPendente={onPendente} confirmarSaida={confirmarSaida} />;
  if (dtc) return <Documento id={dtc.id} tipo={dtc.tipo} csrf={csrf} papel={papel} onVoltar={voltar}
    onErro={onErro} onLimpar={onLimpar} onPendente={onPendente} />;
  return <section><h2>Retornos para ajustes</h2>
    <p>Declarações devolvidas que ainda não receberam alteração. Abrir não remove a notificação; salvar ajustes ou mudar de estado atualiza a contagem.</p>
    {falhou ? <button type="button" onClick={() => setVersao((v) => v + 1)}>Tentar carregar retornos</button> :
      !pagina ? <p role="status">Carregando retornos...</p> : <>
        {!pagina.itens.length && <p>Nenhum retorno pendente.</p>}
        <div className="tabela"><table><thead><tr><th>Tipo</th><th>Servidor</th><th>Matrícula</th><th>Devolução</th><th>Ação</th></tr></thead>
          <tbody>{pagina.itens.map((item) => <tr key={item.id}><td>{item.tipo}</td><td>{item.nome}</td><td>{item.matricula}</td>
            <td>{dataTabela(item.devolvidoEm)}</td><td><button type="button" onClick={() => {
              if (item.tipo !== 'DOF') { setDtc({ id: item.id, tipo: item.tipo }); return; }
              api.obterRascunhoDof(item.id).then(setDof).catch(onErro);
            }}>Abrir para ajustes</button></td></tr>)}</tbody></table></div>
        <button type="button" disabled={!cursor} onClick={() => setCursor(undefined)}>Primeira página</button>
        <button type="button" disabled={!pagina.proximoCursor} onClick={() => setCursor(pagina.proximoCursor ?? undefined)}>Próxima página</button>
      </>}
  </section>;
}
