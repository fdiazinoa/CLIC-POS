import type { BusinessConfig } from '../../types';
import { isTerminalAuthorizationSuperseded } from '../../utils/terminalAuthorizationGuard';
import { normalizeItemLabelPrice, type ItemLabelPriceVersion } from '../../utils/itemLabelPrice';
import { dbAdapter } from '../db';
import type { DatabaseAdapter, DurableDocumentMutation } from '../db/DatabaseAdapter';
import { readOperationalCatalogBindingProof } from './OperationalTerminalConfig';
import { resolveSyncTarget } from './SyncProfile';
import { readTerminalCredentialsSync } from './TerminalCredentialStore';

export const ITEM_LABEL_PRICES_UPDATED = 'itemLabelPricesUpdated';

type Binding = NonNullable<ReturnType<typeof readOperationalCatalogBindingProof>> & { key: string; storageKey: string };
type Cursor = { id: string; bindingKey: string; scopeKey: string; revision: number; epoch: number };
type Row = ItemLabelPriceVersion & { id: string; itemId: string; epoch: number };
type PullPage = (revision: number, binding: Binding) => Promise<unknown>;
type PriceStorage = Pick<DatabaseAdapter, 'getDocument' | 'getDocumentsByIds' | 'saveDocumentsAtomically'>;

const collectionName = 'syncMetadata';
const limitPerRun = 20;
const inFlight = new Map<string, Promise<void>>();
let generation = 0;

export function itemLabelPricesGeneration(): number {
  return generation;
}

export function itemLabelPriceBinding(config: BusinessConfig, localTerminalId: string): Binding | null {
  if (!localTerminalId || isTerminalAuthorizationSuperseded()) return null;
  const activeTerminalId = localStorage.getItem('active_terminal_id') || localStorage.getItem('CLIC_POS_TERMINAL_ID');
  if (activeTerminalId && activeTerminalId !== localTerminalId) return null;
  const target = resolveSyncTarget();
  const proof = readOperationalCatalogBindingProof();
  const credentials = readTerminalCredentialsSync();
  const terminal = config?.terminals?.find(row => row.id === localTerminalId);
  const binding = terminal?.config?.erpBinding;

  if (!proof || target.kind !== 'ERP_ACTIVE' || !target.canPullMasters || !target.baseUrl
    || /REVOKED|NOT_AUTHORIZED|BOUND_AUTH_MISMATCH/i.test(credentials.authStatus || '')
    || !terminal || (binding?.terminalId || terminal.config.erpTerminalId || terminal.id) !== proof.terminalId
    || (binding?.tenantId && binding.tenantId !== proof.tenantId)
    || (binding?.companyId && binding.companyId !== proof.companyId)
    || (binding?.storeId && credentials.storeId && binding.storeId !== credentials.storeId)
    || (terminal.config.currentDeviceId && terminal.config.currentDeviceId !== proof.deviceId)) return null;

  const categories = [...new Set(terminal.config.catalog?.allowedCategories || [])].sort();
  const storageKey = JSON.stringify([target.baseUrl, proof.tenantId, proof.companyId, proof.terminalId, proof.deviceId,
    credentials.storeId, binding?.storeId]);
  return { ...proof, storageKey, key: JSON.stringify([storageKey, categories]) };
}

export function validateItemLabelPricePage(value: unknown, binding: Pick<Binding, 'tenantId' | 'companyId'>, since: number) {
  if (!value || typeof value !== 'object') throw new Error('ITEM_LABEL_PRICE_PAGE_INVALID');
  const page = value as Record<string, unknown>;
  if (page.status !== 'success' || page.tenantId !== binding.tenantId || page.companyId !== binding.companyId
    || typeof page.scopeKey !== 'string' || !page.scopeKey || page.scopeKey.length > 250
    || typeof page.nextRevision !== 'number' || !Number.isSafeInteger(page.nextRevision) || page.nextRevision < 0
    || typeof page.hasMore !== 'boolean' || !Array.isArray(page.items) || page.items.length > 200) {
    throw new Error('ITEM_LABEL_PRICE_PAGE_INVALID');
  }
  const items: Omit<Row, 'id' | 'epoch'>[] = [];
  const seen = new Set<string>();
  let previous = since;
  for (const item of page.items) {
    if (!item || typeof item.itemId !== 'string' || !item.itemId || item.itemId.length > 128 || seen.has(item.itemId)
      || !Number.isSafeInteger(item.revision) || item.revision <= previous || item.revision > page.nextRevision) {
      throw new Error('ITEM_LABEL_PRICE_ROW_INVALID');
    }
    const labelPrice = normalizeItemLabelPrice(item.labelPrice);
    if (!labelPrice && item.labelPrice !== null) throw new Error('ITEM_LABEL_PRICE_VALUE_INVALID');
    items.push({ itemId: item.itemId, revision: item.revision, labelPrice });
    seen.add(item.itemId);
    previous = item.revision;
  }
  return { scopeKey: page.scopeKey, revision: page.nextRevision, hasMore: page.hasMore, items };
}

