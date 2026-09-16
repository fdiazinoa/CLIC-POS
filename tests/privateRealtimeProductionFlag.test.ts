import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { isSyncFeatureEnabled, resolveSyncFeatureFlagValue, setLocalSyncFeatureOverride } from '../services/sync/SyncFeatureFlags';

const featureFlagSource = await readFile(
    new URL('../services/sync/SyncFeatureFlags.ts', import.meta.url),
    'utf8',
);
const productionEnv = await readFile(new URL('../.env.production', import.meta.url), 'utf8');
const realtimeServiceSource = await readFile(
    new URL('../services/sync/RealtimeNotificationService.ts', import.meta.url),
    'utf8',
);

test('private realtime production flags remain statically injectable by Vite', () => {
    assert.match(featureFlagSource, /const env = import\.meta\.env \?\? \(\{\} as Record<string, unknown>\);/);
    assert.doesNotMatch(featureFlagSource, /import\.meta as any\)\?\.env/);
    assert.match(productionEnv, /^VITE_PRIVATE_REALTIME_ENABLED=true$/m);
    assert.match(productionEnv, /^VITE_SYNC_PRIVATE_REALTIME_ENABLED=true$/m);
});

test('the actual flag runtime tolerates Node without Vite env and preserves dark defaults', () => {
    assert.equal(isSyncFeatureEnabled('pending_operations_recovery'), false);
    assert.equal(isSyncFeatureEnabled('sqlite_outbox_v2'), false);
    assert.equal(isSyncFeatureEnabled('private_realtime'), false);
    for (const flag of ['adaptive_polling', 'sync_hint_v2', 'heartbeat_v2'] as const) {
        assert.equal(isSyncFeatureEnabled(flag), true);
    }
});

test('actual runtime applies and removes device overrides without a Vite environment', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    } });
    try {
        setLocalSyncFeatureOverride('adaptive_polling', false);
        assert.equal(isSyncFeatureEnabled('adaptive_polling'), false);
        setLocalSyncFeatureOverride('sqlite_outbox_v2', true);
        assert.equal(isSyncFeatureEnabled('sqlite_outbox_v2'), true);
        setLocalSyncFeatureOverride('sqlite_outbox_v2', null);
        assert.equal(isSyncFeatureEnabled('sqlite_outbox_v2'), false);
        setLocalSyncFeatureOverride('adaptive_polling', null);
        assert.equal(isSyncFeatureEnabled('adaptive_polling'), true);
        values.set('clic_pos_feature_heartbeat_v2', 'not-a-boolean');
        assert.equal(isSyncFeatureEnabled('heartbeat_v2'), true);
    } finally {
        if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
        else Reflect.deleteProperty(globalThis, 'localStorage');
    }
});

test('production private realtime overrides a stale localStorage false value', () => {
    assert.equal(resolveSyncFeatureFlagValue('private_realtime', {
        localValue: 'false',
        envValue: 'true',
        legacyPrivateEnvValue: 'true',
    }), true);
});

test('explicit private environment denial outranks legacy policy and local enablement', () => {
    assert.equal(resolveSyncFeatureFlagValue('private_realtime', {
        localValue: 'true', envValue: 'false', legacyPrivateEnvValue: 'true',
    }), false);
    assert.equal(resolveSyncFeatureFlagValue('private_realtime', {
        localValue: 'false', envValue: undefined, legacyPrivateEnvValue: 'true',
    }), true);
});

test('private realtime keeps local overrides only when no deployment policy exists', () => {
    assert.equal(resolveSyncFeatureFlagValue('private_realtime', {
        localValue: 'true',
        envValue: undefined,
    }), true);
    assert.equal(resolveSyncFeatureFlagValue('private_realtime', {
        localValue: 'false',
        envValue: undefined,
    }), false);
});

test('other sync flags preserve their existing local override precedence', () => {
    assert.equal(resolveSyncFeatureFlagValue('adaptive_polling', {
        localValue: 'false',
        envValue: 'true',
    }), false);
});

test('POS realtime is fail-closed and never creates public channels', () => {
    assert.match(realtimeServiceSource, /config: \{ private: true, broadcast: \{ self: false \} \}/);
    assert.doesNotMatch(realtimeServiceSource, /channel\(channelName, \{[\s\S]*?config:\s*privateRealtime/);
    assert.doesNotMatch(realtimeServiceSource, /store_\$\{storeId\}/);
    assert.match(realtimeServiceSource, /Private realtime disabled; polling remains active/);
});
