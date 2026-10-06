import { LargeMasterSyncV3Error, type LargeMasterSyncV3InventorySnapshot } from './LargeMasterSyncV3Types';
import { type LargeMasterSyncV3BoundIdentity,
  validatedLargeMasterSyncV3ErpSyncBase } from './LargeMasterSyncV3BoundTransport';
import { largeMasterSyncV3DownloadOrigin } from './LargeMasterSyncV3DownloadOrigin';
export type { LargeMasterSyncV3InventoryBalance, LargeMasterSyncV3InventorySnapshot } from './LargeMasterSyncV3Types';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object'
  && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const quantity = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new LargeMasterSyncV3Error('SYNC_V3_INVENTORY_INVALID');
  }
  return value;
};

export const parseLargeMasterSyncV3Inventory = (input: unknown): LargeMasterSyncV3InventorySnapshot => {
  const payload = record(input);
  if (payload.status !== 'success' || payload.collection !== 'productInventory'
    || payload.supported !== true || !Array.isArray(payload.items)
    || !Number.isSafeInteger(payload.count) || payload.count !== payload.items.length
    || !Number.isSafeInteger(payload.version) || !text(payload.cursor)) {
    throw new LargeMasterSyncV3Error('SYNC_V3_INVENTORY_INVALID');
  }
  const seen = new Set<string>();
  const balances = payload.items.map(item => {
    const row = record(item);
    const itemId = text(row.item_id);
    const warehouseId = text(row.warehouse_id);
    const key = `${itemId}\u0000${warehouseId}`;
    if (!itemId || !warehouseId || seen.has(key) || !text(row.updated_at)) {
      throw new LargeMasterSyncV3Error('SYNC_V3_INVENTORY_INVALID');
    }
    seen.add(key);
    return { item_id: itemId, warehouse_id: warehouseId,
      qty_on_hand: quantity(row.qty_on_hand), qty_reserved: quantity(row.qty_reserved),
      qty_committed: quantity(row.qty_committed), updated_at: text(row.updated_at) };
  });
  return { version: payload.version as number, cursor: text(payload.cursor), balances };
};

/** Fetches only inventory balances, never legacy articles/prices/taxes. */
export const fetchLargeMasterSyncV3Inventory = async (
  readBoundIdentity: () => LargeMasterSyncV3BoundIdentity,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  downloadOrigin?: string,
): Promise<LargeMasterSyncV3InventorySnapshot> => {
  const identity = readBoundIdentity();
  const identityBase = validatedLargeMasterSyncV3ErpSyncBase(identity.erpSyncBaseUrl);
  const baseUrl = downloadOrigin === undefined ? identityBase
    : `${largeMasterSyncV3DownloadOrigin(downloadOrigin)}/api/sync`;
  if (!identity.syncToken || !identity.tenantId || !identity.terminalId || !identity.deviceId) {
    throw new LargeMasterSyncV3Error('SYNC_V3_ERP_BINDING_REQUIRED');
  }
  const response = await fetchImpl(`${baseUrl}/collections/productInventory/full`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Sync-Token': identity.syncToken,
      'X-Terminal-Id': identity.terminalId,
      'X-Tenant-Id': identity.tenantId,
      'X-Device-Id': identity.deviceId,
      'X-POS-Device-Id': identity.deviceId,
    },
    signal,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  });
  if (!response.ok) throw new LargeMasterSyncV3Error('SYNC_V3_INVENTORY_HTTP_ERROR');
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new LargeMasterSyncV3Error('SYNC_V3_INVENTORY_INVALID'); }
  const current = readBoundIdentity();
  if (validatedLargeMasterSyncV3ErpSyncBase(current.erpSyncBaseUrl) !== identityBase
    || current.tenantId !== identity.tenantId || current.terminalId !== identity.terminalId
    || current.deviceId !== identity.deviceId || current.syncToken !== identity.syncToken) {
    throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
  }
  return parseLargeMasterSyncV3Inventory(payload);
};
