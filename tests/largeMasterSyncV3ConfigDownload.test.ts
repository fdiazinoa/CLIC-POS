import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { getInitialConfig } from '../constants';
import { fetchLargeMasterSyncV3ConfigSnapshot } from '../services/sync/LargeMasterSyncV3ConfigDownload';
import { assertLargeMasterSyncV3IncomingConfigMasters, assertLargeMasterSyncV3ConfigWriteDestinations
} from '../services/sync/LargeMasterSyncV3ConfigPayload';

const origin = 'https://clic-erp-production.up.railway.app';
const auth = 'https://clic-erp.clicsuite.com/api/sync';
const terminalId = '9ffc6771-7845-4976-afd3-20cebc3cc6e8';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const savedFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = savedFetch; });

test('configuration GET alone selects validated download authority; V2 and auth headers unchanged', async () => {
  const calls: any[] = [];
  const headers = { 'X-Sync-Token': 'bound-token', 'X-Device-Id': 'device', 'X-Terminal-Id': terminalId };
  const transport = (async (url, init) => { calls.push({ url, init }); return Response.json({}); }) as typeof fetch;
  const path = '/terminals/terminal/config-snapshots/snapshot?scopes=terminal_config';
  await fetchLargeMasterSyncV3ConfigSnapshot(path, auth, headers, true, origin, transport);
  await fetchLargeMasterSyncV3ConfigSnapshot(path, auth, headers, false, undefined, transport);
  assert.equal(calls[0].url, `${origin}/api/sync${path}`);
  assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(calls[0].init.headers, { 'Content-Type': 'application/json', ...headers,
    'X-POS-Capabilities': 'largeMasterSyncV3' });
  assert.equal(calls[1].url, auth + path);
  assert.equal(calls[1].init.redirect, undefined);
  assert.deepEqual(calls[1].init.headers, { 'Content-Type': 'application/json', ...headers });
  assert.throws(() => fetchLargeMasterSyncV3ConfigSnapshot(path, auth, headers, true, `${origin}/invalid`, transport));
  assert.equal(calls.length, 2);
});

test('whole incoming contract rejects replaced arrays including empty, extra scopes and nested wrappers', () => {
  for (const key of ['items', 'products', 'taxes', 'priceLists', 'price_lists', 'productPrices',
    'product_prices', 'prices', 'productStocks', 'product_stocks']) {
    for (const values of [[], [{ id: 'legacy' }]]) {
      const payload = { domains: { extra_scope: { terminal: { config: { business_config: { [key]: values } } } } } };
      assert.throws(() => assertLargeMasterSyncV3IncomingConfigMasters(payload, 'ERP_ACTIVE', true),
        (error: any) => error.code === 'SYNC_V3_LEGACY_MASTER_FORBIDDEN');
      assert.doesNotThrow(() => assertLargeMasterSyncV3IncomingConfigMasters(payload, 'ERP_ACTIVE', false));
      assert.doesNotThrow(() => assertLargeMasterSyncV3IncomingConfigMasters(payload, 'POS_MASTER', true));
    }
  }
  assert.throws(() => assertLargeMasterSyncV3IncomingConfigMasters({ domains: { inventory: { balances: [] } } }, 'ERP_ACTIVE', true));
  assert.throws(() => assertLargeMasterSyncV3IncomingConfigMasters({ resolved: { catalog_delta: { items: [] } } }, 'ERP_ACTIVE', true));
  assert.doesNotThrow(() => assertLargeMasterSyncV3IncomingConfigMasters({ config: { prices: true },
    domains: { terminal_config: { config: { currency_code: 'USD' } }, catalog: { users: [] },
      fiscal: { document_series: [] }, inventory: { warehouses: [] } } }, 'ERP_ACTIVE', true));
  assert.throws(() => assertLargeMasterSyncV3ConfigWriteDestinations(['users', 'config', 'productStocks'], 'ERP_ACTIVE', true));
});

