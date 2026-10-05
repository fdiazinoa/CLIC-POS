import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,
  assertLegacyMasterPullAllowed,
  isLargeMasterSyncV3ReplacedCollection,
  usesLargeMasterSyncV3Authority,
} from '../services/sync/LargeMasterSyncV3Authority';

test('V3 candidate blocks only the ERP masters replaced by its contract', () => {
  assert.equal(LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED, false);
  assert.equal(usesLargeMasterSyncV3Authority('ERP_ACTIVE', true), true);
  for (const collection of ['products', 'items', 'priceLists', 'productPrices', 'taxes']) {
    assert.equal(isLargeMasterSyncV3ReplacedCollection(collection), true);
    assert.throws(() => assertLegacyMasterPullAllowed(collection, 'ERP_ACTIVE', true),
      (error: unknown) => (error as { code?: string }).code === 'SYNC_V3_LEGACY_MASTER_FORBIDDEN');
    assert.doesNotThrow(() => assertLegacyMasterPullAllowed(collection, 'ERP_ACTIVE', false));
    assert.doesNotThrow(() => assertLegacyMasterPullAllowed(collection, 'POS_MASTER', true));
  }
  for (const collection of ['customers', 'warehouses', 'paymentMethods', 'documentSeries',
    'fiscalRanges', 'users', 'roles', 'categories', 'config', 'productInventory']) {
    assert.equal(isLargeMasterSyncV3ReplacedCollection(collection), false);
    assert.doesNotThrow(() => assertLegacyMasterPullAllowed(collection, 'ERP_ACTIVE', true));
  }
});

test('both collection and terminal-manifest legacy routes enforce candidate authority', () => {
  const adapter = readFileSync(new URL('../services/sync/ApiSyncAdapter.ts', import.meta.url), 'utf8');
  const manager = readFileSync(new URL('../services/sync/SyncManager.ts', import.meta.url), 'utf8');
  assert.match(adapter, /async pull\([\s\S]*?assertLegacyMasterPullAllowed\(collection, resolveSyncTarget\(\)\.kind\)/);
  assert.match(adapter, /async pullFullSnapshot\([\s\S]*?assertLegacyMasterPullAllowed\(collection, resolveSyncTarget\(\)\.kind\)/);
  assert.match(adapter, /async pullDelta\([\s\S]*?assertLegacyMasterPullAllowed\(collection, routedTarget\.kind\)/);
  assert.match(manager, /const changedMasterScopes:[\s\S]*?v3Authority && scope === 'items'/);
  assert.match(manager, /if \(!v3Authority\) \{[\s\S]*?this\.applySnapshotProducts/);
  assert.match(manager, /!v3Authority && requestedBlockScopes\?\.includes\('product_prices'\)/);
  assert.match(manager, /!v3Authority && requestedBlockScopes\?\.includes\('inventory'\)/);
  assert.match(manager, /await prepareLargeMasterSyncV3Candidate\(dbAdapter\.masterSyncV3Store, v3BaseUrl\)/);
});
