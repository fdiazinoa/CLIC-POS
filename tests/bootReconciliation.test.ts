import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

test('a single boot path repairs the terminal', () => {
  const app = read('App.tsx');
  assert.match(app, /runBootReconciliation\(\)/);
  assert.doesNotMatch(app, /reconcileStaleFiscalCheckout\(\)\.then/);
  assert.doesNotMatch(app, /reauthorizeTerminal\(\)\.then/);
  const service = read('services/sync/BootReconciliation.ts');
  assert.match(service, /reconcileStaleFiscalCheckout\(\)/);
  assert.match(service, /needsTerminalReauthorization\(\)/);
  assert.match(service, /reauthorizeTerminal\(\)/);
  // Both repairs report into the same trace line.
  assert.match(service, /notes\.push/);
});
