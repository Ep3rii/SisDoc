import { useEffect, useState } from 'react';
import { sugestoesCadastroSchema, CAMPOS_AJUSTE_CADASTRO, type CadastroServidor, type AjustesCadastro } from '@sisdoc/contratos';
import { requisitar, validar } from '../infraestrutura/api';

export function SugestoesCadastro({ pessoaId, vinculoId, cadastro, onErro, onAplicar }: {
  pessoaId: string; vinculoId: string; cadastro: CadastroServidor;
  onErro: (erro: unknown) => void; onAplicar?: (cadastro: CadastroServidor) => void;
}) {
  const [pagina, setPagina] = useState<ReturnType<typeof sugestoesCadastroSchema.parse> | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [falhou, setFalhou] = useState(false);
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    let ativa = true;
    setPagina(null); setFalhou(false);
    requisitar(`servidores/${pessoaId}/sugestoes?${new URLSearchParams({ limite: '50', ...(cursor ? { cursor } : {}) })}`)
      .then((dados) => { if (ativa) setPagina(validar(sugestoesCadastroSchema, dados)); })
      .catch((erro: unknown) => { if (ativa) { setFalhou(true); onErro(erro); } });
    return () => { ativa = false; };
  }, [pessoaId, cursor, versao, onErro, cadastro]);
  const campoCadastro = (campo: keyof AjustesCadastro): keyof CadastroServidor => campo === 'rg' ? 'rgNumero' : campo;
  const sugestoes = pagina?.itens.filter((item) => item.vinculoId === vinculoId).map((item) => ({
    ...item,
    campos: CAMPOS_AJUSTE_CADASTRO.filter(([campo]) => campo in item.ajustes && item.ajustes[campo] !== cadastro[campoCadastro(campo)]),
  })).filter((item) => item.campos.length > 0) ?? [];
  return <section className="separado" aria-label="Sugestões de atualização do cadastro">
    <h4>Sugestões registradas em declarações</h4>
    <p>Compare com a referência antes de corrigir o cadastro. Nenhuma sugestão é aplicada automaticamente.</p>
    {falhou ? <button type="button" onClick={() => setVersao((v) => v + 1)}>Tentar carregar sugestões</button> :
      !pagina ? <p role="status">Carregando sugestões...</p> : <>
        {!sugestoes.length && <p>Nenhuma divergência sugerida para este vínculo nesta página.</p>}
        {sugestoes.map((item) => <details key={item.documentoId} className="grupo-formulario">
          <summary>{item.tipo} · revisão {item.revisao} · {item.campos.length} sugestão(ões)</summary>
          <dl>{item.campos.map(([campo, rotulo]) => <div key={campo}><dt>{rotulo}</dt>
            <dd>Cadastro: {cadastro[campoCadastro(campo)] ?? 'Não informado'} → Declaração: {item.ajustes[campo] ?? 'Não informado'}</dd></div>)}</dl>
          {onAplicar && <button type="button" className="secundario" onClick={() => {
            if (!window.confirm('Preparar correção do cadastro local com esta sugestão? Confira os campos e informe motivo antes de salvar.')) return;
            const novo = { ...cadastro };
            for (const [campo] of item.campos) Object.assign(novo, { [campoCadastro(campo)]: item.ajustes[campo] });
            onAplicar(novo);
          }}>Revisar correção no cadastro local</button>}
        </details>)}
        <div className="acoes">
          <button type="button" disabled={!cursor} onClick={() => setCursor(undefined)}>Primeira página de sugestões</button>
          <button type="button" disabled={!pagina.proximoCursor} onClick={() => setCursor(pagina.proximoCursor ?? undefined)}>Próxima página de sugestões</button>
        </div>
      </>}
  </section>;
}
