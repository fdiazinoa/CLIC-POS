import assert from 'node:assert/strict';
import test from 'node:test';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)),
    removeItem: (key: string) => storage.delete(key),
  },
});

const { getInitialConfig, DEFAULT_TERMINAL_CONFIG } = await import('../constants');
const {
  materializeErpTerminalCards,
  prioritizeMappedErpTenantContext,
} = await import('../services/setup/erpTerminalSetup');

test('new ERP terminal uses its own preference defaults while existing terminal retains policy and counter', () => {
  const currentConfig = structuredClone(getInitialConfig('Supermercado' as any));
  currentConfig.terminals = [currentConfig.terminals[0]];
  const existing = currentConfig.terminals[0];
  existing.config.erpTerminalId = 'ERP-A';
  existing.config.ux.showProductImages = false;
  existing.config.ux.viewMode = 'RETAIL';
  existing.config.startWithAgenda = true;
  existing.config.operational.expandTicket = true;
  existing.config.operational.showGlobalSales = true;
  existing.config.operational.orderNumbers = { enabled: true, nextNumber: 109, prefix: 'A', padding: 4 };
  existing.config.operational.reservationPolicy = { validityDays: 30, printCopies: 4, requireAdvance: true, minimumAdvancePercent: 50 };
  existing.config.security.requirePinForVoid = false;
  (existing.config.security as any).requireManagerForVoid = false;
  const before = structuredClone(existing.config);
  const cards = materializeErpTerminalCards({ currentConfig, posDeviceId: 'DEV-NEW', terminals: [
    { id: 'ERP-A', terminal_code: 'POS-A' }, { id: 'ERP-B', terminal_code: 'POS-B' },
  ] });
  const a = cards.find(card => card.erpTerminalId === 'ERP-A')!.config;
  const b = cards.find(card => card.erpTerminalId === 'ERP-B')!.config;
  assert.deepEqual(a.operational.orderNumbers, before.operational.orderNumbers);
  assert.equal(a.ux.showProductImages, false);
  assert.equal(a.security.requirePinForVoid, false);
  assert.equal(b.ux.showProductImages, true);
  assert.equal(b.ux.viewMode, 'VISUAL');
  assert.equal(b.startWithAgenda, false);
  assert.equal(b.operational.expandTicket, false);
  assert.equal(b.operational.showGlobalSales, false);
  assert.deepEqual(b.operational.orderNumbers, { enabled: false });
  assert.deepEqual(b.operational.reservationPolicy, DEFAULT_TERMINAL_CONFIG.operational.reservationPolicy);
  assert.equal(b.security.requirePinForVoid, DEFAULT_TERMINAL_CONFIG.security.requirePinForVoid);
  assert.equal((b.security as any).requireManagerForVoid, undefined);
  assert.deepEqual(b.hardware, before.hardware);
  assert.deepEqual(existing.config, before);
});

test('keeps occupied ERP terminals visible with their own operational codes', () => {
  const currentConfig = getInitialConfig('Supermercado' as any);
  currentConfig.terminals = [currentConfig.terminals[0]];
  currentConfig.terminals[0].config.stationNumber = 'POS-001';

  const terminals = materializeErpTerminalCards({
    currentConfig,
    posDeviceId: 'DEV-NEW',
    terminals: [
      {
        id: 'erp-pos-003',
        terminal_code: 'POS-003',
        name: 'Caja 003',
        device_id: 'DEV-OLD-003',
        company_name: 'MercaSend-Pruebas',
      },
      {
        id: 'erp-pos-005',
        terminal_code: 'POS-005',
        name: 'POS-005',
        device_id: '',
        company_name: 'MercaSend-Pruebas',
      },
    ],
  });

  assert.equal(terminals.length, 2);
  assert.deepEqual(terminals.map((terminal) => terminal.config.stationNumber), ['POS-003', 'POS-005']);
  assert.equal(terminals[0].occupied, true);
  assert.equal(terminals[0].currentDeviceId, 'DEV-OLD-003');
  assert.equal(terminals[0].config.currentDeviceId, 'DEV-OLD-003');
  assert.equal(terminals[0].config.erpBinding?.terminalId, 'erp-pos-003');
  assert.equal(terminals[1].occupied, false);
});

