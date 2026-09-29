import type { BusinessConfig, TerminalConfig } from '../types';

export type EffectiveBusinessVertical = 'RETAIL' | 'RESTAURANT';

const normalizeVertical = (value: unknown): EffectiveBusinessVertical | undefined => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'RESTAURANT' || normalized === 'RESTAURANTE') return 'RESTAURANT';
  if (normalized === 'RETAIL') return 'RETAIL';
  return undefined;
};

export const resolveEffectiveBusinessVertical = (
  config: Pick<BusinessConfig, 'vertical'>,
  terminalConfig?: Pick<TerminalConfig, 'operational'> | null,
): EffectiveBusinessVertical => (
  normalizeVertical(terminalConfig?.operational?.vertical_negocio)
  || normalizeVertical(config.vertical)
  || 'RETAIL'
);

export const isRestaurantBusiness = (
  config: Pick<BusinessConfig, 'vertical'>,
  terminalConfig?: Pick<TerminalConfig, 'operational'> | null,
): boolean => resolveEffectiveBusinessVertical(config, terminalConfig) === 'RESTAURANT';
