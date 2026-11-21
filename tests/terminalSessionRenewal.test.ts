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

const canonicalTerminal = '00000000-0000-4000-8000-000000000001';
const authResponse = {
  status: 'AUTHORIZED',
  success: true,
  token: 'synthetic-new-session',
  terminalId: canonicalTerminal,
  deviceId: scope.deviceId,
  tenantId: scope.tenantId,
};
const installStaleAuth = () => {
  const current = credentials({ terminalId: canonicalTerminal, lastAuthError: 'DEVICE_SUPERSEDED' });
  const values = install(current);
  values.set('CLIC_POS_DEVICE_ID', scope.deviceId);
  values.set('clic_sync_auth_status', 'AUTHENTICATED');
  values.set('clic_sync_last_auth_error', 'DEVICE_SUPERSEDED');
  return { current, values };
};
const fiscalRenewalPorts = (current: ReturnType<typeof credentials>, json: () => unknown) => ({
  target: () => ({ kind: 'ERP_ACTIVE', baseUrl: base, terminalId: canonicalTerminal }),
  credentials: () => current,
  fetchImpl: async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get('X-Device-Token'), current.deviceToken);
    return new Response(JSON.stringify(json()), { status: 200 });
  },
});

test('fiscal renewal reconciles a stale legacy marker after same-device ERP proof', async () => {
  const { renewFiscalTerminalSession } = await import('../services/sync/TerminalSessionRenewal');
  const { current, values } = installStaleAuth();
  let native = '';
  setTerminalCredentialNativeWriterForTests(async value => { native = value; });
  const result = await renewFiscalTerminalSession(fiscalRenewalPorts(current, () => authResponse));
  assert.deepEqual(result, { renewed: true, reason: 'AUTHORIZATION_RECOVERED', expiresAt: null });
  const stored = JSON.parse(values.get('clic_terminal_credentials_v1')!);
  assert.deepEqual(JSON.parse(native), stored);
  assert.equal(stored.authStatus, 'AUTHENTICATED');
  assert.equal(stored.lastAuthError, null);
  assert.equal(values.has('clic_sync_last_auth_error'), false);
  for (const key of ['deviceId', 'tenantId', 'terminalId', 'companyId', 'storeId', 'deviceToken', 'deviceTokenSource'] as const) {
    assert.equal(stored[key], current[key]);
  }
});

test('session-only renewal leaves legacy authorization markers untouched', async () => {
  const { current, values } = installStaleAuth();
  const { renewTerminalSession } = await import('../services/sync/TerminalSessionRenewal');
  assert.equal((await renewTerminalSession(fiscalRenewalPorts(current, () => authResponse))).reason, 'OK');
  assert.equal(JSON.parse(values.get('clic_terminal_credentials_v1')!).lastAuthError, 'DEVICE_SUPERSEDED');
  assert.equal(values.get('clic_sync_last_auth_error'), 'DEVICE_SUPERSEDED');
});

test('fiscal recovery rejects changed, missing or contradictory ERP identity', async () => {
  const { renewFiscalTerminalSession } = await import('../services/sync/TerminalSessionRenewal');
  for (const proof of [
    { ...authResponse, deviceId: 'other-device' },
    { ...authResponse, tenantId: 'other-tenant' },
    { ...authResponse, terminalId: undefined },
    { ...authResponse, terminal_id: '00000000-0000-4000-8000-000000000002' },
  ]) {
    const { current, values } = installStaleAuth();
    const result = await renewFiscalTerminalSession(fiscalRenewalPorts(current, () => proof));
    assert.equal(result.reason, 'SYNC_AUTH_RECOVERY_SCOPE_MISMATCH');
    assert.deepEqual(JSON.parse(values.get('clic_terminal_credentials_v1')!), current);
    assert.equal(values.get('clic_sync_last_auth_error'), 'DEVICE_SUPERSEDED');
  }
});

