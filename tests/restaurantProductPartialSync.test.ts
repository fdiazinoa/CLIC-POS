import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

class TestCustomEvent {
  constructor(public type: string, public init?: { detail?: unknown }) {}
}

const localStorage = new MemoryStorage();
Object.assign(globalThis, {
  localStorage,
  sessionStorage: new MemoryStorage(),
  CustomEvent: TestCustomEvent,
  window: {
    localStorage,
    setTimeout,
    clearTimeout,
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  },
});

const fixture = JSON.parse(readFileSync(new URL('./fixtures/command-modifier-product.json', import.meta.url), 'utf8'));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const collections = new Map<string, any>();

const { db } = await import('../utils/db');
const { apiSyncAdapter } = await import('../services/sync/ApiSyncAdapter');
const { productImageCacheService } = await import('../services/sync/ProductImageCacheService');
const {
  mergeIncomingRestaurantProductConfig,
  normalizeRestaurantProductConfig,
  resolveRestaurantProductConfig,
} = await import('../utils/restaurantProductConfig');
const { syncPolicy } = await import('../services/sync/SyncProfile');
const { syncManager } = await import('../services/sync/SyncManager');

const installMemoryDb = (product = fixture) => {
  collections.clear();
  collections.set('products', [clone(product)]);
  collections.set('config', { id: 'current', tariffs: [] });
  collections.set('warehouses', []);
  (db as any).get = async (collection: string) => clone(collections.get(collection) ?? []);
  (db as any).save = async (collection: string, value: unknown) => collections.set(collection, clone(value));
  (db as any).saveDocument = async (collection: string, value: any) => {
    const rows = clone(collections.get(collection) ?? []);
    const index = rows.findIndex((row: any) => row.id === value.id);
    if (index >= 0) rows[index] = clone(value);
    else rows.push(clone(value));
    collections.set(collection, rows);
  };
  (db as any).deleteDocument = async (collection: string, id: string) => {
    collections.set(collection, (collections.get(collection) ?? []).filter((row: any) => row.id !== id));
  };
};

test('normalizes the complete command fixture without expanding legacy aliases', async () => {
  installMemoryDb({});
  const [normalized] = await productImageCacheService.normalizeIncomingProducts([clone(fixture)]);
  const config = resolveRestaurantProductConfig(normalized);
  assert.equal(config.modifier_groups[0].modifiers.length, 3);
  assert.equal(config.combo_groups[0].required, true);
  assert.deepEqual(config.note_presets, ['Sin hielo', 'Salsa aparte', 'Para llevar']);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'modifierGroups'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.restaurant, 'modifierGroups'), false);
});

test('preserves every absent restaurant family while applying ordinary partial fields', async () => {
  installMemoryDb();
  const [normalized] = await productImageCacheService.normalizeIncomingProducts([{
    id: fixture.id,
    name: fixture.name,
    price: 575,
  }]);
  const config = resolveRestaurantProductConfig(normalized);

  assert.equal(normalized.price, 575);
  assert.equal(config.product_type, 'COMBO');
  assert.equal(config.production_area_id, 'fixture-kitchen');
  assert.equal(config.modifier_groups.length, 1);
  assert.equal(config.combo_groups.length, 1);
  assert.deepEqual(config.note_presets, fixture.note_presets);
  assert.equal(normalized.taxable, true);
  assert.deepEqual(normalized.appliedTaxIds, ['fixture-tax']);
  assert.deepEqual(normalized.stockBalances, fixture.stockBalances);
});

test('uses presence precedence and never revives an explicitly cleared alias', () => {
  const cleared = mergeIncomingRestaurantProductConfig({
    ...fixture,
    modifier_groups: [],
    modifierGroups: fixture.modifier_groups,
    restaurant: { ...fixture.restaurant, modifier_groups: fixture.modifier_groups },
  }, fixture);
  assert.deepEqual(resolveRestaurantProductConfig(cleared).modifier_groups, []);
  assert.equal(Object.prototype.hasOwnProperty.call(cleared, 'modifierGroups'), false);
  assert.deepEqual(cleared.restaurant.modifier_groups, []);
  assert.equal(Object.prototype.hasOwnProperty.call(cleared.restaurant, 'modifierGroups'), false);

  const nullCleared = mergeIncomingRestaurantProductConfig({
    id: fixture.id,
    comboGroups: null,
    notePresets: null,
    fractionRule: null,
    product_type: null,
    production_area_id: null,
  }, fixture);
  assert.deepEqual(resolveRestaurantProductConfig(nullCleared).combo_groups, []);
  assert.deepEqual(resolveRestaurantProductConfig(nullCleared).note_presets, []);
  assert.equal(resolveRestaurantProductConfig(nullCleared).fraction_rule, undefined);
  assert.equal(resolveRestaurantProductConfig(nullCleared).product_type, 'SIMPLE');
  assert.equal(resolveRestaurantProductConfig(nullCleared).production_area_id, undefined);
});

