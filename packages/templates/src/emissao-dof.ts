import type { SnapshotEmissaoDof } from '@sisdoc/contratos';
import { renderizarEmissaoDofV1 } from './emissao-dof-v1';
import { renderizarModeloDof } from './modelo-dof';
import { TEMPLATES_OFICIAIS } from './versoes';

/** Seleciona renderer pelo snapshot; aprovação/versão v1 nunca recebe o novo desenho. */
export function renderizarEmissaoDof(dados: SnapshotEmissaoDof): string {
  if (dados.template.versao === 'emissao-dof-1') return renderizarEmissaoDofV1(dados);
  if (dados.template.versao !== TEMPLATES_OFICIAIS.DOF) throw new Error('Versão de template DOF não suportada.');
  return renderizarModeloDof({
    ...dados, classificacao: 'emissao',
    rodape: `SEMAD — Emitida em ${dados.dataEmissao}; regra ${dados.regra.codigo} ${dados.regra.versao}; modelo ${dados.template.versao}.`,
  });
}
