import type { BusinessConfig, TerminalConfig } from '../types';

export type EffectiveBusinessVertical = 'RETAIL' | 'RESTAURANT';

const normalizeVertical = (value: unknown): EffectiveBusinessVertical | undefined => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'RESTAURANT' || normalized === 'RESTAURANTE') return 'RESTAURANT';
  if (normalized === 'RETAIL') return 'RETAIL';
  return undefined;
};

export const resolveEffectiveBusinessVertical = (
  config: Pick<BusinessConfig, 'vertical' | 'business_config' | 'businessConfig'>,
  terminalConfig?: Pick<TerminalConfig, 'operational'> | null,
): EffectiveBusinessVertical => (
  normalizeVertical(terminalConfig?.operational?.vertical_negocio)
  || normalizeVertical(config.business_config?.businessVertical)
  || normalizeVertical(config.business_config?.vertical_negocio)
  || normalizeVertical(config.businessConfig?.businessVertical)
  || normalizeVertical(config.businessConfig?.vertical_negocio)
  || normalizeVertical(config.vertical)
  || 'RETAIL'
);

export const isRestaurantBusiness = (
  config: Pick<BusinessConfig, 'vertical' | 'business_config' | 'businessConfig'>,
  terminalConfig?: Pick<TerminalConfig, 'operational'> | null,
): boolean => resolveEffectiveBusinessVertical(config, terminalConfig) === 'RESTAURANT';

export const calculateRestaurantServiceCharge = (
  grossLineTotal: number,
  discountAmount: number,
  percentage: number,
): number => {
  const base = Math.max(0, Number(grossLineTotal || 0) - Math.max(0, Number(discountAmount || 0)));
  const rate = Math.max(0, Number(percentage || 0)) / 100;
  return Math.round((base * rate + Number.EPSILON) * 100) / 100;
};
