import type { Product, ProductStock } from '../types';

const normalizeToken = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : value != null ? String(value).trim().toLowerCase() : '';

const trimValue = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : value != null ? String(value).trim() : '';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const uniqueValues = (values: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const trimmed = trimValue(value);
    if (!trimmed) continue;
    const token = normalizeToken(trimmed);
    if (seen.has(token)) continue;
    seen.add(token);
    normalized.push(trimmed);
  }

  return normalized;
};

const quantityFromValue = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const WAREHOUSE_ID_KEYS = [
  'warehouseId',
  'warehouse_id',
  'id',
  'code',
  'warehouseCode',
  'warehouse_code',
  'storeId',
  'store_id',
];

const STOCK_QTY_KEYS = [
  'qtyPhysical',
  'qty_physical',
  'quantity',
  'qty',
  'balance',
  'stock',
  'onHand',
  'on_hand',
  'physical',
  'available',
  'qtyAvailable',
  'qty_available',
];

const extractWarehouseIdFromRow = (row: Record<string, unknown>): string => {
  for (const key of WAREHOUSE_ID_KEYS) {
    const value = trimValue(row[key]);
    if (value) return value;
  }
  return '';
};

const extractQuantityFromRow = (row: Record<string, unknown>): number | null => {
  for (const key of STOCK_QTY_KEYS) {
    const numeric = quantityFromValue(row[key]);
    if (numeric != null) return numeric;
  }
  return null;
};

const normalizeStockBalanceSource = (source: unknown): Record<string, number> => {
  const normalized: Record<string, number> = {};

  for (const row of asArray(source)) {
    const record = asRecord(row);
    const warehouseId = extractWarehouseIdFromRow(record);
    const quantity = extractQuantityFromRow(record);
    if (warehouseId && quantity != null) {
      normalized[warehouseId] = quantity;
    }
  }
  if (Object.keys(normalized).length > 0) {
    return normalized;
  }

  const record = asRecord(source);
  if (Object.keys(record).length === 0) {
    return {};
  }

  const singleWarehouseId = extractWarehouseIdFromRow(record);
  const singleQuantity = extractQuantityFromRow(record);
  if (singleWarehouseId && singleQuantity != null) {
    return { [singleWarehouseId]: singleQuantity };
  }

  for (const [warehouseId, rawValue] of Object.entries(record)) {
    const directQuantity = quantityFromValue(rawValue);
    if (directQuantity != null) {
      normalized[warehouseId] = directQuantity;
      continue;
    }

    const nestedRecord = asRecord(rawValue);
    const nestedQuantity = extractQuantityFromRow(nestedRecord);
    if (nestedQuantity != null) {
      normalized[warehouseId] = nestedQuantity;
    }
  }

  return normalized;
};

export const productReferenceCandidates = (
  product: Partial<Product> | Record<string, unknown> | null | undefined
): string[] => {
  if (!product || typeof product !== 'object') return [];
  const record = product as Record<string, unknown>;

  return uniqueValues([
    trimValue(record.id),
    trimValue(record.barcode),
    trimValue(record.sku),
    trimValue(record.item_code),
    trimValue(record.code),
  ]);
};

export const resolveLinkedProductIds = (
  product: Partial<Product> | Record<string, unknown> | null | undefined,
  products: Array<Partial<Product> | Record<string, unknown>> = []
): string[] => {
  const targetTokens = new Set(productReferenceCandidates(product).map(normalizeToken));
  const linkedIds = new Set<string>();

  for (const candidate of productReferenceCandidates(product)) {
    linkedIds.add(candidate);
  }

  if (targetTokens.size === 0) {
    return Array.from(linkedIds);
  }

  for (const entry of products) {
    const entryId = trimValue((entry as Record<string, unknown>)?.id);
    if (!entryId) continue;

    const matches = productReferenceCandidates(entry).some((candidate) => targetTokens.has(normalizeToken(candidate)));
    if (matches) {
      linkedIds.add(entryId);
    }
  }

  return Array.from(linkedIds);
};

export const productIdMatchesProductReference = (
  productId: unknown,
  product: Partial<Product> | Record<string, unknown> | null | undefined,
  products: Array<Partial<Product> | Record<string, unknown>> = []
): boolean => {
  const candidate = trimValue(productId);
  if (!candidate) return false;

  const candidateToken = normalizeToken(candidate);
  const linkedIds = new Set(resolveLinkedProductIds(product, products).map(normalizeToken));
  if (linkedIds.has(candidateToken)) {
    return true;
  }

  const referenceTokens = new Set(productReferenceCandidates(product).map(normalizeToken));
  if (referenceTokens.has(candidateToken)) {
    return true;
  }

  for (const entry of products) {
    const matchesCurrent = productReferenceCandidates(entry).some((value) => referenceTokens.has(normalizeToken(value)));
    if (!matchesCurrent) continue;
    if (productReferenceCandidates(entry).some((value) => normalizeToken(value) === candidateToken)) {
      return true;
    }
  }

  return false;
};

export const resolveProductStockRow = (
  product: Partial<Product> | Record<string, unknown> | null | undefined,
  warehouseId: unknown,
  productStocks: Array<Partial<ProductStock>> = [],
  products: Array<Partial<Product> | Record<string, unknown>> = []
): ProductStock | undefined => {
  const normalizedWarehouseId = trimValue(warehouseId);
  if (!normalizedWarehouseId) return undefined;

  const matches = productStocks.filter((stock) =>
    trimValue(stock?.warehouseId) === normalizedWarehouseId &&
    productIdMatchesProductReference(stock?.productId, product, products)
  );

  return matches.sort((left, right) => {
    const leftTime = new Date(left?.updatedAt || 0).getTime();
    const rightTime = new Date(right?.updatedAt || 0).getTime();
    return rightTime - leftTime;
  })[0] as ProductStock | undefined;
};

export const extractWarehouseStockBalances = (...sources: unknown[]): Record<string, number> => {
  for (const source of sources) {
    const normalized = normalizeStockBalanceSource(source);
    if (Object.keys(normalized).length > 0) {
      return normalized;
    }
  }

  return {};
};
