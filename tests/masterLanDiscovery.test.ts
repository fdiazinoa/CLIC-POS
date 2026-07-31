import assert from 'node:assert/strict';
import test from 'node:test';

const storage = new Map<string, string>([['active_tenant_id', 'tenant-a']]);
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
});

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    ClicPOSNativePrinter: {
      discoverMasterServers: async () => ({
        success: true,
        masters: [
          { host: '10.0.0.20', tenantId: 'tenant-b', companyName: 'Otra empresa' },
          { host: '10.0.0.94', tenantId: 'tenant-a', companyName: 'Restaurante POS' },
        ],
      }),
    },
  },
});

const { discoverLanMasterCandidates } = await import('../utils/masterLanDiscovery');

test('autodiscovery only accepts the Master for the active tenant', async () => {
  const candidates = await discoverLanMasterCandidates({ timeoutMs: 800 });

  assert.deepEqual(candidates.map(candidate => candidate.host), ['10.0.0.94']);
  assert.equal(candidates[0]?.companyName, 'Restaurante POS');
});
