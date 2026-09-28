import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { NetworkScanner } from '../services/sync/NetworkScanner';

const verifyIdentity = (baseUrl: string) => (NetworkScanner as unknown as {
  verifyIdentity: (url: string, tenant?: string) => Promise<boolean>;
}).verifyIdentity(baseUrl, 'tenant-a');

const mockResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
}) as Response;

test('identity-only discovery stays untrusted while legacy findMaster still validates config', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url === 'http://10.0.0.1:3001/api/sync/identify') {
      return mockResponse({ app: 'CLIC-POS', role: 'MASTER', tenantId: 'tenant-a' });
    }
    if (url === 'http://10.0.0.1:3001/api/config') return mockResponse({});
    return mockResponse({}, 404);
  }) as typeof fetch;

  try {
    const untrusted = await NetworkScanner.findUntrustedMasterCandidateByIdentity(
      '10.0.0.28',
      'tenant-a',
      ['10.0.0.28'],
    );
    assert.equal(untrusted, 'http://10.0.0.1:3001');
    assert.equal(requests.some(url => url.endsWith('/api/config')), false);

    requests.length = 0;
    const validated = await NetworkScanner.findMaster('10.0.0.28', 'tenant-a');
    assert.equal(validated, 'http://10.0.0.1:3001');
    assert.equal(requests.includes('http://10.0.0.1:3001/api/config'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('identity-only discovery excludes every hydrated local address before probing', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    return mockResponse({}, 404);
  }) as typeof fetch;

  try {
    const result = await NetworkScanner.findUntrustedMasterCandidateByIdentity(
      '10.0.0.28',
      undefined,
      ['10.0.0.28', '10.0.0.29'],
    );
    assert.equal(result, null);
    assert.equal(requests.some(url => url.includes('10.0.0.28:')), false);
    assert.equal(requests.some(url => url.includes('10.0.0.29:')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('identity probe accepts a valid response after 400ms and before 1000ms', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const originalFetch = globalThis.fetch;
  let aborts = 0;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { aborts += 1; reject(new Error('ABORTED')); }, { once: true });
    setTimeout(() => resolve(mockResponse({ app: 'CLIC-POS', role: 'MASTER', tenantId: 'tenant-a' })), 650);
  })) as typeof fetch;
  try {
    const pending = verifyIdentity('http://10.0.0.101:3001');
    context.mock.timers.tick(649);
    context.mock.timers.tick(1);
    assert.equal(await pending, true);
    context.mock.timers.runAll();
    assert.equal(aborts, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('identity probe aborts once at 1000ms and leaves no residual timer', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const originalFetch = globalThis.fetch;
  let aborts = 0;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { aborts += 1; reject(new Error('ABORTED')); }, { once: true });
  })) as typeof fetch;
  try {
    const pending = verifyIdentity('http://10.0.0.101:3001');
    context.mock.timers.tick(999);
    assert.equal(aborts, 0);
    context.mock.timers.tick(1);
    assert.equal(await pending, false);
    assert.equal(aborts, 1);
    context.mock.timers.runAll();
    assert.equal(aborts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('overlapping identity probes clean their own timers without cross-abort', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const originalFetch = globalThis.fetch;
  const aborts: string[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const url = String(input);
    init?.signal?.addEventListener('abort', () => { aborts.push(url); reject(new Error('ABORTED')); }, { once: true });
    if (url.includes('10.0.0.101')) {
      setTimeout(() => resolve(mockResponse({ app: 'CLIC-POS', role: 'MASTER', tenantId: 'tenant-a' })), 700);
    }
  })) as typeof fetch;
  try {
    const first = verifyIdentity('http://10.0.0.101:3001');
    const second = verifyIdentity('http://10.0.0.102:3001');
    context.mock.timers.tick(700);
    assert.equal(await first, true);
    assert.deepEqual(aborts, []);
    context.mock.timers.tick(300);
    assert.equal(await second, false);
    assert.deepEqual(aborts, ['http://10.0.0.102:3001/api/sync/identify']);
    context.mock.timers.runAll();
    assert.equal(aborts.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('full config resolver retains its independent 8s validation budget', () => {
  const source = readFileSync(new URL('../utils/operationalMasterConfig.ts', import.meta.url), 'utf8');
  assert.match(source, /const timeoutMs = options\.timeoutMs \?\? 8_000/);
});
