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
const {
  bindTerminalFromErp,
  SetupDeviceAuthorizationError,
  SetupErpRequestError,
} = await import('../services/setup/erpTerminalSetup');
const { readTerminalCredentialsSync } = await import('../services/sync/TerminalCredentialStore');

const ERP_UUID = '461837f1-67d1-4ce6-b394-bf9e7b79dc8c';
const ERP_TENANT_ID = '54c8df05-d28c-40ea-9ad4-38f37412acac';
const CLOUD_TENANT_ID = 'c1e7daab-4845-4161-9a98-e8061328f209';
const NEW_DEVICE_ID = 'DEV-R9CUIS87';
const OLD_DEVICE_ID = 'DEV-JJP90FCP';

type RequestRecord = {
  path: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

const normalizeHeaders = (headers: HeadersInit | undefined): Record<string, string> => {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
};

const normalizeBody = (body: BodyInit | null | undefined): Record<string, unknown> => {
  if (!body) return {};
  if (typeof body === 'string') return JSON.parse(body);
  return body as unknown as Record<string, unknown>;
};

const installErpMock = (options: {
  authorizedDeviceId?: string;
  takeoverError?: { status: number; code: string; message: string };
  registerUnauthorized?: boolean;
} = {}) => {
  const requests: RequestRecord[] = [];
  const authorizedDeviceId = options.authorizedDeviceId ?? OLD_DEVICE_ID;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = String(init?.method || 'GET').toUpperCase();
    const record: RequestRecord = {
      path: url.pathname,
      method,
      headers: normalizeHeaders(init?.headers),
      body: normalizeBody(init?.body),
    };
    requests.push(record);

    if (url.pathname === '/api/sync/bootstrap/check') {
      return Response.json({
        status: 'success',
        tenant: { id: ERP_TENANT_ID, name: 'Restaurante POS' },
        company: { id: 'company-1' },
        store: { id: 'store-1' },
      });
    }
    if (url.pathname === '/api/sync/tenants') {
      return Response.json({ tenants: [] });
    }
    if (url.pathname === '/api/sync/terminals' && method === 'GET') {
      return Response.json({
        terminals: [{
          id: ERP_UUID,
          terminal_code: 'POS-001',
          name: 'Mast-01',
          device_id: authorizedDeviceId,
          company_id: 'company-1',
          store_id: 'store-1',
          currency_code: 'DOP',
        }],
      });
    }
    if (url.pathname === '/api/sync/bootstrap/terminal-profile' && method === 'GET') {
      return Response.json({
        profile: {
          currency_code: 'DOP',
          metadata: { bound_device_id: authorizedDeviceId },
        },
      });
    }
    if (url.pathname === `/api/sync/terminals/${ERP_UUID}/takeover`) {
      if (options.takeoverError) {
        return Response.json({
          code: options.takeoverError.code,
          message: options.takeoverError.message,
        }, { status: options.takeoverError.status });
      }
      return Response.json({
        status: 'success',
        terminal_id: ERP_UUID,
        previous_device_id: authorizedDeviceId,
        auth: {
          device_token: 'rotated-device-token',
          sync_token: 'rotated-sync-token',
        },
      });
    }
    if (url.pathname === '/api/sync/terminals/register') {
      if (options.registerUnauthorized) {
        return Response.json({
          code: 'DEVICE_NOT_AUTHORIZED',
          message: 'Terminal ocupada en otro equipo',
          terminal_id: ERP_UUID,
          current_device_id: authorizedDeviceId,
        }, { status: 403 });
      }
      return Response.json({
        status: 'success',
        terminal: { id: ERP_UUID, device_id: NEW_DEVICE_ID, name: 'Mast-01' },
      });
    }
    if (url.pathname === '/api/sync/bootstrap/terminal-profile' && method === 'POST') {
      return Response.json({ profile: { currency_code: 'DOP' } });
    }
    if (url.pathname === `/api/sync/terminals/${ERP_UUID}/recovery-state`) {
      return Response.json({ recovery_state: { terminal_id: ERP_UUID, last_global_sequence: 12 } });
    }
    throw new Error(`Unexpected ERP request: ${method} ${url.pathname}`);
  }) as typeof fetch;

  return requests;
};

const bind = (options: {
  forceTransfer: boolean;
  bindingMode?: 'MASTER' | 'SLAVE';
  posDeviceId?: string;
  deviceName?: string;
}) => bindTerminalFromErp({
  currentConfig: getInitialConfig('Restaurante' as any),
  posDeviceId: options.posDeviceId || NEW_DEVICE_ID,
  deviceName: options.deviceName,
  terminalId: ERP_UUID,
  erpTerminalId: ERP_UUID,
  bindingMode: options.bindingMode || 'MASTER',
  forceTransfer: options.forceTransfer,
  tenantId: CLOUD_TENANT_ID,
  tenantSlug: 'restaurante-pos',
  erpBaseUrl: 'https://erp.test',
});

