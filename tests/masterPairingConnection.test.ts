import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchMasterPairingResources,
  MasterPairingConnectionError,
} from '../services/setup/masterPairingConnection';

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

test('la vinculación acepta una Master aunque falle temporalmente /api/users', async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/api/config')) return jsonResponse({ name: 'Caja Master', terminals: [] });
    throw new TypeError('Network request failed');
  }) as typeof fetch;

  const result = await fetchMasterPairingResources('http://10.0.0.145:3001', fetchImpl);

  assert.deepEqual(result.config.terminals, []);
  assert.equal(result.users, null);
});

test('la vinculación conserva los usuarios entregados por la Master', async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/api/config')) return jsonResponse({ name: 'Caja Master', terminals: [] });
    return jsonResponse([{ id: 'admin-1', name: 'Admin', role: 'ADMIN' }]);
  }) as typeof fetch;

  const result = await fetchMasterPairingResources('http://10.0.0.145:3001', fetchImpl);

  assert.equal(result.users?.length, 1);
  assert.equal(result.users?.[0]?.id, 'admin-1');
});

test('la vinculación informa por separado un error HTTP de configuración', async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/api/config')) return jsonResponse({ error: 'offline' }, 503);
    return jsonResponse([]);
  }) as typeof fetch;

  await assert.rejects(
    () => fetchMasterPairingResources('http://10.0.0.145:3001', fetchImpl),
    (error: unknown) => (
      error instanceof MasterPairingConnectionError
      && error.code === 'CONFIG_HTTP_ERROR'
      && /503/.test(error.message)
    ),
  );
});
