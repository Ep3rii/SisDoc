import type { ServerResponse } from 'node:http';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';

const titulos: Record<number, string> = {
  400: 'Requisição inválida',
  401: 'Não autorizado',
  403: 'Acesso negado',
  404: 'Não encontrado',
  409: 'Conflito',
  429: 'Limite de requisições',
  500: 'Erro interno',
  503: 'Serviço indisponível',
};

@Catch()
export class FiltroProblemas implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(erro: unknown, contexto: ArgumentsHost): void {
    const resposta = contexto.switchToHttp().getResponse<ServerResponse>();
    const status = erro instanceof HttpException ? erro.getStatus() : 500;
    if (status >= 500) this.logger.error('Falha interna ou de infraestrutura; consulte o responsável.');
    if (resposta.headersSent) {
      resposta.destroy();
      return;
    }
    const detalhe = erro instanceof HttpException
      ? erro.message
      : 'Não foi possível concluir a operação. Contate o administrador.';
    resposta.statusCode = status;
    resposta.setHeader('Content-Type', 'application/problem+json; charset=utf-8');
    resposta.end(JSON.stringify({ type: 'about:blank', title: titulos[status] ?? 'Falha na requisição', status, detail: detalhe }));
  }
}
