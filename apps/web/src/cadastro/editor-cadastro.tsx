import {
  atualizarServidorSchema,
  type CadastroServidor,
  type ReferenciaServidor
} from '@sisdoc/contratos';
import { useState, type FormEvent } from 'react';
import { api, ErroApi } from '../infraestrutura/api';
import type { Props, ProtecaoEdicao } from './contexto';

/** Edita apenas o cadastro local, preservando origem e snapshots dos documentos. */
export function EditorCadastro({ dados, csrf, onErro, onPendente, confirmarSaida, onAtualizado }: {
  dados: ReferenciaServidor;
  csrf: string;
  onErro: Props['onErro'];
  onPendente: ProtecaoEdicao['onPendente'];
  confirmarSaida: ProtecaoEdicao['confirmarSaida'];
  onAtualizado: () => void;
}) {
  const [cadastro, setCadastro] = useState<CadastroServidor>(dados.cadastro);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  /** Atualiza campo e marca pendência; vazio opcional é representado por null. */
  const atualizarCampo = (campo: keyof CadastroServidor, valor: string) => {
    setCadastro((atual) => ({ ...atual, [campo]: valor === '' ? null : valor }));
    onPendente(true);
  };
  /** Restaura o cadastro consultado somente após confirmar descarte da edição. */
  const cancelar = () => {
    if (!confirmarSaida()) return;
    onPendente(false);
    setCadastro(dados.cadastro);
    setMotivo('');
    onAtualizado();
  };
  /** Valida CPF, datas, motivo e revisões antes de enviar a alteração concorrente ao núcleo. */
  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const entrada = atualizarServidorSchema.safeParse({
      pessoaId: dados.pessoaId,
      vinculoId: dados.vinculoId,
      revisaoPessoa: dados.revisaoPessoa,
      revisaoVinculo: dados.revisaoVinculo,
      cadastro,
      motivo,
    });
    if (!entrada.success) {
      onErro(new ErroApi(400, 'Confira os dados, o CPF, as datas e informe o motivo da edição.'));
      return;
    }
    try {
      setOcupado(true);
      const resultado = await api.atualizarServidor(csrf, dados.pessoaId, entrada.data);
      onPendente(false);
      setMotivo('');
      onAtualizado();
      if (resultado.atualizado) return;
    } catch (erro: unknown) {
      onErro(erro);
    } finally {
      setOcupado(false);
    }
  }
  const camposPessoais: ReadonlyArray<[keyof CadastroServidor, string]> = [
    ['nome', 'Nome completo'], ['cpf', 'CPF'], ['nomeMae', 'Nome da mãe'], ['nomePai', 'Nome do pai'],
    ['pisPasep', 'PIS/PASEP'], ['rgNumero', 'RG'], ['rgOrgao', 'Órgão expedidor do RG'],
    ['tituloEleitor', 'Título de eleitor'],
  ];
  const camposVinculo: ReadonlyArray<[keyof CadastroServidor, string]> = [
    ['matricula', 'Matrícula'], ['regimeJuridico', 'Regime jurídico'], ['cargo', 'Cargo'],
    ['classe', 'Classe'], ['nivel', 'Nível'], ['referencia', 'Referência'], ['setor', 'Setor'],
    ['orgaoCodigo', 'Código do órgão'], ['orgao', 'Órgão'],
  ];
  /** Vincula campo ISO de cadastro ao controle nativo de data. */
  const campoData = (campo: keyof CadastroServidor, rotulo: string) => (
    <label key={campo}>{rotulo}<input type="date" value={String(cadastro[campo] ?? '')}
      onChange={(evento) => atualizarCampo(campo, evento.target.value)} /></label>
  );
  /** Renderiza campo textual com limite próprio e registro de alteração pendente. */
  const campoTexto = (campo: keyof CadastroServidor, rotulo: string, maxLength: number) => (
    <label key={campo}>{rotulo}<input value={String(cadastro[campo] ?? '')} maxLength={maxLength}
      onChange={(evento) => atualizarCampo(campo, evento.target.value)} /></label>
  );
  return (
    <form className="painel separado" onSubmit={salvar} aria-label="Editar cadastro local do servidor">
      <h4>Editar cadastro local</h4>
      <p className="aviso">A edição altera somente o núcleo local; origem, vínculos de origem e snapshots de documentos são preservados. Informe um motivo obrigatório; ele será armazenado cifrado.</p>
      <fieldset className="grupo-formulario"><legend>Identificação e contato</legend>
      <div className="grade-formulario">
        {camposPessoais.slice(0, 4).map(([campo, rotulo]) => campoTexto(campo, rotulo, campo === 'cpf' ? 14 : 200))}
        {campoData('nascimento', 'Nascimento')}
        <label>Endereço<textarea value={cadastro.endereco ?? ''} maxLength={500}
          onChange={(evento) => atualizarCampo('endereco', evento.target.value)} /></label>
      </div>
      </fieldset>
      <fieldset className="grupo-formulario"><legend>Documentos pessoais</legend>
      <div className="grade-formulario">
        {camposPessoais.slice(4).map(([campo, rotulo]) => campoTexto(campo, rotulo, 200))}
        {campoData('rgExpedicao', 'Expedição do RG')}
      </div></fieldset>
      <fieldset className="grupo-formulario"><legend>Vínculo selecionado</legend>
      <div className="grade-formulario">
        {camposVinculo.map(([campo, rotulo]) => campoTexto(campo, rotulo, campo === 'matricula' ? 100 : 200))}
        {campoData('admissao', 'Admissão')}
        {campoData('desligamento', 'Desligamento')}
      </div>
      </fieldset>
      <label>Motivo da edição<textarea value={motivo} minLength={5} maxLength={2000} required
        onChange={(evento) => { setMotivo(evento.target.value); onPendente(true); }} /></label>
      <div className="acoes">
        <button type="submit" disabled={ocupado}>{ocupado ? 'Salvando...' : 'Salvar edição local'}</button>
        <button type="button" className="secundario" disabled={ocupado} onClick={cancelar}>Cancelar edição</button>
      </div>
    </form>
  );
}
