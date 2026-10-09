import type { BusinessConfig, TerminalConfig } from '../types';

export interface QuantityPresentation { salesDecimals: number; purchaseDecimals: number }
export const quantityDecimals = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6 ? value : 3;
export const normalizeQuantityPresentation = (value?: Partial<QuantityPresentation> | null): QuantityPresentation => ({
  salesDecimals: quantityDecimals(value?.salesDecimals), purchaseDecimals: quantityDecimals(value?.purchaseDecimals),
});
/** Only the explicitly selected terminal controls presentation. Never inherit another terminal. */
export const terminalQuantityPresentation = (config: Pick<BusinessConfig, 'terminals'>, terminalId?: string): QuantityPresentation =>
  normalizeQuantityPresentation(config.terminals?.find(t => t.id === terminalId)?.config?.operational?.quantityPresentation);
export const operationalQuantityPresentation = (config: Pick<TerminalConfig, 'operational'>): QuantityPresentation =>
  normalizeQuantityPresentation(config.operational?.quantityPresentation);
const formats = new Map<number, Intl.NumberFormat>();
export const formatQuantity = (value: number, decimals: unknown = 3): string => {
  if (!Number.isFinite(value)) return '—';
  const digits = quantityDecimals(decimals);
  let formatter = formats.get(digits);
  if (!formatter) { formatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits }); formats.set(digits, formatter); }
  const text = formatter.format(Object.is(value, -0) ? 0 : value);
  if (value !== 0 && Number(text.replace(/,/g, '')) === 0) {
    const threshold = digits === 0 ? '1' : `0.${'0'.repeat(digits - 1)}1`;
    return value > 0 ? `< ${threshold}` : `> -${threshold}`;
  }
  return text;
};
