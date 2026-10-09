import test from 'node:test';
import assert from 'node:assert/strict';
import { LargeMasterSyncV3OperationalCatalog } from '../services/sync/LargeMasterSyncV3OperationalCatalog';
import type { LargeMasterSyncV3CandidateReady } from '../services/sync/LargeMasterSyncV3Candidate';
import { validateV3PinnedLineSource } from '../services/sync/LargeMasterSyncV3LineSource';
import { buildLargeMasterSyncV3CheckoutFiscalInput } from '../services/sync/LargeMasterSyncV3CheckoutAuthority';
import { calculateLineFiscalValuesForTransaction } from '../utils/fiscalBreakdown';
import type { CartItem, BusinessConfig } from '../types';
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

const weightedArticle = { ...article, name: 'BAL-001', measurementUnit: 'Kilogramo', purchaseUnit: 'kg',
  conversionFactor: 1, operationalFlags: { trackInventory: false, isWeighted: true, integersOnly: false } };

test('weighted V3 product uses effective price, fractional kilograms, pinned taxes and warehouse stock', async () => {
  const { ready } = fixture({ article: weightedArticle, variants: [] });
  const catalog = await LargeMasterSyncV3OperationalCatalog.open(ready, 'T1', 'W');
  const [item] = await catalog.search('BAL-001');
  assert.equal(item.product.name, 'BAL-001');
  assert.equal(item.product.price, 125.5);
  assert.equal(item.product.operationalFlags.isWeighted, true);
  assert.equal(item.product.operationalFlags.trackInventory, false);
  assert.equal(item.product.isInventoriable, true);
  assert.equal(item.product.stockBalances.W, 5);
  assert.equal((await catalog.get('A'))?.product.measurementUnit, 'Kilogramo');
  const line = { ...item.product, cartId: 'weighted', quantity: 0.25 } as CartItem;
  validateV3PinnedLineSource(line, item.product, item.authority);
  const fiscal = buildLargeMasterSyncV3CheckoutFiscalInput({ taxRate: 0.99, taxes: [] } as unknown as BusinessConfig,
    [line], item.authority, item.taxes);
  const [amounts] = calculateLineFiscalValuesForTransaction([line], fiscal.config, { isTaxIncluded: fiscal.isTaxIncluded });
  assert.equal(amounts.totalAmount, 31.38);
  assert.equal(amounts.taxAmount, 4.79);
  assert.equal(line.quantity, 0.25);
  assert.equal(item.authority.syncVersion, 10);
  for (const patch of [
    { measurementUnit: 'lb' }, { purchaseUnit: 'gr' }, { conversionFactor: 1000 },
    { operationalFlags: { ...line.operationalFlags, isWeighted: false } },
    { operationalFlags: { ...line.operationalFlags, integersOnly: true } },
    { operationalFlags: { ...line.operationalFlags, trackInventory: true } },
    { operationalFlags: { ...line.operationalFlags, trackInventory: undefined } },
    { operationalFlags: { ...line.operationalFlags, usesLots: true } },
    { operationalFlags: { ...line.operationalFlags, usesSerial: true } },
    { variantId: 'foreign' }, { recipeDetails: [{}] }, { modifiers: ['extra'] },
  ]) assert.throws(() => validateV3PinnedLineSource({ ...line, ...patch } as unknown as CartItem, item.product, item.authority), /ARTICLE_SOURCE_CHANGED/);
  assert.throws(() => validateV3PinnedLineSource(line,
    { ...item.product, operationalFlags: { ...item.product.operationalFlags, isWeighted: false } }, item.authority), /ARTICLE_SOURCE_CHANGED/);
  assert.throws(() => validateV3PinnedLineSource(line,
    { ...item.product, operationalFlags: { ...item.product.operationalFlags, trackInventory: true } }, item.authority), /ARTICLE_SOURCE_CHANGED/);
  assert.throws(() => buildLargeMasterSyncV3CheckoutFiscalInput(fiscal.config,
    [{ ...line, v3SaleAuthority: { ...item.authority, syncVersion: 11 } }], item.authority, item.taxes), /MIXED_VERSION/);
});

test('weighted contract rejects unsupported or ambiguous source semantics and advanced features', async () => {
  const changes = [
    ...[true, undefined, null, 0, 'false'].map(trackInventory => ({ operationalFlags: {
      isWeighted: true, integersOnly: false, trackInventory, allowNegativeStock: true } })),
    { type: 'SERVICE' }, { measurementUnit: undefined }, { measurementUnit: 'lb' },
    { purchaseUnit: 'gr' }, { conversionFactor: undefined }, { conversionFactor: 0 }, { conversionFactor: 1000 },
    { operationalFlags: { isWeighted: true } },
    { operationalFlags: { isWeighted: true, integersOnly: true } },
    { operationalFlags: { isWeighted: 'true', integersOnly: false } },
    { operationalFlags: { isWeighted: true, integersOnly: false, trackInventory: false, usesLots: true } },
    { operationalFlags: { isWeighted: true, integersOnly: false, trackInventory: false, usesSerial: true } },
    { recipeDetails: [{}] }, { modifiers: [{}] }, { availableModifiers: [{}] },
    { restaurant: { comboGroups: [{}] } }, { fractionRule: {} }, { attributes: [{}] },
  ];
  for (const patch of changes) {
    const { ready } = fixture({ article: { ...weightedArticle, ...patch }, variants: [] });
    const catalog = await LargeMasterSyncV3OperationalCatalog.open(ready, 'T1', 'W');
    await assert.rejects(catalog.search('BAL-001'), /ADVANCED_ARTICLE_CONTRACT_REQUIRED/, JSON.stringify(patch));
  }
  const { ready } = fixture({ article: weightedArticle });
  const catalog = await LargeMasterSyncV3OperationalCatalog.open(ready, 'T1', 'W');
  await assert.rejects(catalog.get('A'), /ADVANCED_ARTICLE_CONTRACT_REQUIRED/);
});

test('raw inventoriable tracked article without anchor coverage is unavailable without hiding covered search results',async()=>{
 const {ready}=fixture(); const runtime=ready.runtime as any;
 const originalBalance=runtime.getInventoryBalance.bind(runtime);
 runtime.searchOperationalArticles=async()=>[article,{...article,id:'NEW',sku:'NEW',name:'Nuevo'}];
 runtime.getOperationalArticle=async(id:string)=>({...article,id});
 runtime.getPrices=async(ids:string[])=>ids.map(id=>({articleId:id,tariffId:'T1',price:85}));
 runtime.getInventoryBalance=async(id:string,warehouse:string)=>id==='NEW'?null:originalBalance(id,warehouse);
 runtime.findBarcode=async()=>({articleId:'NEW'});
 const catalog=await LargeMasterSyncV3OperationalCatalog.open(ready,'T1','W');
 assert.deepEqual((await catalog.search('')).map(row=>row.product.id),['A']);
 await assert.rejects(catalog.get('NEW'),/ARTICLE_INVENTORY_COVERAGE_REQUIRED/);
 await assert.rejects(catalog.findBarcode('NEW'),/ARTICLE_INVENTORY_COVERAGE_REQUIRED/);
});
