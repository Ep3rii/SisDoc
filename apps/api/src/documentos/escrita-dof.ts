import { randomUUID } from 'node:crypto';
import { type PoolClient } from 'pg';
import { ProtetorDados } from '../seguranca/protecao-dados';
import { type Mudanca } from './contexto-dof';

/** Escrita contextual de valores e ajustes cifrados na transação existente do documento. */
export class EscritaDof {
  /** Compartilha o protetor; não cria conexão, lock ou transação. */
  constructor(private readonly protetor: ProtetorDados) {}

  /** Cifra JSON vinculando o valor ao registro e campo de destino no domínio documentos. */
  cifrar(tabela: string, id: string, campo: string, valor: unknown): Buffer {
    return this.protetor.cifrar(Buffer.from(JSON.stringify(valor), 'utf8'), {
      schema: 'documentos', tabela, registroId: id, campo,
    });
  }

  /** Grava valores anteriores/novos e motivo cifrados no mesmo cliente da alteração. */
  async registrarAjustes(
    cliente: PoolClient,
    documentoId: string,
    usuarioId: string,
    motivo: string,
    alteracoes: Mudanca[],
  ): Promise<void> {
    for (const alteracao of alteracoes) {
      const id = randomUUID();
      await cliente.query(`
        INSERT INTO documentos.ajuste_campo
          (id, documento_id, campo, valor_original_cifrado, valor_novo_cifrado, motivo_cifrado, usuario_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        id, documentoId, alteracao.campo,
        alteracao.anterior === null ? null : this.cifrar('ajuste_campo', id, 'valor_original_cifrado', alteracao.anterior),
        this.cifrar('ajuste_campo', id, 'valor_novo_cifrado', alteracao.novo),
        this.cifrar('ajuste_campo', id, 'motivo_cifrado', motivo),
        usuarioId,
      ]);
    }
  }
}
