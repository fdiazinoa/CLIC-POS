import assert from 'node:assert/strict';
import test from 'node:test';
import { Capacitor } from '@capacitor/core';
import { setNativeRequestTransportForTests } from '../services/network/httpClient';
import { assertLargeMasterSyncV3ConfigPayload, largeMasterSyncV3DownloadOrigin } from '../services/sync/LargeMasterSyncV3DownloadOrigin';
const storage = new Map<string, string>([['existing-sync-token', 'preserved']]);
let storageWrites = 0;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storageWrites++; storage.set(key, String(value)); },
  removeItem: (key: string) => { storageWrites++; storage.delete(key); },
} });
const { fetchInitialConfigFromErp } = await import('../services/setup/erpTerminalSetup');
const { extractErpRegisterAuth } = await import('../services/sync/erpRegisterResponse');

const origin = 'https://clic-erp-production.up.railway.app';
const input = { erpBaseUrl: 'https://clic-erp.clicsuite.com', tenantId: 'tenant-a',
  erpTerminalId: 'terminal-a', posDeviceId: 'device-a', candidateV3: true, downloadOrigin: origin };
const bootstrap = () => ({ success: true, bootstrapProtocol: 'v3',
  masterSync: { protocol: 'v3', required: true, schemaVersion: 3, contractVersion: 2,
    createUrl: '/api/sync/v3/master-syncs' },
  terminal_config: { tenant_id: input.tenantId, terminal_id: input.erpTerminalId,
    config: {}, masters: { pos_users: [{ id: 'user-1' }], pos_roles: [] },
    resolved: { inventory: { warehouses: [] }, documents: { document_series: [], fiscal_ranges: [] } },
    operational: { users: [{ id: 'user-1' }], fiscalRanges: [{ id: 'range-1' }] } } });
const rejectedCandidateCode = (error: any): boolean => [
  'SYNC_V3_SETUP_CONTRACT_REQUIRED', 'SYNC_V3_SETUP_SNAPSHOT_REQUIRED',
  'SYNC_V3_SETUP_IDENTITY_MISMATCH', 'SYNC_V3_LEGACY_MASTER_FORBIDDEN',
].includes(error.code);

const savedFetch = globalThis.fetch;
const savedNative = Capacitor.isNativePlatform;
const savedPlatform = Capacitor.getPlatform;
test.afterEach(() => {
  globalThis.fetch = savedFetch;
  Capacitor.isNativePlatform = savedNative;
  Capacitor.getPlatform = savedPlatform;
  setNativeRequestTransportForTests(null);
});

test('native candidate uses one explicit Railway GET, capability, unchanged device and 12s limits', async () => {
  Capacitor.isNativePlatform = () => true;
  Capacitor.getPlatform = () => 'android';
  const calls: any[] = [];
  setNativeRequestTransportForTests(async options => {
    calls.push(options);
    return { status: 200, data: bootstrap(), headers: {}, url: options.url };
  });
  const result = await fetchInitialConfigFromErp(input);
  assert.equal(calls.length, 1);
  const call = calls[0];
  const url = new URL(call.url);
  assert.equal(url.origin, origin);
  assert.equal(url.pathname, '/api/setup/initial-config/terminal-a');
  assert.equal(url.searchParams.get('tenant_id'), 'tenant-a');
  assert.equal(url.searchParams.get('device_id'), 'device-a');
  assert.equal(call.headers['X-POS-Capabilities'], 'largeMasterSyncV3');
  assert.equal(call.headers['X-Device-Id'], 'device-a');
  assert.equal(call.connectTimeout, 12000);
  assert.equal(call.readTimeout, 12000);
  assert.equal(call.disableRedirects, true);
  assert.equal(result.bootstrapProtocol, 'v3');
  assert.equal(result.downloadOrigin, origin);
  assert.equal(input.erpBaseUrl, 'https://clic-erp.clicsuite.com');
  assert.deepEqual(result.terminal_config?.operational, bootstrap().terminal_config.operational);
});

