import assert from 'node:assert/strict';
import test from 'node:test';
import { TerminalConfigRequestCoordinator } from '../services/sync/TerminalConfigRequestCoordinator';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const requestInput = {
  baseUrl: 'https://erp.example.test',
  terminalId: 'terminal-12345678',
  tenantId: 'tenant-a',
  deviceId: 'device-12345678',
  reason: 'manual_sync' as const,
};

test('HTTP 304 preserves cache and never parses JSON', async () => {
  const storage = new MemoryStorage();
  storage.setItem('clic_pos_terminal_config_cache:terminal-12345678', JSON.stringify({
    configVersion: 'v10',
    etag: '"etag-10"',
    lastValidAt: '2026-07-29T10:00:00.000Z',
    lastCheckedAt: null,
  }));
  let bodyRead = false;
  const coordinator = new TerminalConfigRequestCoordinator(storage, (async (_input, init) => {
    assert.equal((init?.headers as Record<string, string>)['If-None-Match'], '"etag-10"');
    return {
      status: 304,
      ok: false,
      headers: new Headers(),
      text: async () => {
        bodyRead = true;
        return '';
      },
    } as Response;
  }) as typeof fetch);

  const result = await coordinator.request(requestInput);

  assert.equal(result.status, 'unchanged');
  assert.equal(result.configVersion, 'v10');
  assert.equal(bodyRead, false);
  assert.equal(coordinator.readCache(requestInput.terminalId).lastValidAt, '2026-07-29T10:00:00.000Z');
});

test('HTTP 200 applies before persisting version and ETag', async () => {
  const storage = new MemoryStorage();
  let cacheDuringApply: string | null = 'not-checked';
  const coordinator = new TerminalConfigRequestCoordinator(storage, (async () => new Response(
    JSON.stringify({ success: true, config_version: 'v11', terminal_config: { mode: 'RESTAURANT' } }),
    {
      status: 200,
      headers: {
        ETag: '"etag-11"',
        'X-Config-Version': 'v11',
        'Content-Type': 'application/json',
      },
    },
  )) as typeof fetch);

  const result = await coordinator.request({
    ...requestInput,
    apply: async () => {
      cacheDuringApply = storage.getItem('clic_pos_terminal_config_cache:terminal-12345678');
    },
  });

  assert.equal(cacheDuringApply, null);
  assert.equal(result.status, 'applied');
  assert.equal(coordinator.readCache(requestInput.terminalId).configVersion, 'v11');
  assert.equal(coordinator.readCache(requestInput.terminalId).etag, '"etag-11"');
});

test('simultaneous requests share one HTTP operation', async () => {
  const storage = new MemoryStorage();
  let requests = 0;
  const coordinator = new TerminalConfigRequestCoordinator(storage, (async () => {
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return Response.json({ success: true, config_version: 'v12' }, {
      headers: { ETag: '"etag-12"', 'X-Config-Version': 'v12' },
    });
  }) as typeof fetch);

  const [first, second] = await Promise.all([
    coordinator.request(requestInput),
    coordinator.request({ ...requestInput, reason: 'config_push' }),
  ]);

  assert.equal(requests, 1);
  assert.deepEqual(second, first);
});

test('HTTP 4xx does not retry', async () => {
  let requests = 0;
  const coordinator = new TerminalConfigRequestCoordinator(new MemoryStorage(), (async () => {
    requests += 1;
    return new Response('forbidden', { status: 403 });
  }) as typeof fetch, [0], async () => undefined);

  await assert.rejects(() => coordinator.request(requestInput), /403/);
  assert.equal(requests, 1);
});

test('temporary errors use bounded backoff and then recover', async () => {
  let requests = 0;
  const waits: number[] = [];
  const coordinator = new TerminalConfigRequestCoordinator(new MemoryStorage(), (async () => {
    requests += 1;
    if (requests === 1) return new Response('unavailable', { status: 503 });
    return Response.json({ success: true, config_version: 'v13' }, {
      headers: { 'X-Config-Version': 'v13' },
    });
  }) as typeof fetch, [1], async (delayMs) => {
    waits.push(delayMs);
  });

  const result = await coordinator.request(requestInput);

  assert.equal(result.status, 'applied');
  assert.equal(requests, 2);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] >= 0);
});

test('cancel aborts the active request', async () => {
  const coordinator = new TerminalConfigRequestCoordinator(new MemoryStorage(), (async (_input, init) => (
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })
  )) as typeof fetch);

  const operation = coordinator.request(requestInput);
  coordinator.cancel(requestInput.terminalId);

  await assert.rejects(operation, (error: any) => error?.name === 'AbortError');
});
