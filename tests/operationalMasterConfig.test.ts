import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  resolveClientMasterAuthority,
  resolveOperationalMasterConfig,
  runClientMasterStartup,
  type ClientMasterAuthority,
} from '../utils/operationalMasterConfig';
import { persistValidatedClientMasterTarget, persistValidatedClientMasterTargetAsync, resolveClientMasterTerminalId } from '../utils/clientMasterBinding';
import { loadSyncProfile, saveSyncProfile } from '../services/sync/SyncProfile';
import { saveTerminalCredentials, setTerminalCredentialNativeWriterForTests } from '../services/sync/TerminalCredentialStore';

const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
}) as Response;

test('self stored endpoint is candidate-local and cloud Master is selected without premature persistence', async () => {
  const requested: string[] = [];
  const result = await resolveOperationalMasterConfig<{ runtimeTerminalId: string }>({
    storedHosts: ['10.0.0.28'],
    resolveCloudHost: async () => '10.0.0.129',
    discoverLanHosts: async () => assert.fail('cloud candidate should resolve'),
    fetchImpl: async (url) => {
      requested.push(String(url));
      return response({ runtimeTerminalId: String(url).includes('10.0.0.28') ? 'CLIENT' : 'MASTER' });
    },
    validate: (_baseUrl, config) => {
      if (config.runtimeTerminalId === 'CLIENT') throw new Error('MASTER_SELF_ENDPOINT');
    },
  });

  assert.equal(result?.baseUrl, 'http://10.0.0.129:3001');
  assert.equal(result?.source, 'CLOUD');
  assert.deepEqual(requested, [
    'http://10.0.0.28:3001/api/config',
    'http://10.0.0.129:3001/api/config',
  ]);
});

test('App cloud discovery is read-only until a candidate validates', () => {
  const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const calls = source.match(/resolveMasterEndpointFromCloud\([^;]+/g) || [];
  assert.ok(calls.length >= 3, 'expected all App cloud discovery callsites');
  calls.forEach(call => assert.match(call, /persist:\s*false/));
});

test('an unavailable mutation journal blocks client discovery while preserving local startup', () => {
  const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const guard = source.indexOf('isOperationalClientBoot && !legacyMutationJournal.isHealthy()');
  const discovery = source.indexOf('runClientMasterStartup<BusinessConfig');
  assert.ok(guard > 0 && discovery > guard, 'journal health must gate discovery before any remote candidate work');
  assert.match(source.slice(guard, discovery), /backgroundSyncManager\.disableRemoteSync/);
  assert.match(source.slice(guard, discovery), /resetOperationalAuthority/);
  assert.match(source.slice(guard, discovery), /refreshedTerminalConfig = finalConfig/);
});

test('stale and self candidates cannot mutate existing Master mirrors', async () => {
  const values = new Map<string, string>([
    ['CLIC_POS_MASTER_URL', 'http://10.0.0.10:3001'],
    ['pos_master_ip', '10.0.0.10'],
  ]);
  let mirrorWrites = 0;
  const result = await resolveOperationalMasterConfig<{ runtimeTerminalId: string }>({
    storedHosts: ['10.0.0.28'],
    resolveCloudHost: async () => '10.0.0.40',
    discoverLanHosts: async () => [],
    fetchImpl: async (url) => response({
      runtimeTerminalId: String(url).includes('10.0.0.28') ? 'CLIENT' : 'STALE-MASTER',
    }),
    validate: (_baseUrl, config) => {
      if (config.runtimeTerminalId === 'CLIENT') throw new Error('MASTER_SELF_ENDPOINT');
      throw new Error('MASTER_IDENTITY_MISMATCH');
    },
  });
  if (result) {
    mirrorWrites++;
    persistValidatedClientMasterTarget(result.baseUrl, {
      storage: {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, value); },
        removeItem: key => { values.delete(key); },
      },
      persistProfile: () => true,
    });
  }

  assert.equal(result, null);
  assert.equal(mirrorWrites, 0);
  assert.equal(values.get('CLIC_POS_MASTER_URL'), 'http://10.0.0.10:3001');
  assert.equal(values.get('pos_master_ip'), '10.0.0.10');
});

