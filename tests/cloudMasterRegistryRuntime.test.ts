import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { buildMasterUrlFromHost, normalizeMasterHost } from '../utils/masterEndpointUrl';
import { resolveStoredTenantIdentity } from '../utils/tenantIdentityStorage';

// Execute the complete production module. Only external platform/auth/network boundaries are fixtures.
const source = readFileSync(new URL('../utils/cloudMasterRegistry.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/^export \{.*\} from .*;\n/gm, '')
  .replace(/^export type \{.*\} from .*;\n/gm, '')
  .replace(/\(import\.meta as any\)\.env/g, '__env');
const compiled = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS });
const endpoint = (ip = '192.168.1.20') => ({ local_ip: ip, protocol: 'http', port: 3001, endpoint_url: `http://${ip}:3001` });
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function fixture(options: { native?: boolean; bridge?: any; legacy?: any; tenant?: string | null; auth?: boolean } = {}) {
  const values = new Map<string, string>();
  if (options.tenant !== null) values.set('clic_cloud_tenant_id', options.tenant || 'cloud-tenant');
  const writes: Array<[string, string]> = [];
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const timers = new Map<number, () => void>();
  const listeners = new Set<EventListenerOrEventListenerObject>();
  class TrackedAbortController extends AbortController {
    constructor() {
      super();
      const add = this.signal.addEventListener.bind(this.signal);
      const remove = this.signal.removeEventListener.bind(this.signal);
      this.signal.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options: any) => {
        if (type === 'abort') listeners.add(listener);
        add(type, listener, options);
      }) as typeof this.signal.addEventListener;
      this.signal.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options: any) => {
        if (type === 'abort') listeners.delete(listener);
        remove(type, listener, options);
      }) as typeof this.signal.removeEventListener;
    }
  }
  let timerId = 0;
  let responder: (url: string, init: RequestInit) => Promise<Response> = async () => Response.json(endpoint());
  const exports: any = {};
  const context = {
    exports, __env: { VITE_SUPABASE_URL: 'https://cloud.test', VITE_SUPABASE_ANON_KEY: 'fixture-anon' },
    window: { location: { protocol: 'https:', hostname: 'localhost' },
      ...(options.bridge === null ? {} : { ClicPOSNativePrinter: { getDeviceInfo: options.bridge || (() => ({ versionName: 'fixture', localIp: '192.168.1.20' })) } }),
      ...(options.legacy ? { AndroidPrinter: { getDeviceInfo: options.legacy } } : {}),
    },
    localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { writes.push([key, value]); values.set(key, value); } },
    isNativeAndroidRuntime: () => options.native !== false,
    ensureSupabaseSessionRestored: async () => {},
    supabase: { auth: { getSession: async () => ({ data: { session: options.auth === false ? null : { access_token: 'fixture-token' } } }) } },
    resolveStoredTenantIdentity, normalizeMasterHost, buildMasterUrlFromHost,
    fetch: (url: string, init: RequestInit) => { calls.push({ url, init }); return responder(url, init); },
    AbortController: TrackedAbortController, URL, URLSearchParams, console: { warn: () => {} },
    setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
  };
  runInNewContext(compiled, context);
  return { api: exports, values, writes, calls, timers, listeners, context,
    respond: (next: typeof responder) => { responder = next; },
    timeout: () => { for (const callback of [...timers.values()]) callback(); },
    publish: (extra = {}) => exports.publishMasterEndpointToCloud({ deviceId: 'device', terminalId: 'terminal', isPrimary: true, ...extra }),
  };
}

test('Android HTTPS assets advertise HTTP LAN using bridge only; success dedupes and cleans timers', async () => {
  const f = fixture();
  assert.equal((await f.publish()).endpointUrl, 'http://192.168.1.20:3001');
  const body = JSON.parse(f.calls[0].init.body as string);
  assert.equal(body.p_protocol, 'http'); assert.equal(body.p_tenant_id, 'cloud-tenant');
  assert.equal(body.p_device_id, 'device'); assert.equal(body.p_terminal_id, 'terminal');
  assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 0); assert.equal(f.listeners.size, 0);
  await f.publish(); assert.equal(f.calls.length, 1);
  assert.ok(f.calls.every(call => call.url.startsWith('https://cloud.test/rest/v1/rpc/')));
});

test('legacy AndroidPrinter bridge is supported', async () => {
  const f = fixture({ bridge: null, legacy: () => JSON.stringify({ localIps: ['10.0.3.15'] }) });
  f.respond(async () => Response.json(endpoint('10.0.3.15')));
  assert.equal((await f.publish()).localIp, '10.0.3.15');
});

