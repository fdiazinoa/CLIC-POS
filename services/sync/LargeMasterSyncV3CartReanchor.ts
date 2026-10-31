import type { CartItem, V3SaleAuthorityStamp } from '../../types';
import { v3StockSource } from './LargeMasterSyncV3StockAuthority';

export type V3ReanchorOutcome = {
  lines: CartItem[];
  changed: boolean;
  /** Articles that can no longer be sold with the live catalog (deleted, inactive or repriced treatment). */
  unavailable: string[];
};

const sameAuthority = (current: V3SaleAuthorityStamp | undefined, next: V3SaleAuthorityStamp, binding: string, warehouseId: string): boolean => {
  if (!current || current.binding !== binding || current.warehouseId !== warehouseId) return false;
  if (current.tariffId !== next.tariffId || current.taxIncluded !== next.taxIncluded) return false;
  if (current.inventoryVersion !== next.inventoryVersion || current.inventoryCursor !== next.inventoryCursor) return false;
  const a = v3StockSource(current), b = v3StockSource(next);
  return a.syncId === b.syncId && a.syncVersion === b.syncVersion;
};

/**
 * A restaurant account opened on a previous day keeps the price, discounts, taxes and notes
 * agreed with the customer. Only the sale authority (stock generation, tariff, warehouse and
 * binding) is moved to the live one so the checkout can validate and consume today's stock.
 * A line whose article disappeared, or whose tariff switched between tax-included and
 * tax-excluded, is reported instead of being silently repriced.
 */
export const planV3CartReanchor = (
  lines: CartItem[],
  liveAuthorityFor: (line: CartItem) => V3SaleAuthorityStamp | null,
  binding: string,
  warehouseId: string,
): V3ReanchorOutcome => {
  const output: CartItem[] = [];
  const unavailable: string[] = [];
  let changed = false;
  for (const line of lines) {
    const live = liveAuthorityFor(line);
    if (!live) { unavailable.push(line.id); output.push(line); continue; }
    const next: V3SaleAuthorityStamp = { ...live, binding, warehouseId };
    if (sameAuthority(line.v3SaleAuthority, next, binding, warehouseId)) { output.push(line); continue; }
    if (line.v3SaleAuthority && line.v3SaleAuthority.taxIncluded !== next.taxIncluded) {
      unavailable.push(line.id);
      output.push(line);
      continue;
    }
    changed = true;
    output.push({ ...line, v3SaleAuthority: next });
  }
  return { lines: output, changed, unavailable };
};
