import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const featureFlagSource = await readFile(
    new URL('../services/sync/SyncFeatureFlags.ts', import.meta.url),
    'utf8',
);
const productionEnv = await readFile(new URL('../.env.production', import.meta.url), 'utf8');

test('private realtime production flags remain statically injectable by Vite', () => {
    assert.match(featureFlagSource, /const env = import\.meta\.env;/);
    assert.doesNotMatch(featureFlagSource, /import\.meta as any\)\?\.env/);
    assert.match(productionEnv, /^VITE_PRIVATE_REALTIME_ENABLED=true$/m);
    assert.match(productionEnv, /^VITE_SYNC_PRIVATE_REALTIME_ENABLED=true$/m);
});
