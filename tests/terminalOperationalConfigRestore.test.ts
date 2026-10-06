import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { getInitialConfig } from '../constants';
import { applyTerminalConfigSnapshot } from '../utils/terminalConfigSnapshot';
import { assertOperationalTerminalConfig, readOperationalTerminalBinding } from '../services/sync/OperationalTerminalConfig';
import { assertLargeMasterSyncV3ConfigPayload } from '../services/sync/LargeMasterSyncV3DownloadOrigin';

const terminalId = 'terminal';
const identity = { tenantId: 'tenant', terminalId, posDeviceId: 'device' };
const snapshot = () => ({ tenant_id: 'tenant', terminal_id: terminalId, device_id: 'device', resolved: {
  identity: { id: terminalId, tenant_id: 'tenant' },
  pricing: { default_tariff_id: 'DUARTE', allowed_tariff_ids: ['DUARTE', 'WHOLESALE'] },
  inventory: { default_warehouse_id: 'W', allowed_warehouse_ids: ['W'], warehouses: [{ id: 'W', name: 'Warehouse' }] },
  documents: { fiscal_mode: 'NONE', document_series: [], fiscal_ranges: [] },
} });

test('raw terminal authority admits NONE fiscal without inventing pricing or warehouse authority', () => {
  assertOperationalTerminalConfig(snapshot(), identity);
  assertOperationalTerminalConfig({ terminal_config: snapshot(), status: 'success' }, identity);
});

for (const [name, patch] of [
  ['null', () => null], ['global', () => ({ config: getInitialConfig('Supermercado' as any) })],
  ['failure', (s: any) => ({ ...s, success: false })],
  ['resolution', (s: any) => ({ ...s, resolution_error: 'missing assignment' })],
  ['tenant', (s: any) => ({ ...s, tenant_id: 'foreign' })],
  ['terminal', (s: any) => ({ ...s, terminal_id: 'foreign' })],
  ['device', (s: any) => ({ ...s, device_id: 'foreign' })],
  ['missing pricing', (s: any) => { delete s.resolved.pricing; return s; }],
  ['empty pricing', (s: any) => { s.resolved.pricing = {}; return s; }],
  ['foreign default', (s: any) => { s.resolved.pricing.default_tariff_id = 'VILLA'; return s; }],
  ['empty allowed warehouses', (s: any) => { s.resolved.inventory.allowed_warehouse_ids = []; return s; }],
  ['foreign warehouse', (s: any) => { s.resolved.inventory.default_warehouse_id = 'foreign'; return s; }],
  ['missing scoped warehouse', (s: any) => { s.resolved.inventory.warehouses = []; return s; }],
  ['missing documents', (s: any) => { delete s.resolved.documents; return s; }],
] as Array<[string, (snapshot: any) => any]>) {
  test(`raw validation rejects ${name}`, () => assert.throws(() => assertOperationalTerminalConfig(patch(snapshot()), identity), /ERP_OPERATIONAL_TERMINAL_/));
}

