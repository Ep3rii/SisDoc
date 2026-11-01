import {
  atualizarUsuarioSchema,
  criarUsuarioSchema,
  type PaginaUsuarios,
  type RespostaSessao,
  type UsuarioAdministrativo,
} from '@sisdoc/contratos';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { FiltrosLista, useFiltroLista } from '../compartilhado/filtros-lista';
import { api, ErroApi } from '../infraestrutura/api';

export const nomesPerfis: Record<UsuarioAdministrativo['papel'], string> = {
  analista: 'Analista',
  coordenador: 'Coordenador',
  secretario_adjunto: 'Secretário adjunto',
  admin: 'Administrador',
};

function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);
  if (typeof valor !== 'string') throw new ErroApi(400, 'Preencha todos os campos obrigatórios.');
  return valor;
}

function Perfis({ padrao = 'analista' }: { padrao?: UsuarioAdministrativo['papel'] }) {
  return (
    <select name="papel" defaultValue={padrao} required>
      {Object.entries(nomesPerfis).map(([valor, nome]) => <option key={valor} value={valor}>{nome}</option>)}
    </select>
  );
}

type Props = {
  sessao: RespostaSessao;
  onErro: (erro: unknown) => void;
  onMensagem: (mensagem: string) => void;
  onSessaoEncerrada: (mensagem: string) => void;
};