test('transport, HTTP, JSON, and validation failures continue through LAN candidates', async () => {
  const result = await resolveOperationalMasterConfig<Record<string, unknown>>({
    storedHosts: ['10.0.0.1'],
    resolveCloudHost: async () => '10.0.0.2',
    discoverLanHosts: async () => ['10.0.0.3', '10.0.0.4'],
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes('10.0.0.1')) throw new TypeError('Failed to fetch');
      if (target.includes('10.0.0.2')) return response({}, 503);
      if (target.includes('10.0.0.3')) return { ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } } as unknown as Response;
      return response({ primary: true });
    },
    validate: (_baseUrl, config) => { if (!config.primary) throw new Error('MASTER_ROLE_INVALID'); },
  });
  assert.equal(result?.baseUrl, 'http://10.0.0.4:3001');
  assert.equal(result?.source, 'LAN');
});

test('client pairing rejects its own ids and resolves the primary identity', () => {
  const config = {
    terminals: [
      { id: 'MASTER', config: { isPrimaryNode: true, erpTerminalId: 'ERP-MASTER' } },
      { id: 'CLIENT', config: { isPrimaryNode: false, erpTerminalId: 'ERP-CLIENT' } },
    ],
  } as any;
  assert.equal(resolveClientMasterTerminalId(config, ['CLIENT', 'ERP-CLIENT'], ['CLIENT', 'ERP-CLIENT']), 'ERP-MASTER');
  assert.equal(resolveClientMasterTerminalId(config, ['CLIENT', 'ERP-CLIENT'], ['STALE-OTHER-MASTER']), 'ERP-MASTER');
});

test('client pairing never trusts an uncorroborated master id without a primary terminal', () => {
  const config = { terminals: [{ id: 'CLIENT', config: { isPrimaryNode: false } }] } as any;
  assert.equal(resolveClientMasterTerminalId(config, ['CLIENT'], ['STALE-OTHER-MASTER']), undefined);
});

test('non-primary devices are rejected before cloud publication work starts', () => {
  const source = readFileSync(new URL('../utils/cloudMasterRegistry.ts', import.meta.url), 'utf8');
  const publication = source.slice(source.indexOf('export const publishMasterEndpointToCloud'));
  assert.ok(publication.indexOf("if (payload.isPrimary !== true) return null") < publication.indexOf('getStoredTenantIdentity()'));
});

test('validated Master persistence rolls mirrors back when SyncProfile persistence fails, then recovers', () => {
  const values = new Map<string, string>([
    ['CLIC_POS_MASTER_URL', 'http://10.0.0.10:3001'],
    ['pos_master_ip', '10.0.0.10'],
  ]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  let profileUrl = 'http://10.0.0.10:3001';
  let rejectNext = true;
  const persistProfile = (url: string) => {
    if (rejectNext && url === 'http://10.0.0.129:3001') { rejectNext = false; return false; }
    profileUrl = url;
    return true;
  };

  assert.throws(() => persistValidatedClientMasterTarget('http://10.0.0.129:3001', { storage, persistProfile }), /PROFILE_PERSIST_FAILED/);
  assert.equal(values.get('CLIC_POS_MASTER_URL'), 'http://10.0.0.10:3001');
  assert.equal(values.get('pos_master_ip'), '10.0.0.10');
  assert.equal(profileUrl, 'http://10.0.0.10:3001');

  persistValidatedClientMasterTarget('http://10.0.0.129:3001', { storage, persistProfile });
  assert.equal(values.get('CLIC_POS_MASTER_URL'), 'http://10.0.0.129:3001');
  assert.equal(values.get('pos_master_ip'), '10.0.0.129');
  assert.equal(profileUrl, 'http://10.0.0.129:3001');
});

test('validated Master persistence rolls back a partial localStorage write before profile mutation', () => {
  const values = new Map<string, string>([
    ['CLIC_POS_MASTER_URL', 'http://10.0.0.10:3001'],
    ['pos_master_ip', '10.0.0.10'],
  ]);
  let failHostWrite = true;
  let profileWrites = 0;
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key === 'pos_master_ip' && failHostWrite) { failHostWrite = false; throw new Error('QUOTA'); }
      values.set(key, value);
    },
    removeItem: (key: string) => { values.delete(key); },
  };
  assert.throws(() => persistValidatedClientMasterTarget('http://10.0.0.129:3001', {
    storage,
    persistProfile: () => { profileWrites++; return true; },
  }), /QUOTA/);
  assert.equal(values.get('CLIC_POS_MASTER_URL'), 'http://10.0.0.10:3001');
  assert.equal(values.get('pos_master_ip'), '10.0.0.10');
  assert.equal(profileWrites, 1, 'only rollback reconciliation may touch the prior profile');
});

