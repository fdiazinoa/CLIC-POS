import test from 'node:test';
import assert from 'node:assert/strict';
import { capturePresentationAuth } from '../services/inventoryPresentations/client';
import { saveTerminalSessionCAS, setTerminalCredentialNativeWriterForTests, setTerminalCredentialNativeReaderForTests } from '../services/sync/TerminalCredentialStore';

const scope = { tenantId: 'tenant', companyId: 'company', storeId: 'store', terminalId: 'terminal', deviceId: 'device' };
const base = 'https://erp.example.invalid/api/sync';

const installStorage = (credentials: any) => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.has(key) ? values.get(key)! : null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(), key: () => null, get length() { return values.size; },
  } as unknown as Storage;
  values.set('clic_terminal_credentials_v1', JSON.stringify(credentials));
  (globalThis as any).localStorage = storage;
  setTerminalCredentialNativeWriterForTests(async () => undefined);
  setTerminalCredentialNativeReaderForTests(async () => null);
  return values;
};

const identity = () => ({ erpSyncBaseUrl: base, tenantId: scope.tenantId, terminalId: scope.terminalId, deviceId: scope.deviceId, syncToken: 'synthetic-sync' });
const credentials = (overrides: Record<string, unknown> = {}) => ({
  ...scope, syncToken: 'synthetic-sync', deviceToken: 'synthetic-device', deviceTokenSource: 'ERP_REGISTER',
  authStatus: 'AUTHENTICATED', deviceTokenExpiresAt: null, syncTokenExpiresAt: null, ...overrides,
});

test('an open-ended session keeps the commercial presentation channel authorized', () => {
  installStorage(credentials());
  const auth = capturePresentationAuth(identity, () => credentials() as any);
  assert.equal(auth.origin, new URL(base).origin);
  assert.throws(() => capturePresentationAuth(identity, () => credentials({ syncTokenExpiresAt: '2020-01-01' }) as any), /INVENTORY_PRESENTATION_AUTH_REQUIRED/);
});

test('a renewal answer without expiry is stored as an open-ended session, never as a fake date', async () => {
  const values = installStorage(credentials({ syncTokenExpiresAt: '2020-01-01' }));
  const snapshot = { document: values.get('clic_terminal_credentials_v1')!, generation: 0, credentials: credentials({ syncTokenExpiresAt: '2020-01-01' }) as any };
  const observation = { source: 'LOCAL_OBSERVATION_OF_ERP_SYNC_AUTH' as const, origin: new URL(base).origin, route: '/api/sync/auth' as const, tenantId: scope.tenantId, terminalId: scope.terminalId, deviceId: scope.deviceId, observedAt: new Date().toISOString() };
  await saveTerminalSessionCAS(snapshot, { token: 'synthetic-renewed', expiresAt: null, observation }, () => undefined);
  const stored = JSON.parse(values.get('clic_terminal_credentials_v1')!);
  assert.equal(stored.syncToken, 'synthetic-renewed');
  assert.equal(stored.syncTokenExpiresAt, null);
  assert.equal(values.has('clic_erp_sync_token_expires_at'), false, 'an open-ended session keeps no date mirror');
});