export function Usuarios({ sessao, onErro, onMensagem, onSessaoEncerrada }: Props) {
  const [pagina, setPagina] = useState<PaginaUsuarios | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [versao, setVersao] = useState(0);
  const [selecionado, setSelecionado] = useState<UsuarioAdministrativo | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const filtro = useFiltroLista(pagina?.itens ?? [], (usuario) =>
    `${usuario.nome} ${usuario.matricula} ${nomesPerfis[usuario.papel]} ${usuario.ativo ? 'Ativo' : 'Inativo'}`);
  const recarregar = useCallback(() => setVersao((atual) => atual + 1), []);

  useEffect(() => {
    let ativa = true;
    setPagina(null);
    setFalhou(false);
    api.listarUsuarios(cursor).then((resultado) => {
      if (ativa) setPagina(resultado);
    }).catch((erro: unknown) => {
      if (ativa) {
        setFalhou(true);
        onErro(erro);
      }
    });
    return () => { ativa = false; };
  }, [cursor, versao, onErro]);

  async function criar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    const valores = new FormData(formulario);
    try {
      const resultado = criarUsuarioSchema.safeParse({
        matricula: texto(valores, 'matricula'),
        nome: texto(valores, 'nome'),
        email: texto(valores, 'email') || null,
        papel: texto(valores, 'papel'),
        senha: texto(valores, 'senha'),
      });
      if (!resultado.success) throw new ErroApi(400, 'Confira os dados e informe uma senha de pelo menos 10 caracteres.');
      setOcupado(true);
      await api.criarUsuario(sessao.csrf, resultado.data);
      formulario.reset();
      setCursor(undefined);
      recarregar();
      onMensagem('Usuário criado. A troca da senha será exigida no primeiro acesso.');
    } catch (erro) {
      onErro(erro);
    } finally {
      setOcupado(false);
    }
  }

  async function atualizar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!selecionado) return;
    const valores = new FormData(evento.currentTarget);
    try {
      const resultado = atualizarUsuarioSchema.safeParse({
        nome: texto(valores, 'nome'),
        email: texto(valores, 'email') || null,
        papel: texto(valores, 'papel'),
        ativo: valores.has('ativo'),
      });
      if (!resultado.success) throw new ErroApi(400, 'Confira os dados do usuário.');
      setOcupado(true);
      const alterado = await api.atualizarUsuario(sessao.csrf, selecionado.id, resultado.data);
      setSelecionado(null);
      if (alterado.id === sessao.usuario.id
          && (alterado.papel !== sessao.usuario.papel || !alterado.ativo)) {
        onSessaoEncerrada('Sua sessão foi encerrada após a alteração do seu acesso.');
        return;
      }
      recarregar();
      onMensagem('Usuário atualizado.');
    } catch (erro) {
      onErro(erro);
    } finally {
      setOcupado(false);
    }
  }

  async function redefinir(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!selecionado) return;
    const formulario = evento.currentTarget;
    const valores = new FormData(formulario);
    try {
      const senha = texto(valores, 'senha');
      if (senha !== texto(valores, 'confirmacao')) throw new ErroApi(400, 'As senhas informadas não coincidem.');
      setOcupado(true);
      await api.redefinirSenha(sessao.csrf, selecionado.id, senha);
      formulario.reset();
      if (selecionado.id === sessao.usuario.id) {
        onSessaoEncerrada('Sua sessão foi encerrada após a redefinição da senha.');
        return;
      }
      setSelecionado(null);
      recarregar();
      onMensagem('Senha redefinida; as sessões do usuário foram revogadas.');
    } catch (erro) {
      onErro(erro);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section aria-labelledby="usuarios-titulo">
      <h2 id="usuarios-titulo">Administração de usuários</h2>
      <FiltrosLista filtro={filtro} onAtualizar={recarregar} />
      <p>O administrador tem acesso completo aos dados e documentos funcionais, inclusive aos rascunhos de outros usuários. Todas as ações são auditadas.</p>
      <div className="grade">
        <form className="painel" onSubmit={criar}>
          <h3>Criar usuário</h3>
          <label>Matrícula<input name="matricula" maxLength={100} required autoComplete="off" /></label>
          <label>Nome<input name="nome" minLength={3} maxLength={200} required autoComplete="off" /></label>
          <label>E-mail (opcional)<input name="email" type="email" maxLength={254} autoComplete="off" /></label>
          <label>Perfil<Perfis /></label>
          <label>Senha inicial<input name="senha" type="password" minLength={10} maxLength={1024} required autoComplete="new-password" /></label>
          <button type="submit" disabled={ocupado}>Criar usuário</button>
        </form>

        {selecionado && (
          <div className="painel" key={selecionado.id}>
            <h3>Editar {selecionado.nome}</h3>
            <form onSubmit={atualizar}>
              <label>Nome<input name="nome" defaultValue={selecionado.nome} minLength={3} maxLength={200} required /></label>
              <label>E-mail (opcional)<input name="email" type="email" defaultValue={selecionado.email ?? ''} maxLength={254} /></label>
              <label>Perfil<Perfis padrao={selecionado.papel} /></label>
              <label className="marcador"><input name="ativo" type="checkbox" defaultChecked={selecionado.ativo} /> Usuário ativo</label>
              <div className="acoes">
                <button type="submit" disabled={ocupado}>Salvar alterações</button>
                <button type="button" className="secundario" onClick={() => setSelecionado(null)}>Fechar</button>
              </div>
            </form>
            <form className="separado" onSubmit={redefinir}>
              <h4>Redefinir senha</h4>
              <p>A redefinição encerra as sessões do usuário e exige troca no próximo acesso.</p>
              <label>Nova senha<input name="senha" type="password" minLength={10} maxLength={1024} required autoComplete="new-password" /></label>
              <label>Confirme a nova senha<input name="confirmacao" type="password" minLength={10} maxLength={1024} required autoComplete="new-password" /></label>
              <button type="submit" disabled={ocupado}>Redefinir senha</button>
            </form>
          </div>
        )}
      </div>

      <h3>Usuários cadastrados</h3>
      {falhou ? <button type="button" className="secundario" onClick={recarregar}>Tentar carregar usuários novamente</button> : !pagina ? <p role="status">Carregando usuários...</p> : (
        <>
          <div className="tabela">
            <table>
              <thead><tr><th scope="col">Matrícula</th><th scope="col">Nome</th><th scope="col">Perfil</th><th scope="col">Situação</th><th scope="col">Ações</th></tr></thead>
              <tbody>
                {filtro.itens.map((usuario) => (
                  <tr key={usuario.id}>
                    <td>{usuario.matricula}</td><td>{usuario.nome}</td><td>{nomesPerfis[usuario.papel]}</td>
                    <td>{usuario.ativo ? 'Ativo' : 'Inativo'}</td>
                    <td><button type="button" className="secundario" onClick={() => setSelecionado(usuario)}>Editar <span className="sr-only">{usuario.nome}</span></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="acoes">
            <button type="button" className="secundario" disabled={!cursor} onClick={() => setCursor(undefined)}>Primeira página</button>
            <button type="button" className="secundario" disabled={!pagina.proximoCursor} onClick={() => setCursor(pagina.proximoCursor ?? undefined)}>Próxima página</button>
          </div>
        </>
      )}
    </section>
  );
}
