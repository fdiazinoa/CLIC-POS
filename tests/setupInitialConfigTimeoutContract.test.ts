import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const setupSource = readFileSync(
  new URL('../services/setup/erpTerminalSetup.ts', import.meta.url),
  'utf8'
);

test('native pairing downloads initial configuration through Capacitor HTTP', () => {
  const initialConfigFlow = setupSource.slice(
    setupSource.indexOf('export const fetchInitialConfigFromErp'),
    setupSource.indexOf('export const fetchInitialConfigWithFallback')
  );

  assert.match(
    initialConfigFlow,
    /getNetworkEngine\(\) === 'capacitor-http'/,
    'Android pairing must use the native network engine instead of WebView fetch'
  );
  assert.match(
    initialConfigFlow,
    /fetchErpJson\(\s*input\.erpBaseUrl,\s*`\/api\/setup\/initial-config\//,
    'the initial configuration endpoint must go through the native-capable request helper'
  );
  assert.match(
    initialConfigFlow,
    /headers:\s*buildDeviceHeaders\(input\.posDeviceId\)/,
    'native pairing must preserve the device authorization headers'
  );
});

test('web pairing bounds the coordinated initial configuration download', () => {
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
