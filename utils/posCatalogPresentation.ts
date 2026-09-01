import type { ClassificationItem, Product } from '../types';

type PresentationRecord = Record<string, unknown>;

const asRecord = (value: unknown): PresentationRecord =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as PresentationRecord
    : {};

const firstFiniteNumber = (...values: unknown[]): number | undefined => {
  for (const value of values) {
    if (value === '' || value === null || value === undefined) continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
};

export const normalizeCatalogKey = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLocaleLowerCase('es') : '';

export const resolveClassificationSortOrder = (
  item: Partial<ClassificationItem> | PresentationRecord | null | undefined,
  fallback = Number.MAX_SAFE_INTEGER,
): number => {
  const record = asRecord(item);
  return firstFiniteNumber(
    record.sortOrder,
    record.sort_order,
    record.displayOrder,
    record.display_order,
    record.posSortOrder,
    record.pos_sort_order,
  ) ?? fallback;
};

export const resolveClassificationActive = (
  item: Partial<ClassificationItem> | PresentationRecord | null | undefined,
): boolean => {
  const record = asRecord(item);
  const value = record.isActive
    ?? record.is_active
    ?? record.isEnabled
    ?? record.is_enabled
    ?? record.enabled
    ?? record.active;
  return value === undefined || value === null ? true : value !== false && value !== 0 && value !== 'false';
};

export const normalizeCategoryColor = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const color = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const [r, g, b] = color.slice(1).split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return undefined;
};

export const resolveClassificationColor = (
  item: Partial<ClassificationItem> | PresentationRecord | null | undefined,
): string | undefined => {
  const record = asRecord(item);
  return normalizeCategoryColor(record.color ?? record.hexColor ?? record.hex_color ?? record.posColor ?? record.pos_color);
};

export const resolveProductPosSortOrder = (
  product: Partial<Product> | PresentationRecord | null | undefined,
  fallback = Number.MAX_SAFE_INTEGER,
): number => {
  const record = asRecord(product);
  return firstFiniteNumber(
    record.posSortOrder,
    record.pos_sort_order,
    record.displayOrder,
    record.display_order,
    record.sortOrder,
    record.sort_order,
  ) ?? fallback;
};

export const comparePosProducts = (left: Product, right: Product): number => {
  const orderDifference = resolveProductPosSortOrder(left) - resolveProductPosSortOrder(right);
  if (Number.isFinite(orderDifference) && orderDifference !== 0) return orderDifference;
  return String(left.name || '').localeCompare(String(right.name || ''), 'es', { sensitivity: 'base' });
};

export const categoryAliases = (item: Partial<ClassificationItem>): string[] =>
  Array.from(new Set([item.id, item.code, item.name].map(normalizeCatalogKey).filter(Boolean)));

/**
 * ERP catalog refreshes own the category identity and descriptive fields, while
 * the POS owns its local presentation. Keep the latter when both records refer
 * to the same logical category, even if ERP uses a UUID and POS uses the name.
 */
export const mergePosCategoryPresentation = (
  existingItems: Array<Partial<ClassificationItem>> | null | undefined,
  incomingItems: ClassificationItem[],
): ClassificationItem[] => {
  const existingByAlias = new Map<string, Partial<ClassificationItem>>();
  for (const existing of existingItems || []) {
    categoryAliases(existing).forEach((alias) => {
      if (!existingByAlias.has(alias)) existingByAlias.set(alias, existing);
    });
  }

  return incomingItems.map((incoming) => {
    const existing = categoryAliases(incoming)
      .map((alias) => existingByAlias.get(alias))
      .find(Boolean);
    if (!existing) return incoming;

    const merged: ClassificationItem = { ...existing, ...incoming } as ClassificationItem;
    if (Object.prototype.hasOwnProperty.call(existing, 'isActive')) {
      merged.isActive = existing.isActive;
    }
    if (Object.prototype.hasOwnProperty.call(existing, 'color')) {
      merged.color = existing.color;
    }
    if (Object.prototype.hasOwnProperty.call(existing, 'sortOrder')) {
      merged.sortOrder = existing.sortOrder;
    }
    return merged;
  });
};

export const readableTextColor = (hexColor: string): '#FFFFFF' | '#0F172A' => {
  const normalized = normalizeCategoryColor(hexColor);
  if (!normalized) return '#0F172A';
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  const luminance = (0.299 * red) + (0.587 * green) + (0.114 * blue);
  return luminance > 160 ? '#0F172A' : '#FFFFFF';
};
