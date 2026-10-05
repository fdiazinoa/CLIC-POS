import test from 'node:test';
import assert from 'node:assert/strict';
import { LargeMasterSyncV3OperationalCatalog } from '../services/sync/LargeMasterSyncV3OperationalCatalog';
import type { LargeMasterSyncV3CandidateReady } from '../services/sync/LargeMasterSyncV3Candidate';
import type { LargeMasterSyncV3Runtime } from '../services/sync/LargeMasterSyncV3Runtime';

const article = {
  id: 'A', sku: 'SKU-A', name: 'Agua', category: 'Bebidas', active: true,
  sellable: true, inventoriable: true, taxable: true, taxIds: ['TX'],
  operationalFlags: { trackInventory: true }, activeWarehouseIds: ['W'],
};

const fixture = (options: {
  tariffId?: string;
  priceTariffId?: string;
  inventoryVersion?: number;
  advanceInventoryAfterBalance?: boolean;
  article?: Record<string, unknown>;
} = {}) => {
  const version = { syncId: 'S1', syncVersion: 10, contractVersion: 2 };
  const calls: string[] = [];
  let balanceRead = false;
  const runtime = {
    version,
    async getInventorySnapshotVersion() {
      return { version: balanceRead && options.advanceInventoryAfterBalance
        ? 5 : options.inventoryVersion ?? 4, cursor: 'C4' };
    },
    async getInventoryBalance(itemId: string, warehouseId: string) {
      calls.push(`inventory:${itemId}:${warehouseId}`);
      balanceRead = true;
      return { qtyOnHand: 8, qtyReserved: 2, qtyCommitted: 1 };
    },
    async getOperationalTariffs() { return [{ id: 'T1', active: true, taxIncluded: true }]; },
    async getOperationalTaxes() {
      return [{ id: 'TX', name: 'ITBIS', rate: 0.18, type: 'SALES', active: true }];
    },
    async searchOperationalArticles() { return [options.article ?? article]; },
    async getOperationalArticle() { return options.article ?? article; },
    async getPrices(_ids: string[], tariffId: string) {
      calls.push(`prices:${tariffId}`);
      return [{ articleId: 'A', tariffId: options.priceTariffId ?? 'T1', price: 125.5 }];
    },
    async getOperationalVariants() {
      return [{ id: 'V1', sku: 'SKU-A-RED', active: true, price: 130,
        barcodes: ['7460001'], attributeValues: { color: 'Rojo' } }];
    },
    async findBarcode() { return { articleId: 'A', variantId: 'V1' }; },
  } as unknown as LargeMasterSyncV3Runtime;
  const ready: LargeMasterSyncV3CandidateReady = {
    runtime, inventoryVersion: 4, inventoryCursor: 'C4',
  };
  return { ready, calls };
};

test('adapts a pinned V3 article, tariff, tax, variant and separate warehouse balance', async () => {
  const { ready, calls } = fixture();
  const catalog = await LargeMasterSyncV3OperationalCatalog.open(ready, 'T1', 'W');
  const [item] = await catalog.search('Agua');
  assert.equal(item.product.id, 'A');
  assert.equal(item.product.price, 125.5);
  assert.deepEqual(item.product.tariffs, [{ tariffId: 'T1', price: 125.5 }]);
  assert.equal(item.product.stock, 5);
  assert.deepEqual(item.product.stockBalances, { W: 5 });
  assert.deepEqual(item.product.appliedTaxIds, ['TX']);
  assert.equal(item.taxes[0].type, 'VAT');
  assert.equal(item.taxes[0].rate, 0.18);
  assert.equal(item.product.variants[0].price, 130);
  assert.deepEqual(item.authority, {
    syncId: 'S1', syncVersion: 10, tariffId: 'T1', taxIncluded: true,
    inventoryVersion: 4, inventoryCursor: 'C4',
  });
  assert.strictEqual(item.product.v3SaleAuthority, item.authority);
  assert.deepEqual(calls, ['prices:T1', 'inventory:A:W']);
  const barcode = await catalog.findBarcode('7460001');
  assert.equal(barcode?.variant?.id, 'V1');
  assert.equal(barcode?.item.authority.syncId, 'S1');
});

test('fails closed on stale inventory and a missing effective-tariff price', async () => {
  const stale = fixture({ inventoryVersion: 5 });
  await assert.rejects(() => LargeMasterSyncV3OperationalCatalog.open(stale.ready, 'T1', 'W'),
    /SYNC_V3_INVENTORY_NOT_READY/);
  const wrongTariff = fixture({ priceTariffId: 'OTHER' });
  const catalog = await LargeMasterSyncV3OperationalCatalog.open(wrongTariff.ready, 'T1', 'W');
  assert.deepEqual(await catalog.search('Agua'), []);
  assert.equal(await catalog.get('A'), null);
  assert.deepEqual(wrongTariff.calls, ['prices:T1', 'prices:T1']);
});

test('never adapts inactive or unsellable V3 articles', async () => {
  const inactive = fixture({ article: { ...article, active: false } });
  const catalog = await LargeMasterSyncV3OperationalCatalog.open(inactive.ready, 'T1', 'W');
  assert.deepEqual(await catalog.search('Agua'), []);
  const unsellable = fixture({ article: { ...article, sellable: false } });
  const second = await LargeMasterSyncV3OperationalCatalog.open(unsellable.ready, 'T1', 'W');
  assert.equal(await second.get('A'), null);
});

test('rejects a result if the independent inventory snapshot changes mid-read', async () => {
  const changing = fixture({ advanceInventoryAfterBalance: true });
  const catalog = await LargeMasterSyncV3OperationalCatalog.open(changing.ready, 'T1', 'W');
  await assert.rejects(() => catalog.search('Agua'), /SYNC_V3_INVENTORY_NOT_READY/);
});
