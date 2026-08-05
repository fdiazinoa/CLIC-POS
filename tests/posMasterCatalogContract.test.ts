import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  buildPosMasterCatalogSnapshot,
  POS_MASTER_OPERATIONAL_CATALOGS,
} from '../utils/posMasterCatalogContract';
import { normalizeRestaurantProductConfig } from '../utils/restaurantProductConfig';

test('POS Master publishes production and promotion catalogs required by clients', () => {
  const collections = new Set(POS_MASTER_OPERATIONAL_CATALOGS);
  assert.equal(collections.has('productionAreas'), true);
  assert.equal(collections.has('promotions'), true);
  assert.equal(collections.has('paymentMethods'), true);
  assert.equal(collections.has('taxes'), true);
  assert.equal(collections.has('documentSeries'), true);
  assert.equal(collections.has('productPrices'), true);
});

test('catalog snapshot reads SQLite and falls back to operational config arrays', async () => {
  const stored = new Map<string, unknown[]>([
    ['productionAreas', [{ id: 'kitchen', name: 'Cocina' }]],
    ['products', [{ id: 'product-1' }]],
  ]);
  const snapshot = await buildPosMasterCatalogSnapshot(
    async (collection) => stored.get(collection) || [],
    { customers: [{ id: 'customer-live' }] },
    {
      taxes: [{ id: 'tax-18' }],
      paymentMethods: [{ id: 'cash', name: 'Efectivo', type: 'CASH', isActive: true }],
      tariffs: [{ id: 'retail', name: 'Detalle', active: true }],
      promotions: [{ id: 'promo-1' }],
    } as any,
  );

  assert.deepEqual(snapshot.productionAreas, [{ id: 'kitchen', name: 'Cocina' }]);
  assert.deepEqual(snapshot.products, [{ id: 'product-1' }]);
  assert.deepEqual(snapshot.customers, [{ id: 'customer-live' }]);
  assert.deepEqual(snapshot.promotions, [{ id: 'promo-1' }]);
  assert.deepEqual(snapshot.paymentMethods, [{ id: 'cash', name: 'Efectivo', type: 'CASH', isActive: true }]);
  assert.deepEqual(snapshot.priceLists, [{ id: 'retail', name: 'Detalle', active: true }]);
});

test('client catalog batches bypass per-call debounce so production and promotions are not skipped', () => {
  const syncManagerSource = fs.readFileSync(
    new URL('../services/sync/SyncManager.ts', import.meta.url),
    'utf8',
  );
  const syncAllCatalogsSource = syncManagerSource.slice(
    syncManagerSource.indexOf('async syncAllCatalogs()'),
    syncManagerSource.indexOf('async syncAllCatalogs()') + 10_000,
  );

  assert.match(
    syncAllCatalogsSource,
    /pullCatalog\(collection, false, \{ ignoreThrottle: true \}\)/,
  );
  assert.doesNotMatch(
    syncAllCatalogsSource,
    /await this\.pullCatalog\(collection\);/,
  );
});

test('production and promotion screens refresh when their client catalogs arrive', () => {
  const appSource = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const productionAreaSource = fs.readFileSync(
    new URL('../components/ProductionAreaManager.tsx', import.meta.url),
    'utf8',
  );

  assert.match(appSource, /case 'promotions':[\s\S]*setConfig/);
  assert.match(appSource, /'productionAreasUpdated'/);
  assert.match(appSource, /'promotionsUpdated'/);
  assert.match(productionAreaSource, /addEventListener\('productionAreasUpdated'/);
  assert.match(productionAreaSource, /removeEventListener\('productionAreasUpdated'/);
});

test('client pairing keeps the LAN Master product routing authoritative', () => {
  const appSource = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const syncManagerSource = fs.readFileSync(
    new URL('../services/sync/SyncManager.ts', import.meta.url),
    'utf8',
  );

  assert.match(appSource, /const shouldPersistSetupSnapshotItems = !shouldRestoreRemoteData/);
  assert.equal(
    (appSource.match(/shouldPersistSetupSnapshotItems && Array\.isArray\(setupResult\?\.snapshotItems\)/g) || []).length,
    2,
  );
  assert.match(
    syncManagerSource,
    /activeTarget\.kind === 'POS_MASTER' && activeTarget\.baseUrl/,
  );
});

test('KDS dispatch uses Cocina and the table-map fallback without raw cart auto-sync', () => {
  const posSource = fs.readFileSync(
    new URL('../components/POSInterface.tsx', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(posSource, /syncOrderToConfiguredKds/);
  assert.match(posSource, /const newItems = cart\.filter\(item => !item\.dispatched\)/);
  assert.match(posSource, /cart\.some\(item => !item\.dispatched\)/);
  assert.match(posSource, /const dispatchOutcome = await handleDispatchCommand\('table_exit'\)/);
});

test('production assignments are published immediately by the Master LAN catalog', () => {
  const appSource = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const managerSource = fs.readFileSync(
    new URL('../components/ProductionAreaManager.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(
    (managerSource.match(/dispatchEvent\(new CustomEvent\('productsUpdated'\)\)/g) || []).length,
    2,
  );
  assert.match(managerSource, /dispatchEvent\(new CustomEvent\('productionAreasUpdated'\)\)/);
  assert.match(appSource, /addEventListener\('productionAreasUpdated', ensureMasterServerWithoutSnapshot\)/);
  assert.match(appSource, /removeEventListener\('productionAreasUpdated', ensureMasterServerWithoutSnapshot\)/);
});

test('client KDS dispatch self-heals missing routing from the Master', () => {
  const posSource = fs.readFileSync(
    new URL('../components/POSInterface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(
    posSource,
    /shouldRefreshClientProductionRouting\(\{[\s\S]*isClientTerminal: isClientTerminalMode\(\)[\s\S]*unresolvedRouteCount/,
  );
  assert.doesNotMatch(posSource, /routingCatalogs\.productionProductCount === 0/);
  assert.match(posSource, /pullCatalog\('productionAreas', true, \{ ignoreThrottle: true \}\)/);
  assert.match(posSource, /pullCatalog\('products', true, \{ ignoreThrottle: true \}\)/);
  assert.match(posSource, /routingCatalogs = await readProductionRoutingCatalogs\(\)/);
});

test('restaurant product normalization preserves the production area aliases used by the Master', () => {
  const normalized = normalizeRestaurantProductConfig({
    id: 'product-1',
    name: 'Agua',
    productionAreaId: 'kitchen-1',
  } as any);

  assert.equal(normalized.production_area_id, 'kitchen-1');
  assert.equal(normalized.restaurant.production_area_id, 'kitchen-1');
});
