export type InventoryScannerQuantityMode = 'UNIT' | 'PROMPT';

export const inventoryScannerPreferenceKey = (terminalId: unknown): string => (
  `clic_inventory_scanner_quantity_mode:${String(terminalId || 'device').trim() || 'device'}`
);

export const resolveInventoryScannerQuantityMode = (
  storedValue: unknown,
): InventoryScannerQuantityMode => (
  String(storedValue || '').trim().toUpperCase() === 'PROMPT' ? 'PROMPT' : 'UNIT'
);

export const normalizeInventoryScannerQuantity = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.min(9999, Math.max(1, Math.round(parsed)));
};
