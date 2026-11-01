import { useEffect, useState, type FormEvent } from 'react';
import {
  buscarServidoresQuerySchema,
  referenciaServidorSchema,
  atualizarServidorSchema,
  type CadastroServidor,
  type ReferenciaServidor,
  type ReferenciaServidorQuery,
  type DetalheServidor,
  type PaginaBuscaServidores,
  type PaginaEventosServidor,
  type TipoBuscaServidor,
} from '@sisdoc/contratos';
import { api, ErroApi, requisitar, validar } from './api';
import { CalculoDof } from './calculo-dof';
import { FiltrosLista, useFiltroLista } from './filtros-lista';

type Props = { onErro: (erro: unknown) => void; onLimpar: () => void };
type ProtecaoEdicao = { onPendente: (valor: boolean) => void; confirmarSaida: () => boolean };
export type Consulta = { q: string; tipo: TipoBuscaServidor };

function EditorCadastro({ dados, csrf, onErro, onPendente, confirmarSaida, onAtualizado }: {
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
  const atualizarCampo = (campo: keyof CadastroServidor, valor: string) => {
    setCadastro((atual) => ({ ...atual, [campo]: valor === '' ? null : valor }));
    onPendente(true);
  };
  const cancelar = () => {
    if (!confirmarSaida()) return;
    onPendente(false);
    setCadastro(dados.cadastro);
    setMotivo('');
    onAtualizado();
  };
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
  const campoData = (campo: keyof CadastroServidor, rotulo: string) => (
    <label key={campo}>{rotulo}<input type="date" value={String(cadastro[campo] ?? '')}
      onChange={(evento) => atualizarCampo(campo, evento.target.value)} /></label>
  );
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

function Referencias({ pessoaId, vinculoId, csrf, podeEditarCadastro, onErro, onPendente, confirmarSaida, onAtualizado }: {
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

export function BuscaGlobal({ onBuscar, onErro }: {
  onBuscar: (consulta: Consulta) => void; onErro: (erro: unknown) => void;
}) {
  function buscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const valores = new FormData(evento.currentTarget);
    const resultado = buscarServidoresQuerySchema.safeParse({ q: valores.get('q'), tipo: valores.get('tipo') });
    if (!resultado.success || !resultado.data.tipo || !resultado.data.q) {
      onErro(new ErroApi(400, 'Informe nome com ao menos três caracteres, CPF válido ou matrícula exata.'));
      return;
    }
    onBuscar({ q: resultado.data.q, tipo: resultado.data.tipo });
  }
  return (
    <form className="busca-global" onSubmit={buscar} aria-label="Busca de servidores">
      <label><span className="sr-only">Tipo de busca</span>
        <select name="tipo" defaultValue="nome"><option value="nome">Nome</option><option value="cpf">CPF</option><option value="matricula">Matrícula</option></select>
      </label>
      <label><span className="sr-only">Termo de busca</span>
        <input name="q" maxLength={200} required autoComplete="off" placeholder="Buscar servidor" aria-describedby="orientacao-busca" />
      </label>
      <button type="submit">Buscar</button>
      <span className="sr-only" id="orientacao-busca">Nome: mínimo de três caracteres. CPF: com ou sem máscara. Matrícula: informe o valor exato.</span>
    </form>
  );
}

function Eventos({ pessoaId, vinculoId, onErro, onLimpar }: Props & { pessoaId: string; vinculoId: string }) {
  const [pagina, setPagina] = useState<PaginaEventosServidor | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [falhou, setFalhou] = useState(false);
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    let ativa = true;
    setPagina(null);
    setFalhou(false);
    api.eventosServidor(pessoaId, vinculoId, cursor).then((resultado) => {
      if (ativa) setPagina(resultado);
    }).catch((erro: unknown) => {
      if (ativa) { setFalhou(true); onErro(erro); }
    });
    return () => { ativa = false; };
  }, [pessoaId, vinculoId, cursor, versao, onErro]);
  return (
    <section aria-labelledby="eventos-titulo">
      <h4 id="eventos-titulo">Eventos do vínculo</h4>
      {falhou ? <button type="button" className="secundario" onClick={() => { onLimpar(); setVersao((atual) => atual + 1); }}>Tentar carregar eventos novamente</button> : !pagina ? <p role="status">Carregando eventos...</p> : (
        <>
          {pagina.itens.length === 0 ? <p>Nenhum evento encontrado.</p> : (
            <div className="tabela"><table>
              <thead><tr><th scope="col">Tipo</th><th scope="col">Data</th><th scope="col">Ato</th><th scope="col">Publicação</th><th scope="col">Fonte</th></tr></thead>
              <tbody>{pagina.itens.map((evento) => (
                <tr key={evento.id}>
                  <td>{evento.tipo}</td><td>{evento.dataEvento ?? 'Não informada'}</td>
                  <td>{[evento.atoTipo, evento.atoNumero].filter(Boolean).join(' ') || 'Não informado'}</td>
                  <td>{evento.dataPublicacao ?? 'Não informada'}</td>
                  <td>{evento.fonte}{evento.removidoNaFonte ? ' — removido na fonte' : ''}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <div className="acoes">
            <button type="button" className="secundario" disabled={!cursor} onClick={() => setCursor(undefined)}>Primeira página de eventos</button>
            <button type="button" className="secundario" disabled={!pagina.proximoCursor} onClick={() => setCursor(pagina.proximoCursor ?? undefined)}>Próxima página de eventos</button>
          </div>
        </>
      )}
    </section>
  );
}

function Detalhe({ pessoaId, vinculoInicial, csrf, podeSalvar, podeEditarCadastro, onCadastroAtualizado, onFechar, onErro, onLimpar, onPendente, confirmarSaida }: Props & ProtecaoEdicao & {
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

export function Servidores({ csrf, podeSalvar, podeEditarCadastro, consulta, onErro, onLimpar, onPendente, confirmarSaida }: Props & ProtecaoEdicao & {
  csrf: string; podeSalvar: boolean; podeEditarCadastro: boolean; consulta: Consulta | null;
}) {
  const [pagina, setPagina] = useState<PaginaBuscaServidores | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [pessoaId, setPessoaId] = useState<string | null>(null);
  const [vinculoInicial, setVinculoInicial] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [versao, setVersao] = useState(0);
  const filtro = useFiltroLista(pagina?.itens ?? [], (item) =>
    `${item.nome} ${item.cpf} ${item.matricula} ${item.orgao ?? ''} ${item.sistemaOrigem} ${item.removidoNaFonte ? 'Removido na fonte' : ''}`);
  const trocarContexto = (acao: () => void) => {
    if (confirmarSaida()) { onPendente(false); acao(); }
  };
  useEffect(() => {
    let ativa = true;
    setPagina(null);
    setFalhou(false);
    api.buscarServidores(consulta?.q, consulta?.tipo, cursor).then((resultado) => {
      if (ativa) setPagina(resultado);
    }).catch((erro: unknown) => {
      if (ativa) { setFalhou(true); onErro(erro); }
    });
    return () => { ativa = false; };
  }, [consulta, cursor, versao, onErro]);

  return (
    <section aria-labelledby="busca-titulo">
      <h2 id="busca-titulo" className={pessoaId ? 'sr-only' : undefined}>Consulta de servidores</h2>
      {!pessoaId && <p>Os resultados são locais. Matrículas e sufixos são preservados; confira a origem quando houver duplicidade.</p>}
      {!consulta && <p>Vínculos por matrícula em ordem natural crescente, 50 por página. Use a busca no topo para filtrar por nome, CPF ou matrícula.</p>}
      {!pessoaId && <p className="aviso">Dados pessoais completos para atividades autorizadas do setor. O acesso é auditado.</p>}
      {!pessoaId && <FiltrosLista filtro={filtro} onAtualizar={() => setVersao((atual) => atual + 1)} />}
      {!pessoaId && (falhou ? <button type="button" className="secundario" onClick={() => { onLimpar(); setVersao((atual) => atual + 1); }}>Tentar buscar novamente</button> : !pagina ? <p role="status">Buscando...</p> : pagina && (
        <>
          <h3>Resultados</h3>
          {pagina.itens.length === 0 ? <p>Nenhum vínculo encontrado.</p> : (
            <div className="tabela"><table>
              <thead><tr><th scope="col">Nome</th><th scope="col">CPF</th><th scope="col">Matrícula</th><th scope="col">Órgão</th><th scope="col">Origem</th><th scope="col">Detalhes</th></tr></thead>
              <tbody>{filtro.itens.map((item) => (
                <tr key={item.vinculoId}>
                  <td>{item.nome}</td><td>{item.cpf}</td><td>{item.matricula}{item.removidoNaFonte ? ' — removido na fonte' : ''}</td>
                  <td>{item.orgao ?? 'Não informado'}</td><td>{item.sistemaOrigem}</td>
                  <td><button type="button" className="secundario" onClick={() => {
                    if (pessoaId === item.pessoaId) return;
                    trocarContexto(() => { onLimpar(); setVinculoInicial(item.vinculoId); setPessoaId(item.pessoaId); });
                  }}>Ver vínculos <span className="sr-only">de {item.nome}, matrícula {item.matricula}</span></button></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <div className="acoes">
            <button type="button" className="secundario" disabled={!cursor}
              onClick={() => trocarContexto(() => { setPessoaId(null); setCursor(undefined); })}>Primeira página de resultados</button>
            <button type="button" className="secundario" disabled={!pagina.proximoCursor}
              onClick={() => trocarContexto(() => { setPessoaId(null); setCursor(pagina.proximoCursor ?? undefined); })}>Próxima página de resultados</button>
          </div>
        </>
      ))}
      {pessoaId && <Detalhe key={pessoaId} pessoaId={pessoaId} vinculoInicial={vinculoInicial} csrf={csrf} podeSalvar={podeSalvar}
        podeEditarCadastro={podeEditarCadastro} onCadastroAtualizado={() => setVersao((atual) => atual + 1)}
        onFechar={() => setPessoaId(null)} onErro={onErro} onLimpar={onLimpar}
        onPendente={onPendente} confirmarSaida={confirmarSaida} />}
    </section>
  );
}