for (const [name, bridge] of Object.entries({ absent: null, rejected: () => Promise.reject(new Error('bridge')), empty: () => ({}), malformed: () => ({ localIp: {}, localIps: [null, 42, {}, 'hello', 'http://192.168.1.2', '999.1.1.1', '01.2.3.4'] }), loopback: () => ({ localIps: ['127.0.0.2', 'localhost', '0.0.0.0', '::1', '224.1.1.1'] }) })) {
  test(`native ${name} bridge refuses publication without probing unsupported routes`, async () => {
    const f = fixture({ bridge }); assert.equal(await f.publish(), null); assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0);
  });
}

test('native resolve preserves authorized direct RPC and omits Node fallback for null/auth failure', async () => {
  const f = fixture(); assert.equal((await f.api.resolveMasterEndpointFromCloud()).localIp, '192.168.1.20');
  f.respond(async () => Response.json(null)); assert.equal(await f.api.resolveMasterEndpointFromCloud(), null);
  assert.ok(f.calls.every(call => call.url.startsWith('https://cloud.test/rest/v1/rpc/')));
  const unauth = fixture({ auth: false }); assert.equal(await unauth.publish(), null); assert.equal(await unauth.api.resolveMasterEndpointFromCloud(), null); assert.equal(unauth.calls.length, 0);
});

test('web HTTPS discovery and fallback semantics are retained', async () => {
  const f = fixture({ native: false });
  f.respond(async (url) => url.includes('/api/network') ? Response.json({ addresses: ['192.168.1.20'] }) : Response.json(endpoint()));
  await f.publish(); assert.equal(JSON.parse(f.calls[1].init.body as string).p_protocol, 'https');
  assert.equal(f.calls[0].url, 'https://localhost:3001/api/network');
  f.respond(async url => url.includes('/rest/') ? Response.json(null) : Response.json({ endpoint: endpoint() }));
  assert.equal((await f.api.resolveMasterEndpointFromCloud()).localIp, '192.168.1.20');
  assert.ok(f.calls.some(call => call.url.startsWith('https://localhost:3001/api/cloud/master-endpoint/resolve')));
});

for (const status of ['null', '403', 'error']) {
  test(`failed ${status} publication permits exact fingerprint retry`, async () => {
    const f = fixture(); f.respond(async () => { if (status === 'error') throw new Error('network'); return status === '403' ? new Response('', { status: 403 }) : Response.json(null); });
    assert.equal(await f.publish(), null); assert.equal(f.timers.size, 0); assert.equal(f.listeners.size, 0); const n = f.calls.length;
    f.respond(async () => Response.json(endpoint())); assert.ok(await f.publish()); assert.equal(f.calls.length, n + 1);
  });
}

test('timeouts clean up and allow retry, without unhandled late rejection', async () => {
  const f = fixture(); const pending: Array<ReturnType<typeof deferred<Response>>> = [];
  f.respond(() => { const d = deferred<Response>(); pending.push(d); return d.promise; });
  const result = f.publish();
  for (let i = 0; i < 8; i++) { await tick(); f.timeout(); }
  assert.equal(await result, null); assert.equal(f.timers.size, 0); assert.equal(f.listeners.size, 0);
  for (const d of pending) d.reject(new Error('late'));
  f.respond(async () => Response.json(endpoint())); assert.ok(await f.publish());
});

test('same fingerprint in flight coalesces into one write', async () => {
  const f = fixture(); const d = deferred<Response>(); f.respond(() => d.promise);
  const first = f.publish(); await tick(); const second = f.publish(); await tick();
  assert.equal(f.calls.length, 1); d.resolve(Response.json(endpoint()));
  assert.ok(await first); assert.ok(await second); assert.equal(f.calls.length, 1);
});

for (const late of ['success', 'failure']) {
  test(`changed IP wins against ignored abort late ${late}; old completion cannot clear latest ownership`, async () => {
    let ip = '192.168.1.20'; const f = fixture({ bridge: () => ({ localIp: ip }) });
    const old = deferred<Response>(); const next = deferred<Response>(); let n = 0;
    f.respond(() => ++n === 1 ? old.promise : next.promise);
    const first = f.publish(); await tick(); ip = '192.168.1.21'; const second = f.publish(); await tick();
    assert.equal(f.calls.length, 2); assert.equal(f.calls[0].init.signal?.aborted, true);
    late === 'success' ? old.resolve(Response.json(endpoint())) : old.reject(new Error('ignored abort'));
    await tick(); const third = f.publish(); await tick(); assert.equal(f.calls.length, 2);
    next.resolve(Response.json(endpoint(ip))); assert.equal(await first, null);
    assert.equal((await second).localIp, ip); assert.equal((await third).localIp, ip);
    assert.equal(f.values.get('pos_master_ip'), ip); assert.equal(f.writes.filter(([key]) => key === 'pos_master_ip').length, 1); assert.equal(f.timers.size, 0); assert.equal(f.listeners.size, 0);
  });
}

