import type { BusinessConfig, Transaction } from '../types';

/** Service labels belong to restaurant receipts; explicit terminal scope wins. */
export function receiptUsesRestaurantService(config: BusinessConfig, terminalId?: string): boolean {
  const terminal = config.terminals?.find(row => row.id === terminalId);
  const ux = terminal?.config?.ux as Record<string, unknown> | undefined;
  const operational = terminal?.config?.operational as unknown as Record<string, unknown> | undefined;
  const mode = String(ux?.viewMode || ux?.mode || operational?.viewMode || '').trim().toUpperCase().replace(/[\s_-]+/g, '_');
  if (['RETAIL', 'RETAIL_MODE', 'POS', 'STANDARD', 'SUPERMARKET', 'SUPERMERCADO'].includes(mode)) return false;
  const vertical = String(terminal?.config?.operational?.vertical_negocio || '');
  if (vertical) return vertical === 'RESTAURANT' || vertical === 'RESTAURANTE';
  return config.vertical === 'RESTAURANT';
}

/** A reprint identifies the original operator, never whoever is logged in now. */
export function receiptSaleOperator(transaction: Pick<Transaction, 'userName'>): string {
  return String(transaction.userName || '').trim() || 'No registrado';
}
