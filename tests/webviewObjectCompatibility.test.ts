import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtimeSources = [
  'services/sync/ProductImageCacheService.ts',
  'services/sync/SyncManager.ts',
  'components/ClassificationManager.tsx',
];

test('catalog application does not require Object.hasOwn on older Android WebViews', () => {
  for (const sourcePath of runtimeSources) {
    const source = readFileSync(new URL(`../${sourcePath}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /Object\.hasOwn\s*\(/, sourcePath);
  }
});
