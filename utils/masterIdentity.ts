import type { Tariff, TariffPrice, Warehouse } from '../types';

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
