import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { importarHistoricoQuerySchema, registroHistoricoSchema, relatorioImportacaoHistoricoSchema, type RegistroHistorico } from '@sisdoc/contratos';
import { transacao } from '../banco';
import { lerPlanilha, ErroPlanilha } from '../importacao/planilhas';
import { ErroXmlImportacao } from '../importacao/xml';
import { importarPlanilhaLegado } from '../importacao/planilha-legado';
import { confirmarSessao } from '../seguranca/sessao-transacao';
import { papeisPermitidos } from '../seguranca/permissoes';
import type { SessaoAutenticada } from '../seguranca/autenticacao';
import { HistoricoServidorService, type LinhaHistoricoServidor } from './historico-servidor';

const normalizar = (campo: string) => campo.normalize('NFD').replace(/[\u0300-\u036f_\s]/g, '').toLowerCase();
export function analisarHistorico(linhas: string[][], origem: string) {
  const colunas = Object.keys(registroHistoricoSchema.shape);
  const cabecalho = linhas[0];
  if (!cabecalho?.length || new Set(cabecalho.map(normalizar)).size !== cabecalho.length) throw new UnprocessableEntityException('Cabeçalhos ausentes ou duplicados.');
  const campos = cabecalho.map((nome) => colunas.find((campo) => normalizar(campo) === normalizar(nome)));
  if (campos.some((campo) => !campo)) throw new UnprocessableEntityException('Há colunas desconhecidas no modelo de histórico.');
  if (linhas.length > 100001) throw new UnprocessableEntityException('Use no máximo 100 mil registros históricos.');
  const registros: Array<{ linha: number; registro: RegistroHistorico }> = [];
  const ocorrencias: Array<{ linha: number; motivo: string }> = [];
  const ids = new Set<string>();
  for (const [indice, valores] of linhas.slice(1).entries()) {
    const linha = indice + 2;
    if (valores.length > campos.length && valores.slice(campos.length).some((valor) => valor.trim())) {
      ocorrencias.push({ linha, motivo: 'Há valores sem cabeçalho.' }); continue;
    }
    const dados: Record<string, unknown> = Object.fromEntries(colunas.map((campo) => [campo, null]));
    dados.origem = origem;
    dados.efeitoTempo = 'nao_informado'; dados.efeitoRemuneracao = 'nao_informado';
    campos.forEach((campo, i) => {
      if (!campo) return;
      const valor = (valores[i] ?? '').trim();
      if (valor) dados[campo] = campo === 'diasInformados' ? Number(valor) : valor;
    });
    const validado = registroHistoricoSchema.safeParse(dados);
    if (!validado.success || validado.data.origem !== origem || !validado.data.idOrigem) {
      ocorrencias.push({ linha, motivo: !validado.success ? validado.error.issues.map((erro) => `${erro.path.join('.')}: ${erro.message}`).join(' ') : 'Informe identificador e mesma origem técnica.' }); continue;
    }
    if (ids.has(validado.data.idOrigem)) { ocorrencias.push({ linha, motivo: 'Identificador de origem repetido no arquivo.' }); continue; }
    ids.add(validado.data.idOrigem); registros.push({ linha, registro: validado.data });
  }
  return { registros, ocorrencias };
}

export async function importarHistorico(historico: HistoricoServidorService, sessao: SessaoAutenticada, ip: string,
  pessoaId: string, consulta: ReturnType<typeof importarHistoricoQuerySchema.parse>, arquivo: Buffer) {
  let linhas: string[][];
  try { linhas = lerPlanilha(arquivo, consulta.aba).linhas; }
  catch (erro) {
    if (erro instanceof ErroPlanilha || erro instanceof ErroXmlImportacao) throw new UnprocessableEntityException(erro.message);
    throw erro;
  }
  const analise = analisarHistorico(linhas, consulta.origem);
  return transacao(historico.banco, async (cliente) => {
    await confirmarSessao(cliente, sessao, papeisPermitidos('editar_servidor'));
    await historico.vinculo(cliente, pessoaId, consulta.vinculoId, true);
    const existentes = await cliente.query<LinhaHistoricoServidor>('SELECT * FROM nucleo.historico_servidor WHERE vinculo_id = $1 ORDER BY id FOR UPDATE', [consulta.vinculoId]);
    const validacao = historico.protetor.hashConteudo('importacao', 'historico_servidor_v1', {
      pessoaId, vinculoId: consulta.vinculoId, origem: consulta.origem, linhas, sessao: sessao.hash.toString('hex'),
      revisoes: existentes.rows.map((linha) => [linha.id, linha.revisao]),
    }).toString('hex');
    if (consulta.modo === 'gravar') {
      const enviada = Buffer.from(consulta.validacao ?? '', 'hex');
      const esperada = Buffer.from(validacao, 'hex');
      if (enviada.length !== esperada.length || !timingSafeEqual(enviada, esperada)) throw new ConflictException('Arquivo, sessão ou histórico mudou. Valide novamente.');
    }
    const atuais = existentes.rows.map((linha) => historico.apresentar(linha));
    const ocorrencias = [...analise.ocorrencias];
    const novos: typeof analise.registros = [];
    const estornos = new Set<string>();
    let rejeitados = analise.ocorrencias.length;
    let inalterados = 0; let divergentes = 0;
    for (const item of analise.registros) {
      const existente = atuais.find((outro) => outro.registro.origem === consulta.origem && outro.registro.idOrigem === item.registro.idOrigem);
      if (!existente) {
        try {
          await historico.validarRelacoes(cliente, consulta.vinculoId, item.registro);
          if (item.registro.situacao === 'estornado' && item.registro.relacionadoId) {
            if (estornos.has(item.registro.relacionadoId)) throw new ConflictException('Pagamento repetido entre os estornos deste arquivo.');
            estornos.add(item.registro.relacionadoId);
          }
          novos.push(item);
        } catch (erro) {
          if (!(erro instanceof ConflictException || erro instanceof UnprocessableEntityException)) throw erro;
          rejeitados++; ocorrencias.push({ linha: item.linha, motivo: erro.message });
        }
      }
      else if (JSON.stringify(existente.registro) === JSON.stringify(item.registro)) inalterados++;
      else { divergentes++; ocorrencias.push({ linha: item.linha, motivo: 'Divergência com registro existente; edição manual preservada.' }); }
    }
    let loteId: string | null = null;
    if (consulta.modo === 'gravar') {
      const identidade = consulta.aba ? Buffer.concat([Buffer.from(`sisdoc/aba/v1:${JSON.stringify(consulta.aba)}\0`), arquivo]) : arquivo;
      const lote = await importarPlanilhaLegado(cliente, historico.protetor, linhas, identidade,
        { origem: consulta.origem, destino: 'legado', tipo: 'dados_funcionais', modo: 'gravar' }, sessao.usuario.id, ip);
      loteId = lote.loteId ?? lote.loteExistente;
      if (!loteId) throw new Error('A recepção protegida do histórico não foi confirmada.');
      for (const item of novos) {
        const gravado = await historico.gravar(cliente, sessao, ip, pessoaId, consulta.vinculoId, item.registro,
          'Importação confirmada do histórico local.', undefined, undefined, loteId, item.linha);
        for (const aviso of gravado.avisos) ocorrencias.push({ linha: item.linha, motivo: aviso });
      }
    }
    return relatorioImportacaoHistoricoSchema.parse({
      modo: consulta.modo, validacao, inseridos: novos.length, inalterados, divergentes,
      rejeitados, ocorrencias, loteId,
    });
  });
}
