import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolveSyncFeatureFlagValue } from '../services/sync/SyncFeatureFlags';

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
    assert.match(featureFlagSource, /const env = import\.meta\.env;/);
    assert.doesNotMatch(featureFlagSource, /import\.meta as any\)\?\.env/);
    assert.match(productionEnv, /^VITE_PRIVATE_REALTIME_ENABLED=true$/m);
    assert.match(productionEnv, /^VITE_SYNC_PRIVATE_REALTIME_ENABLED=true$/m);
});

test('production private realtime overrides a stale localStorage false value', () => {
    assert.equal(resolveSyncFeatureFlagValue('private_realtime', {
        localValue: 'false',
        envValue: 'true',
        legacyPrivateEnvValue: 'true',
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
