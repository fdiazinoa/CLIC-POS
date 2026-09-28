import assert from 'node:assert/strict';
import test from 'node:test';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

class MemoryBroadcastChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public readonly name: string) {}
  postMessage() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
}

const storage = new MemoryStorage();
const windowListeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
const documentListeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
const scheduled = new Map<number, () => void>();
const intervals = new Set<number>();
let timerId = 0;
let online = false;

const add = (registry: Map<string, Set<EventListenerOrEventListenerObject>>, type: string, listener: EventListenerOrEventListenerObject) => {
  const listeners = registry.get(type) || new Set<EventListenerOrEventListenerObject>();
  listeners.add(listener);
  registry.set(type, listeners);
};
const remove = (registry: Map<string, Set<EventListenerOrEventListenerObject>>, type: string, listener: EventListenerOrEventListenerObject) => {
  registry.get(type)?.delete(listener);
};

Object.assign(globalThis, {
  localStorage: storage,
  sessionStorage: new MemoryStorage(),
  CustomEvent: class { constructor(public type: string, public init?: unknown) {} },
  BroadcastChannel: MemoryBroadcastChannel,
  document: {
    hidden: false,
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => add(documentListeners, type, listener),
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => remove(documentListeners, type, listener),
  },
  window: {
    localStorage: storage,
    location: { hostname: 'localhost', protocol: 'https:', search: '', origin: 'https://localhost' },
    setTimeout: (callback: () => void) => {
      const id = ++timerId;
      scheduled.set(id, () => { scheduled.delete(id); callback(); });
      return id;
    },
    clearTimeout: (id: number) => { scheduled.delete(id); },
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => add(windowListeners, type, listener),
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => remove(windowListeners, type, listener),
    dispatchEvent: () => true,
    BroadcastChannel: MemoryBroadcastChannel,
  },
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { get onLine() { return online; }, userAgent: 'Android QA' },
});
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
globalThis.setInterval = ((_: TimerHandler) => {
  const id = ++timerId;
  intervals.add(id);
  return id;
}) as typeof setInterval;
globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
  intervals.delete(Number(id));
}) as typeof clearInterval;
globalThis.setTimeout = ((callback: TimerHandler) => {
  const id = ++timerId;
  scheduled.set(id, () => {
    scheduled.delete(id);
    if (typeof callback === 'function') callback();
  });
  return id;
}) as typeof setTimeout;
globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
  scheduled.delete(Number(id));
}) as typeof clearTimeout;

const { saveSyncProfile } = await import('../services/sync/SyncProfile');
const { resolveClientMasterAuthority } = await import('../utils/operationalMasterConfig');
const { persistValidatedClientMasterTarget } = await import('../utils/clientMasterBinding');
const { apiSyncAdapter } = await import('../services/sync/ApiSyncAdapter');
const { backgroundSyncManager } = await import('../services/sync/BackgroundSyncManager');
const { realtimeNotificationService } = await import('../services/sync/RealtimeNotificationService');
const { syncManager } = await import('../services/sync/SyncManager');
const { transferReceiptService } = await import('../services/sync/TransferReceiptService');

const terminalId = '9ffc6771-7845-4976-afd3-20cebc3cc6e8';
const config = {
  terminals: [{
    id: terminalId,
    config: {
      currentDeviceId: 'device-client',
      isPrimaryNode: false,
      governedByMaster: true,
      syncConfig: { mode: 'SLAVE', autoSyncIntervalMs: 30000, isEnabled: true },
    },
  }],
} as any;

