import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

class MemoryStorage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

const localStorage = new MemoryStorage();
Object.assign(globalThis, {
  localStorage,
  window: {
    location: { protocol: 'https:' },
    localStorage,
  },
});

const { checkLicenseStatus } = await import('../utils/licenseGuard');

const tenantId = '9eda7d73-76e4-4432-ad13-4934fefe8f69';
const deviceId = 'DEV-LICENSE-QA';
const cacheKey = 'clic:license:last-success';

const resetRuntime = () => {
  localStorage.clear();
  localStorage.setItem('CLIC_ERP_BASE_URL', 'https://erp.example.test');
  localStorage.setItem('clic_tenant_id', tenantId);
  localStorage.setItem('active_terminal_id', 'terminal-license-qa');
};

const cachedLicense = (overrides: Record<string, unknown> = {}) => ({
  tenantId,
  branchId: 'branch-license-qa',
  licensed: true,
  reason: null,
  checkedAt: new Date().toISOString(),
  lastSuccessfulAt: new Date().toISOString(),
  expiresAt: null,
  source: 'erp-cloud',
  inGracePeriod: false,
  cloudReachable: true,
  ...overrides,
});

test('consulta la licencia sin cookies y conserva una suspensión explícita', async () => {
  resetRuntime();
  let requestCredentials: RequestCredentials | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestCredentials = init?.credentials;
    return Response.json(cachedLicense({
      licensed: false,
      reason: 'SUSPENDED',
    }));
  }) as typeof fetch;

  const result = await checkLicenseStatus(tenantId, deviceId);

  assert.equal(requestCredentials, 'omit');
  assert.equal(result.isValid, false);
  assert.equal(result.reason, 'SUSPENDED');
});

test('una licencia activa reciente obtiene únicamente la gracia configurada ante una falla temporal', async () => {
  resetRuntime();
  localStorage.setItem(cacheKey, JSON.stringify(cachedLicense()));
  globalThis.fetch = (async () => {
    throw new Error('temporary network failure');
  }) as typeof fetch;

  const result = await checkLicenseStatus(tenantId, deviceId);

  assert.equal(result.isValid, true);
  assert.equal(result.inGracePeriod, true);
  assert.equal(result.cloudReachable, false);
});

test('una suspensión cacheada nunca se convierte en gracia offline', async () => {
  resetRuntime();
  localStorage.setItem(cacheKey, JSON.stringify(cachedLicense({
    licensed: false,
    reason: 'SUSPENDED',
  })));
  globalThis.fetch = (async () => {
    throw new Error('network unavailable');
  }) as typeof fetch;

  const result = await checkLicenseStatus(tenantId, deviceId);

  assert.equal(result.isValid, false);
  assert.equal(result.reason, 'SUSPENDED');
  assert.equal(result.inGracePeriod, false);
});

test('sin una licencia activa reciente la falla de red bloquea en vez de autorizar indefinidamente', async () => {
  resetRuntime();
  globalThis.fetch = (async () => {
    throw new Error('network unavailable');
  }) as typeof fetch;

  const result = await checkLicenseStatus(tenantId, deviceId);

  assert.equal(result.isValid, false);
  assert.match(result.reason || '', /No se pudo validar la licencia/);
  assert.equal(result.inGracePeriod, false);
});

test('el contrato App separa licencia suspendida de dispositivo reemplazado', () => {
  const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

  assert.match(source, /if \(!res\.isValid\) \{\s*triggerLockdown\(res\.reason \|\| fallbackMessage\);/);
  assert.match(source, /if \(!license\.isValid\) \{\s*triggerLockdown\(license\.reason \|\| 'Servicio Suspendido\.'\);/);
  assert.match(source, /if \(blockingMessage === DEVICE_SUPERSEDED_MESSAGE\) \{\s*await triggerLockdownAfterAuthorizationCheck/);
  assert.doesNotMatch(source, /triggerLockdownAfterAuthorizationCheck\(license\.reason/);
  assert.doesNotMatch(source, /triggerLockdownAfterAuthorizationCheck\(res\.reason/);
});
