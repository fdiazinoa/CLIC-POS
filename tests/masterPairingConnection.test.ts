import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusinessConfig } from '../types';
import {
  fetchMasterPairingResources,
  MasterPairingConnectionError,
  waitForMasterPairingResources,
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

test('la vinculación espera el arranque de la Master y conecta con backoff', async () => {
  let configAttempts = 0;
  let nowMs = 0;
  const delays: number[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/api/users')) return jsonResponse([]);
    configAttempts += 1;
    if (configAttempts < 3) throw new TypeError('Network request failed');
    return jsonResponse({ name: 'Caja Master', terminals: [] });
  }) as typeof fetch;

  const result = await waitForMasterPairingResources(
    'http://10.0.0.142:3001',
    fetchImpl,
    {
      now: () => nowMs,
      sleep: async (delayMs) => {
        delays.push(delayMs);
        nowMs += delayMs;
      },
    },
  );

  assert.equal((result.config as BusinessConfig & { name?: string }).name, 'Caja Master');
  assert.equal(configAttempts, 3);
  assert.deepEqual(delays, [750, 1275]);
});

test('la vinculación reintenta cuando el puerto abre antes de que la configuración Master esté lista', async () => {
  let configAttempts = 0;
  let nowMs = 0;
  const retryCodes: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/api/users')) return jsonResponse([]);
    configAttempts += 1;
    return jsonResponse({ ready: configAttempts >= 3, terminals: [] });
  }) as typeof fetch;

  const result = await waitForMasterPairingResources(
    'http://10.0.0.142:3001',
    fetchImpl,
    {
      isConfigReady: config => (config as BusinessConfig & { ready?: boolean }).ready === true,
      now: () => nowMs,
      sleep: async delayMs => { nowMs += delayMs; },
      onRetry: state => retryCodes.push((state.error as MasterPairingConnectionError).code),
    },
  );

  assert.equal((result.config as BusinessConfig & { ready?: boolean }).ready, true);
  assert.equal(configAttempts, 3);
  assert.deepEqual(retryCodes, ['CONFIG_NOT_READY', 'CONFIG_NOT_READY']);
});

test('la espera de arranque no reintenta errores funcionales 4xx', async () => {
  let configAttempts = 0;
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/api/users')) return jsonResponse([]);
    configAttempts += 1;
    return jsonResponse({ error: 'forbidden' }, 403);
  }) as typeof fetch;

  await assert.rejects(
    () => waitForMasterPairingResources('http://10.0.0.142:3001', fetchImpl, { sleep: async () => {} }),
    (error: unknown) => error instanceof MasterPairingConnectionError && /403/.test(error.message),
  );
  assert.equal(configAttempts, 1);
});

test('la espera de arranque respeta la ventana máxima y conserva el último error', async () => {
  let configAttempts = 0;
  let nowMs = 0;
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/api/users')) return jsonResponse([]);
    configAttempts += 1;
    throw new TypeError('Master booting');
  }) as typeof fetch;

  await assert.rejects(
    () => waitForMasterPairingResources(
      'http://10.0.0.142:3001',
      fetchImpl,
      {
        maxWaitMs: 1_000,
        now: () => nowMs,
        sleep: async (delayMs) => { nowMs += delayMs; },
      },
    ),
    (error: unknown) => error instanceof MasterPairingConnectionError && error.code === 'CONFIG_NETWORK_ERROR',
  );
  assert.equal(configAttempts, 3);
});