test('updates one snake, camel, or nested family and preserves its siblings', () => {
  const replacement = [{ ...fixture.modifier_groups[0], id: 'replacement-group', name: 'Salsas' }];
  const nested = normalizeRestaurantProductConfig(mergeIncomingRestaurantProductConfig({
    id: fixture.id,
    restaurant: { modifierGroups: replacement, productType: 'SIMPLE', productionAreaId: 'fixture-bar' },
  }, fixture));
  const config = resolveRestaurantProductConfig(nested);
  assert.equal(config.modifier_groups[0].id, 'replacement-group');
  assert.equal(config.product_type, 'SIMPLE');
  assert.equal(config.production_area_id, 'fixture-bar');
  assert.equal(config.combo_groups[0].id, 'fixture-drink');
  assert.deepEqual(config.note_presets, fixture.note_presets);
});

for (const scenario of [
  {
    name: 'combo group through camel alias',
    incoming: { comboGroups: [{ ...fixture.combo_groups[0], id: 'replacement-combo' }] },
    assertChanged: (config: any) => assert.equal(config.combo_groups[0].id, 'replacement-combo'),
  },
  {
    name: 'notes through nested camel alias',
    incoming: { restaurant: { notePresets: ['Nueva nota'] } },
    assertChanged: (config: any) => assert.deepEqual(config.note_presets, ['Nueva nota']),
  },
  {
    name: 'fraction rule through snake alias',
    incoming: { fraction_rule: { fraction_mode: 'HALF', max_parts: 2, options: [] } },
    assertChanged: (config: any) => assert.equal(config.fraction_rule.fraction_mode, 'HALF'),
  },
]) {
  test(`updates ${scenario.name} without clearing unrelated families`, () => {
    const config = resolveRestaurantProductConfig(mergeIncomingRestaurantProductConfig({
      id: fixture.id,
      ...scenario.incoming,
    }, fixture));
    scenario.assertChanged(config);
    assert.equal(config.modifier_groups[0].id, 'fixture-extras');
    assert.equal(config.product_type, 'COMBO');
    assert.equal(config.production_area_id, 'fixture-kitchen');
  });
}

test('new products keep legacy type and metadata production-area fallbacks', () => {
  const merged = mergeIncomingRestaurantProductConfig({
    id: 'new-product',
    type: 'COMBO',
    metadata: { production_area_id: 'metadata-kitchen' },
  } as any);
  const config = resolveRestaurantProductConfig(merged);
  assert.equal(config.product_type, 'COMBO');
  assert.equal(config.production_area_id, 'metadata-kitchen');
});

test('SyncManager incremental pull persists absent families and honors a later explicit clear', async () => {
  installMemoryDb();
  const originalResolve = syncPolicy.resolve;
  const originalPullDelta = apiSyncAdapter.pullDelta;
  const originalSyncSnapshotItems = productImageCacheService.syncSnapshotItems;
  (syncPolicy as any).resolve = () => ({
    kind: 'ERP_ACTIVE',
    dataMaster: 'ERP',
    canPullMasters: true,
    canPushOperations: true,
  });
  (productImageCacheService as any).syncSnapshotItems = async () => {};

  const responses = [
    { id: fixture.id, name: fixture.name, price: 575, _op: 'UPDATE' },
    { id: fixture.id, modifier_groups: [], comboGroups: null, note_presets: null, fraction_rule: null, _op: 'UPDATE' },
  ];
  (apiSyncAdapter as any).pullDelta = async () => ({
    items: [responses.shift()],
    serverTime: '2026-09-19T12:00:00.000Z',
    isFullDownload: false,
    latestVersion: 10,
  });

  try {
    assert.equal(await syncManager.pullCatalog('products', false, { ignoreThrottle: true }), 1);
    let persisted = collections.get('products')[0];
    assert.equal(persisted.price, 575);
    assert.equal(resolveRestaurantProductConfig(persisted).modifier_groups.length, 1);
    assert.equal(resolveRestaurantProductConfig(persisted).combo_groups.length, 1);
    assert.deepEqual(resolveRestaurantProductConfig(persisted).note_presets, fixture.note_presets);
    assert.equal(persisted.taxable, true);
    assert.deepEqual(persisted.appliedTaxIds, ['fixture-tax']);
    assert.deepEqual(persisted.stockBalances, fixture.stockBalances);

    assert.equal(await syncManager.pullCatalog('products', false, { ignoreThrottle: true }), 1);
    persisted = collections.get('products')[0];
    assert.deepEqual(resolveRestaurantProductConfig(persisted).modifier_groups, []);
    assert.deepEqual(resolveRestaurantProductConfig(persisted).combo_groups, []);
    assert.deepEqual(resolveRestaurantProductConfig(persisted).note_presets, []);
    assert.equal(resolveRestaurantProductConfig(persisted).fraction_rule, undefined);
    assert.equal(resolveRestaurantProductConfig(persisted).product_type, 'COMBO');
    assert.equal(resolveRestaurantProductConfig(persisted).production_area_id, 'fixture-kitchen');
  } finally {
    (syncPolicy as any).resolve = originalResolve;
    (apiSyncAdapter as any).pullDelta = originalPullDelta;
    (productImageCacheService as any).syncSnapshotItems = originalSyncSnapshotItems;
  }
});
