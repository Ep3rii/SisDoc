import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/** Resultado de domínio retornado antes do commit para preservar auditoria de falhas esperadas. */
export type Falha = { tipo: 'invalido' | 'conflito' | 'nao_encontrado'; mensagem: string };

export type Tentativa<T> = { valor: T } | { falha: Falha };

/** Converte falha esperada em HTTP somente depois da transação, evitando rollback da auditoria. */
export function concluir<T>(tentativa: Tentativa<T>): T {
  if ('valor' in tentativa) return tentativa.valor;
  if (tentativa.falha.tipo === 'conflito') throw new ConflictException(tentativa.falha.mensagem);
  if (tentativa.falha.tipo === 'nao_encontrado') throw new NotFoundException(tentativa.falha.mensagem);
  throw new BadRequestException(tentativa.falha.mensagem);
}
