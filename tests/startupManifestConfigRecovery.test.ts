/**
 * Regression coverage for the STARTUP/manifest/config cycle observed on Caja 6
 * (APK 1.1.689): every manifest reconciliation asked the ERP for
 * `/terminals/:id/config` with `master_scopes` empty, `resolved_scopes=catalog`
 * and `forceRemoteFetch=true`, even though the catalog classifications were
 * already persisted locally.
 *
 * Root cause under test: `syncTerminalManifestInBackground()` forwards
 * `baseConfig ?? null` to `reconcileTerminalManifest()`. With a `null` base the
 * classification pre-flight (`productGroups`, allowed categories, departments,
 * sections, families, subfamilies, brands) always looked empty, so the manifest
 * reconciliation concluded that the classifications were missing and forced a
 * config fetch. These tests exercise the real `syncManager` singleton with the
 * DB adapter and the manifest transport stubbed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

type StorageLike = Storage;

const createMemoryStorage = (): StorageLike => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; },
  } as StorageLike;
};

const installBrowserShims = () => {
  const localStorage = createMemoryStorage();
  const sessionStorage = createMemoryStorage();
  const windowStub: Record<string, any> = {
    localStorage,
    sessionStorage,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    location: { href: 'http://localhost/', origin: 'http://localhost' },
  };
  const globalAny = globalThis as any;
  globalAny.localStorage = localStorage;
  globalAny.sessionStorage = sessionStorage;
  globalAny.window = windowStub;
  globalAny.document = {
    hidden: false,
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  Object.defineProperty(globalAny, 'navigator', {
    value: { onLine: true },
    configurable: true,
    writable: true,
  });
  globalAny.CustomEvent = class CustomEvent<T = unknown> {
    type: string;
    detail?: T;
    constructor(type: string, init?: { detail?: T }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  globalAny.Event = class Event { type: string; constructor(type: string) { this.type = type; } };
  return { localStorage, sessionStorage, windowStub };
};

const shims = installBrowserShims();

// Load the runtime singletons only after the browser shims exist (module init
// reads localStorage/Capacitor in the web fallback path).
const { syncManager } = await import('../services/sync/SyncManager');
const { dbAdapter } = await import('../services/db');
const { apiSyncAdapter } = await import('../services/sync/ApiSyncAdapter');

const TENANT_ID = 'tenant-caja-6';
const LOCAL_TERMINAL_ID = 'local-terminal-6';
const ERP_TERMINAL_ID = '11111111-2222-4333-8444-555555555555';
const DEVICE_ID = 'device-caja-6';

const setBindingStorage = (overrides: Record<string, string | null> = {}) => {
  const values: Record<string, string> = {
    active_terminal_id: LOCAL_TERMINAL_ID,
    CLIC_POS_TERMINAL_ID: LOCAL_TERMINAL_ID,
    clic_erp_sync_terminal_id: ERP_TERMINAL_ID,
    clic_erp_sync_tenant_id: TENANT_ID,
    active_tenant_id: TENANT_ID,
    CLIC_ERP_BASE_URL: 'https://erp.example.test',
    clic_customer_erp_access: 'true',
    CLIC_POS_DEVICE_ID: DEVICE_ID,
    ...Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, value as string])),
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === null) shims.localStorage.removeItem(key);
    else shims.localStorage.setItem(key, value);
  }
};

const buildPersistedConfig = (overrides: Record<string, any> = {}) => ({
  terminals: [{
    id: LOCAL_TERMINAL_ID,
    config: {
      currentDeviceId: DEVICE_ID,
      stationNumber: '6',
      erpTerminalId: ERP_TERMINAL_ID,
      isPrimaryNode: true,
      erpBinding: { terminalId: ERP_TERMINAL_ID, tenantId: TENANT_ID, stationNumber: '6' },
      catalog: { allowedCategories: ['Bebidas', 'Comidas'] },
      documentSeries: [],
    },
  }],
  metadata: { tenantId: TENANT_ID },
  productGroups: [{ id: 'group-1' }],
  departments: [{ id: 'dep-1' }],
  sections: [{ id: 'sec-1' }],
  families: [{ id: 'fam-1' }],
  subfamilies: [{ id: 'sub-1' }],
  brands: [{ id: 'brand-1' }],
  ...overrides,
});

const buildManifest = (overrides: Record<string, any> = {}) => ({
  cursor_map: {
    terminal: 'terminal-c1',
    items: 'items-c1',
    inventory: 'inventory-c1',
    product_prices: 'prices-c1',
  },
  changed: {},
  changed_blocks: [],
  counts: {},
  inventory_version: 'inv-v1',
  price_version: 'price-v1',
  ...overrides,
});

interface ManifestScenario {
  persistedConfig: Record<string, any> | null;
  manifest?: Record<string, any>;
  storageOverrides?: Record<string, string | null>;
  online?: boolean;
  bootstrapBlocks?: boolean;
}

interface ManifestRunResult {
  refreshCalls: Array<Record<string, any>>;
  manifestCalls: Array<Record<string, any>>;
  paymentMethodRefreshCalls: number;
  result: unknown;
}

const originalMethods = {
  getCollection: (dbAdapter as any).getCollection,
  isErpActiveOperationalTarget: (apiSyncAdapter as any).isErpActiveOperationalTarget,
  fetchTerminalManifest: (syncManager as any).fetchTerminalManifest,
  refreshTerminalResolvedConfig: (syncManager as any).refreshTerminalResolvedConfig,
  refreshErpPaymentMethods: (syncManager as any).refreshErpPaymentMethods,
  fetchTerminalInventoryBlock: (syncManager as any).fetchTerminalInventoryBlock,
  fetchTerminalProductPricesBlock: (syncManager as any).fetchTerminalProductPricesBlock,
  refreshOperationalInventorySnapshot: (syncManager as any).refreshOperationalInventorySnapshot,
};

const restoreRuntime = () => {
  (dbAdapter as any).getCollection = originalMethods.getCollection;
  (apiSyncAdapter as any).isErpActiveOperationalTarget = originalMethods.isErpActiveOperationalTarget;
  (syncManager as any).fetchTerminalManifest = originalMethods.fetchTerminalManifest;
  (syncManager as any).refreshTerminalResolvedConfig = originalMethods.refreshTerminalResolvedConfig;
  (syncManager as any).refreshErpPaymentMethods = originalMethods.refreshErpPaymentMethods;
  (syncManager as any).fetchTerminalInventoryBlock = originalMethods.fetchTerminalInventoryBlock;
  (syncManager as any).fetchTerminalProductPricesBlock = originalMethods.fetchTerminalProductPricesBlock;
  (syncManager as any).refreshOperationalInventorySnapshot = originalMethods.refreshOperationalInventorySnapshot;
};

const runBackgroundManifestSync = async (scenario: ManifestScenario): Promise<ManifestRunResult> => {
  shims.localStorage.clear();
  shims.sessionStorage.clear();
  setBindingStorage(scenario.storageOverrides);
  // Persisted cursors/versions: the local catalog is already synchronized, so a
  // manifest without changes must not bootstrap inventory or prices.
  shims.localStorage.setItem(
    `clic_pos_terminal_manifest_cursor_map:${LOCAL_TERMINAL_ID}`,
    JSON.stringify({
      terminal: 'terminal-c1', items: 'items-c1', inventory: 'inventory-c1', product_prices: 'prices-c1',
    }),
  );
  shims.localStorage.setItem(`clic_pos_inventory_version:${LOCAL_TERMINAL_ID}`, 'inv-v1');
  shims.localStorage.setItem(`clic_pos_price_version:${LOCAL_TERMINAL_ID}`, 'price-v1');

  const refreshCalls: Array<Record<string, any>> = [];
  const manifestCalls: Array<Record<string, any>> = [];
  let paymentMethodRefreshCalls = 0;
  const manifest = buildManifest(scenario.manifest);

  (dbAdapter as any).getCollection = async (collection: string) => {
    if (collection === 'config') return scenario.persistedConfig;
    if (collection === 'internalSequences') return [{ id: 'series-1', source: 'ERP_TERMINAL_CONFIG' }];
    return [];
  };
  (apiSyncAdapter as any).isErpActiveOperationalTarget = () => true;
  (syncManager as any).fetchTerminalManifest = async (context: Record<string, any>, cursorMap: Record<string, any>) => {
    manifestCalls.push({ context, cursorMap });
    return manifest;
  };
  (syncManager as any).refreshTerminalResolvedConfig = async (_snapshot: unknown, options: Record<string, any>) => {
    refreshCalls.push(options ?? {});
    return null;
  };
  (syncManager as any).refreshErpPaymentMethods = async () => { paymentMethodRefreshCalls += 1; };
  (syncManager as any).fetchTerminalInventoryBlock = async () => null;
  (syncManager as any).fetchTerminalProductPricesBlock = async () => null;
  (syncManager as any).refreshOperationalInventorySnapshot = async () => 0;
  (syncManager as any).lastBackgroundTerminalManifestSyncAt = 0;
  (globalThis as any).navigator.onLine = scenario.online !== false;

  try {
    const result = await syncManager.syncTerminalManifestInBackground(undefined, {
      reason: 'startup',
      bootstrapBlocks: Boolean(scenario.bootstrapBlocks),
    });
    return { refreshCalls, manifestCalls, paymentMethodRefreshCalls, result };
  } finally {
    restoreRuntime();
  }
};

const assertCatalogRecoveryRequest = (call: Record<string, any>) => {
  assert.equal(call.forceRemoteFetch, true, 'la recuperación de config debe ser remota');
  assert.deepEqual(call.masterScopes, [], 'sin scopes maestros: solo faltan clasificaciones');
  assert.deepEqual(call.resolvedScopes, ['catalog'], 'el ámbito recuperado es catálogo');
  assert.equal(call.supplementalMode, 'background');
};

test('catálogo persistido vigente + manifest sin cambios: no se fuerza GET config', async () => {
  const { refreshCalls, manifestCalls, paymentMethodRefreshCalls } = await runBackgroundManifestSync({
    persistedConfig: buildPersistedConfig(),
  });

  assert.equal(manifestCalls.length, 1, 'el manifest se consulta una vez');
  assert.equal(paymentMethodRefreshCalls, 1, 'los métodos de pago se siguen reconciliando');
  assert.deepEqual(
    refreshCalls,
    [],
    'con las clasificaciones persistidas no debe pedirse /terminals/:id/config',
  );
  // El manifest se consulta con el ámbito efectivo de la vinculación local.
  assert.equal(manifestCalls[0].context.terminalId, ERP_TERMINAL_ID);
  assert.equal(manifestCalls[0].context.localTerminalId, LOCAL_TERMINAL_ID);
  assert.equal(manifestCalls[0].context.tenantId, TENANT_ID);
});

test('STARTUP real (bootstrapBlocks) con catálogo vigente: tampoco fuerza GET config', async () => {
  const { refreshCalls, manifestCalls } = await runBackgroundManifestSync({
    persistedConfig: buildPersistedConfig(),
    bootstrapBlocks: true,
  });

  assert.equal(manifestCalls.length, 1);
  assert.deepEqual(
    refreshCalls,
    [],
    'el STARTUP de arranque no debe pedir /config si las clasificaciones persistidas están completas',
  );
});

test('cambio real de catálogo conserva la recuperación de config (ámbito catalog)', async () => {
  const { refreshCalls } = await runBackgroundManifestSync({
    persistedConfig: buildPersistedConfig(),
    manifest: buildManifest({ changed: { items: true }, changed_blocks: ['items'] }),
  });

  assert.equal(refreshCalls.length, 1, 'un cambio real de ítems sigue refrescando la config');
  assert.equal(refreshCalls[0].forceRemoteFetch, true);
  assert.deepEqual(refreshCalls[0].masterScopes, ['items']);
  assert.ok(
    Array.isArray(refreshCalls[0].resolvedScopes) && refreshCalls[0].resolvedScopes.includes('catalog'),
    'resolved_scopes debe incluir catalog cuando cambiaron ítems',
  );
});

test('cambio real de permisos/maestros (sellers) conserva la recuperación acotada', async () => {
  const { refreshCalls } = await runBackgroundManifestSync({
    persistedConfig: buildPersistedConfig(),
    // Evidencia separada de Caja 6: el manifest reporta changed_blocks=['sellers'].
    manifest: buildManifest({ changed: { sellers: true }, changed_blocks: ['sellers'] }),
  });

  assert.equal(refreshCalls.length, 1, 'un cambio real de sellers sigue refrescando la config');
  assert.equal(refreshCalls[0].forceRemoteFetch, true);
  assert.deepEqual(refreshCalls[0].masterScopes, ['sellers']);
  assert.deepEqual(
    refreshCalls[0].resolvedScopes,
    [],
    'las clasificaciones ya persistidas no se vuelven a pedir por un cambio de sellers',
  );
});

test('cambio real de terminal conserva la recuperación identidad/terminal', async () => {
  const { refreshCalls } = await runBackgroundManifestSync({
    persistedConfig: buildPersistedConfig(),
    manifest: buildManifest({ changed: { terminal: true }, changed_blocks: ['terminal'] }),
  });

  assert.equal(refreshCalls.length, 1);
  assert.equal(refreshCalls[0].forceRemoteFetch, true);
  for (const scope of ['identity', 'terminal', 'catalog']) {
    assert.ok(refreshCalls[0].resolvedScopes.includes(scope), `resolved_scopes debe incluir ${scope}`);
  }
});

test('SQLite vacía: se recupera la config cuando no hay base persistida', async () => {
  const { refreshCalls, manifestCalls } = await runBackgroundManifestSync({
    persistedConfig: null,
  });

  assert.equal(manifestCalls.length, 1);
  assert.equal(refreshCalls.length, 1, 'sin config persistida la recuperación es obligatoria');
  assertCatalogRecoveryRequest(refreshCalls[0]);
});

test('catálogo persistido incompleto: se recupera la config (clasificaciones realmente faltantes)', async () => {
  const incomplete = buildPersistedConfig({
    productGroups: [],
    departments: [],
    sections: [],
    families: [],
    subfamilies: [],
    brands: [],
  });
  incomplete.terminals[0].config.catalog = { allowedCategories: [] };

  const { refreshCalls } = await runBackgroundManifestSync({ persistedConfig: incomplete });

  assert.equal(refreshCalls.length, 1, 'si de verdad faltan clasificaciones hay recuperación');
  assertCatalogRecoveryRequest(refreshCalls[0]);
});

test('config persistida de otro ámbito no se usa como base (no contamina vinculación)', async () => {
  const foreign = buildPersistedConfig({
    terminals: [{
      id: 'local-terminal-otra',
      config: {
        currentDeviceId: 'device-otro',
        stationNumber: '9',
        erpTerminalId: '99999999-8888-4777-8666-555555555555',
        erpBinding: { terminalId: '99999999-8888-4777-8666-555555555555', tenantId: 'tenant-otro' },
        catalog: { allowedCategories: ['Bebidas'] },
      },
    }],
    metadata: { tenantId: 'tenant-otro' },
  });

  const { refreshCalls } = await runBackgroundManifestSync({ persistedConfig: foreign });

  assert.equal(refreshCalls.length, 1, 'un snapshot de otro ámbito no cancela la recuperación');
  assertCatalogRecoveryRequest(refreshCalls[0]);
});

test('vinculación cambiada en storage: no reutiliza la config del ámbito anterior', async () => {
  const previousScopeConfig = buildPersistedConfig();
  const { refreshCalls } = await runBackgroundManifestSync({
    persistedConfig: previousScopeConfig,
    storageOverrides: {
      active_terminal_id: 'local-terminal-renewed',
      CLIC_POS_TERMINAL_ID: 'local-terminal-renewed',
      clic_erp_sync_terminal_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    },
  });

  assert.equal(refreshCalls.length, 1, 'tras un rebind real se recupera la config del nuevo ámbito');
  assertCatalogRecoveryRequest(refreshCalls[0]);
});

test('offline: no hay manifest ni config y la recuperación no se adelanta', async () => {
  const { refreshCalls, manifestCalls } = await runBackgroundManifestSync({
    persistedConfig: buildPersistedConfig(),
    online: false,
  });

  assert.equal(manifestCalls.length, 0);
  assert.deepEqual(refreshCalls, []);
});

test('cambio real de inventario/precios conserva los bloques de recuperación', async () => {
  let inventoryBlockCalls = 0;
  let priceBlockCalls = 0;
  const persistedConfig = buildPersistedConfig();
  const manifest = buildManifest({
    changed: { inventory: true, product_prices: true },
    changed_blocks: ['inventory', 'product_prices'],
  });

  shims.localStorage.clear();
  shims.sessionStorage.clear();
  setBindingStorage();
  (dbAdapter as any).getCollection = async (collection: string) => {
    if (collection === 'config') return persistedConfig;
    if (collection === 'internalSequences') return [{ id: 'series-1', source: 'ERP_TERMINAL_CONFIG' }];
    return [];
  };
  (apiSyncAdapter as any).isErpActiveOperationalTarget = () => true;
  (syncManager as any).fetchTerminalManifest = async () => manifest;
  (syncManager as any).refreshTerminalResolvedConfig = async () => null;
  (syncManager as any).refreshErpPaymentMethods = async () => {};
  (syncManager as any).fetchTerminalInventoryBlock = async () => {
    inventoryBlockCalls += 1;
    return { balances: [], has_changes: false, cursor: null };
  };
  (syncManager as any).fetchTerminalProductPricesBlock = async () => {
    priceBlockCalls += 1;
    return { prices: [], has_changes: false, cursor: null };
  };
  (syncManager as any).refreshOperationalInventorySnapshot = async () => 0;
  (syncManager as any).lastBackgroundTerminalManifestSyncAt = 0;
  (globalThis as any).navigator.onLine = true;

  try {
    await syncManager.syncTerminalManifestInBackground(undefined, { reason: 'startup', bootstrapBlocks: false });
  } finally {
    restoreRuntime();
  }

  assert.equal(inventoryBlockCalls, 1, 'inventario sigue recuperándose cuando el manifest lo marca');
  assert.equal(priceBlockCalls, 1, 'precios siguen recuperándose cuando el manifest lo marca');
});
