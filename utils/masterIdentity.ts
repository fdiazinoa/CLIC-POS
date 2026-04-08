import type { Product, Tariff, TariffPrice, Warehouse } from '../types';

const normalizeToken = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const pushToken = (bucket: Set<string>, value: unknown) => {
  const normalized = normalizeToken(value);
  if (normalized) bucket.add(normalized);
};

const buildTariffTokens = (tariff?: Partial<Tariff> | TariffPrice | null): Set<string> => {
  const tokens = new Set<string>();
  if (!tariff) return tokens;
  pushToken(tokens, (tariff as Tariff).id);
  pushToken(tokens, (tariff as Tariff).code);
  pushToken(tokens, (tariff as TariffPrice).tariffId);
  pushToken(tokens, (tariff as any).tariff_id);
  pushToken(tokens, (tariff as any).tariffCode);
  pushToken(tokens, (tariff as any).tariff_code);
  pushToken(tokens, (tariff as any).name);
  return tokens;
};

const buildWarehouseTokens = (warehouse?: Partial<Warehouse> | null): Set<string> => {
  const tokens = new Set<string>();
  if (!warehouse) return tokens;
  pushToken(tokens, warehouse.id);
  pushToken(tokens, warehouse.code);
  pushToken(tokens, warehouse.name);
  return tokens;
};

const readEntryIdentifier = (entry: unknown, keys: string[]): string => {
  if (typeof entry === 'string') return entry.trim();
  if (!entry || typeof entry !== 'object') return '';

  const record = entry as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const tariffMatchesIdentifier = (tariff: Partial<Tariff> | TariffPrice | null | undefined, identifier: unknown): boolean => {
  const token = normalizeToken(identifier);
  if (!token) return false;
  return buildTariffTokens(tariff || null).has(token);
};

export const warehouseMatchesIdentifier = (warehouse: Partial<Warehouse> | null | undefined, identifier: unknown): boolean => {
  const token = normalizeToken(identifier);
  if (!token) return false;
  return buildWarehouseTokens(warehouse || null).has(token);
};

export const resolveTariffId = (identifier: unknown, tariffs: Array<Partial<Tariff>> = []): string => {
  const token = normalizeToken(identifier);
  if (!token) return '';
  const matched = tariffs.find((tariff) => tariffMatchesIdentifier(tariff, token));
  return typeof matched?.id === 'string' && matched.id.trim() ? matched.id.trim() : String(identifier).trim();
};

export const resolveWarehouseId = (identifier: unknown, warehouses: Array<Partial<Warehouse>> = []): string => {
  const token = normalizeToken(identifier);
  if (!token) return '';
  const matched = warehouses.find((warehouse) => warehouseMatchesIdentifier(warehouse, token));
  return typeof matched?.id === 'string' && matched.id.trim() ? matched.id.trim() : String(identifier).trim();
};

export const canonicalizeTariffEntries = (entries: TariffPrice[] = [], tariffs: Array<Partial<Tariff>> = []): TariffPrice[] => {
  const seen = new Set<string>();
  const normalized: TariffPrice[] = [];

  for (const entry of entries) {
    const tariffId = resolveTariffId(
      readEntryIdentifier(entry, ['tariffId', 'tariff_id', 'id', 'code', 'tariffCode', 'tariff_code', 'name']),
      tariffs
    );
    if (!tariffId || seen.has(tariffId)) continue;
    seen.add(tariffId);
    normalized.push({
      ...entry,
      tariffId,
    });
  }

  return normalized;
};

export const canonicalizeWarehouseIds = (warehouseIds: unknown[] = [], warehouses: Array<Partial<Warehouse>> = []): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawId of warehouseIds) {
    const warehouseId = resolveWarehouseId(
      readEntryIdentifier(rawId, ['id', 'warehouseId', 'warehouse_id', 'code', 'name']) || rawId,
      warehouses
    );
    if (!warehouseId || seen.has(warehouseId)) continue;
    seen.add(warehouseId);
    normalized.push(warehouseId);
  }

  return normalized;
};

export const canonicalizeWarehouseRecord = <T>(
  record: Record<string, T> | null | undefined,
  warehouses: Array<Partial<Warehouse>> = []
): Record<string, T> => {
  const normalized: Record<string, T> = {};

  for (const [rawId, value] of Object.entries(record || {})) {
    const warehouseId = resolveWarehouseId(rawId, warehouses);
    if (!warehouseId) continue;
    normalized[warehouseId] = value;
  }

  return normalized;
};

export const deriveWarehouseIdsFromSettings = (value: unknown): string[] => {
  const settings = asRecord(value);
  if (Object.keys(settings).length === 0) return [];

  return Object.entries(settings)
    .filter(([, rawValue]) => {
      if (rawValue === false) return false;
      const entry = asRecord(rawValue);
      if (Object.keys(entry).length === 0) return true;
      if (entry.active === false) return false;
      if (entry.enabled === false) return false;
      return true;
    })
    .map(([key]) => key)
    .filter(Boolean);
};

export const resolveProductActiveWarehouseIds = (
  product: Partial<Product> | Record<string, unknown> | null | undefined,
  warehouses: Array<Partial<Warehouse>> = []
): string[] => {
  if (!product) return [];

  const source = product as Record<string, unknown>;
  const explicit = canonicalizeWarehouseIds(
    Array.isArray(source.activeInWarehouses)
      ? source.activeInWarehouses
      : (Array.isArray(source.warehouse_ids)
          ? source.warehouse_ids
          : (Array.isArray(source.warehouseIds) ? source.warehouseIds : [])),
    warehouses
  );
  if (explicit.length > 0) return explicit;

  const fromSettings = canonicalizeWarehouseIds(
    deriveWarehouseIdsFromSettings(source.warehouseSettings),
    warehouses
  );

  return fromSettings;
};

export const isProductWarehouseActive = (
  product: Partial<Product> | Record<string, unknown> | null | undefined,
  warehouseId: unknown,
  warehouses: Array<Partial<Warehouse>> = []
): boolean => {
  const resolvedWarehouseId = resolveWarehouseId(warehouseId, warehouses);
  if (!resolvedWarehouseId) return false;
  return resolveProductActiveWarehouseIds(product, warehouses).includes(resolvedWarehouseId);
};

export const getWarehouseScopedNumber = (
  record: Record<string, unknown> | null | undefined,
  warehouseId: unknown,
  warehouses: Array<Partial<Warehouse>> = [],
  fallback = 0
): number => {
  const resolvedWarehouseId = resolveWarehouseId(warehouseId, warehouses);
  if (!resolvedWarehouseId) return fallback;

  const value = canonicalizeWarehouseRecord(record || {}, warehouses)[resolvedWarehouseId];
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};
