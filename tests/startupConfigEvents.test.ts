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
      async waitForBackgroundSyncWindow() { return false; },
      freezePhase() {},
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

test('V3 catalog publication applies persisted config and preserves a batched unrelated edit', () => {
  const v3Handler = app.slice(app.indexOf('    const applyV3CatalogConfig ='),
    app.indexOf("    window.addEventListener('v3CatalogUpdated', applyV3CatalogConfig"));
  const config = { terminals: [{ id: 'T1', warehouse: 'W1' }], tariffs: ['old'], currencySymbol: '$' };
  const persisted = { ...config, terminals: [{ id: 'T1', warehouse: 'W2' }], tariffs: ['new'] };
  const pending = { ...config, terminals: [{ ...config.terminals[0] }], currencySymbol: 'RD$' };
  let applied: typeof config = pending;
  const apply = runInNewContext(ts.transpile(`${v3Handler}\napplyV3CatalogConfig;`, { target: ts.ScriptTarget.ES2022 }), {
    config,
    setConfig(update: (value: typeof config) => typeof config) {
      applied = update(applied);
    },
  });
  const detail = { config: persisted, authority: { assertCurrent(value: typeof config) {
    if (value.terminals[0].id !== 'T1') throw Error('SYNC_V3_BINDING_CHANGED');
  } } };

  apply({ detail: undefined });
  assert.equal(applied, pending);
  apply({ detail });
  assert.equal(applied.tariffs, persisted.tariffs);
  assert.equal(applied.terminals, persisted.terminals);
  assert.equal(applied.currencySymbol, pending.currencySymbol);

  const newer = { ...pending, terminals: [{ id: 'T1', warehouse: 'W3' }] };
  applied = newer;
  apply({ detail });
  assert.equal(applied.terminals, newer.terminals);

  const otherTerminal = { ...config, terminals: [{ id: 'T2', warehouse: 'W2' }] };
  applied = otherTerminal;
  apply({ detail });
  assert.equal(applied, otherTerminal);
});
