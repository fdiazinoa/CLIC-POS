import test from 'node:test';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { LargeMasterSyncV3OperationalCatalog } from '../services/sync/LargeMasterSyncV3OperationalCatalog';
import type { LargeMasterSyncV3CandidateReady } from '../services/sync/LargeMasterSyncV3Candidate';
import { validateV3PinnedLineSource } from '../services/sync/LargeMasterSyncV3LineSource';
import { buildLargeMasterSyncV3CheckoutFiscalInput } from '../services/sync/LargeMasterSyncV3CheckoutAuthority';
import { calculateLineFiscalValuesForTransaction } from '../utils/fiscalBreakdown';
import { resolveProductImageSrc } from '../utils/entityImage';
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

test('authoritative image references survive get/search/page and reject inline media without legacy reads', async () => {
  const source = { ...article, image_url: 'https://images.example.test/canonical.jpg',
    images: ['data:image/png;base64,abc', 'https://images.example.test/side.jpg'],
    image: 'file:///legacy.jpg', image_version: 'v2' };
  const { ready } = fixture({ article: source, variants: [] });
  Object.assign(ready.runtime, { async readAdministrativeCatalogPage(request: any) {
    assert.equal(request.limit, 30);
    return { rows: [{ id: 'A', images: ['https://wrong.example.test/legacy.jpg'] }], nextCursor: null };
  } });
  const catalog = await LargeMasterSyncV3OperationalCatalog.open(ready, 'T1', 'W');
  const results = [(await catalog.get('A'))!, ...(await catalog.search('Agua')),
    ...(await catalog.page({ limit: 30 })).items];
  assert.equal(results.length, 3);
  for (const { product } of results) {
    assert.deepEqual(product.images, ['https://images.example.test/canonical.jpg', 'https://images.example.test/side.jpg']);
    assert.equal(product.imageVersion, 'v2');
    assert.equal(resolveProductImageSrc(product), source.image_url);
    assert.equal(product.price, 125.5);
    assert.equal(product.v3SaleAuthority?.tariffId, 'T1');
  }
  for (const value of [undefined, 'data:image/jpeg;base64,abc', 'file:///a.jpg', 'javascript:alert(1)',
    '/relative.jpg', 'https://u:p@images.example.test/a.jpg', `https://images.example.test/${'x'.repeat(2048)}`]) {
    const { ready: invalid } = fixture({ article: { ...article, images: [value] }, variants: [] });
    const empty = await LargeMasterSyncV3OperationalCatalog.open(invalid, 'T1', 'W');
    assert.deepEqual((await empty.get('A'))!.product.images, []);
  }
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
    let diagnostics: any[] = [];
    assert.deepEqual(await catalog.search('BAL-001', undefined, 60, rows => { diagnostics = rows; }), [], JSON.stringify(patch));
    assert.equal(diagnostics[0].code, 'SYNC_V3_ADVANCED_ARTICLE_CONTRACT_REQUIRED');
    assert.ok(diagnostics[0].reason);
    await assert.rejects(catalog.get('A'), /ADVANCED_ARTICLE_CONTRACT_REQUIRED/, JSON.stringify(patch));
  }
  const { ready } = fixture({ article: weightedArticle });
  const catalog = await LargeMasterSyncV3OperationalCatalog.open(ready, 'T1', 'W');
  await assert.rejects(catalog.get('A'), /ADVANCED_ARTICLE_CONTRACT_REQUIRED/);
});

test('articles without balances remain searchable and resolvable with zero availability',async()=>{
 const {ready}=fixture(); const runtime=ready.runtime as any;
 const originalBalance=runtime.getInventoryBalance.bind(runtime);
 runtime.searchOperationalArticles=async()=>[article,{...article,id:'NEW',sku:'NEW',name:'Nuevo'}];
 runtime.getOperationalArticle=async(id:string)=>({...article,id});
 runtime.getPrices=async(ids:string[])=>ids.map(id=>({articleId:id,tariffId:'T1',price:85}));
 runtime.getInventoryBalance=async(id:string,warehouse:string)=>id==='NEW'?null:originalBalance(id,warehouse);
 runtime.findBarcode=async()=>({articleId:'NEW'});
 const catalog=await LargeMasterSyncV3OperationalCatalog.open(ready,'T1','W');
 const results = await catalog.search('');
 assert.deepEqual(results.map(row=>row.product.id),['A','NEW']);
 assert.equal(results[1].product.stock,0);
 assert.deepEqual(results[1].product.stockBalances,{W:0});
 assert.equal(results[1].product.price,85);
 assert.equal(results[1].product.operationalFlags?.allowNegativeStock,false);
 assert.equal((await catalog.get('NEW'))?.product.stock,0);
 assert.equal((await catalog.findBarcode('NEW'))?.item.product.stock,0);
});