const config = () => {
  const value = getInitialConfig('Supermercado' as any);
  value.terminals = [{ id: terminalId, config: structuredClone(value.terminals[0].config) }];
  value.terminals[0].config.pricing = { ...value.terminals[0].config.pricing,
    defaultTariffId: 'DUARTE', allowedTariffIds: ['DUARTE', 'WHOLESALE'], tariffs: [{ id: 'DUARTE', name: 'Duarte' }] as any };
  value.terminals[0].config.inventoryScope = { defaultSalesWarehouseId: 'W', visibleWarehouseIds: ['W'],
    transferWarehouseId: 'TRANSFER', warehouses: [{ id: 'W', name: 'Warehouse' }] as any,
    defaultWarehouse: { id: 'W', name: 'Warehouse' } as any };
  value.inventoryScope = { defaultSalesWarehouseId: 'W', visibleWarehouseIds: ['W'] };
  value.tariffs = [{ id: 'VILLA', name: 'Villa Mella' }] as any;
  return value;
};
for (const cached of [false, true]) {
  test(`V3 partial identity/role keeps complete operational objects and global mirrors (cached=${cached})`, () => {
    const base = config(); const before = structuredClone(base);
    const result = applyTerminalConfigSnapshot(base, { terminalId,
      incomingSnapshot: { terminal_id: terminalId, resolved: { identity: { id: terminalId }, role: {} } } as any,
      cachedSnapshot: cached ? snapshot() as any : undefined, preserveOmittedOperationalScopes: true });
    assert.deepEqual(result.config.terminals[0].config.pricing, before.terminals[0].config.pricing);
    assert.deepEqual(result.config.terminals[0].config.inventoryScope, before.terminals[0].config.inventoryScope);
    assert.deepEqual(result.config.inventoryScope, before.inventoryScope);
    assert.deepEqual(result.config.tariffs, before.tariffs);
    assert.deepEqual(base, before);
  });
}
test('explicit operational authority overrides stale defaults; omission is not explicit empty', () => {
  const base = config(); base.terminals[0].config.pricing.defaultTariffId = 'VILLA';
  const result = applyTerminalConfigSnapshot(base, { terminalId, incomingSnapshot: snapshot() as any, preserveOmittedOperationalScopes: true });
  assert.equal(result.config.terminals[0].config.pricing.defaultTariffId, 'DUARTE');
  assert.deepEqual(result.config.terminals[0].config.pricing.allowedTariffIds, ['DUARTE', 'WHOLESALE']);
  assert.equal(result.config.terminals[0].config.inventoryScope?.defaultSalesWarehouseId, 'W');
  const explicitEmpty = applyTerminalConfigSnapshot(config(), { terminalId, preserveOmittedOperationalScopes: true,
    incomingSnapshot: { terminal_id: terminalId, resolved: { pricing: {} } } as any });
  assert.equal(explicitEmpty.config.terminals[0].config.pricing.defaultTariffId, 'VILLA');
});
test('V2 default behavior continues to infer global pricing for omitted scopes', () => {
  const result = applyTerminalConfigSnapshot(config(), { terminalId,
    incomingSnapshot: { terminal_id: terminalId, resolved: { identity: { id: terminalId } } } as any });
  assert.equal(result.config.terminals[0].config.pricing.defaultTariffId, 'VILLA');
});

for (const [incoming, previous, expected] of [[false, true, false], [true, false, true], [undefined, true, true], ['false', true, true]]) {
  test(`V3 operational policy boolean ${String(incoming)} preserves unrelated inventory workflow`, () => {
    const base = config(); base.terminals[0].config.workflow.inventory.allowNegativeStock = previous as boolean;
    const before = structuredClone(base.terminals[0].config.workflow.inventory);
    const incomingSnapshot = { ...snapshot(), config: { workflow: { inventory: { allowNegativeStock: incoming } } } };
    const applied = applyTerminalConfigSnapshot(base, { terminalId, incomingSnapshot: incomingSnapshot as any,
      preserveOmittedOperationalScopes: true });
    assert.deepEqual(applied.config.terminals[0].config.workflow.inventory, { ...before, allowNegativeStock: expected });
    const legacy = applyTerminalConfigSnapshot(base, { terminalId, incomingSnapshot: incomingSnapshot as any });
    assert.deepEqual(legacy.config.terminals[0].config.workflow.inventory, before);
  });
}

test('pure binding fingerprint reads legacy credentials/profile without migration or writes', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let writes = 0;
  const values = new Map([['clic_terminal_credentials_v1', JSON.stringify({ configSnapshot: { terminals: [] }, syncToken: 'synthetic' })],
    ['clic_sync_profile', JSON.stringify({ erpBaseUrl: 'https://old.example.test' })]]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) || null, setItem: () => { writes++; },
  } });
  try {
    const before = readOperationalTerminalBinding();
    assert.throws(() => assertOperationalTerminalConfig(null, identity));
    assert.equal(writes, 0);
    values.set('clic_sync_profile', JSON.stringify({ erpBaseUrl: 'https://new.example.test' }));
    assert.notEqual(readOperationalTerminalBinding(), before); assert.equal(writes, 0);
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});