test('MASTER ERP directo ejecuta takeover canónico una vez antes de register y queda vinculado', async () => {
  storage.clear();
  const requests = installErpMock();

  const result = await bind({ forceTransfer: true, deviceName: 'Tablet QA' });
  const takeoverRequests = requests.filter(({ path }) => path.endsWith('/takeover'));
  const registerRequests = requests.filter(({ path }) => path === '/api/sync/terminals/register');
  assert.equal(takeoverRequests.length, 1);
  assert.equal(registerRequests.length, 1);
  assert.ok(requests.indexOf(takeoverRequests[0]) < requests.indexOf(registerRequests[0]));

  const takeover = takeoverRequests[0];
  assert.equal(takeover.path, `/api/sync/terminals/${ERP_UUID}/takeover`);
  assert.equal(takeover.body.terminal_id, ERP_UUID);
  assert.notEqual(takeover.body.terminal_id, 'POS-001');
  assert.equal(takeover.body.device_id, NEW_DEVICE_ID);
  assert.equal(takeover.body.device_name, 'Tablet QA');
  assert.equal(takeover.body.tenant_id, ERP_TENANT_ID);
  assert.equal(takeover.body.cloud_admin_tenant_id, CLOUD_TENANT_ID);
  assert.equal(takeover.body.reason, 'CLIC_POS_ANDROID_DIRECT_REAUTHORIZATION');
  assert.equal(takeover.body.requested_by, 'clic-pos-android-setup');
  assert.equal(takeover.body.takeover, true);
  assert.equal(takeover.body.rotate_device_token, true);
  assert.equal(takeover.headers['X-Device-Id'], NEW_DEVICE_ID);
  assert.equal(takeover.headers['X-POS-Device-Id'], NEW_DEVICE_ID);

  assert.equal(result.success, true);
  assert.equal(result.transferred, true);
  assert.equal(result.terminal_id, ERP_UUID);
  assert.equal(result.previous_device_id, OLD_DEVICE_ID);
  assert.equal(result.deviceToken, 'rotated-device-token');
  assert.equal(result.syncToken, 'rotated-sync-token');
  assert.equal(result.recovery_state?.last_global_sequence, 12);

  const credentials = readTerminalCredentialsSync();
  assert.equal(credentials.erpTerminalId, ERP_UUID);
  assert.equal(credentials.terminalCode, 'POS-001');
  assert.equal(credentials.deviceId, NEW_DEVICE_ID);
  assert.equal(credentials.deviceToken, 'rotated-device-token');
  assert.equal(credentials.syncToken, 'rotated-sync-token');
});

test('forceTransfer=false no llama takeover y conserva DEVICE_NOT_AUTHORIZED', async () => {
  storage.clear();
  const requests = installErpMock({ registerUnauthorized: true });

  await assert.rejects(
    bind({ forceTransfer: false }),
    (error: unknown) => {
      assert.ok(error instanceof SetupDeviceAuthorizationError);
      assert.equal(error.code, 'DEVICE_NOT_AUTHORIZED');
      assert.equal(error.httpStatus, 403);
      assert.match(error.message, /Terminal ocupada en otro equipo/);
      return true;
    },
  );
  assert.equal(requests.filter(({ path }) => path.endsWith('/takeover')).length, 0);
});

test('no ejecuta takeover cuando el dispositivo ya es el autorizado', async () => {
  storage.clear();
  const requests = installErpMock({ authorizedDeviceId: NEW_DEVICE_ID });

  const result = await bind({ forceTransfer: true });
  assert.equal(result.success, true);
  assert.equal(result.transferred, false);
  assert.equal(requests.filter(({ path }) => path.endsWith('/takeover')).length, 0);
});

test('error de takeover conserva HTTP, código backend y mensaje y no llama register', async () => {
  storage.clear();
  const requests = installErpMock({
    takeoverError: { status: 422, code: 'TAKEOVER_POLICY_DENIED', message: 'La política bloqueó el takeover' },
  });

  await assert.rejects(
    bind({ forceTransfer: true }),
    (error: unknown) => {
      assert.ok(error instanceof SetupErpRequestError);
      assert.equal(error.httpStatus, 422);
      assert.equal(error.code, 'TAKEOVER_POLICY_DENIED');
      assert.match(error.message, /La política bloqueó el takeover/);
      return true;
    },
  );
  assert.equal(requests.filter(({ path }) => path.endsWith('/takeover')).length, 1);
  assert.equal(requests.filter(({ path }) => path === '/api/sync/terminals/register').length, 0);
});

test('SLAVE no llama takeover ERP aunque forceTransfer sea true', async () => {
  storage.clear();
  const requests = installErpMock({ registerUnauthorized: true });

  await assert.rejects(bind({ forceTransfer: true, bindingMode: 'SLAVE' }), SetupDeviceAuthorizationError);
  assert.equal(requests.filter(({ path }) => path.endsWith('/takeover')).length, 0);
});
