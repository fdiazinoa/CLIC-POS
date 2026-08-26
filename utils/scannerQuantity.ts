import type { TerminalConfig } from '../types';

export type ScannerQuantityMode = 'UNIT' | 'PROMPT';

export const resolveScannerQuantityMode = (
  config?: Pick<TerminalConfig, 'operational'> | null
): ScannerQuantityMode => (
  String(config?.operational?.scannerQuantityMode || '').trim().toUpperCase() === 'PROMPT'
    ? 'PROMPT'
    : 'UNIT'
);

export const normalizeScannerQuantity = (
  value: unknown,
  fallback = 1
): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(9999, Math.round(parsed * 1000) / 1000);
};