test('real singleton lifecycle blocks stale pushes, recovers once, and rotates authority credentials', async () => {
  storage.clear();
  windowListeners.clear();
  documentListeners.clear();
  scheduled.clear();
  online = false;
  storage.setItem('clic_pos_terminal_setup_mode', 'CLIENT');
  storage.setItem('CLIC_POS_MASTER_URL', 'http://10.0.0.28:3001');
  storage.setItem('pos_master_ip', '10.0.0.28');
  storage.setItem('CLIC_POS_TERMINAL_ID', terminalId);
  saveSyncProfile({
    contractedProduct: 'POS_ONLY', posRuntime: 'SLAVE', cloudChannel: 'POS_MASTER', dataMaster: 'POS_MASTER',
    cloudSyncEnabled: false, customerErpAccess: false, erpUiEnabled: false,
    contractSource: 'BACKEND_REGISTER', masterUrl: 'http://10.0.0.28:3001', masterTerminalId: 'master-id', masterReady: true,
  });

  const originalFetch = globalThis.fetch;
  const originalRefresh = syncManager.refreshTerminalResolvedConfig;
  const originalSyncInternals = {
    loadVersions: (syncManager as any).loadSyncVersions,
    loadImages: (syncManager as any).loadProductImageSyncState,
    purge: (syncManager as any).purgeSyncedHistoricalData,
  };
  const originalRecoverInterrupted = transferReceiptService.recoverInterrupted;
  const originalRealtimeInitialize = realtimeNotificationService.initialize;
  const originalRealtimeDisconnect = realtimeNotificationService.disconnect;
  const originalBackgroundMethods = {
    recover: (backgroundSyncManager as any).recoverStuckSyncItems,
    update: (backgroundSyncManager as any).updatePendingCount,
  };
  const originalPushTransaction = (apiSyncAdapter as any).pushTransaction;
  let configValidations = 0;
  let recoveryCalls = 0;
  let transactionPushes = 0;
  let realtimeInitializations = 0;
  let realtimeDisconnects = 0;
  const authTargets: string[] = [];
  let recoveredHost = '10.0.0.129';

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/api/config')) {
      configValidations += 1;
      return Response.json(config);
    }
    if (url.endsWith('/api/sync/auth')) {
      const host = new URL(url).hostname;
      authTargets.push(host);
      return Response.json({ token: `token-${host}` });
    }
    throw new Error(`Unexpected runtime fetch: ${url}`);
  }) as typeof fetch;
  (syncManager as any).refreshTerminalResolvedConfig = async () => config;
  (syncManager as any).loadSyncVersions = async () => undefined;
  (syncManager as any).loadProductImageSyncState = () => undefined;
  (syncManager as any).purgeSyncedHistoricalData = async () => undefined;
  (backgroundSyncManager as any).recoverStuckSyncItems = async () => undefined;
  (backgroundSyncManager as any).updatePendingCount = async () => undefined;
  (transferReceiptService as any).recoverInterrupted = async () => undefined;
  (apiSyncAdapter as any).pushTransaction = async () => { transactionPushes += 1; };
  (realtimeNotificationService as any).initialize = async (...args: unknown[]) => {
    realtimeInitializations += 1;
    void args;
  };
  (realtimeNotificationService as any).disconnect = async (...args: unknown[]) => {
    realtimeDisconnects += 1;
    return originalRealtimeDisconnect.apply(realtimeNotificationService, args as any);
  };

  const recoverAuthority = async () => {
    recoveryCalls += 1;
    return resolveClientMasterAuthority({
      storedHosts: ['10.0.0.28'],
      resolveCloudHost: async () => null,
      discoverLanHosts: async () => [recoveredHost],
      rejectHosts: ['10.0.0.28'],
      fetchImpl: globalThis.fetch,
      validate: () => undefined,
    });
  };
  const disableRemoteServices = (reason: string) => backgroundSyncManager.disableRemoteSync(reason);
  const enableRemoteServices = async () => {
    backgroundSyncManager.enableRemoteSync();
    await backgroundSyncManager.initialize();
  };

  try {
    await backgroundSyncManager.initialize();
    assert.equal(backgroundSyncManager.isRemoteSyncActive(), true, 'pre-existing background worker is active');
    (apiSyncAdapter as any).config = { masterUrl: 'http://10.0.0.28:3001', terminalId };
    (apiSyncAdapter as any).authToken = 'stale-master-token';
    (realtimeNotificationService as any).state = 'HEALTHY';

    await syncManager.initialize(config, terminalId, {
      clientMasterAuthority: { status: 'UNAVAILABLE' },
      recoverClientMasterAuthority: recoverAuthority,
      disableRemoteServices,
      enableRemoteServices,
    });
    assert.deepEqual(apiSyncAdapter.getOperationalAuthorityState(), {
      enabled: false, masterUrl: null, terminalId: null, authenticated: false,
      revision: apiSyncAdapter.getOperationalAuthorityState().revision,
    });
    assert.equal(backgroundSyncManager.isRemoteSyncActive(), false);
    online = true;
    await backgroundSyncManager.sync();
    online = false;
    assert.equal(transactionPushes, 0);
    assert.equal(realtimeInitializations, 0);
    assert.equal(realtimeNotificationService.getState(), 'DISABLED');
    assert.equal(windowListeners.get('online')?.size, 1, 'only validated authority recovery listens while unavailable');

    const recoveryOnlineHandler = [...(windowListeners.get('online') || [])][0] as EventListener;
    online = true;
    recoveryOnlineHandler(new Event('online'));
    recoveryOnlineHandler(new Event('online'));
    assert.equal(scheduled.size, 1, 'duplicate online events schedule one authority recovery');
    [...scheduled.values()][0]();
    const recoveryA = (syncManager as any).authorityRecoveryPromise as Promise<boolean>;
    const recoveryB = (syncManager as any).attemptAuthorityRecovery();
    assert.equal(await recoveryA, true);
    assert.equal(await recoveryB, true);
    assert.equal(recoveryCalls, 1, 'single-flight recovery validates only once');
    assert.equal(configValidations, 1);
    assert.equal(storage.getItem('CLIC_POS_MASTER_URL'), 'http://10.0.0.129:3001');
    assert.equal(storage.getItem('pos_master_ip'), '10.0.0.129');
    assert.equal(apiSyncAdapter.getOperationalAuthorityState().masterUrl, 'http://10.0.0.129:3001');
    assert.equal((apiSyncAdapter as any).authToken, 'token-10.0.0.129');
    assert.equal(backgroundSyncManager.isRemoteSyncActive(), true);
    assert.equal(recoveryCalls, 1);
    assert.equal((syncManager as any).authorityRecoveryOnlineHandler, null);
    assert.equal(scheduled.size, 1, 'only the current authority image-sync timer remains scheduled');
    const onlineListenersAfterRecovery = windowListeners.get('online')?.size;

    recoveredHost = '10.0.0.140';
    const authorityB = await recoverAuthority();
    assert.equal(authorityB.status, 'VALIDATED');
    if (authorityB.status !== 'VALIDATED') assert.fail('authority B required');
    persistValidatedClientMasterTarget(authorityB.baseUrl);
    await syncManager.initialize(config, terminalId, {
      clientMasterAuthority: authorityB,
      recoverClientMasterAuthority: recoverAuthority,
      disableRemoteServices,
      enableRemoteServices,
    });
    assert.deepEqual(authTargets, ['10.0.0.129', '10.0.0.140']);
    assert.equal((apiSyncAdapter as any).authToken, 'token-10.0.0.140');
    assert.equal(apiSyncAdapter.getOperationalAuthorityState().masterUrl, 'http://10.0.0.140:3001');
    assert.equal(scheduled.size, 1, 'authority rotation replaces its prior image-sync timer');
    assert.equal(
      windowListeners.get('online')?.size,
      onlineListenersAfterRecovery,
      'adapter, image, and background listeners remain deduplicated after authority rotation',
    );
    assert.equal(documentListeners.get('visibilitychange')?.size, 1);
    assert.ok(realtimeDisconnects >= 2);
    assert.ok(realtimeInitializations <= 2);
  } finally {
    online = false;
    backgroundSyncManager.disableRemoteSync('test-cleanup');
    syncManager.stopAutoSync();
    apiSyncAdapter.resetOperationalAuthority();
    (syncManager as any).clearAuthorityRecovery();
    (syncManager as any).refreshTerminalResolvedConfig = originalRefresh;
    (syncManager as any).loadSyncVersions = originalSyncInternals.loadVersions;
    (syncManager as any).loadProductImageSyncState = originalSyncInternals.loadImages;
    (syncManager as any).purgeSyncedHistoricalData = originalSyncInternals.purge;
    (backgroundSyncManager as any).recoverStuckSyncItems = originalBackgroundMethods.recover;
    (backgroundSyncManager as any).updatePendingCount = originalBackgroundMethods.update;
    (transferReceiptService as any).recoverInterrupted = originalRecoverInterrupted;
    (apiSyncAdapter as any).pushTransaction = originalPushTransaction;
    (realtimeNotificationService as any).initialize = originalRealtimeInitialize;
    (realtimeNotificationService as any).disconnect = originalRealtimeDisconnect;
    globalThis.fetch = originalFetch;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
