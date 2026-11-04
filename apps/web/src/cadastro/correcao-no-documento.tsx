import { useEffect, useState } from 'react';
import { referenciaServidorSchema, type ReferenciaServidor } from '@sisdoc/contratos';
import { api, requisitar, validar } from '../infraestrutura/api';
import { EditorCadastro } from './editor-cadastro';

export function CorrecaoNoDocumento({ pessoaId, vinculoId, csrf, bloqueado, onErro, onPendente, onAtualizado }: {
  pessoaId: string; vinculoId: string; csrf: string; bloqueado: boolean;
  onErro: (erro: unknown) => void; onPendente: (valor: boolean) => void;
  onAtualizado: (dados: ReferenciaServidor) => void;
}) {
  const [administrador, setAdministrador] = useState(false);
  const [dados, setDados] = useState<ReferenciaServidor | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    let ativa = true;
    api.sessao().then((sessao) => { if (ativa) setAdministrador(sessao.usuario.papel === 'admin'); })
      .catch((erro: unknown) => { if (ativa) onErro(erro); });
    return () => { ativa = false; };
  }, [onErro]);
  async function carregar(concluir = false) {
    setOcupado(true);
    try {
      const referencia = validar(referenciaServidorSchema, await requisitar(`servidores/${pessoaId}/referencias?${new URLSearchParams({ vinculoId, tipo: 'eventos_funcionais', limite: '1' })}`));
      if (concluir) { setDados(null); onAtualizado(referencia); }
      else setDados(referencia);
    } catch (erro: unknown) { onErro(erro); }
    finally { setOcupado(false); }
  }
  if (!administrador) return <p>Correções compartilhadas no cadastro local são revisadas pelo administrador. Salvar ajustes nesta declaração gera sugestões no cadastro.</p>;
  return <section className="separado">
    <p>Corrigir cadastro local altera a referência compartilhada, não a fonte externa. Ajustes já salvos na declaração continuam separados.</p>
    {!dados && <button type="button" className="secundario" disabled={bloqueado || ocupado} onClick={() => {
      if (window.confirm('Abrir correção do cadastro local? A correção valerá para novas consultas/documentos e exige motivo. Não remove ajustes exclusivos desta declaração.')) void carregar();
    }}>Corrigir cadastro local</button>}
    {dados && <EditorCadastro dados={dados} csrf={csrf} onErro={onErro} onPendente={onPendente}
      confirmarSaida={() => window.confirm('Descartar a correção cadastral ainda não salva?')}
      onCancelar={() => setDados(null)}
      onAtualizado={() => void carregar(true)} />}
  </section>;
}
