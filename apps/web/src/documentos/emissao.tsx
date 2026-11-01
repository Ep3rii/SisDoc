import { ROTULOS_DTC, type SituacaoEmissao } from '@sisdoc/contratos';
import { useEffect, useState } from 'react';
import { api } from '../infraestrutura/api';

const rotulosPdf: Record<SituacaoEmissao['pdf']['status'], string> = {
  pendente: 'Na fila de geração',
  processando: 'Sendo gerado',
  concluido: 'Disponível',
  falhou: 'Falhou; nova tentativa automática',
};

/** Traduz estado de geração e destaca falha persistente após o limite de tentativas. */
export function rotuloPdf(situacao: SituacaoEmissao): string {
  if (situacao.pdf.status === 'falhou' && situacao.pdf.erro && situacao.pdf.tentativas >= 5) return 'Falha persistente';
  return rotulosPdf[situacao.pdf.status];
}

/** Inicia download autenticado e libera a URL temporária após o navegador recebê-la. */
export async function baixarPdfEmissao(emissaoId: string): Promise<string> {
  const { nome, arquivo } = await api.baixarPdf(emissaoId);
  const endereco = URL.createObjectURL(arquivo);
  try {
    const ancora = document.createElement('a');
    ancora.href = endereco;
    ancora.download = nome;
    ancora.rel = 'noopener';
    document.body.append(ancora);
    ancora.click();
    ancora.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(endereco), 1000);
  }
  return nome;
}

type Props = {
  situacao: SituacaoEmissao;
  onErro: (erro: unknown) => void;
  onLimpar: () => void;
};

/** Acompanha PDF de emissão existente sem repetir a operação de emissão. */
export function PainelEmissao({ situacao: inicial, onErro, onLimpar }: Props) {
  const [situacao, setSituacao] = useState(inicial);
  const [baixando, setBaixando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const aguardando = !situacao.pdf.disponivel && !(situacao.pdf.status === 'falhou' && situacao.pdf.tentativas >= 5);

  useEffect(() => { setSituacao(inicial); }, [inicial]);

  useEffect(() => {
    if (!aguardando) return undefined;
    let corrente = true;
    const temporizador = setTimeout(() => {
      api.situacaoEmissao(situacao.emissaoId).then((atual) => {
        if (corrente && atual.emissaoId === situacao.emissaoId) setSituacao(atual);
      }).catch((erro: unknown) => {
        if (corrente) onErro(erro);
      });
    }, 2000);
    return () => { corrente = false; clearTimeout(temporizador); };
  }, [aguardando, situacao, onErro]);

  /** Baixa o PDF pronto e informa falhas sem perder o estado da emissão. */
  async function baixar() {
    try {
      onLimpar();
      setBaixando(true);
      const nome = await baixarPdfEmissao(situacao.emissaoId);
      setMensagem(`Download iniciado: ${nome}.`);
    } catch (erro) {
      onErro(erro);
    } finally {
      setBaixando(false);
    }
  }

  return (
    <div className="painel-emissao" aria-live="polite">
      <p className="aviso sucesso" role="status">
        {situacao.tipo === 'DOF' ? 'DOF' : ROTULOS_DTC[situacao.tipo]} emitida: {situacao.numero}, em{' '}
        {new Date(situacao.emitidoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} por {situacao.emitidoPorNome}.
      </p>
      <p>Situação do PDF: <strong>{rotuloPdf(situacao)}</strong>
        {situacao.pdf.tentativas > 0 && ` (tentativas: ${situacao.pdf.tentativas})`}.</p>
      {situacao.pdf.erro && <p className="aviso erro">{situacao.pdf.erro}</p>}
      {situacao.status === 'cancelado' && <p className="aviso erro">Esta emissão foi cancelada.</p>}
      {mensagem && <p role="status">{mensagem}</p>}
      <button type="button" disabled={!situacao.pdf.disponivel || baixando} onClick={() => void baixar()}>
        {baixando ? 'Baixando PDF...' : 'Baixar PDF'}
      </button>
    </div>
  );
}
