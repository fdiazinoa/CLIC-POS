import type { TerminalConfig } from '../types';

export type ScannerQuantityMode = 'UNIT' | 'PROMPT';

export const scannerQuantityPreferenceKey = (terminalId: unknown): string => (
  `clic_pos_scanner_quantity_mode:${String(terminalId || 'device').trim() || 'device'}`
);

export const resolveScannerQuantityMode = (
  config?: Pick<TerminalConfig, 'operational'> | null
): ScannerQuantityMode => (
  String(config?.operational?.scannerQuantityMode || '').trim().toUpperCase() === 'PROMPT'
    ? 'PROMPT'
    : 'UNIT'
);

export const resolveScannerQuantityPreference = (
  storedValue: unknown,
  configuredMode: ScannerQuantityMode = 'UNIT'
): ScannerQuantityMode => {
  const normalized = String(storedValue || '').trim().toUpperCase();
  if (normalized === 'PROMPT') return 'PROMPT';
  if (normalized === 'UNIT') return 'UNIT';
  return configuredMode;
};

export const normalizeScannerQuantity = (
  value: unknown,
  fallback = 1
): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(9999, Math.round(parsed * 1000) / 1000);
};