test('validated Master rollback restores a real SLAVE/POS_MASTER profile with no previous URL', async () => {
  const previousStorage = globalThis.localStorage;
  const values = new Map<string, string>();
  const storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
  } as Storage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try {
    saveSyncProfile({
      contractedProduct: 'POS_ONLY', posRuntime: 'SLAVE', cloudChannel: 'POS_MASTER', dataMaster: 'POS_MASTER',
      cloudSyncEnabled: false, customerErpAccess: false, erpUiEnabled: false,
      contractSource: 'BACKEND_REGISTER', masterReady: false,
    });
    const rollback = await persistValidatedClientMasterTargetAsync('http://10.0.0.129:3001');
    await rollback();
    assert.equal(storage.getItem('CLIC_POS_MASTER_URL'), null);
    assert.equal(storage.getItem('pos_master_ip'), null);
    assert.equal(loadSyncProfile().masterUrl, undefined);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage });
  }
});

test('serialized credential persistence leaves rollback newer than a delayed native A write', async () => {
  const nativeWrites: string[] = [];
  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>(resolve => { markFirstStarted = resolve; });
  let first = true;
  setTerminalCredentialNativeWriterForTests(async (value: string) => {
    nativeWrites.push(value);
    if (first) {
      first = false;
      markFirstStarted();
      await new Promise<void>(resolve => { releaseFirst = resolve; });
    }
  });
  try {
    const writeA = saveTerminalCredentials({ masterUrl: 'http://10.0.0.129:3001', masterIp: '10.0.0.129' });
    await firstStarted;
    const rollback = saveTerminalCredentials({ masterUrl: null, masterIp: null });
    releaseFirst();
    await Promise.all([writeA, rollback]);
    assert.equal(JSON.parse(nativeWrites.at(-1) || '{}').masterUrl, null);
    assert.equal(JSON.parse(nativeWrites.at(-1) || '{}').masterIp, null);
  } finally {
    setTerminalCredentialNativeWriterForTests(null);
  }
});

test('client startup enforces hydrate → identity candidate → slow full validation → persist → initialize → refresh', async () => {
  const events: string[] = [];
  const masterConfig = { terminals: [{ id: 'MASTER' }] };
  let persisted = 0;
  const startedAt = Date.now();

  const result = await runClientMasterStartup({
    fallbackConfig: { terminals: [{ id: 'CLIENT' }] },
    hydrateLocalIps: async () => {
      events.push('localIps hydrated');
      return ['10.0.0.28', '192.168.50.28'];
    },
    resolveAuthority: async (localIps) => resolveClientMasterAuthority({
      storedHosts: ['10.0.0.28'],
      resolveCloudHost: async () => null,
      discoverLanHosts: async () => {
        events.push('identity candidate');
        return ['10.0.0.129'];
      },
      rejectHosts: localIps,
      timeoutMs: 8_000,
      fetchImpl: async (url, init) => {
        events.push(`full config:${String(url)}`);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 2_600);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
        return response(masterConfig);
      },
      validate: (baseUrl) => events.push(`validated:${baseUrl}`),
    }),
    persistValidated: (authority) => {
      events.push(`persist:${authority.baseUrl}`);
      persisted += 1;
    },
    applyValidatedConfig: async (config) => {
      events.push('apply config');
      return config;
    },
    initialize: async (authority) => {
      events.push(authority.status === 'VALIDATED' ? `initialize:${authority.baseUrl}` : 'initialize:offline');
    },
    refresh: async (authority) => {
      events.push(`refresh:${authority.baseUrl}`);
      return masterConfig;
    },
  });

  assert.equal(result.authority.status, 'VALIDATED');
  assert.equal(persisted, 1);
  assert.ok(Date.now() - startedAt >= 2_500, 'the full config response must exceed the rejected 2.5s budget');
  assert.deepEqual(events, [
    'localIps hydrated',
    'identity candidate',
    'full config:http://10.0.0.129:3001/api/config',
    'validated:http://10.0.0.129:3001',
    'persist:http://10.0.0.129:3001',
    'apply config',
    'initialize:http://10.0.0.129:3001',
    'refresh:http://10.0.0.129:3001',
  ]);
});