test('web candidate uses one bounded direct request without coordinator retries or token writes', async () => {
  const before = [...storage];
  const writesBefore = storageWrites;
  Capacitor.isNativePlatform = () => false;
  Capacitor.getPlatform = () => 'web';
  let calls = 0;
  globalThis.fetch = (async (url, init) => {
    calls++;
    assert.equal(new URL(String(url)).origin, origin);
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.signal?.aborted, false);
    return Response.json(bootstrap());
  }) as typeof fetch;
  await fetchInitialConfigFromErp(input);
  assert.equal(calls, 1);
  assert.deepEqual([...storage], before);
  assert.equal(storageWrites, writesBefore);
});

test('invalid explicit origin fails before issuing any request', async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('unexpected'); }) as typeof fetch;
  for (const value of ['', 'http://remote.example', 'https://user:pass@host.example',
    `${origin}/api`, `${origin}?x=1`, `${origin}#x`]) {
    assert.throws(() => largeMasterSyncV3DownloadOrigin(value));
    await assert.rejects(fetchInitialConfigFromErp({ ...input, downloadOrigin: value }));
  }
  assert.equal(calls, 0);
});

test('raw candidate contract and identity reject legacy/missing/foreign replies before normalization', async () => {
  const valid = bootstrap();
  const invalid = [
    { terminal_config: valid.terminal_config, items: [] },
    { ...valid, masterSync: undefined },
    { ...valid, masterSync: { ...valid.masterSync, required: false } },
    { ...valid, masterSync: { ...valid.masterSync, contractVersion: 1 } },
    { ...valid, masterSync: { ...valid.masterSync, schemaVersion: 2 } },
    { ...valid, masterSync: { ...valid.masterSync, createUrl: 'https://evil.example/collect' } },
    { ...valid, terminal_config: {} },
    { ...valid, terminal_config: { tenant_id: 'foreign', terminal_id: 'terminal-a' } },
    { ...valid, terminal_id: 'foreign' },
    { ...valid, terminal_config: { ...valid.terminal_config,
      resolved: { ...valid.terminal_config.resolved, identity: { terminal_id: 'foreign' } } } },
    { ...valid, terminal_config: { name: 'identity missing' } },
    { ...valid, tenant_id: input.tenantId, terminal_id: input.erpTerminalId,
      terminal_config: { name: 'incomplete' } },
    { ...valid, items: [{ id: 'legacy' }] },
    { ...valid, items: [] },
    { ...valid, terminal_config: { ...valid.terminal_config, masters: {} } },
  ];
  for (const payload of invalid) {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return Response.json(payload); }) as typeof fetch;
    await assert.rejects(fetchInitialConfigFromErp(input), rejectedCandidateCode);
    assert.equal(calls, 1);
  }
});

test('config lifecycle rejects raw scope mismatch and replaced collections before any application', () => {
  const good = bootstrap().terminal_config;
  assert.doesNotThrow(() => assertLargeMasterSyncV3ConfigPayload({ terminal_config: good }, input));
  let applies = 0;
  const bad = [{ ...good, tenant_id: 'foreign' }, { ...good, terminal_id: 'foreign' },
    { ...good, masters: [], resolved: {} },
    { ...good, masters: { ...good.masters, items: [{ id: 'legacy' }] } },
    { ...good, masters: { ...good.masters, taxes: [{ id: 'tax' }] } },
    { ...good, resolved: { ...good.resolved, product_prices: [{ id: 'price' }] } },
    { ...good, config: { productStocks: [{ id: 'stock' }] } }];
  for (const terminal_config of bad) {
    assert.throws(() => {
      assertLargeMasterSyncV3ConfigPayload({ terminal_config }, input);
      applies++;
    }, rejectedCandidateCode);
  }
  assert.equal(applies, 0);
});

