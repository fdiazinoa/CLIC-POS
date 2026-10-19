import test from 'node:test';
import assert from 'node:assert/strict';
import { LargeMasterSyncV3OperationalCatalog } from '../services/sync/LargeMasterSyncV3OperationalCatalog';
import type { LargeMasterSyncV3CandidateReady } from '../services/sync/LargeMasterSyncV3Candidate';
import type { LargeMasterSyncV3Runtime } from '../services/sync/LargeMasterSyncV3Runtime';
const article = {
  id: 'A', type: 'PRODUCT', sku: 'SKU-A', name: 'Agua', category: 'Bebidas', active: true,
  sellable: true, inventoriable: true, taxable: true, taxIds: ['TX'],
  operationalFlags: { trackInventory: true }, activeWarehouseIds: ['W'],
};

const fixture = (options: {
  tariffId?: string;
  priceTariffId?: string;
  inventoryVersion?: number;
  advanceInventoryAfterBalance?: boolean;
  article?: Record<string, unknown>;
  variants?: Record<string, unknown>[];
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
      return options.variants ?? [{ id: 'V1', sku: 'SKU-A-RED', active: true, price: 130,
        barcodes: ['7460001'], attributeValues: { color: 'Rojo' } }];
    },
    async getOperationalSupports(itemIds: string[], warehouseId: string) {
      const balances: Record<string, unknown> = {};
      const variants: Record<string, unknown[]> = {};
      for (const id of itemIds) {
        balances[id] = await this.getInventoryBalance(id, warehouseId);
        variants[id] = await this.getOperationalVariants();
      }
      return { balances, variants };
    },
    async findBarcode() { return { articleId: 'A', variantId: 'V1' }; },
  } as unknown as LargeMasterSyncV3Runtime;
  const ready: LargeMasterSyncV3CandidateReady = {
    runtime, inventoryVersion: 4, inventoryCursor: 'C4',
  };
  return { ready, calls };
};


test('kiosk native page resolves IDs through guarded sale authority, never administrative prices', async () => {
 const {ready}=fixture();
 Object.assign(ready.runtime,{async readAdministrativeCatalogPage(request: any) { assert.equal(request.limit,30); assert.equal(request.tariffId,'T1'); assert.equal(request.warehouseId,'W'); return {rows:[{id:'A',price:999}],total:61,filteredTotal:61,nextCursor:'A'}; }});
 const catalog=await LargeMasterSyncV3OperationalCatalog.open(ready,'T1','W');
 const result=await catalog.page({limit:30});
 assert.equal(result.items[0].product.price,125.5); assert.equal(result.nextCursor,'A'); assert.equal(result.items[0].product.stock,5);
});
