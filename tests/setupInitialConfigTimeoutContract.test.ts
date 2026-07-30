import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const setupSource = readFileSync(
  new URL('../services/setup/erpTerminalSetup.ts', import.meta.url),
  'utf8'
);

test('interactive pairing bounds the initial configuration download', () => {
  const initialConfigFlow = setupSource.slice(
    setupSource.indexOf('export const fetchInitialConfigFromErp'),
    setupSource.indexOf('export const fetchInitialConfigWithFallback')
  );

  assert.match(
    initialConfigFlow,
    /await withTimeout\(\s*terminalConfigRequestCoordinator\.request/,
    'pairing must not inherit the coordinator long-running background retries'
  );
  assert.match(
    initialConfigFlow,
    /terminalConfigRequestCoordinator\.cancel\(input\.erpTerminalId\)/,
    'a timed-out pairing request must cancel its pending retries'
  );
  assert.match(
    initialConfigFlow,
    /pulsa Reintentar/,
    'the operator must receive an actionable recovery message'
  );
});
