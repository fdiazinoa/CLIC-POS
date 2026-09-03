import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchAndReadWithTimeout } from '../services/network/fetchAndReadWithTimeout';

test('startup recovers when the network never returns headers', async () => {
  let signal: AbortSignal | undefined;
  const fetcher = ((_url, init) => {
    signal = init?.signal as AbortSignal;
    return new Promise<Response>(() => {});
  }) as typeof fetch;
  await assert.rejects(fetchAndReadWithTimeout('/config', {}, r => r.json(), 20, fetcher),
    /TERMINAL_CONFIG_REQUEST_TIMEOUT/);
  assert.equal(signal?.aborted, true);
});

test('startup deadline includes a stalled JSON body, not only headers', async () => {
  let signal: AbortSignal | undefined;
  const fetcher = (async (_url, init) => {
    signal = init?.signal as AbortSignal;
    return { ok: true, json: () => new Promise(() => {}) } as Response;
  }) as typeof fetch;
  await assert.rejects(fetchAndReadWithTimeout('/config', {}, r => r.json(), 20, fetcher),
    /TERMINAL_CONFIG_REQUEST_TIMEOUT/);
  assert.equal(signal?.aborted, true);
});

test('successful configuration keeps payload and authorization headers intact', async () => {
  let signal: AbortSignal | undefined;
  const fetcher = (async (_url, init) => {
    signal = init?.signal as AbortSignal;
    assert.equal(new Headers(init?.headers).get('X-Device-Id'), 'test-device');
    return Response.json({ terminal_config: { id: 'terminal-a' } });
  }) as typeof fetch;
  const result = await fetchAndReadWithTimeout('/config', { headers: { 'X-Device-Id': 'test-device' } },
    r => r.json(), 20, fetcher);
  assert.deepEqual(result, { terminal_config: { id: 'terminal-a' } });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(signal?.aborted, false, 'successful requests must clear the timer');
});

test('authorization rejection is preserved for the existing error handler', async () => {
  const error = new Error('TERMINAL_AUTHORIZATION_REVOKED');
  await assert.rejects(fetchAndReadWithTimeout('/config', {}, async response => {
    assert.equal(response.status, 403);
    throw error;
  }, 100, (async () => new Response('', { status: 403 })) as typeof fetch), e => e === error);
});