test('scoped security refresh accepts a pruned snapshot and requires only its requested arrays', () => {
  const security = { ...bootstrap().terminal_config,
    masters: { pos_users: [], pos_roles: [] }, resolved: { identity: { terminal_id: input.erpTerminalId } } };
  const scopes = { masterScopes: ['pos_users', 'pos_roles'], resolvedScopes: ['identity', 'role'] };
  assert.doesNotThrow(() => assertLargeMasterSyncV3ConfigPayload({ terminal_config: security }, input, scopes));
  assert.throws(() => assertLargeMasterSyncV3ConfigPayload({ terminal_config: { ...security, masters: {} } },
    input, scopes), /SNAPSHOT_REQUIRED/);
  assert.throws(() => assertLargeMasterSyncV3ConfigPayload({ terminal_config: security }, input,
    { resolvedScopes: ['inventory'] }), /SNAPSHOT_REQUIRED/);
  assert.doesNotThrow(() => assertLargeMasterSyncV3ConfigPayload({ terminal_config: {
    tenant_id: input.tenantId, terminal_id: input.erpTerminalId,
    resolved: { documents: { document_series: [], fiscal_ranges: [] } },
  } }, input, { resolvedScopes: ['documents'] }));
});

test('candidate 304/HTML/503/timeout/redirect stay failures with zero fallback or extra auth requests', async () => {
  const failures = [() => new Response(null, { status: 304 }),
    () => new Response('<html>Error</html>', { status: 200 }),
    () => new Response('Unavailable', { status: 503 }),
    () => { throw new DOMException('Timed out', 'AbortError'); },
    () => { throw new TypeError('redirect rejected'); }];
  for (const response of failures) {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return response(); }) as typeof fetch;
    await assert.rejects(fetchInitialConfigFromErp(input));
    assert.equal(calls, 1);
  }
});

test('native flag OFF keeps the auth-domain legacy GET and existing header contract', async () => {
  Capacitor.isNativePlatform = () => true;
  Capacitor.getPlatform = () => 'android';
  const calls: any[] = [];
  setNativeRequestTransportForTests(async options => {
    calls.push(options);
    return { status: 200, data: { terminal_config: { name: 'legacy' }, items: [{ id: 'legacy' }] },
      headers: {}, url: options.url };
  });
  const result = await fetchInitialConfigFromErp({ ...input, candidateV3: false });
  assert.equal(new URL(calls[0].url).origin, input.erpBaseUrl);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers['X-POS-Capabilities'], undefined);
  assert.equal(calls[0].disableRedirects, undefined);
  assert.equal(result.items?.[0].id, 'legacy');
});

test('native and web candidate download strip nested POS credentials before handoff without credential writes', async () => {
  for (const native of [false, true]) {
    Capacitor.isNativePlatform = () => native;
    Capacitor.getPlatform = () => native ? 'android' : 'web';
    const payload = bootstrap();
    Object.assign(payload.terminal_config.config, { deviceToken: 'malicious-download',
      auth: { activationToken: 'malicious-auth' },
      fiscal: { provider: { apiKey: 'legitimate-provider-key' } } });
    Object.assign(payload.terminal_config, { metadata: { auth: { deviceToken: 'malicious-metadata' },
      syncAuth: { syncToken: 'malicious-sync' } } });
    const before = [...storage];
    const writesBefore = storageWrites;
    globalThis.fetch = (async () => Response.json(payload)) as typeof fetch;
    setNativeRequestTransportForTests(async options => ({ status: 200, data: payload, headers: {}, url: options.url }));
    const result = await fetchInitialConfigFromErp(input);
    const auth = extractErpRegisterAuth(result, result.terminal_config);
    assert.equal(auth.deviceToken, undefined);
    assert.equal(auth.syncToken, undefined);
    assert.equal(auth.activationToken, undefined);
    assert.equal(result.terminal_config?.config.fiscal.provider.apiKey, 'legitimate-provider-key');
    assert.deepEqual([...storage], before);
    assert.equal(storageWrites, writesBefore);
    assert.equal((payload.terminal_config.config as any).deviceToken, 'malicious-download');
  }
});