const cursorId = (binding: Binding) => `item-label-prices:cursor:${binding.storageKey}`;
const rowId = (binding: Binding, itemId: string) => `item-label-prices:row:${JSON.stringify([binding.storageKey, itemId])}`;

const readCursor = (storage: PriceStorage, binding: Binding) => storage.getDocument<Cursor>(collectionName, cursorId(binding));

function notifyPricesUpdated() {
  generation++;
  window.dispatchEvent(new Event(ITEM_LABEL_PRICES_UPDATED));
}

export async function syncItemLabelPrices(
  getBinding: () => Promise<Binding | null>, pull: PullPage, storage: PriceStorage = dbAdapter,
): Promise<void> {
  const binding = await getBinding();
  if (!binding) return Promise.resolve();
  const active = inFlight.get(binding.key);
  if (active) return active;

  const assertBinding = async () => {
    if ((await getBinding())?.key !== binding.key) throw new Error('ITEM_LABEL_PRICE_BINDING_CHANGED');
  };
  const promise = (async () => {
    const save = storage.saveDocumentsAtomically?.bind(storage);
    if (!save) throw new Error('ITEM_LABEL_PRICE_STORAGE_UNAVAILABLE');
    let cursor = await readCursor(storage, binding);
    for (let count = 0; count < limitPerRun; count++) {
      await assertBinding();
      const matchingBinding = cursor?.bindingKey === binding.key;
      const since = matchingBinding ? cursor.revision : 0;
      const payload = await pull(since, binding);
      await assertBinding();
      if (payload === null) return; // ERP anterior a la colección.

      const wireScope = (payload as Record<string, unknown>).scopeKey;
      const sameScope = !cursor || matchingBinding && wireScope === cursor.scopeKey;
      const page = validateItemLabelPricePage(payload, binding, sameScope ? since : 0);
      const cursorMutation = (next: Cursor): DurableDocumentMutation => ({
        collectionName, document: next,
        ...(cursor ? { expectedDocument: JSON.stringify(cursor) } : { requireAbsent: true }),
      });
      if (!sameScope) {
        // Change namespaces before fetching again so offline readers cannot see the old remote scope.
        const next = { id: cursorId(binding), bindingKey: binding.key, scopeKey: page.scopeKey,
          revision: 0, epoch: (cursor?.epoch || 0) + 1 };
        await save([cursorMutation(next)]);
        cursor = next;
        notifyPricesUpdated();
        continue;
      }
      if (page.revision < since || page.hasMore && page.revision === since) {
        throw new Error('ITEM_LABEL_PRICE_CURSOR_INVALID');
      }
      if (!cursor || page.revision > since) {
        const next = { id: cursorId(binding), bindingKey: binding.key, scopeKey: page.scopeKey,
          revision: page.revision, epoch: cursor?.epoch || 1 };
        const changes = page.items.map(item => ({
          collectionName, document: { ...item, id: rowId(binding, item.itemId), epoch: next.epoch },
        }));
        await save([...changes, cursorMutation(next)]);
        cursor = next;
        notifyPricesUpdated();
      }
      if (!page.hasMore) return;
    }
  })();
  inFlight.set(binding.key, promise);
  void promise.finally(() => { inFlight.delete(binding.key); }).catch(() => undefined);
  return promise;
}

export async function readItemLabelPrices(
  binding: Binding, itemIds: readonly string[], storage: PriceStorage = dbAdapter,
) {
  const cursor = await readCursor(storage, binding);
  const persistedCursor = JSON.stringify(cursor);
  const assertCurrent = async () => {
    if (JSON.stringify(await readCursor(storage, binding)) !== persistedCursor) {
      throw new Error('ITEM_LABEL_PRICE_CURSOR_CHANGED');
    }
  };

  const prices = new Map<string, ItemLabelPriceVersion>();
  if (cursor?.bindingKey === binding.key) {
    const ids = [...new Set(itemIds)];
    for (let index = 0; index < ids.length; index += 100) {
      const batch = ids.slice(index, index + 100).map(id => rowId(binding, id));
      const rows = storage.getDocumentsByIds ? await storage.getDocumentsByIds<Row>(collectionName, batch)
        : await Promise.all(batch.map(id => storage.getDocument<Row>(collectionName, id)));
      for (const row of rows) {
        if (!row || row.epoch !== cursor.epoch || row.revision > cursor.revision) continue;
        prices.set(row.itemId, { labelPrice: row.labelPrice, revision: row.revision });
      }
    }
  }
  await assertCurrent();
  return { prices, assertCurrent };
}
