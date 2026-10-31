import { useEffect, useState, type FormEvent } from 'react';
import {
  buscarServidoresQuerySchema,
  type DetalheServidor,
  type PaginaBuscaServidores,
  type PaginaEventosServidor,
  type TipoBuscaServidor,
} from '@sisdoc/contratos';
import { api, ErroApi } from './api';
import { CalculoDof } from './calculo-dof';

type Props = { onErro: (erro: unknown) => void; onLimpar: () => void };
type Consulta = { q: string; tipo: TipoBuscaServidor };

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

function Detalhe({ pessoaId, csrf, onFechar, onErro, onLimpar }: Props & { pessoaId: string; csrf: string; onFechar: () => void }) {
  const [detalhe, setDetalhe] = useState<DetalheServidor | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [vinculoId, setVinculoId] = useState<string | null>(null);
  const [vinculoCalculo, setVinculoCalculo] = useState<{ id: string; matricula: string; admissao: string } | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    let ativa = true;
    setDetalhe(null);
    setFalhou(false);
    setVinculoId(null);
    setVinculoCalculo(null);
    api.servidor(pessoaId, cursor).then((resultado) => {
      if (ativa) setDetalhe(resultado);
    }).catch((erro: unknown) => {
      if (ativa) { setFalhou(true); onErro(erro); }
    });
    return () => { ativa = false; };
  }, [pessoaId, cursor, versao, onErro]);
  return (
    <section className="painel separado" aria-labelledby="detalhe-titulo">
      <h3 id="detalhe-titulo">Detalhes do servidor</h3>
      <div className="acoes"><button type="button" className="secundario" onClick={onFechar}>Fechar detalhes</button></div>
      {falhou ? <button type="button" className="secundario" onClick={() => { onLimpar(); setVersao((atual) => atual + 1); }}>Tentar carregar detalhes novamente</button> : !detalhe ? <p role="status">Carregando detalhes...</p> : (
        <>
          <h4>{detalhe.pessoa.nome}</h4>
          <p>CPF: {detalhe.pessoa.cpfMascarado}</p>
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
                  <td><button type="button" className="secundario" onClick={() => { onLimpar(); setVinculoCalculo(null); setVinculoId(vinculo.id); }}>Eventos <span className="sr-only">da matrícula {vinculo.matricula}</span></button></td>
                  <td>{admissao ? (
                    <button type="button" className="secundario" onClick={() => {
                      onLimpar();
                      setVinculoId(null);
                      setVinculoCalculo({ id: vinculo.id, matricula: vinculo.matricula, admissao });
                    }}>Calcular DOF <span className="sr-only">da matrícula {vinculo.matricula}</span></button>
                  ) : 'Admissão ausente na fonte'}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
          <div className="acoes">
            <button type="button" className="secundario" disabled={!cursor} onClick={() => setCursor(undefined)}>Primeira página de vínculos</button>
            <button type="button" className="secundario" disabled={!detalhe.proximoCursor} onClick={() => setCursor(detalhe.proximoCursor ?? undefined)}>Próxima página de vínculos</button>
          </div>
          {vinculoId && <Eventos key={vinculoId} pessoaId={pessoaId} vinculoId={vinculoId} onErro={onErro} onLimpar={onLimpar} />}
          {vinculoCalculo && (
            <CalculoDof key={vinculoCalculo.id} pessoaId={pessoaId} vinculoId={vinculoCalculo.id}
              nome={detalhe.pessoa.nome} matricula={vinculoCalculo.matricula} admissao={vinculoCalculo.admissao}
              csrf={csrf} onFechar={() => setVinculoCalculo(null)} onErro={onErro} onLimpar={onLimpar} />
          )}
        </>
      )}
    </section>
  );
}

export function Servidores({ csrf, onErro, onLimpar }: Props & { csrf: string }) {
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  const [pagina, setPagina] = useState<PaginaBuscaServidores | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [pessoaId, setPessoaId] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    if (!consulta) return;
    let ativa = true;
    setPagina(null);
    setFalhou(false);
    api.buscarServidores(consulta.q, consulta.tipo, cursor).then((resultado) => {
      if (ativa) setPagina(resultado);
    }).catch((erro: unknown) => {
      if (ativa) { setFalhou(true); onErro(erro); }
    });
    return () => { ativa = false; };
  }, [consulta, cursor, versao, onErro]);

  function buscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const valores = new FormData(evento.currentTarget);
    const resultado = buscarServidoresQuerySchema.safeParse({ q: valores.get('q'), tipo: valores.get('tipo') });
    if (!resultado.success || !resultado.data.tipo) {
      setConsulta(null);
      setPagina(null);
      setPessoaId(null);
      setCursor(undefined);
      setFalhou(false);
      onErro(new ErroApi(400, 'Informe nome com ao menos três caracteres, CPF válido ou matrícula exata.'));
      return;
    }
    onLimpar();
    setPessoaId(null);
    setCursor(undefined);
    setConsulta({ q: resultado.data.q, tipo: resultado.data.tipo });
  }

  return (
    <section aria-labelledby="busca-titulo">
      <h2 id="busca-titulo">Consulta de servidores</h2>
      <p>Os resultados são locais. Matrículas e sufixos são preservados; confira a origem quando houver duplicidade.</p>
      <form className="painel grade-busca" onSubmit={buscar}>
        <label>Tipo de busca<select name="tipo" defaultValue="nome"><option value="nome">Nome</option><option value="cpf">CPF</option><option value="matricula">Matrícula</option></select></label>
        <label>Termo de busca<input name="q" maxLength={200} required autoComplete="off" aria-describedby="orientacao-busca" /></label>
        <p id="orientacao-busca">Nome: mínimo de três caracteres. CPF: com ou sem máscara. Matrícula: informe o valor exato.</p>
        <button type="submit">Buscar</button>
      </form>
      {falhou ? <button type="button" className="secundario" onClick={() => { onLimpar(); setVersao((atual) => atual + 1); }}>Tentar buscar novamente</button> : consulta && !pagina ? <p role="status">Buscando...</p> : pagina && (
        <>
          <h3>Resultados</h3>
          {pagina.itens.length === 0 ? <p>Nenhum vínculo encontrado.</p> : (
            <div className="tabela"><table>
              <thead><tr><th scope="col">Nome</th><th scope="col">Matrícula</th><th scope="col">Órgão</th><th scope="col">Origem</th><th scope="col">Detalhes</th></tr></thead>
              <tbody>{pagina.itens.map((item) => (
                <tr key={item.vinculoId}>
                  <td>{item.nome}</td><td>{item.matricula}{item.removidoNaFonte ? ' — removido na fonte' : ''}</td>
                  <td>{item.orgao ?? 'Não informado'}</td><td>{item.sistemaOrigem}</td>
                  <td><button type="button" className="secundario" onClick={() => { onLimpar(); setPessoaId(item.pessoaId); }}>Ver vínculos <span className="sr-only">de {item.nome}, matrícula {item.matricula}</span></button></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <div className="acoes">
            <button type="button" className="secundario" disabled={!cursor} onClick={() => { setPessoaId(null); setCursor(undefined); }}>Primeira página de resultados</button>
            <button type="button" className="secundario" disabled={!pagina.proximoCursor} onClick={() => { setPessoaId(null); setCursor(pagina.proximoCursor ?? undefined); }}>Próxima página de resultados</button>
          </div>
        </>
      )}
      {pessoaId && <Detalhe key={pessoaId} pessoaId={pessoaId} csrf={csrf} onFechar={() => setPessoaId(null)} onErro={onErro} onLimpar={onLimpar} />}
    </section>
  );
}