test('keeps repeated terminal codes from different companies as separate UUIDs', () => {
  const currentConfig = getInitialConfig('Supermercado' as any);
  const terminals = materializeErpTerminalCards({
    currentConfig,
    posDeviceId: 'DEV-NEW',
    terminals: [
      {
        id: 'terminal-company-a',
        company_id: 'company-a',
        company_name: 'MercaSend-Pruebas',
        store_id: 'store-a',
        store_name: 'Sucursal Principal',
        terminal_name: 'Caja 1',
        terminal_code: 'POS-001',
      },
      {
        id: 'terminal-company-b',
        company_id: 'company-b',
        company_name: 'Clic-Suites',
        store_id: 'store-b',
        store_name: 'Sucursal Principal',
        terminal_name: 'Caja 1',
        terminal_code: 'POS-001',
      },
    ],
  });

  assert.equal(terminals.length, 2);
  assert.deepEqual(terminals.map((terminal) => terminal.id), ['terminal-company-a', 'terminal-company-b']);
  assert.deepEqual(terminals.map((terminal) => terminal.companyId), ['company-a', 'company-b']);
});

test('filters archived ERP rows without hiding the active terminal with the same code', () => {
  const currentConfig = getInitialConfig('Supermercado' as any);
  const terminals = materializeErpTerminalCards({
    currentConfig,
    posDeviceId: 'DEV-NEW',
    terminals: [
      {
        id: 'active-pos-003',
        terminal_code: 'POS-003',
        name: 'Caja 003',
        device_id: 'DEV-OLD-003',
      },
      {
        id: 'archived-pos-003',
        terminal_code: 'POS-003',
        name: 'ARCHIVED-Caja 003',
        device_id: 'ARCHIVED-old',
      },
    ],
  });

  assert.equal(terminals.length, 1);
  assert.equal(terminals[0].id, 'active-pos-003');
});

test('filters an archived Mast-01 even when ERP keeps its normal display name', () => {
  const currentConfig = getInitialConfig('Restaurante' as any);
  const terminals = materializeErpTerminalCards({
    currentConfig,
    posDeviceId: 'DEV-NEW-MASTER',
    terminals: [
      {
        id: '461837f1-67d1-4ce6-b394-bf9e7b79dc8c',
        terminal_code: 'POS-001',
        terminal_name: 'Mast-01',
        status: 'ACTIVE',
      },
      {
        id: '685cb867-70b6-4f63-aed4-8bc9e706377b',
        terminal_code: 'Mast-01',
        terminal_name: 'Mast-01',
        status: 'ARCHIVED',
      },
    ],
  });

  assert.deepEqual(terminals.map(terminal => terminal.id), [
    '461837f1-67d1-4ce6-b394-bf9e7b79dc8c',
  ]);
});

test('keeps a valid Master whose display name matches another terminal code', () => {
  const currentConfig = getInitialConfig('Restaurante' as any);
  const terminals = materializeErpTerminalCards({
    currentConfig,
    posDeviceId: 'DEV-NEW-MASTER',
    terminals: [
      {
        id: 'erp-master-01',
        terminal_code: 'MASTER-01',
        name: 'Slav-01',
        device_id: '',
        active: true,
      },
      {
        id: 'erp-slave-01',
        terminal_code: 'Slav-01',
        name: 'Slav-01',
        device_id: 'DEV-SLAVE-01',
        active: true,
      },
    ],
  });

  assert.equal(terminals.length, 2);
  assert.deepEqual(terminals.map(terminal => terminal.id), ['erp-master-01', 'erp-slave-01']);
});

test('prioritizes the explicit Cloud-Admin tenant mapping over a stale device bootstrap', () => {
  const ordered = prioritizeMappedErpTenantContext(
    [{
      tenantId: 'stale-erp-tenant',
      tenantName: 'Tenant anterior',
      companyId: 'stale-company',
      storeId: 'stale-store',
      source: 'ERP_BOOTSTRAP',
    }],
    {
      tenantId: '54c8df05-d28c-40ea-9ad4-38f37412acac',
      tenantName: 'Restaurante POS',
      companyId: 'bb604e48-d3c1-4f40-bbc8-baa4bcfcdf38',
      storeId: '0074089e-a648-4e98-8294-2ca350baf33e',
      source: 'ERP_TENANT_DIRECTORY',
    }
  );

  assert.deepEqual(ordered.map(candidate => candidate.tenantId), [
    '54c8df05-d28c-40ea-9ad4-38f37412acac',
    'stale-erp-tenant',
  ]);
});

