import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolveOperationalMasterConfig } from '../utils/operationalMasterConfig';
import { resolveClientMasterTerminalId } from '../utils/clientMasterBinding';

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
});

test('non-primary devices are rejected before cloud publication work starts', () => {
  const source = readFileSync(new URL('../utils/cloudMasterRegistry.ts', import.meta.url), 'utf8');
  const publication = source.slice(source.indexOf('export const publishMasterEndpointToCloud'));
  assert.ok(publication.indexOf("if (payload.isPrimary !== true) return null") < publication.indexOf('getStoredTenantIdentity()'));
});
