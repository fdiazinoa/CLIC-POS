import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import 'fake-indexeddb/auto';

import { DEFAULT_TERMINAL_CONFIG } from '../constants';
import {
  applyFiscalProviderResult,
  DEFAULT_FISCAL_PROVIDERS,
  getEffectiveFiscalComplianceConfig,
  getExistingFiscalProviderReference,
  getFiscalProviderConfig,
  normalizeFiscalProviderId,
} from '../utils/fiscal/fiscalHelpers';
import {
  applyTerminalConfigSnapshot,
  sanitizeFiscalConfigSecrets,
  sanitizeTerminalSnapshotFiscalSecrets,
} from '../utils/terminalConfigSnapshot';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
};

const localStorageMock = memoryStorage();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorageMock });
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    localStorage: localStorageMock,
    location: {
      origin: 'https://pos.example.test',
      protocol: 'https:',
      hostname: 'pos.example.test',
    },
    setTimeout,
    clearTimeout,
  },
});

const buildBusinessConfig = () => ({
  companyInfo: { name: 'Comercio QA', rnc: '101010101' },
  fiscalCompliance: {
    mode: 'ECF',
    defaultProvider: 'NONE',
    allowLegacyFallback: false,
    providers: [],
  },
  terminals: [{
    id: 'terminal-mseller',
    name: 'Caja MSeller',
    config: {
      ...structuredClone(DEFAULT_TERMINAL_CONFIG),
      fiscal: {
        ...structuredClone(DEFAULT_TERMINAL_CONFIG.fiscal),
        providerId: 'NONE',
        authToken: 'STALE_LOCAL_SECRET',
      },
    },
  }],
} as any);

test('normaliza MSELLER y conserva defaults delegados sin afectar proveedores existentes', () => {
  assert.equal(normalizeFiscalProviderId(' mseller '), 'MSELLER');
  assert.equal(normalizeFiscalProviderId('POLARIS'), 'POLARIS');
  assert.equal(normalizeFiscalProviderId('digifact'), 'DIGIFACT');
  assert.equal(normalizeFiscalProviderId('NONE'), 'NONE');

  const provider = DEFAULT_FISCAL_PROVIDERS.find((entry) => entry.id === 'MSELLER');
  assert.equal(provider?.displayName, 'MSeller e-CF');
  assert.equal(provider?.environment, 0);
  assert.equal(provider?.deliveryMode, 'DELEGATED_ERP');
});