test('incomplete local identity and all-invalid candidates remain offline without mutation or refresh', async () => {
  for (const localIps of [[], ['10.0.0.28', '192.168.50.28']]) {
    let persistCalls = 0;
    let refreshCalls = 0;
    const initialized: string[] = [];
    const result = await runClientMasterStartup({
      fallbackConfig: { local: true },
      hydrateLocalIps: async () => localIps,
      resolveAuthority: async (hydrated) => resolveClientMasterAuthority({
        storedHosts: ['10.0.0.28', '127.0.0.1', '0.0.0.0'],
        resolveCloudHost: async () => '192.168.50.28',
        discoverLanHosts: async () => [],
        rejectHosts: hydrated,
        fetchImpl: async () => assert.fail('self/loopback/wildcard candidates must be rejected before fetch'),
        validate: () => assert.fail('invalid candidates cannot validate'),
      }),
      persistValidated: () => { persistCalls++; },
      applyValidatedConfig: async config => config,
      initialize: async authority => { initialized.push(authority.status); },
      refresh: async () => { refreshCalls++; return null; },
    });
    assert.equal(result.authority.status, 'UNAVAILABLE');
    assert.equal(persistCalls, 0);
    assert.equal(refreshCalls, 0);
    assert.deepEqual(initialized, ['UNAVAILABLE']);
  }
});

test('persistence rollback failure path initializes local-only and never refreshes remote', async () => {
  const authority: ClientMasterAuthority<{ terminals: never[] }> = {
    status: 'VALIDATED',
    baseUrl: 'http://10.0.0.129:3001',
    source: 'LAN',
    config: { terminals: [] },
  };
  const initialized: string[] = [];
  let refreshCalls = 0;
  await assert.rejects(() => runClientMasterStartup({
    fallbackConfig: { terminals: [] },
    hydrateLocalIps: async () => ['10.0.0.28'],
    resolveAuthority: async () => authority,
    persistValidated: () => { throw new Error('MASTER_SYNC_PROFILE_PERSIST_FAILED'); },
    applyValidatedConfig: async config => config,
    initialize: async current => { initialized.push(current.status); },
    refresh: async () => { refreshCalls++; return null; },
  }), /PROFILE_PERSIST_FAILED/);
  assert.deepEqual(initialized, ['UNAVAILABLE']);
  assert.equal(refreshCalls, 0);
});

test('offline remount followed by validated authority uses only the new explicit target', async () => {
  const initialized: string[] = [];
  const refreshed: string[] = [];
  const run = (authority: ClientMasterAuthority<{ generation: number }>) => runClientMasterStartup({
    fallbackConfig: { generation: 0 },
    hydrateLocalIps: async () => ['10.0.0.28'],
    resolveAuthority: async () => authority,
    persistValidated: () => undefined,
    applyValidatedConfig: async config => config,
    initialize: async current => { initialized.push(current.status === 'VALIDATED' ? current.baseUrl : 'OFFLINE'); },
    refresh: async current => { refreshed.push(current.baseUrl); return current.config; },
  });

  await run({ status: 'UNAVAILABLE' });
  await run({
    status: 'VALIDATED',
    baseUrl: 'http://10.0.0.140:3001',
    source: 'CLOUD',
    config: { generation: 2 },
  });
  assert.deepEqual(initialized, ['OFFLINE', 'http://10.0.0.140:3001']);
  assert.deepEqual(refreshed, ['http://10.0.0.140:3001']);
});
