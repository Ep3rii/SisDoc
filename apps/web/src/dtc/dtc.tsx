import {
  ROTULOS_DTC,
  type PaginaDtc
} from '@sisdoc/contratos';
import { useCallback, useEffect, useState } from 'react';
import { FiltrosLista, useFiltroLista } from '../compartilhado/filtros-lista';
import { ExclusaoDocumento } from '../documentos/exclusao-documento';
import { api } from '../infraestrutura/api';
import { BuscaServidor } from './busca-servidor';
import { conteudoInicial, DESCRICOES, Modo, Props } from './contexto';
import { Documento } from './documento';
import { Editor } from './editor';

/** Alterna lista, seleção, editor e documento DTC preservando a confirmação de saída. */
export function TelaDtc({ tipo, csrf, papel, onErro, onLimpar, onPendente, confirmarSaida }: Props) {
  const [modo, setModo] = useState<Modo>({ tela: 'lista' });
  const [estado, setEstado] = useState<'rascunho' | 'conferido'>('rascunho');
  const [pagina, setPagina] = useState<PaginaDtc | null>(null);
  const [versao, setVersao] = useState(0);
  const [mensagem, setMensagem] = useState('');
  const filtro = useFiltroLista(pagina?.itens ?? [], (item) =>
    `${item.nome} ${item.matricula} ${item.autorNome} ${item.revisao} ${item.status} ${new Date(item.atualizadoEm).toLocaleString('pt-BR')}`);
  const voltar = useCallback(() => {
    if (!confirmarSaida()) return;
    onPendente(false);
    setModo({ tela: 'lista' });
    setVersao((atual) => atual + 1);
  }, [confirmarSaida, onPendente]);

  useEffect(() => {
    if (modo.tela !== 'lista') return undefined;
    let corrente = true;
    setPagina(null);
    api.listarDtc(estado, tipo).then((resultado) => {
      if (corrente) setPagina(resultado);
    }).catch((erro: unknown) => {
      if (corrente) onErro(erro);
    });
    return () => { corrente = false; };
  }, [modo.tela, estado, tipo, versao, onErro]);

  if (modo.tela === 'busca') {
    return <BuscaServidor onSelecionar={(servidor) => setModo({ tela: 'novo', servidor })} onCancelar={voltar}
      onErro={onErro} onLimpar={onLimpar} />;
  }
  if (modo.tela === 'novo') {
    return <div className="estudio-dof"><Editor tipo={tipo} inicial={conteudoInicial(tipo)} documento={null} servidor={modo.servidor} csrf={csrf}
      onSalvo={(documento) => setModo({ tela: 'documento', id: documento.id })} onCancelar={voltar}
      onErro={onErro} onLimpar={onLimpar} onPendente={onPendente} /></div>;
  }
  if (modo.tela === 'documento') {
    return <Documento key={modo.id} id={modo.id} tipo={tipo} csrf={csrf} papel={papel} onVoltar={voltar}
      onErro={onErro} onLimpar={onLimpar} onPendente={onPendente} />;
  }
  return (
    <section className="painel" aria-labelledby="dtc-titulo">
      <h2 id="dtc-titulo">{ROTULOS_DTC[tipo]}</h2>
      <p>{DESCRICOES[tipo]}</p>
      <FiltrosLista filtro={filtro} antesAlterar={confirmarSaida} onAtualizar={() => setVersao((atual) => atual + 1)}>
        {papel !== 'admin' && <button type="button" onClick={() => { onLimpar(); setModo({ tela: 'busca' }); }}>
          Nova {ROTULOS_DTC[tipo]}</button>}
        <label>Situação<select value={estado} onChange={(evento) => {
          if (confirmarSaida()) setEstado(evento.target.value === 'conferido' ? 'conferido' : 'rascunho');
        }}>
          <option value="rascunho">{papel === 'coordenador' || papel === 'admin' ? 'Rascunhos' : 'Meus rascunhos'}</option>
          <option value="conferido">Conferidas</option>
        </select></label>
      </FiltrosLista>
      {mensagem && <p className="aviso sucesso" role="status">{mensagem}</p>}
      {!pagina ? <p role="status">Carregando...</p> : pagina.itens.length === 0 ? <p>Nenhum documento nesta situação.</p> : (
        <div className="tabela"><table>
          <thead><tr><th scope="col">Nome</th><th scope="col">Matrícula</th><th scope="col">Revisão</th>
            <th scope="col">Atualizado em</th><th scope="col">Autor</th><th scope="col">Ações</th></tr></thead>
          <tbody>{filtro.itens.map((item) => (
            <tr key={item.id}><td>{item.nome}</td><td>{item.matricula}</td><td>{item.revisao}</td>
              <td>{new Date(item.atualizadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</td><td>{item.autorNome}</td>
              <td><div className="acoes">
                <button type="button" className="secundario" onClick={() => { onLimpar(); setModo({ tela: 'documento', id: item.id }); }}>
                  Abrir <span className="sr-only">{item.nome}</span></button>
                {papel === 'admin' && <ExclusaoDocumento csrf={csrf} documentoId={item.id} revisao={item.revisao}
                  descricao={`${item.status === 'rascunho' ? 'rascunho' : 'DTC conferida'} de ${item.nome}`}
                  onErro={onErro} onPendente={onPendente} onConcluido={(resultado) => {
                    setMensagem(resultado.estado === 'concluido'
                      ? 'Documento apagado fisicamente; registros de auditoria foram preservados.'
                      : 'Solicitação registrada e pendente de remoção segura do PDF ou liberação de dependências.');
                    setVersao((atual) => atual + 1);
                  }} />}
              </div></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}
