import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
    ERP_CRITICAL_MASTER_COLLECTIONS,
    ERP_MASTER_COLLECTION_CONTRACT,
    ERP_SUPPORTED_MASTER_COLLECTIONS,
    getErpMasterCollectionContract,
} from '../services/sync/ErpMasterSyncContract';
import {
    resolveAutomaticMasterSyncStrategy,
    shouldRunLegacyAutomaticMasterSweep,
} from '../services/sync/ErpMasterSyncStrategy';

const syncManagerSource = await readFile(
    new URL('../services/sync/SyncManager.ts', import.meta.url),
    'utf8',
);
const appSource = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
const syncSettingsSource = await readFile(
    new URL('../components/SyncSettings.tsx', import.meta.url),
    'utf8',
);

test('ERP_ACTIVE with CONFIG_PUSH_V2 skips legacy collection sweeps', () => {
    const input = { targetKind: 'ERP_ACTIVE', configPushV2Enabled: true };
    assert.equal(resolveAutomaticMasterSyncStrategy(input), 'CONFIG_PUSH_V2_PRIMARY');
    assert.equal(shouldRunLegacyAutomaticMasterSweep(input), false);
});

test('the emergency switch preserves the ERP_ACTIVE legacy fallback', () => {
    const input = { targetKind: 'ERP_ACTIVE', configPushV2Enabled: false };
    assert.equal(resolveAutomaticMasterSyncStrategy(input), 'LEGACY_COLLECTION_SWEEP');
    assert.equal(shouldRunLegacyAutomaticMasterSweep(input), true);
});

test('non ERP targets keep their current automatic strategy', () => {
    for (const targetKind of ['POS_MASTER', 'POS_CLOUD_STAGING', 'NONE']) {
        assert.equal(shouldRunLegacyAutomaticMasterSweep({ targetKind, configPushV2Enabled: true }), true);
    }
});

test('supported and critical master collections come from one contract', () => {
    assert.equal(ERP_SUPPORTED_MASTER_COLLECTIONS.has('products'), true);
    assert.equal(ERP_CRITICAL_MASTER_COLLECTIONS.has('products'), true);
    assert.equal(ERP_CRITICAL_MASTER_COLLECTIONS.has('customers'), false);
    assert.equal(ERP_SUPPORTED_MASTER_COLLECTIONS.has('purchaseOrders'), false);
    assert.equal(getErpMasterCollectionContract('purchaseOrders')?.supported, false);

    for (const collection of ERP_CRITICAL_MASTER_COLLECTIONS) {
        assert.equal(ERP_SUPPORTED_MASTER_COLLECTIONS.has(collection), true);
        assert.equal(ERP_MASTER_COLLECTION_CONTRACT[collection]?.critical, true);
    }
});

test('SyncManager does not schedule the legacy timer for CONFIG_PUSH_V2 primary', () => {
    const startAutoSync = syncManagerSource.match(/startAutoSync\(intervalMs[\s\S]*?private async runAutomaticMasterDataSync/)?.[0] || '';
    assert.match(startAutoSync, /strategy === 'CONFIG_PUSH_V2_PRIMARY'/);
    assert.match(startAutoSync, /return;[\s\S]*?this\.autoSyncInterval = setInterval/);
});

test('startup, reconnect, manifest and manual fallbacks remain available', () => {
    assert.match(appSource, /syncLifecycle\(\{ forceManifestRefresh: true, reason: 'startup' \}\)/);
    assert.match(appSource, /requestConditionalTerminalConfig\('connection_restored'\)/);
    assert.match(appSource, /MANIFEST_REFRESH_INTERVAL_MS = 15 \* 60 \* 1000/);
    assert.match(syncSettingsSource, /triggerErpSyncOutbox\('manual_sync'\)/);
});