test('older success cannot certify changed fingerprint failure; immediate retry remains available', async () => {
  let ip = '192.168.1.20'; const f = fixture({ bridge: () => ({ localIp: ip }) });
  await f.publish(); ip = '192.168.1.21'; f.respond(async () => Response.json(null));
  assert.equal(await f.publish(), null); assert.equal(f.values.get('pos_master_ip'), '192.168.1.20');
  f.respond(async () => Response.json(endpoint(ip))); assert.equal((await f.publish()).localIp, ip);
});

test('non-primary and missing tenant calls have no bridge, storage or network effects; device/tenant scope remains separate', async () => {
  let reads = 0; const f = fixture({ bridge: () => { reads++; return { localIp: '192.168.1.20' }; } });
  assert.equal(await f.publish({ isPrimary: false }), null); assert.equal(reads, 0); assert.equal(f.calls.length, 0);
  const noTenant = fixture({ tenant: null }); assert.equal(await noTenant.publish(), null); assert.equal(noTenant.calls.length, 0);
  await f.publish(); await f.publish({ deviceId: 'second' });
  f.values.set('clic_cloud_tenant_id', 'other-tenant'); await f.publish();
  assert.equal(f.calls.length, 3); assert.equal(JSON.parse(f.calls[2].init.body as string).p_tenant_id, 'other-tenant');
});

test('newer discovery wins when bridge completions arrive out of invocation order', async () => {
  const delayed = deferred<any>(); let reads = 0;
  const f = fixture({ bridge: () => ++reads === 2 ? delayed.promise : ({ localIp: '192.168.1.21' }) });
  f.respond(async () => Response.json(endpoint('192.168.1.21')));
  const first = f.publish(); await tick(); const second = f.publish(); await tick();
  assert.equal((await second).localIp, '192.168.1.21');
  delayed.resolve({ localIp: '192.168.1.20' }); assert.equal(await first, null);
  assert.equal(f.calls.length, 1); assert.equal(JSON.parse(f.calls[0].init.body as string).p_local_ip, '192.168.1.21');
});

test('late RPC body after ignored abort cannot persist or certify success', async () => {
  let ip = '192.168.1.20'; const f = fixture({ bridge: () => ({ localIp: ip }) });
  const body = deferred<string>(); let n = 0;
  f.respond(async () => ++n === 1 ? ({ ok: true, text: () => body.promise } as Response) : Response.json(endpoint(ip)));
  const first = f.publish(); await tick(); ip = '192.168.1.21';
  assert.equal((await f.publish()).localIp, ip);
  body.resolve(JSON.stringify(endpoint('192.168.1.20'))); assert.equal(await first, null);
  assert.equal(f.values.get('pos_master_ip'), ip); assert.equal(f.writes.filter(([key]) => key === 'pos_master_ip').length, 1);
});

test('late web fallback response body cannot persist over latest publication', async () => {
  let ip = '192.168.1.20'; const f = fixture({ native: false, bridge: () => ({ localIp: ip }) });
  const body = deferred<any>(); let fallback = 0;
  f.respond(async url => url.includes('/api/network') ? Response.json({ addresses: [ip] })
    : url.includes('/rest/') ? Response.json(null)
      : ++fallback === 1 ? ({ ok: true, json: () => body.promise } as Response) : Response.json({ endpoint: endpoint(ip) }));
  const first = f.publish(); for (let i = 0; i < 6; i++) await tick();
  assert.equal(fallback, 1); ip = '192.168.1.21'; assert.equal((await f.publish()).localIp, ip);
  body.resolve({ endpoint: endpoint('192.168.1.20') }); assert.equal(await first, null);
  assert.equal(f.values.get('pos_master_ip'), ip); assert.equal(f.writes.filter(([key]) => key === 'pos_master_ip').length, 1);
});

test('a disappearing native LAN aborts current attempt and the same address may retry immediately', async () => {
  let ip = '192.168.1.20'; const f = fixture({ bridge: () => ({ localIp: ip }) });
  const old = deferred<Response>(); f.respond(() => old.promise);
  const first = f.publish(); await tick(); ip = ''; assert.equal(await f.publish(), null);
  ip = '192.168.1.20'; f.respond(async () => Response.json(endpoint(ip)));
  assert.ok(await f.publish()); assert.equal(await first, null); old.resolve(Response.json(endpoint('192.168.1.99')));
  await tick(); assert.equal(f.values.get('pos_master_ip'), ip); assert.equal(f.timers.size, 0); assert.equal(f.listeners.size, 0);
});
