import type { Page } from 'playwright';

export type PerfilVisual = 'admin' | 'analista' | 'coordenador' | 'sem-login';
export type EstadoVisual = 'dados' | 'vazio' | 'carregando' | 'erro' | 'lista-longa' | 'texto-longo';
export type ConfiguracaoVisual = {
  perfil: PerfilVisual;
  estado: EstadoVisual;
  viewport: { width: number; height: number };
  zoom: number;
};
export type CenarioVisual = {
  id: string;
  rota: string;
  perfis: PerfilVisual[];
  estados: EstadoVisual[];
  zoom?: boolean;
  preparar: (page: Page, config: ConfiguracaoVisual) => Promise<void>;
};
