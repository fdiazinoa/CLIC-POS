import assert from 'node:assert/strict';
import test from 'node:test';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
});

const { getInitialConfig } = await import('../constants');
const { bindTerminalFromErp, SetupDeviceAuthorizationError } = await import('../services/setup/erpTerminalSetup');
const { readTerminalCredentialsSync } = await import('../services/sync/TerminalCredentialStore');

const ERP_UUID = '461837f1-67d1-4ce6-b394-bf9e7b79dc8c';
const ERP_TENANT_ID = '54c8df05-d28c-40ea-9ad4-38f37412acac';
const CLOUD_TENANT_ID = 'c1e7daab-4845-4161-9a98-e8061328f209';
const NEW_DEVICE_ID = 'DEV-R9CUIS87';
const OLD_DEVICE_ID = 'DEV-JJP90FCP';

type RequestRecord = { path: string; method: string; body: Record<string, unknown> };
const normalizeBody = (body: BodyInit | null | undefined): Record<string, unknown> => {
  if (!body) return {};
  return typeof body === 'string' ? JSON.parse(body) : body as unknown as Record<string, unknown>;
};

const installErpMock = (options: {
  occupiedDeviceId?: string | null;
  authorization?: 'AUTHORIZED' | 'PENDING' | 'SUPERSEDED';
} = {}) => {
  const requests: RequestRecord[] = [];
  const occupiedDeviceId = options.occupiedDeviceId === undefined ? OLD_DEVICE_ID : options.occupiedDeviceId;
  const authorization = options.authorization || 'SUPERSEDED';

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = normalizeBody(init?.body);
    const method = String(init?.method || 'GET').toUpperCase();
    requests.push({ path: url.pathname, method, body });

    if (url.pathname === '/api/sync/bootstrap/check') {
      if (!body.terminal_id) {
        return Response.json({
          status: 'success',
          tenant: { id: ERP_TENANT_ID, name: 'Restaurante POS' },
          company: { id: 'company-1' },
          store: { id: 'store-1' },
        });
      }
      if (authorization === 'SUPERSEDED') {
        return Response.json({
          status: 'error',
          code: 'DEVICE_SUPERSEDED',
          message: 'Este equipo ya no está autorizado para esta terminal.',
          terminal_id: ERP_UUID,
          request_device_id: NEW_DEVICE_ID,
          authorized_device_id: OLD_DEVICE_ID,
          requires_reauth: true,
        }, { status: 403 });
      }
      return Response.json({
        status: 'success',
        terminal_id: ERP_UUID,
        device_authorized: authorization === 'AUTHORIZED',
        requires_reauth: authorization !== 'AUTHORIZED',
        authorized_device_id: authorization === 'AUTHORIZED' ? NEW_DEVICE_ID : OLD_DEVICE_ID,
      });
    }
    if (url.pathname === '/api/sync/tenants') return Response.json({ tenants: [] });
    if (url.pathname === '/api/sync/terminals' && method === 'GET') {
      return Response.json({ terminals: [{
        id: ERP_UUID,
        terminal_code: 'POS-001',
        name: 'Mast-01',
        device_id: occupiedDeviceId,
        company_id: 'company-1',
        store_id: 'store-1',
        currency_code: 'DOP',
      }] });
    }
    if (url.pathname === '/api/sync/bootstrap/terminal-profile' && method === 'GET') {
      return Response.json({ profile: { currency_code: 'DOP', metadata: { bound_device_id: occupiedDeviceId } } });
    }
    if (url.pathname === '/api/sync/terminals/register') {
      return Response.json({
        status: 'success',
        terminal: { id: ERP_UUID, device_id: NEW_DEVICE_ID, name: 'Mast-01' },
        auth: { device_token: 'fresh-device-token', sync_token: 'fresh-sync-token' },
      });
    }
    if (url.pathname === '/api/sync/bootstrap/terminal-profile' && method === 'POST') {
      return Response.json({ profile: { currency_code: 'DOP' } });
    }
    throw new Error(`Unexpected ERP request: ${method} ${url.pathname}`);
  }) as typeof fetch;

  return requests;
};

