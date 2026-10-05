import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLargeMasterSyncV3BoundClient,
  createLargeMasterSyncV3BoundTransport,
  type LargeMasterSyncV3BoundIdentity,
} from '../services/sync/LargeMasterSyncV3BoundTransport';

const syncId = '00000000-0000-4000-8000-000000000001';
const binding: LargeMasterSyncV3BoundIdentity = {
  erpSyncBaseUrl: 'https://erp.example.test/api/sync',
  tenantId: 'tenant-1', terminalId: 'terminal-1', deviceId: 'device-1', syncToken: 'secret-token',
};

test('bound V3 transport requests Railway directly with exact raw text and existing identity', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const raw = '{"schemaVersion":3, "records":[{"price":1.00}]}';
  const fetcher = (async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    return new Response(raw, { status: 200, headers: { 'X-Sync-V3-Checksum': 'checksum' } });
  }) as typeof fetch;
  const transport = createLargeMasterSyncV3BoundTransport('https://railway.example.test/', () => binding, fetcher);
  const result = await transport.request(`/api/sync/v3/master-syncs/${syncId}/datasets/articles/chunks/0`, { method: 'GET' });
  assert.equal(result.text, raw);
  assert.equal(requests[0].url,
    `https://railway.example.test/api/sync/v3/master-syncs/${syncId}/datasets/articles/chunks/0`);
  assert.equal(requests[0].init?.credentials, 'omit');
  assert.equal(requests[0].init?.redirect, 'error');
  assert.equal((requests[0].init?.headers as Record<string, string>)['X-Sync-Token'], 'secret-token');
  assert.equal((requests[0].init?.headers as Record<string, string>)['X-POS-Capabilities'], 'largeMasterSyncV3');
  assert.equal((requests[0].init?.headers as Record<string, string>)['X-Device-Id'], 'device-1');
  assert.equal(requests.length, 1);
});

test('bound transport refuses changed pairing or token without registration or HTTP', async () => {
  let current = binding;
  let requests = 0;
  const transport = createLargeMasterSyncV3BoundTransport('https://railway.example.test/', () => current,
    (async () => { requests += 1; throw new Error('must not fetch'); }) as typeof fetch);
  current = { ...binding, deviceId: 'other-device' };
  await assert.rejects(transport.request('/api/sync/v3/master-syncs', { method: 'POST' }), /SYNC_V3_BINDING_CHANGED/);
  current = { ...binding, syncToken: 'rotated-token' };
  await assert.rejects(transport.request('/api/sync/v3/master-syncs', { method: 'POST' }), /SYNC_V3_BINDING_CHANGED/);
  assert.equal(requests, 0);
});

test('bound transport discards bytes if identity changes during the HTTP response', async () => {
  let current = binding;
  const transport = createLargeMasterSyncV3BoundTransport('https://railway.example.test/', () => current,
    (async () => {
      current = { ...binding, deviceId: 'other-device' };
      return new Response('{"status":"READY"}', { status: 200 });
    }) as typeof fetch);
  await assert.rejects(transport.request('/api/sync/v3/master-syncs', { method: 'POST' }),
    /SYNC_V3_BINDING_CHANGED/);
});

test('bound transport rejects external paths, legacy endpoints and insecure origins', async () => {
  let requests = 0;
  const fetcher = (async () => { requests += 1; throw new Error('must not fetch'); }) as typeof fetch;
  assert.throws(() => createLargeMasterSyncV3BoundTransport('http://railway.example.test/', () => binding, fetcher),
    /SYNC_V3_ORIGIN_INVALID/);
  const transport = createLargeMasterSyncV3BoundTransport('https://railway.example.test/', () => binding, fetcher);
  for (const path of ['https://evil.example.test/steal', '/api/sync/collections/products/full',
    `/api/sync/v3/master-syncs/${syncId}/datasets/articles/chunks/0?x=1`]) {
    await assert.rejects(transport.request(path, { method: 'GET' }), /SYNC_V3_PATH_INVALID/);
  }
  await assert.rejects(transport.request('/api/sync/v3/master-syncs', { method: 'GET' }), /SYNC_V3_PATH_INVALID/);
  assert.equal(requests, 0);
});

test('bound client requires the operational contract before touching SQLite', async () => {
  let storeCalls = 0;
  const store = { readProgress: async () => { storeCalls += 1; return null; } } as never;
  const fetcher = (async () => new Response(JSON.stringify({
    syncId, syncVersion: 2, schemaVersion: 3, type: 'FULL', status: 'READY',
    datasets: { articles: { count: 0, chunks: 0, bytes: 0, gzipBytes: 0,
      checksum: 'a'.repeat(64) } },
  }), { status: 200 })) as typeof fetch;
  const client = createLargeMasterSyncV3BoundClient(store, 'https://railway.example.test/',
    {}, () => binding, fetcher);
  await assert.rejects(() => client.resumeSync(syncId), /SYNC_V3_OPERATIONAL_CONTRACT_REQUIRED/);
  assert.equal(storeCalls, 0);
});
