import type { Page } from 'playwright';
import type { CenarioVisual, ConfiguracaoVisual, EstadoVisual, PerfilVisual } from './tipos';

const todos: PerfilVisual[] = ['admin', 'analista', 'coordenador'];
const listas: EstadoVisual[] = ['dados', 'vazio', 'carregando', 'erro', 'lista-longa', 'texto-longo'];
const dados: EstadoVisual[] = ['dados', 'texto-longo'];
const aguardar = async (page: Page, config: ConfiguracaoVisual, seletor: string) => {
  if (config.estado === 'erro') await page.getByRole('alert').first().waitFor();
  else if (config.estado === 'carregando') await page.getByRole('status').filter({ hasText: /Carregando|Buscando/ }).first().waitFor();
  else await page.locator(seletor).first().waitFor();
};
export type Cenario = CenarioVisual & { alvo?: RegExp; tipo?: 'DTC_IPAM' | 'DTC_COMISSIONADO' | 'DTC_INSS'; conferida?: boolean; trocaSenha?: boolean };

async function ficha(page: Page) {
  await page.getByRole('button', { name: /^Ver vínculos/ }).first().click();
  await page.getByRole('heading', { name: 'Ficha do servidor', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Trocar servidor', exact: true }).waitFor();
}

export const cenarios: Cenario[] = [
  { id: 'login', rota: '#/inicio', perfis: ['sem-login'], estados: ['dados', 'erro'], zoom: true,
    preparar: async (page, config) => {
      await page.getByRole('button', { name: 'Entrar', exact: true }).waitFor();
      if (config.estado === 'erro') {
        await page.getByLabel('Matrícula', { exact: true }).fill('VISUAL-FICTICIO');
        await page.getByLabel('Senha', { exact: true }).fill('SenhaFicticiaLonga!123');
        await page.getByRole('button', { name: 'Entrar', exact: true }).click();
        await page.getByRole('alert').waitFor();
      }
    } },
  { id: 'troca-senha', rota: '#/inicio', perfis: todos, estados: dados, trocaSenha: true,
    preparar: async (page) => { await page.getByRole('heading', { name: 'Troca obrigatória de senha' }).waitFor(); } },
  { id: 'inicio', rota: '#/inicio', perfis: todos, estados: listas, zoom: true, alvo: /^servidores$/,
    preparar: async (page, config) => {
      await page.getByRole('textbox', { name: 'Buscar servidor no Início', exact: true }).waitFor();
      await aguardar(page, config, config.estado === 'vazio' ? 'h3' : '.tabela tbody tr');
    } },
  { id: 'ficha-servidor', rota: '#/inicio', perfis: todos, estados: listas, zoom: true, alvo: /\/ficha$/,
    preparar: async (page, config) => {
      await ficha(page);
      await aguardar(page, config, config.estado === 'vazio' ? '.ficha-servidor section' : '.ficha-vinculo');
    } },
  { id: 'documentos-servidor', rota: '#/inicio', perfis: todos, estados: dados, preparar: async (page) => {
    await ficha(page); await page.getByRole('heading', { name: 'Documentos deste servidor' }).scrollIntoViewIfNeeded();
  } },
  ...(['funcional', 'financeiro'] as const).map((grupo): Cenario => ({
    id: `historico-${grupo}`, rota: '#/inicio', perfis: todos, estados: listas,
    zoom: grupo === 'funcional', alvo: /\/historico$/,
    preparar: async (page, config) => {
      await ficha(page); await page.getByRole('button', { name: /^Histórico funcional \(/ }).click();
      if (grupo === 'financeiro') await page.getByRole('button', { name: 'Financeiro', exact: true }).click();
      await aguardar(page, config, '[aria-label="Histórico funcional e financeiro do vínculo"]');
      await page.getByRole('heading', { name: 'Histórico funcional e financeiro', exact: true }).scrollIntoViewIfNeeded();
    },
  })),
  ...(['funcional', 'financeiro'] as const).map((grupo): Cenario => ({
    id: `historico-${grupo}-detalhes`, rota: '#/inicio', perfis: todos, estados: dados,
    preparar: async (page) => {
      await ficha(page); await page.getByRole('button', { name: /^Histórico funcional \(/ }).click();
      if (grupo === 'financeiro') await page.getByRole('button', { name: 'Financeiro', exact: true }).click();
      const registro = page.locator('[aria-label="Histórico funcional e financeiro do vínculo"] > details').first();
      await registro.locator('summary').click(); await registro.scrollIntoViewIfNeeded();
    },
  })),
  { id: 'historico-revisoes', rota: '#/inicio', perfis: todos, estados: dados,
    preparar: async (page) => {
      await ficha(page); await page.getByRole('button', { name: /^Histórico funcional \(/ }).click();
      const registro = page.locator('[aria-label="Histórico funcional e financeiro do vínculo"] > details').first();
      await registro.locator('summary').click();
      await registro.getByRole('button', { name: 'Consultar revisões e motivos', exact: true }).click();
      await registro.locator('[aria-label="Revisões do registro histórico"] details > summary').first().click();
      await registro.locator('[aria-label="Revisões do registro histórico"]').scrollIntoViewIfNeeded();
    } },
  { id: 'sugestoes-cadastro', rota: '#/inicio', perfis: todos, estados: dados,
    preparar: async (page) => {
      await ficha(page); await page.getByLabel('Dados de referência do vínculo').selectOption({ index: 1 });
      const sugestoes = page.locator('[aria-label="Sugestões de atualização do cadastro"]');
      await sugestoes.locator('details > summary').first().click();
      await sugestoes.scrollIntoViewIfNeeded();
    } },
  { id: 'registro-historico', rota: '#/inicio', perfis: ['admin'], estados: dados, preparar: async (page) => {
    await ficha(page); await page.getByRole('button', { name: /^Histórico funcional \(/ }).click();
    await page.getByRole('button', { name: 'Adicionar registro funcional', exact: true }).click();
    await page.getByRole('heading', { name: 'Novo registro', exact: true }).scrollIntoViewIfNeeded();
  } },
  { id: 'importar-historico', rota: '#/inicio', perfis: ['admin'], estados: dados, preparar: async (page) => {
    await ficha(page); await page.getByRole('button', { name: /^Histórico funcional \(/ }).click();
    await page.getByRole('button', { name: 'Importar CSV/XLSX/XML', exact: true }).click();
    await page.getByRole('heading', { name: /^Importar histórico funcional deste vínculo/ }).scrollIntoViewIfNeeded();
  } },
  { id: 'referencias-cadastro', rota: '#/inicio', perfis: todos, estados: dados, preparar: async (page) => {
    await ficha(page); await page.getByLabel('Dados de referência do vínculo').selectOption({ index: 1 });
    await page.getByRole('heading', { name: 'Dados de referência — DOF e DTCs' }).scrollIntoViewIfNeeded();
  } },
  { id: 'cadastro-edicao', rota: '#/inicio', perfis: ['admin'], estados: dados, preparar: async (page) => {
    await ficha(page); await page.getByLabel('Dados de referência do vínculo').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Editar cadastro local', exact: true }).click();
    await page.getByRole('heading', { name: 'Editar cadastro local', exact: true }).scrollIntoViewIfNeeded();
  } },
  { id: 'eventos-fonte', rota: '#/inicio', perfis: todos, estados: dados, preparar: async (page) => {
    await ficha(page); await page.getByLabel('Eventos da fonte').selectOption({ index: 1 });
    await page.getByRole('heading', { name: 'Eventos do vínculo' }).scrollIntoViewIfNeeded();
  } },
  ...(['dofs', 'dtcs'] as const).flatMap((grupo) => ['rascunhos', 'encaminhadas', 'devolvidas', 'conferidas'].map((aba): Cenario => ({
    id: `${grupo}-${aba}`, rota: `#/${grupo}/${aba}`, perfis: todos, estados: listas, zoom: grupo === 'dofs' && aba === 'rascunhos',
    alvo: /^documentos\/lista$/,
    preparar: async (page, config) => { await aguardar(page, config, '#lista-documentos-titulo'); },
  }))),
  ...(['Dados do servidor', 'Período', 'Tabela ano a ano', 'Blocos de texto', 'Conferência'] as const).map((aba, i): Cenario => ({
    id: ['editor-dof', 'dof-periodo', 'dof-tabela', 'dof-blocos', 'dof-conferencia'][i],
    rota: '#/dofs/rascunhos', perfis: todos, estados: dados, zoom: i === 0,
    preparar: async (page) => {
      await page.locator('.linha-documento').first().click();
      await page.getByRole('heading', { name: /^DOF —/ }).waitFor();
      await page.getByRole('tab', { name: aba, exact: true }).click();
      await page.locator('.painel-previa iframe').first().waitFor();
    },
  })),
  { id: 'dof-conferida', rota: '#/dofs/conferidas', perfis: todos, estados: dados, preparar: async (page) => {
    await page.locator('.linha-documento').first().click();
    await page.locator('iframe').first().waitFor();
  } },
  { id: 'preview-ampliado', rota: '#/dofs/rascunhos', perfis: todos, estados: dados, preparar: async (page) => {
    await page.locator('.linha-documento').first().click();
    await page.locator('.painel-previa iframe').first().waitFor();
    await page.getByRole('button', { name: 'Ampliar prévia', exact: true }).click();
    await page.getByRole('dialog').waitFor();
  } },
  { id: 'excluir-documento', rota: '#/dofs/rascunhos', perfis: ['admin'], estados: dados, preparar: async (page) => {
    await page.locator('.menu-acoes-documento > button').first().click();
    await page.getByRole('button', { name: 'Excluir', exact: true }).click();
    await page.getByRole('button', { name: 'Cancelar exclusão', exact: true }).waitFor();
  } },
  { id: 'emissao-lote', rota: '#/dofs/conferidas', perfis: ['admin', 'coordenador'], estados: dados, preparar: async (page) => {
    await page.locator('summary').filter({ hasText: 'Emitir em lote' }).click();
    await page.getByRole('button', { name: /documento\(s\) selecionado\(s\)/ }).waitFor();
  } },
  ...(['DTC_IPAM', 'DTC_COMISSIONADO', 'DTC_INSS'] as const).flatMap((tipo) => [
    { id: `${tipo.toLowerCase()}-detalhe`, rota: `#/dtcs/rascunhos?tipo=${tipo}`, perfis: todos, estados: dados, tipo,
      preparar: async (page: Page) => {
        await page.locator('.linha-documento').first().click();
        await page.getByRole('button', { name: 'Editar rascunho', exact: true }).waitFor();
        await page.locator('.painel-previa iframe').first().waitFor();
      } },
    ...(['Identificação', 'Períodos', ...(tipo === 'DTC_IPAM' ? [] : [tipo === 'DTC_INSS' ? 'Documentação' : 'Cargos']), 'Conferência']).map((aba, i) => ({
      id: `${tipo.toLowerCase()}-editor-${i + 1}`, rota: `#/dtcs/rascunhos?tipo=${tipo}`, perfis: todos, estados: dados, tipo,
      preparar: async (page: Page) => {
        await page.locator('.linha-documento').first().click();
        await page.getByRole('button', { name: 'Editar rascunho', exact: true }).click();
        await page.getByRole('tab', { name: aba, exact: true }).click();
        await page.locator('.painel-previa iframe').first().waitFor();
      },
    })),
    { id: `${tipo.toLowerCase()}-conferida`, rota: `#/dtcs/conferidas?tipo=${tipo}`, perfis: todos, estados: dados, tipo, conferida: true,
      preparar: async (page: Page) => {
        await page.locator('.linha-documento').first().click();
        await page.locator('.painel-previa iframe').first().waitFor();
      } },
  ]),
  { id: 'usuarios', rota: '#/administracao/usuarios', perfis: ['admin'], estados: listas, alvo: /^admin\/usuarios$/,
    preparar: async (page, config) => { await aguardar(page, config, '#usuarios-titulo'); } },
  { id: 'novo-usuario', rota: '#/administracao/usuarios', perfis: ['admin'], estados: dados, preparar: async (page) => {
    await page.getByRole('button', { name: 'Novo usuário', exact: true }).click();
    await page.getByRole('dialog', { name: 'Novo usuário', exact: true }).waitFor();
  } },
  { id: 'editar-usuario', rota: '#/administracao/usuarios', perfis: ['admin'], estados: dados, preparar: async (page) => {
    await page.getByRole('button', { name: /^Editar / }).first().click();
    await page.getByRole('button', { name: 'Redefinir senha', exact: true }).scrollIntoViewIfNeeded();
  } },
  { id: 'auditoria', rota: '#/administracao/auditoria', perfis: ['admin'], estados: listas, alvo: /^admin\/auditoria$/,
    preparar: async (page, config) => { await aguardar(page, config, '#auditoria-titulo'); } },
  { id: 'sincronizacao', rota: '#/administracao/sincronizacao', perfis: ['admin'], estados: listas, alvo: /^admin\/sincronizacoes$/,
    preparar: async (page, config) => { await aguardar(page, config, '#sincronizacao-titulo'); } },
  ...(['Importar', 'Disponibilizar Legado', 'Exportar', 'Histórico'] as const).map((aba, i): Cenario => ({
    id: ['importacao', 'legado', 'exportacao', 'importacao-historico'][i], rota: '#/administracao/importacao', perfis: ['admin'], estados: i === 3 ? listas : dados,
    alvo: /^admin\/importacoes$/,
    preparar: async (page, config) => {
      await page.getByRole('tab', { name: aba, exact: true }).click();
      if (i === 3) await aguardar(page, config, '[role="tabpanel"]:not([hidden])');
      else await page.getByRole('tabpanel').filter({ visible: true }).waitFor();
    },
  })),
  { id: 'historico-emissoes', rota: '#/historico', perfis: todos, estados: listas, alvo: /^historico$/,
    preparar: async (page, config) => { await aguardar(page, config, '#historico-titulo'); } },
];
