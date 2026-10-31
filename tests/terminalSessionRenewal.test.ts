import test from 'node:test';
import assert from 'node:assert/strict';
import { setTerminalCredentialNativeWriterForTests, setTerminalCredentialNativeReaderForTests } from '../services/sync/TerminalCredentialStore';

const scope = { tenantId: 'tenant', companyId: 'company', storeId: 'store', terminalId: 'terminal', deviceId: 'device' };
const base = 'https://erp.example.invalid/api/sync';

const install = (credentials: any) => {
  const values = new Map<string, string>();
  values.set('clic_terminal_credentials_v1', JSON.stringify(credentials));
  (globalThis as any).localStorage = {
    getItem: (key: string) => values.has(key) ? values.get(key)! : null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(), key: () => null, get length() { return values.size; },
  };
  setTerminalCredentialNativeWriterForTests(async () => undefined);
  setTerminalCredentialNativeReaderForTests(async () => null);
  return values;
};

const credentials = (overrides: Record<string, unknown> = {}) => ({
  ...scope, syncToken: 'synthetic-old-session', deviceToken: 'synthetic-device', deviceTokenSource: 'ERP_REGISTER',
  authStatus: 'AUTHENTICATED', syncTokenExpiresAt: '2020-01-01T00:00:00Z', deviceTokenExpiresAt: null, ...overrides,
});

const withRenew = async (respond: (url: string) => any) => {
  const { renewTerminalSession } = await import('../services/sync/TerminalSessionRenewal');
  const fetchImpl = async (input: any, init: any) => {
    assert.equal(new URL(String(input)).pathname, '/api/sync/auth');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    return respond(String(input));
  };
  return renewTerminalSession({
    target: () => ({ kind: 'ERP_ACTIVE', baseUrl: base }),
    credentials: () => credentials() as any,
    fetchImpl: fetchImpl as any,
  });
};


test('a renewed session without a date is persisted as open-ended and never re-pairs the device', async () => {
  const values = install(credentials());
  const result = await withRenew(() => ({ status: 200, json: async () => ({ status: 'AUTHORIZED', success: true, token: 'synthetic-new-session', tokenExpiresAt: null }) }));
  assert.deepEqual(result, { renewed: true, reason: 'OK', expiresAt: null });
  const stored = JSON.parse(values.get('clic_terminal_credentials_v1')!);
  assert.equal(stored.syncToken, 'synthetic-new-session');
  assert.equal(stored.syncTokenExpiresAt, null);
  assert.equal(stored.deviceToken, 'synthetic-device', 'the paired device token is never rotated here');
  assert.equal(values.has('clic_erp_sync_token_expires_at'), false);
});

test('a rejected renewal reports the ERP code and leaves the session untouched', async () => {
  const values = install(credentials());
  const result = await withRenew(() => ({ status: 403, json: async () => ({ code: 'DEVICE_TOKEN_INVALID' }) }));
  assert.equal(result.renewed, false);
  assert.match(result.reason, /DEVICE_TOKEN_INVALID/);
  const stored = JSON.parse(values.get('clic_terminal_credentials_v1')!);
  assert.equal(stored.syncToken, 'synthetic-old-session');
  assert.equal(stored.deviceToken, 'synthetic-device');
  assert.equal(values.has('clic_erp_sync_token'), false, 'no mirror write on failure');
});

test('an invalid or past session date is refused before persisting', async () => {
  install(credentials());
  for (const tokenExpiresAt of ['2020-01-01T00:00:00Z', 'tomorrow']) {
    const result = await withRenew(() => ({ status: 200, json: async () => ({ status: 'AUTHORIZED', success: true, token: 'x', tokenExpiresAt }) }));
    assert.equal(result.renewed, false);
  }
});