// Execute the real lifecycle, builder, snapshot merger and guards; only platform/storage/credential boundaries are mocked.
async function fixture(candidate = true, channel = 'ERP_ACTIVE') {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)), removeItem: (key: string) => values.delete(key) };
  const config = getInitialConfig('Supermercado' as any);
  const localTerminalId = config.terminals[0].id;
  const collections = new Map<string, unknown>([['config', clone(config)]]);
  const saves: string[] = [];
  let atomic = 0;
  let ranges = 0;
  const db = { get: async (name: string) => clone(collections.get(name) ?? []),
    save: async (name: string, value: unknown) => { saves.push(name); collections.set(name, clone(value)); } };
  const adapter = { saveDocumentsAtomically: async (documents: any[], _silent: boolean, replace: string[]) => {
    atomic++;
    for (const name of replace) {
      const rows = documents.filter(row => row.collectionName === name).map(row => row.document);
      collections.set(name, clone(name === 'config' ? rows[0] : rows));
    }
  } };
  Object.assign(globalThis, { localStorage: storage, sessionStorage: storage,
    CustomEvent: class { constructor(public type: string, public options?: unknown) {} },
    window: { localStorage: storage, setTimeout, clearTimeout, dispatchEvent: () => true },
    __v3ConfigFixture: { db, adapter, ranges: () => { ranges++; } } });
  for (const [key, value] of Object.entries({ CLIC_ERP_BASE_URL: 'https://clic-erp.clicsuite.com',
    CLIC_POS_DEVICE_ID: 'device', clic_tenant_id: 'tenant', clic_erp_sync_tenant_id: 'tenant',
    clic_erp_sync_terminal_id: terminalId, clic_erp_sync_local_terminal_id: localTerminalId, active_terminal_id: localTerminalId,
    clic_pos_config_push_v2_state: JSON.stringify({ versionHash: null, domainVersions: {}, inFlight: null }) })) storage.setItem(key, value);
  const mocks: Record<string, string> = {
    './db': 'export const db=globalThis.__v3ConfigFixture.db;',
    '../services/db': 'export const dbAdapter=globalThis.__v3ConfigFixture.adapter;',
    '../db': 'export const dbAdapter=globalThis.__v3ConfigFixture.adapter;',
    '../services/sync/SyncManager': 'export const syncManager={refreshTerminalResolvedConfig:async()=>{throw Error("Unexpected catalog fallback")}};',
    '../services/sync/ProductImageCacheService': 'export const productImageCacheService={normalizeIncomingProducts:async x=>x};',
    '../services/sync/MasterNumberRangeService': 'export const persistMasterNumberRangesFromSnapshot=async()=>globalThis.__v3ConfigFixture.ranges();',
    '../services/sync/SyncMetrics': 'export const syncMetrics=new Proxy({}, {get:()=>()=>{}});',
    '../services/sync/AuthenticatedActivityTracker': 'export const authenticatedActivityTracker={record:()=>{}};',
    '../services/sync/SyncErrorDiagnostic': 'export const setCatalogDiagnosticStatus=()=>{}; export const setSalesPushDiagnosticStatus=()=>{}; export const setSyncAuthDiagnosticStatus=()=>{}; export const setTerminalBindingDiagnosticStatus=()=>{};',
    '../services/sync/deviceToken': 'export const getSyncDeviceToken=()=>"device-token"; export const persistSyncDeviceToken=()=>{throw Error("Unexpected credential mutation")};',
    '../services/sync/TerminalCredentialStore': 'export const buildTerminalSyncAuthHeaders=()=>({"X-Sync-Token":"bound-token"}); export const readTerminalCredentialsSync=()=>({erpTerminalId:"'+terminalId+'"}); export const clearStoredSyncToken=()=>{}; export const awaitTerminalCredentialWrites=async()=>{}; export const saveTerminalCredentialsSync=()=>{throw Error("Unexpected credential mutation")};',
    '../services/sync/SyncProfile': 'export const syncPolicy={resolve:()=>({kind:'+JSON.stringify(channel)+'})}; export const loadSyncProfile=()=>null; export const restoreClientMasterUrl=()=>null; export const updateClientMasterUrl=()=>{};',
  };
  const built = await build({ entryPoints: [new URL('../utils/erpSyncLifecycle.ts', import.meta.url).pathname],
    bundle: true, write: false, format: 'esm', platform: 'node', define: { 'import.meta.env': JSON.stringify({
      VITE_LARGE_MASTER_SYNC_V3_CANDIDATE: String(candidate), VITE_LARGE_MASTER_SYNC_V3_BASE_URL: origin }) },
    plugins: [{ name: 'v3-config-boundaries', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js' }));
    } }] });
  const lifecycle = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text + `\n//${crypto.randomUUID()}`).toString('base64')}`);
  async function run(scopes: string[], domains: Record<string, unknown>, overrides: Record<string, unknown> = {},
    snapshotResponse?: () => Response) {
    const versions = Object.fromEntries(scopes.map(scope => [scope, 1]));
    const event = { id: 'event', event_type: 'CONFIG_PUSH_V2', status: 'PROCESSING', payload: {
      contract_version: 2, snapshot_id: 'snapshot', version_hash: 'hash', versions, scopes, terminal_id: terminalId } };
    const calls: any[] = [];
    const acks: any[] = [];
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/outbox/pull')) return Response.json({ status: 'success', events: [event], count: 1 });
      if (String(url).includes('/config-snapshots/')) return snapshotResponse?.() ?? Response.json({ status: 'success', snapshot_id: 'snapshot',
        version_hash: 'hash', tenant_id: 'tenant', terminal_id: terminalId, versions, scopes, domains, ...overrides });
      if (String(url).includes('/outbox/ack')) { acks.push(JSON.parse(String(init?.body))); return Response.json({ status: 'success' }); }
      throw Error('Unexpected route');
    }) as typeof fetch;
    const result = await lifecycle.triggerErpSyncOutbox('manual_sync');
    return { result, acks, calls, state: lifecycle.getConfigPushV2Diagnostics() };
  }
  return { run, config, collections, saves, atomic: () => atomic, ranges: () => ranges, storage, values };
}

test('real candidate lifecycle fails before ALL sequential/atomic writes, ranges and version activation', async () => {
  for (const input of [
    { scopes: ['inventory', 'prices'], domains: { inventory: { warehouses: [{ id: 'W' }] }, prices: { prices: [] } } },
    { scopes: ['fiscal', 'catalog'], domains: { fiscal: { document_series: [{ id: 'D' }] }, catalog: { items: [] } } },
    { scopes: ['inventory'], domains: { inventory: { warehouses: [{ id: 'W' }] }, extra: { terminal: { config: { taxes: [] } } } } },
  ]) {
    const f = await fixture();
    const before = clone([...f.collections]);
    const { result, acks, state, calls } = await f.run(input.scopes, input.domains);
    assert.equal(result.applied, 0);
    assert.equal(result.failed, 1);
    assert.deepEqual(f.saves, []);
    assert.equal(f.atomic(), 0);
    assert.equal(f.ranges(), 0);
    assert.deepEqual([...f.collections], before);
    assert.equal(state.versionHash, null);
    assert.deepEqual(state.domainVersions, {});
    assert.equal(acks.length, 1);
    assert.equal(acks[0].status, 'FAILED');
    const downloads = calls.filter(call => call.url.includes('/config-snapshots/'));
    assert.equal(downloads.length, 1);
    assert.equal(new URL(downloads[0].url).origin, origin);
    assert.equal(downloads[0].init.redirect, 'error');
    assert.equal(downloads[0].init.headers['X-Sync-Token'], 'bound-token');
    assert.equal(downloads[0].init.headers['X-POS-Capabilities'], 'largeMasterSyncV3');
    assert(calls.filter(call => call.url.includes('/outbox/')).every(call => new URL(call.url).origin === 'https://clic-erp.clicsuite.com'));
  }
});

test('real candidate lifecycle permits light users/documents/warehouse/settings and retains baseline taxes', async () => {
  const f = await fixture();
  const taxesBefore = clone(f.config.taxes);
  const { result, acks, state } = await f.run(['fiscal', 'catalog', 'inventory', 'terminal_config'], {
    fiscal: { document_series: [{ id: 'D', name: 'Document', documentType: 'TICKET' }] },
    catalog: { users: [{ id: 'U' }], roles: [] }, inventory: { warehouses: [{ id: 'W' }] },
    terminal_config: { terminal: { terminal_id: terminalId, config: { session: { autoLockMinutes: 7 } } }, resolved: {} },
  });
  assert.equal(result.applied, 1);
  assert.equal(acks[0].status, 'APPLIED');
  assert.equal(state.versionHash, 'hash');
  assert.equal(f.atomic(), 1);
  assert.deepEqual(f.collections.get('users'), [{ id: 'U' }]);
  assert.deepEqual(f.collections.get('warehouses'), [{ id: 'W' }]);
  assert.equal((f.collections.get('config') as any).terminals[0].config.security.autoLogoutMinutes, 7);
  // The real pure builder reads retained baseline taxes, but those are not incoming legacy replacements.
  assert.deepEqual((f.collections.get('config') as any).taxes, taxesBefore);
});

test('real lifecycle V2 still applies empty prices as an authoritative clear on auth origin', async () => {
  for (const [candidate, channel] of [[false, 'ERP_ACTIVE'], [true, 'POS_MASTER']] as const) {
  const f = await fixture(candidate, channel);
  const { result, acks, calls } = await f.run(['prices'], { prices: { prices: [] } });
  assert.equal(result.applied, 1);
  assert.equal(acks[0].status, 'APPLIED');
  assert.deepEqual(f.saves, ['productPrices']);
  const call = calls.find(call => call.url.includes('/config-snapshots/'));
  assert.equal(new URL(call.url).origin, 'https://clic-erp.clicsuite.com');
  assert.equal(call.init.redirect, undefined);
  assert.equal(call.init.headers['X-POS-Capabilities'], undefined);
  }
});

test('real lifecycle all replaced aliases, empty and populated embedded replacements leave every write boundary untouched', async () => {
  for (const key of ['items', 'products', 'taxes', 'priceLists', 'price_lists', 'productPrices',
    'product_prices', 'prices', 'productStocks', 'product_stocks']) {
    for (const rows of [[], [{ id: 'legacy' }]]) {
      const f = await fixture();
      const before = [...f.values].filter(([key]) => key !== 'clic_pos_config_push_v2_state');
      const { result, acks, state } = await f.run(['inventory'], { inventory: { warehouses: [{ id: 'W' }] },
        extra: { resolved: { masters: { [key]: rows } } } });
      assert.equal(result.applied, 0, key);
      assert.equal(result.failed, 1, key);
      assert.deepEqual(f.saves, [], key);
      assert.equal(f.atomic(), 0, key);
      assert.equal(f.ranges(), 0, key);
      assert.equal(state.versionHash, null, key);
      assert.deepEqual(state.domainVersions, {}, key);
      assert.equal(acks[0].status, 'FAILED', key);
      assert.deepEqual([...f.values].filter(([key]) => key !== 'clic_pos_config_push_v2_state'), before, key);
    }
  }
});

test('real lifecycle retains identity/version/scopes rejection before any candidate writes', async () => {
  for (const overrides of [{ tenant_id: 'foreign' }, { terminal_id: 'foreign' },
    { version_hash: 'foreign' }, { scopes: ['prices'] }]) {
    const f = await fixture();
    const { result, acks, state } = await f.run(['inventory'], { inventory: { warehouses: [{ id: 'W' }] } }, overrides);
    assert.equal(result.applied, 0);
    assert.deepEqual(f.saves, []);
    assert.equal(f.atomic(), 0);
    assert.equal(f.ranges(), 0);
    assert.equal(state.versionHash, null);
    assert.deepEqual(state.domainVersions, {});
    assert.equal(acks[0].status, 'FAILED');
  }
});

test('real candidate sequential light config preserves retained tax authority and applies settings', async () => {
  const f = await fixture();
  const taxes = clone(f.config.taxes);
  const { result, acks } = await f.run(['inventory', 'terminal_config'], {
    inventory: { warehouses: [{ id: 'W' }] }, terminal_config: {
      terminal: { terminal_id: terminalId, config: { session: { autoLockMinutes: 9 } } }, resolved: {} },
  });
  assert.equal(result.applied, 1);
  assert.equal(acks[0].status, 'APPLIED');
  assert.deepEqual(f.saves, ['warehouses', 'config']);
  assert.equal(f.atomic(), 0);
  assert.deepEqual((f.collections.get('config') as any).taxes, taxes);
  assert.equal((f.collections.get('config') as any).terminals[0].config.security.autoLogoutMinutes, 9);
});

test('candidate 304 and already-applied events retain original no-payload protocol semantics', async () => {
  for (const cached of [false, true]) {
    const f = await fixture();
    if (cached) f.storage.setItem('clic_pos_config_push_v2_state', JSON.stringify({
      versionHash: 'hash', domainVersions: { inventory: 1 }, inFlight: null }));
    const { result, calls, acks } = await f.run(['inventory'], {}, {}, () => new Response(null, { status: 304 }));
    assert.equal(result.applied, 1);
    assert.equal(acks[0].status, 'APPLIED');
    assert.deepEqual(f.saves, []);
    assert.equal(f.atomic(), 0);
    assert.equal(f.ranges(), 0);
    assert.equal(calls.filter(call => call.url.includes('/config-snapshots/')).length, cached ? 0 : 1);
  }
});