test('zero-balance sale validation obeys product-only negative-stock policy, never terminal or spoofed cart flags', async () => {
  const bundle = await build({
    entryPoints: [new URL('../services/sync/LargeMasterSyncV3OperationalSession.ts', import.meta.url).pathname],
    bundle: true, write: false, format: 'esm', platform: 'node', define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'stock-rule-read-only-io', setup(builder) {
      builder.onResolve({ filter: /^(\.\.\/db|\.\.\/\.\.\/utils\/db)$/ }, args => ({ path: args.path, namespace: 'stock-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'stock-fixture' }, args => ({
        contents: args.path === '../db' ? 'export const dbAdapter={};' : 'export const db={};', loader: 'js',
      }));
    } }],
  });
  const { LargeMasterSyncV3OperationalSession } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  for (const [productNegative, terminalNegative, spoofCart] of [
    [false, false, false], [true, false, false], [false, true, false], [false, false, true],
  ]) {
    const { ready } = fixture({ article: { ...article,
      operationalFlags: { trackInventory: true, allowNegativeStock: productNegative } } });
    (ready.runtime as any).getInventoryBalance = async () => null;
    const session = new LargeMasterSyncV3OperationalSession(ready, 'bound-terminal',
      { getLocalInventoryDelta: async () => 0 }, 'https://example.invalid', { deviceId: 'device' });
    session.assertCurrent = async () => {};
    const catalog = await session.catalog('T1', 'W');
    const product = await session.withStock((await catalog.get('A')).product, 'W');
    assert.equal(product.stock, 0);
    const line = { ...product, cartId: 'line', quantity: 1,
      operationalFlags: { ...product.operationalFlags, allowNegativeStock: spoofCart || productNegative } };
    const config = { taxes: [{ id: 'TX', name: 'ITBIS', type: 'VAT', rate: 0.18 }],
      terminals: [{ id: 'terminal', config: { currentDeviceId: 'device', workflow: {
        inventory: { allowNegativeStock: terminalNegative } } } }] };
    if (productNegative) {
      await session.validate(config, [line], 'T1', 'W');
      assert.deepEqual(await session.stockRequirements(config, [line], 'W', 'SALE'), []);
    } else {
      await assert.rejects(session.validate(config, [line], 'T1', 'W'), /STOCK_INSUFFICIENT/);
      assert.equal((await session.stockRequirements(config, [line], 'W', 'SALE')).length, 1);
    }
  }
});


test('healthy + unsupported page keeps healthy results, bounded diagnostics reset per query; direct lookup stays closed', async () => {
  const { ready, calls } = fixture({ variants: [] }); const runtime = ready.runtime as any;
  const unsupported = { ...weightedArticle, id: 'BAD', sku: 'ARR-001', measurementUnit: 'UND', purchaseUnit: 'UND' };
  runtime.searchOperationalArticles = async () => [article, unsupported];
  runtime.getPrices = async (ids: string[]) => ids.map(id => ({ articleId: id, tariffId: 'T1', price: 85 }));
  runtime.getOperationalArticle = async () => unsupported;
  runtime.findBarcode = async () => ({ articleId: 'BAD' });
  const catalog = await LargeMasterSyncV3OperationalCatalog.open(ready, 'T1', 'W'); let warnings: any[] = [];
  assert.deepEqual((await catalog.search('', undefined, 60, rows => { warnings = rows; })).map(row => row.product.id), ['A']);
  assert.equal(warnings[0].sku, 'ARR-001'); assert.match(warnings[0].reason, /unidades/);
  await assert.rejects(catalog.get('BAD'), /ADVANCED_ARTICLE_CONTRACT_REQUIRED/);
  await assert.rejects(catalog.findBarcode('BAD'), /ADVANCED_ARTICLE_CONTRACT_REQUIRED/);
  runtime.searchOperationalArticles = async () => [article];
  await catalog.search('', undefined, 60, rows => { warnings = rows; }); assert.deepEqual(warnings, []);
  assert.ok(calls.length < 12);
});

const inactiveFraction={enabled:false,fraction_mode:'HALF',pricing_rule:'HIGHEST_PRICE',max_parts:2,require_equal_parts:true,options:[]};
test('proven inactive fraction aliases are visible through authoritative get/search/page; invalid and conflicting rules remain held',async()=>{
 for(const alias of ['fraction_rule','fractionRule']){
  const {ready}=fixture({article:{...article,product_type:'SIMPLE',production_area_id:'COCINA',[alias]:inactiveFraction},variants:[]});
  Object.assign(ready.runtime,{readAdministrativeCatalogPage:async()=>({rows:[{id:'A'}],nextCursor:null})});
  const catalog=await LargeMasterSyncV3OperationalCatalog.open(ready,'T1','W');
  for(const row of [(await catalog.get('A'))!,...(await catalog.search('Agua')),...(await catalog.page({limit:30})).items]){
   assert.equal(row.product.production_area_id,'COCINA');assert.equal(row.product.price,125.5);assert.equal(row.product.v3SaleAuthority?.inventoryVersion,4);
  }
  const other=alias==='fraction_rule'?'fractionRule':'fraction_rule';
  for(const bad of [{},{enabled:true},{enabled:'false'}, {...inactiveFraction,options:'bad'}, {...inactiveFraction,max_parts:1.5}, {...inactiveFraction,pricing_rule:'UNKNOWN'}, {...inactiveFraction,options:[{}]}]){
   const {ready:invalid}=fixture({article:{...article,restaurant:{product_type:'SIMPLE',[alias]:inactiveFraction,[other]:bad}},variants:[]});
   const blocked=await LargeMasterSyncV3OperationalCatalog.open(invalid,'T1','W');
   assert.deepEqual(await blocked.search('Agua'),[]);await assert.rejects(blocked.get('A'),/ADVANCED_ARTICLE_CONTRACT_REQUIRED/);
  }
 }
 const {ready}=fixture({article:{...article,restaurant_unsupported:true,fraction_rule:inactiveFraction},variants:[]});
 const stale=await LargeMasterSyncV3OperationalCatalog.open(ready,'T1','W');await assert.rejects(stale.get('A'),/ADVANCED_ARTICLE_CONTRACT_REQUIRED/);
});