// Execute the actual queued method, not a rewritten imitation; boundary dependencies are controlled fixtures.
const source = readFileSync(new URL('../services/sync/SyncManager.ts', import.meta.url), 'utf8');
const refreshMethod = source.slice(source.indexOf('    async refreshTerminalResolvedConfig('), source.indexOf('    private async applySnapshotProducts('));
function refreshFixture(response: unknown = snapshot(), kind = 'ERP_ACTIVE', fetchError?: string) {
  const writes: string[] = [], events: string[] = [], endpoints: string[] = [];
  let local = config(); let active = terminalId; let credentials = { syncToken: 'fixture-token' };
  let target = { kind, baseUrl: 'https://original.example.test', terminalId };
  const storage = new Map<string, string>();
  const deps = {
    freezeCount() {}, freezePhase() {}, protectsLocalCatalogFromCloud: () => false,
    usesLargeMasterSyncV3Authority: () => kind === 'ERP_ACTIVE',
    syncPolicy: { resolve: () => target },
    readOperationalTerminalBinding: () => JSON.stringify([target, credentials]),
    db: { get: async (collection: string) => collection === 'config' ? local : [],
      save: async (collection: string, value: any) => { writes.push(collection); if (collection === 'config') local = value; },
      rehydrateOperationalDocumentState: async () => { writes.push('documents'); } },
    extractTerminalConfigSnapshot: (value: any) => value?.resolved ? value : null,
    assertOperationalTerminalConfig, assertLargeMasterSyncV3ConfigPayload,
    posCatalogDebugNow: () => 0, posCatalogDebugLog() {}, posCatalogDebugElapsedMs: () => 0,
    posCatalogDebugMatchesRaw: () => false, posCatalogDebugSummarizeItem: (v: unknown) => v,
    posCatalogDebugLogDbRows: async () => undefined,
    buildTerminalSyncAuthHeaders: () => assert.fail('operational preflight must not call migrating credential loader'),
    fetchAndReadWithTimeout: async (endpoint: string) => { endpoints.push(endpoint); if (fetchError) throw new Error(fetchError);
      if (mutateDuringFetch) mutateDuringFetch(); return { payload: response, contentType: 'application/json' }; },
    persistMasterNumberRangesFromSnapshot: async () => { writes.push('ranges'); },
    applyTerminalConfigSnapshot, extractTerminalOperationalDocumentState: () => ({ documentSeries: [], fiscalRanges: [], fiscalAllocations: [], terminalId }),
    localStorage: { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => { writes.push('storage:' + key); storage.set(key, value); } },
    window: { dispatchEvent: (event: CustomEvent) => { events.push(event.type); } }, CustomEvent,
    console: { warn() {} }, URLSearchParams,
  };
  let mutateDuringFetch: (() => void) | undefined;
  const Constructor = runInNewContext(ts.transpile(`class Subject { ${refreshMethod} }\nSubject;`, { target: ts.ScriptTarget.ES2022 }), deps);
  const instance = new Constructor(); Object.assign(instance, {
    terminalConfigRefreshQueue: Promise.resolve(), isDisabled: false,
    getActiveTerminalContext: () => ({ ...identity, localTerminalId: active, erpBaseUrl: 'https://auth.example.test' }),
    readStoredCatalogCursor: () => null, readStoredTerminalCursorMap: () => ({}),
    getPendingTerminalSnapshot: () => null, clearPendingTerminalSnapshot: () => assert.fail('unexpected pending clear'),
    buildTerminalConfigEndpointCandidates: () => [{ baseUrl: 'https://railway.example.test/api/sync', mode: 'erp' }],
    resolveTerminalConfigSyncApiBase: () => 'https://railway.example.test/api/sync', shouldUseAbsoluteTerminalConfigEndpoint: () => true,
    buildPosDeviceHeaders: () => ({}), recordSnapshotDiagnostics: () => { writes.push('diagnostics'); }, normalizeVersionToken: () => null,
    refreshTerminalStructuredMasterData: async () => { writes.push('structured'); return {}; },
    sanitizeConfig: (value: any) => value, resolveRuntimeWarehousesFromConfig: () => [],
  });
  return { instance, writes, events, endpoints, getConfig: () => local, changeIdentity: () => { active = 'foreign'; },
    changeToken: () => { credentials = { syncToken: 'rotated-fixture-token' }; },
    changeTarget: () => { target = { ...target, baseUrl: 'https://different.example.test' }; },
    duringFetch: (callback: () => void) => { mutateDuringFetch = callback; } };
}
const options = { forceRemoteFetch: true, requireOperationalTerminalConfig: true, masterScopes: [], blockScopes: [],
  resolvedScopes: ['identity', 'pricing', 'inventory', 'documents'], supplementalMode: 'skip' };
