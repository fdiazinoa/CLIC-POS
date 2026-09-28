import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolveOperationalMasterConfig } from '../utils/operationalMasterConfig';
import { persistValidatedClientMasterTarget, resolveClientMasterTerminalId } from '../utils/clientMasterBinding';

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
