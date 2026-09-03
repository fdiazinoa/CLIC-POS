import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import test from 'node:test';

// Exercise the actual event handler with isolated services: no DB or HTTP calls.
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const handler = app.slice(app.indexOf('    const handleConfigUpdated = async'),
  app.indexOf("    window.addEventListener('configUpdated', handleConfigUpdated"));

for (const bootComplete of [false, true]) {
  test(`config event applies state with bootComplete=${bootComplete}, without duplicate startup`, async () => {
    let initialized = 0;
    let applied: unknown;
    const terminal = { id: 't1', config: { currentDeviceId: 'd1' } };
    const incoming = { terminals: [terminal], currencySymbol: 'RD$' };
    const context = {
      config: { terminals: [terminal] }, isDataLoaded: bootComplete, deviceId: 'd1',
      currentUser: null, currentView: 'LOGIN', console: { log() {}, error() {} },
      persistInitialTerminalConfig() {}, setConfig(value: unknown) { applied = value; },
      localStorage: { getItem() { return ''; } },
      permissionService: { initialize() {} }, authLevelService: { init() {} }, terminalRouter: { init() {} },
      syncManager: { async initialize() { initialized++; } },
      async syncConfigToLocalServer() {},
    };
    const code = ts.transpile(`${handler}\nhandleConfigUpdated;`, { target: ts.ScriptTarget.ES2022 });
    const onEvent = runInNewContext(code, context);
    await onEvent({ detail: incoming });
    assert.equal(applied, incoming, 'config snapshots still update local UI state');
    assert.equal(initialized, bootComplete ? 1 : 0);
  });
}

test('startup retains security validation and uses bounded configuration with background supplements', () => {
  const startup = app.slice(app.indexOf('const loadData = async'), app.indexOf('    loadData();'));
  assert.match(startup, /await checkLicenseStatus/);
  assert.match(startup, /await syncManager\.refreshErpPosUserRoster/);
  assert.match(startup, /requestTimeoutMs: 8_000,\s*supplementalMode: 'background'/);
});
