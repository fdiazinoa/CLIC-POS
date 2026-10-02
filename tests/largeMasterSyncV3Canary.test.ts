import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TerminalConfigRequestCoordinator } from '../services/sync/TerminalConfigRequestCoordinator';
import { LargeMasterSyncV3Client } from '../services/sync/LargeMasterSyncV3Client';
import {
  assertLargeMasterSyncV3CanaryEmulator,
  buildLargeMasterSyncV3CanaryHeaders,
  createLargeMasterSyncV3CanaryTransport,
  runLargeMasterSyncV3Canary,
  validateLargeMasterSyncV3CanaryUrl,
  type LargeMasterSyncV3CanaryInput,
} from '../services/sync/LargeMasterSyncV3Canary';

const identity: LargeMasterSyncV3CanaryInput = {
  erpBaseUrl: 'https://erp.example.test',
  tenantId: 'tenant-id',
  erpTerminalId: 'terminal-id',
  posDeviceId: 'device-id',
  syncToken: 'secret-token',
};

const canaryScreenSource = readFileSync(
  new URL('../components/LargeMasterSyncV3CanaryScreen.tsx', import.meta.url),
  'utf8',
);

test('legacy initial-config keeps its request headers and payload unchanged; capability is opt-in', async () => {
  const requests: Array<{ url: string; headers: HeadersInit | undefined }> = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    requests.push({ url, headers: init?.headers });
    return new Response(JSON.stringify({ status: 'success', terminal_config: { id: 'one' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  const storage = new Map<string, string>();
  const coordinator = new TerminalConfigRequestCoordinator({
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); },
    removeItem: key => { storage.delete(key); },
  } as Storage, fetcher);
  const common = {
    baseUrl: identity.erpBaseUrl,
    terminalId: identity.erpTerminalId,
    tenantId: identity.tenantId,
    deviceId: identity.posDeviceId,
    reason: 'pairing' as const,
    deferPersistence: true,
  };
  const legacy = await coordinator.request(common);
  const v3 = await coordinator.request({ ...common, capabilityHeader: 'largeMasterSyncV3' });
  assert.deepEqual(v3.payload, legacy.payload);
  assert.equal(requests[0].url, requests[1].url);
  assert.deepEqual(requests[0].headers, {
    Accept: 'application/json', 'X-Device-Id': 'device-id', 'X-POS-Device-Id': 'device-id',
  });
  assert.deepEqual(requests[1].headers, {
    Accept: 'application/json', 'X-Device-Id': 'device-id', 'X-POS-Device-Id': 'device-id',
    'X-POS-Capabilities': 'largeMasterSyncV3',
  });
});

test('canary request authenticates with register token without exposing it in initial-config', () => {
  assert.deepEqual(buildLargeMasterSyncV3CanaryHeaders(identity), {
    Accept: 'application/json',
    'X-Sync-Token': 'secret-token',
    'X-POS-Capabilities': 'largeMasterSyncV3',
    'X-Device-Id': 'device-id',
    'X-POS-Device-Id': 'device-id',
    'X-Terminal-Id': 'terminal-id',
  });
});

test('canary registration keeps operational credentials isolated', () => {
  assert.match(canaryScreenSource, /bindTerminalFromErp\(\{[\s\S]*persistCredentials:\s*false/);
});

test('raw V3 transport preserves checksum-sensitive JSON text instead of native reserialization', async () => {
  const raw = '{"schemaVersion":3, "records":[{"id":"a","price":1.00}]}';
  const reserialized = JSON.stringify(JSON.parse(raw));
  assert.notEqual(raw, reserialized);
  let headers: HeadersInit | undefined;
  let redirect: RequestRedirect | undefined;
  const fetcher = (async (_url: string, init?: RequestInit) => {
    headers = init?.headers;
    redirect = init?.redirect;
    return new Response(raw, { status: 200, headers: { 'X-Sync-V3-Checksum': 'checksum' } });
  }) as typeof fetch;
  const response = await createLargeMasterSyncV3CanaryTransport(identity, fetcher)
    .request('/api/sync/v3/master-syncs/id/datasets/articles/chunks/0', { method: 'GET' });
  assert.equal(response.text, raw);
  assert.equal((headers as Record<string, string>)['X-Sync-Token'], 'secret-token');
  assert.equal(redirect, 'error');
  await assert.rejects(createLargeMasterSyncV3CanaryTransport(identity, fetcher)
    .request('https://evil.example.test/steal', { method: 'GET' }), /PATH_INVALID/);
});

test('canary validates ERP origin and fails closed without native emulator proof', () => {
  assert.equal(validateLargeMasterSyncV3CanaryUrl('https://erp.example.test/'), 'https://erp.example.test');
  assert.throws(() => validateLargeMasterSyncV3CanaryUrl('http://erp.example.test'), /HTTPS_REQUIRED/);
  assert.throws(() => validateLargeMasterSyncV3CanaryUrl('https://erp.example.test/other'), /BASE_URL_INVALID/);
  assert.throws(() => assertLargeMasterSyncV3CanaryEmulator(), /EMULATOR_REQUIRED/);
});

test('flag OFF rejects before network or SQLite; missing token also fails closed', async () => {
  let calls = 0;
  const dependencies: Parameters<typeof runLargeMasterSyncV3Canary>[2] = {
    enabled: false,
    assertEmulator: () => undefined,
    getStore: async () => { calls += 1; return undefined; },
    createNegotiator: () => { calls += 1; throw new Error('unexpected negotiator'); },
    createClient: () => { calls += 1; throw new Error('unexpected client'); },
  };
  await assert.rejects(runLargeMasterSyncV3Canary(identity, undefined, dependencies), /SYNC_V3_CANARY_DISABLED/);
  dependencies.enabled = true;
  await assert.rejects(runLargeMasterSyncV3Canary({ ...identity, syncToken: '' }, undefined, dependencies), /syncToken/);
  assert.equal(calls, 0);
});

test('server fallback is a no-sales exit without requesting the legacy catalog', async () => {
  let requests = 0;
  const result = await runLargeMasterSyncV3Canary(identity, undefined, {
    enabled: true,
    assertEmulator: () => undefined,
    getStore: async () => { throw new Error('fallback must not open SQLite'); },
    createNegotiator: () => ({
      requestSync: async () => { requests += 1; return { fallback: 'legacy' }; },
    }),
    createClient: () => { throw new Error('fallback must not create a persistent client'); },
  });
  assert.deepEqual(result, { status: 'legacy-fallback' });
  assert.equal(requests, 1);
});

test('V3 negotiation does not require or open a persistence store', async () => {
  const client = new LargeMasterSyncV3Client({
    transport: {
      request: async () => ({
        status: 404,
        headers: { 'content-type': 'application/json' },
        text: JSON.stringify({ code: 'SYNC_V3_NOT_ENABLED', fallback: 'legacy' }),
      }),
    },
  });
  assert.deepEqual(await client.requestSync(), { fallback: 'legacy' });
  await assert.rejects(client.resumeSync('unused'), /SYNC_V3_STORE_UNAVAILABLE/);
});

test('V3 negotiation requests and resumes with token; server fallback and errors fail closed', async () => {
  let requested = 0;
  let resumed = 0;
  const base: Parameters<typeof runLargeMasterSyncV3Canary>[2] = {
    enabled: true,
    assertEmulator: () => undefined,
    getStore: async () => ({ findIncomplete: async () => null }) as never,
    createNegotiator: () => ({
      requestSync: async () => { requested += 1; return { fallback: 'legacy' }; },
    }),
    createClient: () => ({
      requestSync: async () => { throw new Error('persistent client must not negotiate'); },
      resumeSync: async () => { resumed += 1; throw new Error('unexpected resume'); },
    }),
  };
  assert.deepEqual(await runLargeMasterSyncV3Canary(identity, undefined, base), { status: 'legacy-fallback' });
  assert.equal(resumed, 0);
  base.createNegotiator = () => ({
    requestSync: async () => { requested += 1; return { syncId: 'sync-id', syncVersion: 1,
      schemaVersion: 3, status: 'READY', manifestUrl: '/manifest' }; },
  });
  base.createClient = () => ({
    requestSync: async () => { throw new Error('persistent client must not negotiate'); },
    resumeSync: async syncId => { resumed += 1; return { syncId, syncVersion: 1 }; },
  });
  assert.deepEqual(await runLargeMasterSyncV3Canary(identity, undefined, base),
    { status: 'complete', syncId: 'sync-id', syncVersion: 1 });
  assert.equal(requested, 2);
  assert.equal(resumed, 1);
  base.createNegotiator = () => ({
    requestSync: async () => { throw new Error('network failure'); },
  });
  base.createClient = () => ({
    requestSync: async () => { throw new Error('persistent client must not negotiate'); },
    resumeSync: async () => { throw new Error('unexpected resume'); },
  });
  await assert.rejects(runLargeMasterSyncV3Canary(identity, undefined, base), /network failure/);
});

test('canary resumes only the ERP-current incomplete SQLite session', async () => {
  let requests = 0;
  const result = await runLargeMasterSyncV3Canary(identity, undefined, {
    enabled: true,
    assertEmulator: () => undefined,
    getStore: async () => ({ findIncomplete: async () => ({ syncId: 'prior-sync-id', syncVersion: 7 }) }) as never,
    createNegotiator: () => ({
      requestSync: async () => { requests += 1; return { syncId: 'prior-sync-id', syncVersion: 7,
        schemaVersion: 3, status: 'READY', manifestUrl: '/manifest' }; },
    }),
    createClient: () => ({
      requestSync: async () => { throw new Error('persistent client must not negotiate'); },
      resumeSync: async syncId => ({ syncId, syncVersion: 7 }),
    }),
  });
  assert.equal(requests, 1);
  assert.deepEqual(result, { status: 'complete', syncId: 'prior-sync-id', syncVersion: 7 });
});

test('canary reports a cross-session staging conflict without activating or deleting it', async () => {
  let resumes = 0;
  await assert.rejects(runLargeMasterSyncV3Canary(identity, undefined, {
    enabled: true,
    assertEmulator: () => undefined,
    getStore: async () => ({ findIncomplete: async () => ({ syncId: 'old-id', syncVersion: 6 }) }) as never,
    createNegotiator: () => ({
      requestSync: async () => ({ syncId: 'new-id', syncVersion: 7,
        schemaVersion: 3, status: 'READY', manifestUrl: '/manifest' }),
    }),
    createClient: () => ({
      requestSync: async () => { throw new Error('persistent client must not negotiate'); },
      resumeSync: async () => { resumes += 1; throw new Error('must not resume'); },
    }),
  }), /SYNC_V3_STAGING_CONFLICT/);
  assert.equal(resumes, 0);
});