test('keeps Mast-01 and Slav-01 visible when ERP reuses POS-001 across terminal types', () => {
  const currentConfig = getInitialConfig('Restaurante' as any);
  const terminals = materializeErpTerminalCards({
    currentConfig,
    posDeviceId: 'DEV-NEW-MASTER',
    terminals: [
      {
        id: '461837f1-67d1-4ce6-b394-bf9e7b79dc8c',
        terminal_code: 'POS-001',
        terminal_name: 'Mast-01',
        name: 'Mast-01',
        device_id: 'DEV-3VNT5ZW5',
        terminal_type: 'STANDARD_POS',
        company_name: 'Restaurante POS',
      },
      {
        id: 'efdc61ae-f485-41ea-b50e-3ca4e08123e2',
        terminal_code: 'POS-001',
        terminal_name: 'Slav-01',
        name: 'Slav-01',
        device_id: 'DEV-JJP90FCP',
        terminal_type: 'ORDER_TAKER',
        master_terminal_id: '461837f1-67d1-4ce6-b394-bf9e7b79dc8c',
        device_profile: {
          form_factor: 'TABLET',
          orientation: 'AUTO',
          touch_optimized: true,
        },
        company_name: 'Restaurante POS',
      },
      {
        id: '685cb867-70b6-4f63-aed4-8bc9e706377b',
        terminal_code: 'Mast-01',
        terminal_name: 'ARCHIVED-Mast-01',
        name: 'ARCHIVED-Mast-01',
        device_id: 'ARCHIVED-685cb867-70b6-4f63-aed4-8bc9e706377b',
        terminal_type: 'STANDARD_POS',
      },
    ],
  });

  assert.equal(terminals.length, 2);
  assert.deepEqual(terminals.map(terminal => terminal.name), ['Mast-01', 'Slav-01']);
  assert.deepEqual(terminals.map(terminal => terminal.config.stationNumber), ['POS-001', 'POS-001']);
  assert.equal(terminals[0].terminalType, 'STANDARD_POS');
  assert.equal(terminals[1].terminalType, 'ORDER_TAKER');
  assert.equal(terminals[1].deviceProfile?.formFactor, 'TABLET');
  assert.equal(terminals[1].config.deviceProfile?.formFactor, 'TABLET');
  assert.equal(terminals[1].config.deviceProfile?.touchOptimized, true);
  assert.equal(terminals[0].occupied, true);
});

test('initial ERP bootstrap carries root and nested UX/agenda into terminal snapshot application', async () => {
  const { fetchInitialConfigFromErp } = await import('../services/setup/erpTerminalSetup');
  const { terminalConfigRequestCoordinator } = await import('../services/sync/TerminalConfigRequestCoordinator');
  const { applyTerminalConfigSnapshot } = await import('../utils/terminalConfigSnapshot');
  const originalRequest = terminalConfigRequestCoordinator.request;
  try {
    for (const root of [true, false]) {
      const preferences = { ux: { showProductImages: false, viewMode: 'RETAIL' }, startWithAgenda: true };
      const payload = root
        ? { terminal_config: { terminal_id: 'ERP-A', config: {} }, ...preferences }
        : { terminal_config: { terminal_id: 'ERP-A', config: preferences } };
      (terminalConfigRequestCoordinator as any).request = async () => ({ payload, configVersion: 'bootstrap-1', etag: null, unchanged: false });
      const result = await fetchInitialConfigFromErp({ erpBaseUrl: 'https://erp.example.test', tenantId: 'tenant-test', erpTerminalId: 'ERP-A', posDeviceId: 'DEV-A' });
      const config = structuredClone(getInitialConfig('Supermercado' as any));
      const applied = applyTerminalConfigSnapshot(config, { terminalId: config.terminals[0].id, incomingSnapshot: result.terminal_config as any });
      assert.equal(applied.config.terminals[0].config.ux.showProductImages, false);
      assert.equal(applied.config.terminals[0].config.ux.viewMode, 'RETAIL');
      assert.equal(applied.config.terminals[0].config.startWithAgenda, true);
    }
  } finally {
    terminalConfigRequestCoordinator.request = originalRequest;
  }
});
