import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('production builds enable POS catalog edits', () => {
  const productionEnv = readFileSync(new URL('../.env.production', import.meta.url), 'utf8');
  const configuredValue = productionEnv
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith('VITE_POS_CATALOG_EDITS_ENABLED='))
    ?.split('=', 2)[1]
    ?.trim();

  assert.equal(configuredValue, 'true');
});