for (const failure of ['timeout', 'HTTP 401', 'HTTP 403', 'HTTP 500']) {
  test(`queued scoped refresh ${failure} leaves all authority/persistence/events untouched`, async () => {
    const f = refreshFixture(snapshot(), 'ERP_ACTIVE', failure); const before = structuredClone(f.getConfig());
    await assert.rejects(f.instance.refreshTerminalResolvedConfig(undefined, options), new RegExp(failure));
    assert.deepEqual(f.writes, []); assert.deepEqual(f.events, []); assert.deepEqual(f.getConfig(), before);
  });
}
for (const invalid of [null, { config: {} }, { ...snapshot(), tenant_id: 'foreign' },
  { ...snapshot(), resolution_error: 'bad' }, { ...snapshot(), resolved: { pricing: {} } }]) {
  test(`queued invalid scoped payload ${JSON.stringify(invalid)} causes zero side effects`, async () => {
    const f = refreshFixture(invalid);
    await assert.rejects(f.instance.refreshTerminalResolvedConfig(undefined, options), /ERP_/);
    assert.deepEqual(f.writes, []); assert.deepEqual(f.events, []);
  });
}
for (const mutation of ['identity', 'token', 'target']) {
  test(`queued scope ${mutation} change during fetch rejects before any diagnostics or writes`, async () => {
    const f = refreshFixture(); f.duringFetch(mutation === 'identity' ? f.changeIdentity : mutation === 'token' ? f.changeToken : f.changeTarget);
    await assert.rejects(f.instance.refreshTerminalResolvedConfig(undefined, options), /BINDING_CHANGED/);
    assert.deepEqual(f.writes, []); assert.deepEqual(f.events, []);
  });
}
test('two concurrent scoped refreshes retain queue, request exact endpoint, apply authoritative defaults', async () => {
  const f = refreshFixture();
  await Promise.all([f.instance.refreshTerminalResolvedConfig(undefined, options), f.instance.refreshTerminalResolvedConfig(undefined, options)]);
  assert.equal(f.endpoints.length, 2);
  for (const endpoint of f.endpoints) {
    const url = new URL(endpoint); assert.equal(url.pathname, '/api/sync/terminals/terminal/config');
    assert.equal(url.searchParams.get('master_scopes'), 'none');
  }
  assert.equal(f.getConfig().terminals[0].config.pricing.defaultTariffId, 'DUARTE');
  assert.equal(f.getConfig().inventoryScope?.defaultSalesWarehouseId, 'W');
  assert.ok(f.writes.includes('config'));
});

test('binding switched during structured master await cannot save stale config or active IDs', async () => {
  const f = refreshFixture(); const before = structuredClone(f.getConfig());
  f.instance.refreshTerminalStructuredMasterData = async () => { f.writes.push('structured'); f.changeIdentity(); return {}; };
  await assert.rejects(f.instance.refreshTerminalResolvedConfig(undefined, options), /BINDING_CHANGED/);
  assert.deepEqual(f.getConfig(), before); assert.equal(f.writes.includes('config'), false);
  assert.equal(f.writes.some(row => row.startsWith('storage:')), false);
  assert.deepEqual(f.events, []);
  assert.ok(f.writes.includes('ranges')); // Previously applied valid master effects are not claimed atomic/rolled back.
});