const bind = (forceTransfer = true) => bindTerminalFromErp({
  currentConfig: getInitialConfig('Restaurante' as any),
  posDeviceId: NEW_DEVICE_ID,
  terminalId: ERP_UUID,
  erpTerminalId: ERP_UUID,
  bindingMode: 'MASTER',
  forceTransfer,
  tenantId: CLOUD_TENANT_ID,
  tenantSlug: 'restaurante-pos',
  erpBaseUrl: 'https://erp.test',
});

test('DEVICE_SUPERSEDED queda bloqueado sin bind administrativo, takeover ni register', async () => {
  storage.clear();
  storage.set('CLIC_POS_DEVICE_TOKEN', 'old-device-token');
  storage.set('clic_erp_sync_token', 'old-sync-token');
  const requests = installErpMock({ authorization: 'SUPERSEDED' });

  await assert.rejects(bind(true), (error: unknown) => {
    assert.ok(error instanceof SetupDeviceAuthorizationError);
    assert.equal(error.code, 'DEVICE_SUPERSEDED');
    assert.equal(error.currentDeviceId, OLD_DEVICE_ID);
    return true;
  });

  assert.equal(requests.some(({ path }) => path === '/api/setup/bind-terminal'), false);
  assert.equal(requests.some(({ path }) => path.endsWith('/takeover')), false);
  assert.equal(requests.some(({ path }) => path === '/api/sync/terminals/register'), false);
  const check = requests.find(({ path, body }) => path === '/api/sync/bootstrap/check' && body.terminal_id);
  assert.equal(check?.body.terminal_id, ERP_UUID);
  assert.equal(check?.body.erp_terminal_id, ERP_UUID);
  assert.equal(check?.body.device_id, NEW_DEVICE_ID);
});

test('un bootstrap pendiente no permite que forceTransfer haga takeover ni register', async () => {
  storage.clear();
  const requests = installErpMock({ authorization: 'PENDING' });

  await assert.rejects(bind(true), SetupDeviceAuthorizationError);
  assert.equal(requests.some(({ path }) => path.endsWith('/takeover')), false);
  assert.equal(requests.some(({ path }) => path === '/api/sync/terminals/register'), false);
});

test('después de autorización externa ejecuta register y persiste credenciales nuevas', async () => {
  storage.clear();
  storage.set('CLIC_POS_DEVICE_TOKEN', 'old-device-token');
  storage.set('clic_erp_sync_token', 'old-sync-token');
  const requests = installErpMock({ authorization: 'AUTHORIZED' });

  const result = await bind(true);
  const register = requests.find(({ path }) => path === '/api/sync/terminals/register');
  assert.ok(register);
  assert.equal(register.body.terminal_id, ERP_UUID);
  assert.equal(register.body.erp_terminal_id, ERP_UUID);
  assert.equal(register.body.device_id, NEW_DEVICE_ID);
  assert.equal(requests.some(({ path }) => path.endsWith('/takeover')), false);
  assert.equal(result.transferred, false);

  const credentials = readTerminalCredentialsSync();
  assert.equal(credentials.erpTerminalId, ERP_UUID);
  assert.equal(credentials.deviceId, NEW_DEVICE_ID);
  assert.equal(credentials.deviceToken, 'fresh-device-token');
  assert.equal(credentials.syncToken, 'fresh-sync-token');
  assert.notEqual(credentials.deviceToken, 'old-device-token');
  assert.notEqual(credentials.syncToken, 'old-sync-token');
});

test('una terminal libre puede registrarse sin inventar un takeover', async () => {
  storage.clear();
  const requests = installErpMock({ occupiedDeviceId: null, authorization: 'PENDING' });

  const result = await bind(false);
  assert.equal(result.success, true);
  assert.equal(requests.filter(({ path }) => path === '/api/sync/terminals/register').length, 1);
  assert.equal(requests.some(({ path }) => path.endsWith('/takeover')), false);
});
