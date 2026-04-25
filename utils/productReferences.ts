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
  'code',
  'warehouseCode',
  'warehouse_code',
  'warehouseId',
  'warehouse_id',
  'id',
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
  'qtyOnHand',
  'qty_on_hand',
  'physical',
  'available',
  'qtyAvailable',
  'qty_available',
];

const extractWarehouseIdsFromRow = (row: Record<string, unknown>): string[] => {
  const values: string[] = [];
  for (const key of WAREHOUSE_ID_KEYS) {
    const value = trimValue(row[key]);
    if (value) values.push(value);
  }
  return uniqueValues(values);
};

const extractWarehouseIdFromRow = (row: Record<string, unknown>): string => {
  return extractWarehouseIdsFromRow(row)[0] || '';
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
    const quantity = extractQuantityFromRow(record);
    const warehouseIds = extractWarehouseIdsFromRow(record);
    if (warehouseIds.length > 0 && quantity != null) {
      for (const warehouseId of warehouseIds) {
        normalized[warehouseId] = Number(normalized[warehouseId] || 0) + quantity;
      }
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
  const nestedProduct = asRecord(record.product);

  return uniqueValues([
    trimValue(record.id),
    trimValue(record.itemId),
    trimValue(record.item_id),
    trimValue(record.productId),
    trimValue(record.product_id),
    trimValue(record.sourceProductId),
    trimValue(record.source_product_id),
    trimValue(record.erpProductId),
    trimValue(record.erp_product_id),
    trimValue(record.sourceItemId),
    trimValue(record.source_item_id),
    trimValue(record.barcode),
    trimValue(record.sku),
    trimValue(record.item_code),
    trimValue(record.code),
    trimValue(nestedProduct.id),
    trimValue(nestedProduct.itemId),
    trimValue(nestedProduct.item_id),
    trimValue(nestedProduct.productId),
    trimValue(nestedProduct.product_id),
    trimValue(nestedProduct.sourceProductId),
    trimValue(nestedProduct.source_product_id),
    trimValue(nestedProduct.erpProductId),
    trimValue(nestedProduct.erp_product_id),
    trimValue(nestedProduct.sourceItemId),
    trimValue(nestedProduct.source_item_id),
    trimValue(nestedProduct.barcode),
    trimValue(nestedProduct.sku),
    trimValue(nestedProduct.item_code),
    trimValue(nestedProduct.code),
  ]);
};

export const productIdentityCandidates = (
  product: Partial<Product> | Record<string, unknown> | null | undefined
): string[] => {
  if (!product || typeof product !== 'object') return [];
  const record = product as Record<string, unknown>;
  const nestedProduct = asRecord(record.product);

  return uniqueValues([
    trimValue(record.id),
    trimValue(record.itemId),
    trimValue(record.item_id),
    trimValue(record.productId),
    trimValue(record.product_id),
    trimValue(record.sourceProductId),
    trimValue(record.source_product_id),
    trimValue(record.erpProductId),
    trimValue(record.erp_product_id),
    trimValue(record.sourceItemId),
    trimValue(record.source_item_id),
    trimValue(nestedProduct.id),
    trimValue(nestedProduct.itemId),
    trimValue(nestedProduct.item_id),
    trimValue(nestedProduct.productId),
    trimValue(nestedProduct.product_id),
    trimValue(nestedProduct.sourceProductId),
    trimValue(nestedProduct.source_product_id),
    trimValue(nestedProduct.erpProductId),
    trimValue(nestedProduct.erp_product_id),
    trimValue(nestedProduct.sourceItemId),
    trimValue(nestedProduct.source_item_id),
  ]);
};

export const resolveOperationalProductId = (
  product: Partial<Product> | Record<string, unknown> | null | undefined
): string => {
  if (!product || typeof product !== 'object') return '';
  const record = product as Record<string, unknown>;
  const nestedProduct = asRecord(record.product);

  return uniqueValues([
    trimValue(record.itemId),
    trimValue(record.item_id),
    trimValue(record.sourceProductId),
    trimValue(record.source_product_id),
    trimValue(record.erpProductId),
    trimValue(record.erp_product_id),
    trimValue(record.sourceItemId),
    trimValue(record.source_item_id),
    trimValue(record.productId),
    trimValue(record.product_id),
    trimValue(nestedProduct.itemId),
    trimValue(nestedProduct.item_id),
    trimValue(nestedProduct.sourceProductId),
    trimValue(nestedProduct.source_product_id),
    trimValue(nestedProduct.erpProductId),
    trimValue(nestedProduct.erp_product_id),
    trimValue(nestedProduct.sourceItemId),
    trimValue(nestedProduct.source_item_id),
    trimValue(nestedProduct.productId),
    trimValue(nestedProduct.product_id),
    trimValue(record.id),
    trimValue(nestedProduct.id),
  ])[0] || '';
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

export const resolveLinkedInventoryProductIds = (
  product: Partial<Product> | Record<string, unknown> | null | undefined,
  products: Array<Partial<Product> | Record<string, unknown>> = []
): string[] => {
  const targetTokens = new Set(productIdentityCandidates(product).map(normalizeToken));
  const linkedIds = new Set<string>();

  for (const candidate of productIdentityCandidates(product)) {
    linkedIds.add(candidate);
  }

  if (targetTokens.size === 0) {
    return Array.from(linkedIds);
  }

  for (const entry of products) {
    const entryId = trimValue((entry as Record<string, unknown>)?.id);
    if (!entryId) continue;

    const matches = productIdentityCandidates(entry).some((candidate) => targetTokens.has(normalizeToken(candidate)));
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
  const candidateValues =
    productId && typeof productId === 'object'
      ? productReferenceCandidates(productId as Record<string, unknown>)
      : uniqueValues([trimValue(productId)]);
  const candidateTokens = new Set(candidateValues.map(normalizeToken).filter(Boolean));
  if (candidateTokens.size === 0) return false;

  const linkedIds = new Set(resolveLinkedProductIds(product, products).map(normalizeToken));
  const referenceTokens = new Set(productReferenceCandidates(product).map(normalizeToken));
  if ([...candidateTokens].some((token) => linkedIds.has(token) || referenceTokens.has(token))) {
    return true;
  }

  for (const entry of products) {
    const entryTokens = productReferenceCandidates(entry).map(normalizeToken);
    const matchesCurrent = entryTokens.some((value) => referenceTokens.has(value));
    if (!matchesCurrent) continue;
    if (entryTokens.some((value) => candidateTokens.has(value))) {
      return true;
    }
  }

  return false;
};

export const productIdMatchesInventoryReference = (
  productId: unknown,
  product: Partial<Product> | Record<string, unknown> | null | undefined,
  products: Array<Partial<Product> | Record<string, unknown>> = []
): boolean => {
  const candidateValues =
    productId && typeof productId === 'object'
      ? productIdentityCandidates(productId as Record<string, unknown>)
      : uniqueValues([trimValue(productId)]);
  const candidateTokens = new Set(candidateValues.map(normalizeToken).filter(Boolean));
  if (candidateTokens.size === 0) return false;

  const linkedIds = new Set(resolveLinkedInventoryProductIds(product, products).map(normalizeToken));
  const referenceTokens = new Set(productIdentityCandidates(product).map(normalizeToken));
  if ([...candidateTokens].some((token) => linkedIds.has(token) || referenceTokens.has(token))) {
    return true;
  }

  for (const entry of products) {
    const entryTokens = productIdentityCandidates(entry).map(normalizeToken);
    const matchesCurrent = entryTokens.some((value) => referenceTokens.has(value));
    if (!matchesCurrent) continue;
    if (entryTokens.some((value) => candidateTokens.has(value))) {
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

export const resolveInventoryProductStockRow = (
  product: Partial<Product> | Record<string, unknown> | null | undefined,
  warehouseId: unknown,
  productStocks: Array<Partial<ProductStock>> = [],
  products: Array<Partial<Product> | Record<string, unknown>> = []
): ProductStock | undefined => {
  const normalizedWarehouseId = trimValue(warehouseId);
  if (!normalizedWarehouseId) return undefined;

  const matches = productStocks.filter((stock) =>
    trimValue(stock?.warehouseId) === normalizedWarehouseId &&
    productIdMatchesInventoryReference(stock?.productId, product, products)
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