test('hidrata terminalFiscalConfig de MSeller, fuerza ERP delegado y descarta secretos', () => {
  const snapshot = {
    terminal_id: 'terminal-mseller',
    fiscalMode: 'ECF',
    resolved: {
      terminalFiscalConfig: {
        providerId: 'MSELLER',
        environment: 2,
        credentialKey: 'tenant-qa/key.01',
        deliveryMode: 'LOCAL_DIRECT',
        authToken: 'TOKEN_SHOULD_NOT_PERSIST',
        access_token: 'ACCESS_SHOULD_NOT_PERSIST',
        refreshToken: 'REFRESH_SHOULD_NOT_PERSIST',
        password: 'PASSWORD_SHOULD_NOT_PERSIST',
        apiKey: 'API_KEY_SHOULD_NOT_PERSIST',
        credentials: [{ password: 'ARRAY_SECRET_SHOULD_NOT_PERSIST' }],
      },
    },
  } as any;

  const applied = applyTerminalConfigSnapshot(buildBusinessConfig(), {
    terminalId: 'terminal-mseller',
    incomingSnapshot: snapshot,
  });
  const terminal = applied.config.terminals.find((entry) => entry.id === 'terminal-mseller')!;

  assert.equal(terminal.config.fiscal.providerId, 'MSELLER');
  assert.equal(terminal.config.fiscal.environment, 2);
  assert.equal(terminal.config.fiscal.credentialKey, 'tenant-qa/key.01');
  assert.equal(terminal.config.fiscal.deliveryMode, 'DELEGATED_ERP');
  const serialized = JSON.stringify(terminal.config);
  assert.doesNotMatch(serialized, /TOKEN_SHOULD_NOT_PERSIST|ACCESS_SHOULD_NOT_PERSIST|REFRESH_SHOULD_NOT_PERSIST|PASSWORD_SHOULD_NOT_PERSIST|API_KEY_SHOULD_NOT_PERSIST|ARRAY_SECRET_SHOULD_NOT_PERSIST|STALE_LOCAL_SECRET/);

  const effective = getEffectiveFiscalComplianceConfig(applied.config, terminal.config);
  assert.equal(effective.defaultProvider, 'MSELLER');
  assert.equal(getFiscalProviderConfig(effective, 'MSELLER').deliveryMode, 'DELEGATED_ERP');

  const legacySafe = sanitizeTerminalSnapshotFiscalSecrets({
    terminal_config: {
      resolved: {
        terminal_fiscal_config: {
          provider_id: 'MSELLER',
          credential_key: 'tenant-qa/key.01',
          access_token: 'LEAK_ACCESS',
          refreshToken: 'LEAK_REFRESH',
          credentials: [{ password: 'LEAK_ARRAY' }],
        },
      },
    },
  } as any);
  assert.equal(JSON.stringify(legacySafe).includes('tenant-qa/key.01'), true);
  assert.doesNotMatch(JSON.stringify(legacySafe), /LEAK_ACCESS|LEAK_REFRESH|LEAK_ARRAY/);
  const lifecycleSource = readFileSync(new URL('../utils/erpSyncLifecycle.ts', import.meta.url), 'utf8');
  assert.match(lifecycleSource, /snapshot: sanitizeTerminalSnapshotFiscalSecrets\(/);
  assert.match(lifecycleSource, /const nextErpSnapshot = sanitizeTerminalSnapshotFiscalSecrets\(/);
  assert.match(lifecycleSource, /fiscal: sanitizeFiscalConfigSecrets\(resolvedConfig\.fiscal\)/);
  assert.deepEqual(
    sanitizeFiscalConfigSecrets({
      providerId: 'MSELLER',
      credentialKey: 'tenant-qa/key.01',
      authToken: 'LEGACY_TOKEN',
      access_token: 'LEGACY_ACCESS',
    } as any),
    { providerId: 'MSELLER', credentialKey: 'tenant-qa/key.01' }
  );
});

test('normaliza y persiste la respuesta fiscal completa de MSeller', async () => {
  const { normalizeFiscalProviderResponse } = await import('../services/fiscal/fiscalService');
  const normalized = normalizeFiscalProviderResponse({
    success: true,
    providerId: 'MSELLER',
    environment: 0,
    documentCode: 'E31',
    providerTransactionId: 'E310000000001',
    providerReference: 'TRACK-001',
    eNCF: 'E310000000001',
    status: 'RECIBIDO',
    message: 'Recibido por MSeller',
    pending: true,
    diagnostics: {
      qrUrl: 'https://qr.example.test/1',
      securityCode: 'SEC-001',
    },
  });
  const transaction = applyFiscalProviderResult({
    id: 'sale-1',
    date: new Date().toISOString(),
    items: [],
    total: 0,
    payments: [],
    userId: 'u1',
    userName: 'QA',
    status: 'COMPLETED',
  } as any, normalized);

  assert.equal(normalized.pending, true);
  assert.equal(transaction.fiscalCertifiedNcf, 'E310000000001');
  assert.equal(transaction.fiscalReferenceId, 'E310000000001');
  assert.equal(transaction.fiscalProviderStatus, 'RECIBIDO');
  assert.equal(transaction.fiscalQrUrl, 'https://qr.example.test/1');
  assert.equal(transaction.fiscalSecurityCode, 'SEC-001');
  assert.equal(transaction.fiscalResponseMessage, 'Recibido por MSeller');

  const rejected = normalizeFiscalProviderResponse({
    success: true,
    providerId: 'MSELLER',
    environment: 0,
    providerTransactionId: 'E310000000002',
    status: 'RECHAZADO',
    message: 'Documento no enviado por validación',
    pending: false,
  });
  assert.equal(rejected.pending, false);
  assert.equal(rejected.success, false);

  const failedWhileProcessing = normalizeFiscalProviderResponse({
    success: false,
    providerId: 'MSELLER',
    environment: 0,
    providerTransactionId: 'E310000000003',
    status: 'ERROR',
    message: 'Error procesando documento',
    pending: false,
  });
  assert.equal(failedWhileProcessing.pending, false);
  assert.equal(failedWhileProcessing.success, false);
});

test('emite E31/E32/E34 exclusivamente al ERP y nunca envía credenciales MSeller', async (t) => {
  const { issueFiscalDocument } = await import('../services/fiscal/fiscalService');
  localStorageMock.clear();
  localStorageMock.setItem('CLIC_ERP_BASE_URL', 'https://erp.example.test');
  const originalFetch = globalThis.fetch;

  try {
    for (const documentCode of ['E31', 'E32', 'E34'] as const) {
      await t.test(documentCode, async () => {
        let requestUrl = '';
        let requestBody = '';
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          requestUrl = String(input);
          requestBody = String(init?.body || '');
          return Response.json({
            success: true,
            providerId: 'MSELLER',
            environment: 1,
            documentCode,
            providerTransactionId: `${documentCode}0000000001`,
            eNCF: `${documentCode}0000000001`,
            status: 'RECIBIDO',
            message: 'Pendiente DGII',
            pending: true,
          });
        }) as typeof fetch;

        const result = await issueFiscalDocument({
          providerId: 'MSELLER',
          environment: 1,
          companyInfo: { name: 'Comercio QA', rnc: '101010101', phone: '', address: 'Santo Domingo' },
          transaction: {
            id: `sale-${documentCode}`,
            date: new Date().toISOString(),
            items: [{ id: 'p1', name: 'Producto', quantity: 1, price: 118 }],
            total: 118,
            payments: [],
            userId: 'u1',
            userName: 'QA',
            status: 'COMPLETED',
            ncfType: documentCode,
            electronicNcf: `${documentCode}0000000001`,
          } as any,
          credentialKey: 'MSELLERQA001',
          deliveryMode: 'LOCAL_DIRECT',
          apiBaseUrl: 'https://ecf.api.mseller.app',
        });

        assert.equal(requestUrl, 'https://erp.example.test/api/fiscal/documents/issue');
        assert.doesNotMatch(requestUrl, /mseller\.app|127\.0\.0\.1|10\.0\.2\.2/);
        const parsedBody = JSON.parse(requestBody);
        assert.equal(parsedBody.authToken, undefined);
        assert.equal(parsedBody.options.apiBaseUrl, undefined);
        assert.equal(parsedBody.options.testUrl, undefined);
        assert.equal(parsedBody.options.issueUrl, undefined);
        assert.equal(parsedBody.options.statusUrl, undefined);
        assert.equal(parsedBody.options.deliveryMode, 'DELEGATED_ERP');
        assert.doesNotMatch(requestBody, /apiKey|password|ecf\.api\.mseller\.app/i);
        assert.match(requestBody, /"providerId":"MSELLER"/);
        assert.match(requestBody, /"credentialKey":"MSELLERQA001"/);
        assert.equal(result.pending, true);
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('consulta estado por ERP y conserva pending desde raw o estados asíncronos', async () => {
  const { getFiscalDocumentStatus } = await import('../services/fiscal/fiscalService');
  localStorageMock.clear();
  localStorageMock.setItem('CLIC_ERP_BASE_URL', 'https://erp.example.test');
  const originalFetch = globalThis.fetch;
  let requestUrl = '';
  let requestHeaders: HeadersInit | undefined;

  try {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(input);
      requestHeaders = init?.headers;
      return Response.json({
        success: true,
        providerId: 'MSELLER',
        environment: 0,
        providerTransactionId: 'E310000000001',
        status: 'RECIBIDO',
        message: 'Documento recibido',
        raw: { pending: true, securityCode: 'SEC-002', qr_url: 'https://qr.example.test/2' },
      });
    }) as typeof fetch;

    const result = await getFiscalDocumentStatus(
      'MSELLER',
      0,
      'E310000000001',
      { name: 'Comercio QA', rnc: '101010101', phone: '', address: 'Santo Domingo' },
      'MSELLERQA001',
      'LOCAL_DIRECT'
    );

    assert.match(requestUrl, /^https:\/\/erp\.example\.test\/api\/fiscal\/documents\/status\?/);
    assert.doesNotMatch(requestUrl, /mseller\.app|127\.0\.0\.1/);
    assert.equal(requestHeaders, undefined);
    assert.equal(result.pending, true);
    assert.equal(result.securityCode, 'SEC-002');
    assert.equal(result.qrUrl, 'https://qr.example.test/2');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('dos emisiones concurrentes de la misma venta comparten un solo POST', async () => {
  const { issueFiscalDocument } = await import('../services/fiscal/fiscalService');
  localStorageMock.clear();
  localStorageMock.setItem('CLIC_ERP_BASE_URL', 'https://erp.example.test');
  const originalFetch = globalThis.fetch;
  let postCount = 0;

  try {
    globalThis.fetch = (async () => {
      postCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json({
        success: true,
        providerId: 'MSELLER',
        environment: 0,
        documentCode: 'E31',
        providerTransactionId: 'E310000000077',
        eNCF: 'E310000000077',
        status: 'RECIBIDO',
        message: 'Pendiente DGII',
        pending: true,
      });
    }) as typeof fetch;
    const input = {
      providerId: 'MSELLER' as const,
      environment: 0,
      companyInfo: { name: 'Comercio QA', rnc: '101010101', phone: '', address: 'Santo Domingo' },
      transaction: {
        id: 'sale-concurrent',
        date: new Date().toISOString(),
        items: [{ id: 'p1', name: 'Producto', quantity: 1, price: 118 }],
        total: 118,
        payments: [],
        userId: 'u1',
        userName: 'QA',
        status: 'COMPLETED' as const,
        ncfType: 'E31' as const,
        electronicNcf: 'E310000000077',
      },
      deliveryMode: 'DELEGATED_ERP' as const,
    } as any;

    const [first, second] = await Promise.all([
      issueFiscalDocument(input),
      issueFiscalDocument(input),
    ]);
    assert.equal(postCount, 1);
    assert.equal(first.providerTransactionId, second.providerTransactionId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sin ERP configurado, MSeller queda sin ruta y nunca cae al backend fiscal local', async () => {
  const { issueFiscalDocument } = await import('../services/fiscal/fiscalService');
  localStorageMock.clear();
  localStorageMock.setItem('CLIC_POS_FISCAL_BASE_URL', 'https://local-fiscal.example.test');
  localStorageMock.setItem('CLIC_POS_MASTER_URL', 'https://master-lan.example.test');
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  try {
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return Response.json({ success: false });
    }) as typeof fetch;

    await assert.rejects(issueFiscalDocument({
      providerId: 'MSELLER',
      environment: 0,
      companyInfo: { name: 'Comercio QA', rnc: '101010101', phone: '', address: 'Santo Domingo' },
      transaction: {
        id: 'sale-offline',
        date: new Date().toISOString(),
        items: [{ id: 'p1', name: 'Producto', quantity: 1, price: 118 }],
        total: 118,
        payments: [],
        userId: 'u1',
        userName: 'QA',
        status: 'COMPLETED',
        ncfType: 'E31',
        electronicNcf: 'E310000000099',
      } as any,
      deliveryMode: 'DELEGATED_ERP',
    }), /No se pudo contactar el backend fiscal/);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('protege reintentos con referencia o e-NCF certificado y bloquea credenciales locales', async () => {
  assert.equal(getExistingFiscalProviderReference({ fiscalSyncStatus: 'ERROR', fiscalReferenceId: 'TRACK-ERROR' }), 'TRACK-ERROR');
  assert.equal(getExistingFiscalProviderReference({ fiscalSyncStatus: 'ERROR', fiscalCertifiedNcf: 'E310000000009' }), 'E310000000009');

  const { saveLocalFiscalCredential, saveSupabaseFiscalCredential } = await import('../services/fiscal/fiscalService');
  await assert.rejects(
    saveLocalFiscalCredential('MSELLER', 'FAKE_SECRET'),
    /exclusivamente en el ERP/
  );
  await assert.rejects(
    saveSupabaseFiscalCredential('MSELLER', 'FAKE_SECRET'),
    /exclusivamente en el ERP/
  );

  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(appSource, /const existingReference = getExistingFiscalProviderReference\(transaction\);/);
  assert.match(appSource, /if \(existingReference\) \{\s*await pollFiscalDocumentStatus\(/);
  assert.match(appSource, /fiscalReferenceId: undefined,\s*fiscalCertifiedNcf: undefined,\s*fiscalProviderStatus: undefined,\s*fiscalQrUrl: undefined,\s*fiscalSecurityCode: undefined,/);
});
