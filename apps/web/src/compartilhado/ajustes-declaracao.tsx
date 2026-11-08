import { CAMPOS_AJUSTE_CADASTRO, type AjustesCadastro } from '@sisdoc/contratos';
import { dataTabela } from './datas-tabela';

export function AjustesDeclaracao({ fonte, ajustes, onAlterar, bloqueado = false }: {
  fonte: { nome: string; matricula: string; admissao: string | null };
  ajustes: AjustesCadastro;
  onAlterar: (valor: AjustesCadastro) => void;
  bloqueado?: boolean;
}) {
  return <section aria-label="Ajustar nesta declaração">
    <h3>Ajustar nesta declaração</h3>
    <p>Não altera o cadastro nem a fonte externa. Ao salvar, os ajustes geram uma sugestão de correção no cadastro local.</p>
    <fieldset disabled={bloqueado} className="dados-servidor">
      {CAMPOS_AJUSTE_CADASTRO.filter(([campo]) => campo in fonte).map(([campo, rotulo, tipo]) => {
        const original = Reflect.get(fonte, campo) as string | null;
        const alterado = campo in ajustes;
        const valor = alterado ? ajustes[campo] : original;
        return <div key={campo}>
          <label>{rotulo}<input type={tipo} value={valor ?? ''} maxLength={campo === 'endereco' ? 500 : 200}
            onChange={(evento) => onAlterar({ ...ajustes, [campo]: evento.target.value || (['nome', 'cpf', 'matricula', 'admissao'].includes(campo) ? '' : null) })} /></label>
          <small>Referência: {tipo === 'date' && original ? dataTabela(original) : original ?? 'Não informado'}{alterado ? ' · Ajuste local' : ''}</small>
          {alterado && <button type="button" className="secundario" onClick={() => {
            const novo = { ...ajustes }; delete novo[campo]; onAlterar(novo);
          }}>Usar referência <span className="sr-only">para {rotulo}</span></button>}
        </div>;
      })}
    </fieldset>
  </section>;
}
