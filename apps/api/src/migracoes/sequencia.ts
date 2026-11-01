import type { Client } from 'pg';
import { aplicarAutenticacao } from './autenticacao';
import { aplicarBlocosDof } from './blocos-dof';
import { aplicarConferenciaDof } from './conferencia-dof';
import { aplicarConfirmacaoInicioDof } from './confirmacao-inicio-dof';
import { aplicarConsulta } from './consulta';
import { aplicarDevolucaoDof } from './devolucao-dof';
import { aplicarDtc } from './dtc';
import { aplicarEmissao } from './emissao';
import { aplicarImportacao } from './importacao';
import { aplicarEncaminhamentoDof } from './encaminhamento-dof';
import { aplicarModelo } from './modelo';
import { aplicarPreconferenciaDof } from './preconferencia-dof';
import { aplicarProcessoDof } from './processo-dof';
import { aplicarRascunhoDof } from './rascunho-dof';
import { aplicarRevisaoFonteDof } from './revisao-fonte-dof';

type Migracao = { versao: string; aplicar: (cliente: Client, usuarioAplicacao: string) => Promise<boolean> };

export const SEQUENCIA_MIGRACOES: readonly Migracao[] = [
  { versao: '001-modelo', aplicar: aplicarModelo },
  { versao: '002-autenticacao', aplicar: aplicarAutenticacao },
  { versao: '003-consulta', aplicar: aplicarConsulta },
  { versao: '004-rascunho-dof', aplicar: aplicarRascunhoDof },
  { versao: '005-blocos-dof', aplicar: aplicarBlocosDof },
  { versao: '006-processo-dof', aplicar: aplicarProcessoDof },
  { versao: '007-encaminhamento-dof', aplicar: aplicarEncaminhamentoDof },
  { versao: '008-preconferencia-dof', aplicar: aplicarPreconferenciaDof },
  { versao: '009-confirmacao-inicio-dof', aplicar: aplicarConfirmacaoInicioDof },
  { versao: '010-devolucao-dof', aplicar: aplicarDevolucaoDof },
  { versao: '011-revisao-fonte-dof', aplicar: aplicarRevisaoFonteDof },
  { versao: '012-conferencia-dof', aplicar: aplicarConferenciaDof },
  { versao: '013-emissao', aplicar: aplicarEmissao },
  { versao: '014-dtc', aplicar: aplicarDtc },
  { versao: '015-importacao', aplicar: aplicarImportacao },
];

// Deve ser chamada dentro de uma transação aberta pelo papel de migração; devolve as versões aplicadas agora.
export async function aplicarMigracoesPendentes(cliente: Client, usuarioAplicacao: string): Promise<string[]> {
  const aplicadas: string[] = [];
  for (const migracao of SEQUENCIA_MIGRACOES) {
    if (await migracao.aplicar(cliente, usuarioAplicacao)) aplicadas.push(migracao.versao);
  }
  return aplicadas;
}
