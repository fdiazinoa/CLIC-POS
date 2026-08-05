import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  applyProductionAreaAssignments,
  selectProductionRoutingStrategy,
  shouldRefreshClientProductionRouting,
} from '../utils/productionRoutingAssignment';

test('client refreshes authoritative routing whenever a pending item is unresolved', () => {
  assert.equal(shouldRefreshClientProductionRouting({
    isClientTerminal: true,
    pendingItemCount: 2,
    unresolvedRouteCount: 1,
  }), true);
  assert.equal(shouldRefreshClientProductionRouting({
    isClientTerminal: true,
    pendingItemCount: 2,
    unresolvedRouteCount: 0,
  }), false);
  assert.equal(shouldRefreshClientProductionRouting({
    isClientTerminal: false,
    pendingItemCount: 2,
    unresolvedRouteCount: 2,
  }), false);
});

test('a POS without production areas never prompts or dispatches automatically', () => {
  assert.equal(selectProductionRoutingStrategy({
    productionAreaCount: 0,
    pendingItemCount: 2,
    unassignedItemCount: 2,
  }), 'NO_PRODUCTION_AREAS');
});

test('only prompts when production exists and a pending item lacks a route', () => {
  assert.equal(selectProductionRoutingStrategy({
    productionAreaCount: 2,
    pendingItemCount: 3,
    unassignedItemCount: 1,
  }), 'PROMPT_ASSIGNMENT');
  assert.equal(selectProductionRoutingStrategy({
    productionAreaCount: 2,
    pendingItemCount: 3,
    unassignedItemCount: 0,
  }), 'DISPATCH');
});

test('production assignment updates only selected products and preserves restaurant config', () => {
  const first = {
    id: 'product-1',
    name: 'Hamburguesa',
    price: 250,
    category: 'Comida',
    images: [],
    attributes: [],
    variants: [],
    tariffs: [],
    appliedTaxIds: [],
    restaurant: { product_type: 'SIMPLE', note_presets: ['Sin cebolla'] },
  } as any;
  const second = { ...first, id: 'product-2', name: 'Refresco' };

  const result = applyProductionAreaAssignments(
    [first, second],
    { 'product-1': 'kitchen-1' },
    '2026-08-05T12:00:00.000Z',
  );

  assert.equal(result.products[0].production_area_id, 'kitchen-1');
  assert.equal(result.products[0].restaurant?.production_area_id, 'kitchen-1');
  assert.deepEqual(result.products[0].restaurant?.note_presets, ['Sin cebolla']);
  assert.equal(result.products[0].updatedAt, '2026-08-05T12:00:00.000Z');
  assert.equal(result.products[1], second);
  assert.deepEqual(result.updatedProducts.map(product => product.id), ['product-1']);
});

test('table exit distinguishes dispatch, silent save, and modal cancellation', () => {
  const source = fs.readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');

  assert.match(source, /handleDispatchCommand\('table_exit'\)/);
  assert.match(source, /routingStrategy === 'NO_PRODUCTION_AREAS'[\s\S]*return 'CONTINUE_WITHOUT_DISPATCH'/);
  assert.match(source, /dispatchOutcome === 'DISPATCHED' \|\| dispatchOutcome === 'CANCELLED'/);
  assert.doesNotMatch(source, /alert\("No hay ítems con centro de producción configurado para enviar\."\)/);
});

test('routing changes publish asynchronously after local persistence', () => {
  const source = fs.readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  const persistenceBlock = source.slice(
    source.indexOf('const persistProductionRoutingAssignments'),
    source.indexOf('const handleDispatchCommand'),
  );

  assert.match(persistenceBlock, /await db\.save\('products'/);
  assert.match(persistenceBlock, /onUpdateProducts\(nextProducts\)/);
  assert.match(persistenceBlock, /void syncManager\.broadcastProductRoutingChange\(product\)/);
  assert.doesNotMatch(persistenceBlock, /await syncManager\.broadcastProductRoutingChange/);
});

test('client publishes a narrow patch and Android Master reconciles it into its catalog', () => {
  const syncSource = fs.readFileSync(new URL('../services/sync/SyncManager.ts', import.meta.url), 'utf8');
  const nativeSource = fs.readFileSync(
    new URL('../native-stubs/android/ClicPOSMasterHttpServer.kt', import.meta.url),
    'utf8',
  );
  const appSource = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const serverDbSource = fs.readFileSync(new URL('../server/db.ts', import.meta.url), 'utf8');

  const publishBlock = syncSource.slice(
    syncSource.indexOf('async broadcastProductRoutingChange'),
    syncSource.indexOf('async pushZReport'),
  );
  assert.match(publishBlock, /production_area_id: product\.production_area_id/);
  assert.doesNotMatch(publishBlock, /\[product\]/);
  assert.match(nativeSource, /POST" && path == "\/api\/sync\/collections\/products\/push"/);
  assert.match(nativeSource, /applyProductRoutingOverrides/);
  assert.match(nativeSource, /reconcileProductRoutingOverrides/);
  assert.match(appSource, /state\?\.productRoutingUpdates/);
  assert.match(appSource, /applyProductionAreaAssignments\(products, routingAssignments\)/);
  assert.match(serverDbSource, /ensureColumn\('products', 'production_area_id', 'TEXT'\)/);
});