test('fiscal recovery preserves structured takeover and fiscal revocation blockers', async () => {
  const { renewFiscalTerminalSession } = await import('../services/sync/TerminalSessionRenewal');
  for (const [key, value, expected] of [
    ['clic_terminal_authorization_block', '{}', 'SYNC_AUTH_TAKEOVER_BLOCKED'],
    ['clic_sync_auth_status', 'REVOKED', 'SYNC_AUTH_REVOCATION_REQUIRES_REVIEW'],
    ['clic_terminal_auth_envelope_projection_v1', '1', 'SYNC_AUTH_BINDING_PROJECTION_REQUIRED'],
    ['clic_sync_last_auth_error', 'FISCAL_OFFLINE_LEASE_REVOKED', 'SYNC_AUTH_STALE_STATE_UNSAFE'],
  ]) {
    const { current, values } = installStaleAuth();
    values.set(key, value);
    const result = await renewFiscalTerminalSession(fiscalRenewalPorts(current, () => assert.fail('should not contact ERP')));
    assert.equal(result.reason, expected);
    assert.equal(values.get(key), value);
    assert.deepEqual(JSON.parse(values.get('clic_terminal_credentials_v1')!), current);
  }
});

test('fiscal recovery leaves a concurrently received takeover in force', async () => {
  const { renewFiscalTerminalSession } = await import('../services/sync/TerminalSessionRenewal');
  const { current, values } = installStaleAuth();
  setTerminalCredentialNativeWriterForTests(async () => { assert.fail('concurrent block must stop the write'); });
  const result = await renewFiscalTerminalSession(fiscalRenewalPorts(current, () => {
    values.set('clic_terminal_authorization_block', '{}');
    return authResponse;
  }));
  assert.equal(result.reason, 'SYNC_AUTH_SESSION_CHANGED');
  assert.equal(values.get('clic_terminal_authorization_block'), '{}');
  assert.equal(values.get('clic_sync_last_auth_error'), 'DEVICE_SUPERSEDED');
  assert.deepEqual(JSON.parse(values.get('clic_terminal_credentials_v1')!), current);
});

test('fiscal recovery cannot use credentials after the POS target changes', async () => {
  const { renewFiscalTerminalSession } = await import('../services/sync/TerminalSessionRenewal');
  const { current, values } = installStaleAuth();
  let erpBase = base;
  const ports = fiscalRenewalPorts(current, () => {
    erpBase = 'https://different.example.invalid/api/sync';
    return authResponse;
  });
  ports.target = () => ({ kind: 'ERP_ACTIVE', baseUrl: erpBase, terminalId: canonicalTerminal });
  const result = await renewFiscalTerminalSession(ports);
  assert.equal(result.reason, 'SYNC_AUTH_SESSION_CHANGED');
  assert.deepEqual(JSON.parse(values.get('clic_terminal_credentials_v1')!), current);
});

test('fiscal recovery restores native credentials when takeover arrives during the write', async () => {
  const { renewFiscalTerminalSession } = await import('../services/sync/TerminalSessionRenewal');
  const { current, values } = installStaleAuth();
  const originalNative = JSON.stringify({ ...current, nativeMetadata: 'untouched' });
  let native = originalNative;
  let writes = 0;
  setTerminalCredentialNativeReaderForTests(async () => native);
  setTerminalCredentialNativeWriterForTests(async value => {
    native = value;
    if (++writes === 1) values.set('clic_terminal_authorization_block', '{}');
  });
  const result = await renewFiscalTerminalSession(fiscalRenewalPorts(current, () => authResponse));
  assert.equal(result.reason, 'SYNC_AUTH_SESSION_CHANGED');
  assert.equal(values.get('clic_terminal_authorization_block'), '{}');
  assert.equal(values.get('clic_sync_last_auth_error'), 'DEVICE_SUPERSEDED');
  assert.deepEqual(JSON.parse(values.get('clic_terminal_credentials_v1')!), current);
  assert.equal(writes, 2);
  assert.equal(native, originalNative);
});
