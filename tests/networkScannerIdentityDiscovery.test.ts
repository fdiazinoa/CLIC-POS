import assert from 'node:assert/strict';
import test from 'node:test';
import { NetworkScanner } from '../services/sync/NetworkScanner';

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
