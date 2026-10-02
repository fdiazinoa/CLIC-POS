import test from 'node:test';
import assert from 'node:assert/strict';
import { TerminalConfigRequestCoordinator } from '../services/sync/TerminalConfigRequestCoordinator';
import {
  buildLargeMasterSyncV3CanaryHeaders,
  runLargeMasterSyncV3Canary,
  type LargeMasterSyncV3CanaryInput,
} from '../services/sync/LargeMasterSyncV3Canary';

const identity: LargeMasterSyncV3CanaryInput = {
  erpBaseUrl: 'https://erp.example.test',
  tenantId: 'tenant-id',
  erpTerminalId: 'terminal-id',
  posDeviceId: 'device-id',
  syncToken: 'secret-token',
};

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

test('flag OFF rejects before network or SQLite; missing token also fails closed', async () => {
  let calls = 0;
  const dependencies: Parameters<typeof runLargeMasterSyncV3Canary>[2] = {
    enabled: false,
    fetchInitialConfig: async () => { calls += 1; throw new Error('unexpected network'); },
    getStore: async () => { calls += 1; return undefined; },
    createClient: () => { calls += 1; throw new Error('unexpected client'); },
  };
  await assert.rejects(runLargeMasterSyncV3Canary(identity, undefined, dependencies), /SYNC_V3_CANARY_DISABLED/);
  dependencies.enabled = true;
  await assert.rejects(runLargeMasterSyncV3Canary({ ...identity, syncToken: '' }, undefined, dependencies), /syncToken/);
  assert.equal(calls, 0);
});

test('legacy bootstrap is a no-sales fallback without V3 or legacy catalog download', async () => {
  let receivedCanary = false;
  const result = await runLargeMasterSyncV3Canary(identity, undefined, {
    enabled: true,
    fetchInitialConfig: async input => {
      receivedCanary = input.canaryV3 === true;
      return { success: true, bootstrapProtocol: 'legacy' };
    },
    getStore: async () => { throw new Error('SQLite must not be touched'); },
    createClient: () => { throw new Error('V3 must not be touched'); },
  });
  assert.equal(receivedCanary, true);
  assert.deepEqual(result, { status: 'legacy-fallback' });
});

test('V3 bootstrap requests and resumes with token; server fallback and errors fail closed', async () => {
  let requested = 0;
  let resumed = 0;
  const base: Parameters<typeof runLargeMasterSyncV3Canary>[2] = {
    enabled: true,
    fetchInitialConfig: async () => ({ success: true, bootstrapProtocol: 'v3', masterSync: { protocol: 'v3' } }),
    getStore: async () => ({}) as never,
    createClient: () => ({
      requestSync: async () => { requested += 1; return { fallback: 'legacy' }; },
      resumeSync: async () => { resumed += 1; throw new Error('unexpected resume'); },
    }),
  };
  assert.deepEqual(await runLargeMasterSyncV3Canary(identity, undefined, base), { status: 'legacy-fallback' });
  assert.equal(resumed, 0);
  base.createClient = () => ({
    requestSync: async () => { requested += 1; return { syncId: 'sync-id', syncVersion: 1,
      schemaVersion: 3, status: 'READY', manifestUrl: '/manifest' }; },
    resumeSync: async syncId => { resumed += 1; return { syncId, syncVersion: 1 }; },
  });
  assert.deepEqual(await runLargeMasterSyncV3Canary(identity, undefined, base),
    { status: 'complete', syncId: 'sync-id', syncVersion: 1 });
  assert.equal(requested, 2);
  assert.equal(resumed, 1);
  base.createClient = () => ({
    requestSync: async () => { throw new Error('network failure'); },
    resumeSync: async () => { throw new Error('unexpected resume'); },
  });
  await assert.rejects(runLargeMasterSyncV3Canary(identity, undefined, base), /network failure/);
});