const pullMethod = source.slice(source.indexOf('    async pullConfig(force:'), source.indexOf('    /**', source.indexOf('    async pullConfig(force:')));
test('ERP pullConfig skips generic metadata/config and null refresh is an error rather than successful fallback', async () => {
  let calls = 0;
  const Constructor = runInNewContext(ts.transpile(`class Subject { ${pullMethod} }\nSubject;`, { target: ts.ScriptTarget.ES2022 }), {
    permissionService: { isMasterTerminal: () => false }, syncPolicy: { resolve: () => ({ kind: 'ERP_ACTIVE' }) },
    apiSyncAdapter: { getMetadata: () => assert.fail('global metadata'), pullConfig: () => assert.fail('global config') },
  });
  const instance = new Constructor();
  instance.refreshTerminalResolvedConfig = async (_: unknown, opts: any) => {
    calls++; assert.equal(opts.requireOperationalTerminalConfig, true); assert.equal(opts.supplementalMode, 'skip');
    assert.equal(opts.persist, undefined); assert.equal(opts.baseConfig, undefined); return config();
  };
  await instance.pullConfig(true); assert.equal(calls, 1);
  instance.refreshTerminalResolvedConfig = async () => null;
  await assert.rejects(instance.pullConfig(true), /FRESH_TERMINAL_CONFIG_REQUIRED/);
});

test('V2 LAN pullConfig keeps its generic metadata/config behavior', async () => {
  const local = config(); const calls: string[] = []; const versions = new Map();
  const Constructor = runInNewContext(ts.transpile(`class Subject { ${pullMethod} }\nSubject;`, { target: ts.ScriptTarget.ES2022 }), {
    permissionService: { isMasterTerminal: () => false, getTerminalId: () => terminalId },
    syncPolicy: { resolve: () => ({ kind: 'POS_MASTER' }) }, db: { get: async () => local },
    apiSyncAdapter: { getMetadata: async () => { calls.push('metadata'); return { version: 7 }; },
      pullConfig: async () => { calls.push('global'); return local; } },
    mergePosCategoryPresentation: (_: unknown, value: unknown) => value,
    localStorage: { setItem: () => undefined }, console: { log() {}, error() {} },
  });
  const instance = new Constructor(); instance.syncVersions = versions;
  instance.isDebugSync = () => false; instance.sanitizeConfig = (value: unknown) => value;
  instance.refreshTerminalResolvedConfig = async () => null;
  await instance.pullConfig(true);
  assert.deepEqual(calls, ['metadata', 'global']); assert.equal(versions.get('config'), 7);
});

test('ERP restore config failure leaves version unchanged and emits ERROR rather than SUCCESS', async () => {
  const method = source.slice(source.indexOf('    async forcePullAll()'), source.indexOf('    async fullPull()'));
  const versions = new Map([['config', 17]]); const stored = new Map([['sync_version_config', '17']]);
  const events: any[] = [];
  const Constructor = runInNewContext(ts.transpile(`class Subject { ${method} }\nSubject;`, { target: ts.ScriptTarget.ES2022 }), {
    syncPolicy: { resolve: () => ({ kind: 'ERP_ACTIVE', canPullMasters: true }) },
    permissionService: { isMasterTerminal: () => false, shouldShowGlobalSales: () => false },
    usesLargeMasterSyncV3Authority: () => true,
    isLargeMasterSyncV3ReplacedCollection: (id: string) => ['products', 'taxes', 'priceLists', 'productPrices', 'productStocks'].includes(id),
    getLargeMasterSyncV3OperationalSession: async () => ({ assertCurrent: async () => undefined }),
    window: { dispatchEvent: (event: CustomEvent) => events.push(event.detail) }, CustomEvent,
    localStorage: { setItem: (key: string, value: string) => stored.set(key, value) },
    console: { log() {}, warn() {}, error() {} }, isPaymentMethodsMissingSyncError: () => false,
  });
  const instance = new Constructor(); instance.syncVersions = versions;
  instance.pullConfig = async () => { throw new Error('HTTP 500'); };
  instance.pullCatalog = async () => 0;
  await instance.forcePullAll();
  assert.equal(versions.get('config'), 17); assert.equal(stored.get('sync_version_config'), '17');
  assert.deepEqual(events.filter(event => event.id === 'config').map(event => event.status), ['PROCESSING', 'ERROR']);
});
