import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchAuthoritativeTableSnapshot } from '../utils/authoritativeTableSnapshot';

test('lectura de Master caduca si no responde dentro del límite', async () => {
  const fetcher = ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  })) as typeof fetch;
  await assert.rejects(fetchAuthoritativeTableSnapshot({
    resolveUrl: async () => 'http://master/api/mesas', fetcher, timeoutMs: 10,
  }), /MASTER_TABLES_TIMEOUT/);
});

test('rebind de autoridad invalida el snapshot y su fence antes de persistir', async () => {
  let authority = 1;
  const fetcher = (async () => new Response(JSON.stringify({ parkedTickets: [], revision: 3 }), { status: 200 })) as typeof fetch;
  const snapshot = await fetchAuthoritativeTableSnapshot({
    resolveUrl: async () => 'http://master/api/mesas',
    captureAuthority: () => { const captured = authority; return () => authority === captured; },
    fetcher,
  });
  assert.equal(snapshot.revision, 3);
  authority = 2;
  assert.throws(snapshot.assertCurrentAuthority, /MASTER_CONTRACT_CHANGED/);
});

test('rebind durante GET descarta la respuesta', async () => {
  let authority = 1;
  const fetcher = (async () => {
    authority = 2;
    return new Response(JSON.stringify({ parkedTickets: [], revision: 3 }), { status: 200 });
  }) as typeof fetch;
  await assert.rejects(fetchAuthoritativeTableSnapshot({
    resolveUrl: async () => 'http://master/api/mesas',
    captureAuthority: () => { const captured = authority; return () => authority === captured; },
    fetcher,
  }), /MASTER_CONTRACT_CHANGED/);
});
