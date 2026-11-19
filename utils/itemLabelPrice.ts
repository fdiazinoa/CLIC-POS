import type { LabelTemplate } from '../types';

export interface ItemLabelPrice {
  amountCents: number;
  currencyCode: string;
}

export interface ItemLabelPriceVersion {
  labelPrice: ItemLabelPrice | null;
  revision: number;
}

export function normalizeItemLabelPrice(value: unknown): ItemLabelPrice | null {
  if (!value || typeof value !== 'object') return null;
  const { amountCents, currencyCode } = value as Partial<ItemLabelPrice>;
  if (typeof amountCents !== 'number' || !Number.isSafeInteger(amountCents) || amountCents < 0
    || typeof currencyCode !== 'string' || !/^[A-Z]{1,10}$/.test(currencyCode)) return null;
  return { amountCents, currencyCode };
}

export function formatItemLabelPrice(value: unknown): string | null {
  const price = normalizeItemLabelPrice(value);
  if (!price) return null;
  const digits = String(price.amountCents).padStart(3, '0');
  const amount = `${digits.slice(0, -2)}.${digits.slice(-2)}`;
  return price.currencyCode === 'USD' ? `US$${amount}` : `${price.currencyCode} ${amount}`;
}

export function usesItemLabelPrice(template: LabelTemplate | null | undefined): boolean {
  return Boolean(template?.elements.some(element => element.dataSource === 'PRODUCT_LABEL_PRICE'));
}

export function missingItemLabelPriceMessage(
  template: LabelTemplate | null | undefined,
  records: ReadonlyArray<{ productId: string; productName: string; sku?: string; copies: number; labelPrice?: ItemLabelPrice | null }>,
): string | null {
  if (!usesItemLabelPrice(template)) return null;
  const names = new Map<string, string>();
  for (const record of records) {
    if (record.copies > 0 && !normalizeItemLabelPrice(record.labelPrice)) {
      names.set(record.productId, record.sku && record.sku !== record.productName
        ? `${record.productName} (${record.sku})`
        : record.productName || record.productId);
    }
  }
  return names.size ? `Falta el precio de etiqueta para: ${Array.from(names.values()).join(', ')}.` : null;
}

export function selectItemLabelPrice(
  catalog: ItemLabelPriceVersion | null,
  incremental: ItemLabelPriceVersion | null,
  hasIncrementalCollection = false,
): ItemLabelPrice | null {
  // After starting the protected collection, a missing item during a scope
  // replay must not resurrect a price cleared after the cached V3 snapshot.
  if (hasIncrementalCollection && !incremental) return null;
  if (incremental && (!catalog || incremental.revision >= catalog.revision)) return incremental.labelPrice;
  return catalog?.labelPrice ?? null;
}
