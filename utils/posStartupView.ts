import type { BusinessConfig, TerminalConfig } from '../types';

export type PosSalesStartView = 'POS' | 'TABLE_MAP';

const normalizeVertical = (value: unknown) => String(value || '').trim().toUpperCase();

export const resolvePosSalesStartView = (
  config: BusinessConfig,
  terminalConfig?: TerminalConfig | null,
): PosSalesStartView => {
  const vertical = normalizeVertical(
    terminalConfig?.operational?.vertical_negocio
    || config.business_config?.businessVertical
    || config.business_config?.vertical_negocio
    || config.vertical,
  );
  const usesTables = Boolean(
    terminalConfig?.operational?.usa_mesas
    ?? config.business_config?.useTables
    ?? config.business_config?.usa_mesas
    ?? (config as any).usesTables
  );
  const startScreen =
    terminalConfig?.operational?.pantalla_inicio
    || config.business_config?.pantalla_inicio
    || (config as any).pantalla_inicio;

  return (
    ['RESTAURANT', 'RESTAURANTE'].includes(vertical)
    && usesTables
    && startScreen === 'MAPA_MESAS'
  ) ? 'TABLE_MAP' : 'POS';
};
