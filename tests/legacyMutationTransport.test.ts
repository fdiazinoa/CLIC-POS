import assert from 'node:assert/strict';
import test from 'node:test';
import { Capacitor } from '@capacitor/core';
import { ApiSyncAdapter } from '../services/sync/ApiSyncAdapter';
import { LegacyMutationJournal, type LegacyMutationJournalEntry, type LegacyMutationJournalStore } from '../services/sync/LegacyMutationJournal';
import { setNativeRequestTransportForTests } from '../services/network/httpClient';

class Store implements LegacyMutationJournalStore {
  rows = new Map<string, LegacyMutationJournalEntry>();
  async getCollection<T>(): Promise<T[]> { return [...this.rows.values()] as T[]; }
  async saveDocument<T extends { id: string }>(_collection: string, doc: T): Promise<void> {
    this.rows.set(doc.id, { ...doc } as unknown as LegacyMutationJournalEntry);
  }
  async deleteDocument(_collection: string, id: string): Promise<void> { this.rows.delete(id); }
}

const installAndroid = () => {
  const originalNative = Capacitor.isNativePlatform;
  const originalPlatform = Capacitor.getPlatform;
  const originalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  if (!originalStorageDescriptor) {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } });
  }
  (Capacitor as any).isNativePlatform = () => true;
  (Capacitor as any).getPlatform = () => 'android';
  return () => {
    (Capacitor as any).isNativePlatform = originalNative;
    (Capacitor as any).getPlatform = originalPlatform;
    setNativeRequestTransportForTests(null);
    if (originalStorageDescriptor) Object.defineProperty(globalThis, 'localStorage', originalStorageDescriptor);
    else delete (globalThis as any).localStorage;
  };
};

const adapterFor = async () => {
  const store = new Store();
  const journal = new LegacyMutationJournal(store);
  await journal.initializeForStartup();
  const adapter = new ApiSyncAdapter(journal) as any;
  adapter.config = { masterUrl: 'http://10.0.0.129:3001', terminalId: 'terminal-a', autoRetry: true, retryDelayMs: 10 };
  adapter.operationalAuthorityEnabled = true;
  adapter.operationalAuthorityRevision = 7;
  adapter.operationalAuthorityAbortController = new AbortController();
  return { adapter, journal, store };
};

for (const status of [500, 503, 504]) {
  test(`LAN legacy ${status} is one CapacitorHttp attempt and remains OUTCOME_UNKNOWN`, async () => {
    const restore = installAndroid();
    const { adapter, journal, store } = await adapterFor();
    let requests = 0;
    let observedHeaders: Record<string, string> = {};
    setNativeRequestTransportForTests((async (options: any) => {
      requests += 1;
      observedHeaders = options.headers || {};
      return { status, data: { accepted: true } };
    }) as any);
    try {
      await assert.rejects(
        adapter.fetchWithRetry(
          'http://10.0.0.129:3001/api/sync/transactions',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
          2,
          1,
          'sales',
          'PUSH_OPERATIONS',
        ),
        /LEGACY_MUTATION_OUTCOME_UNKNOWN/,
      );
      assert.equal(requests, 1);
      assert.equal(observedHeaders['X-CLIC-Authority-Revision'], undefined);
      assert.equal(observedHeaders['X-CLIC-Authority-Request-Id'], undefined);
      assert.equal(observedHeaders['Idempotency-Key'], undefined);
      assert.equal(journal.hasOutcomeUnknown(), true);
      assert.equal([...store.rows.values()][0]?.state, 'OUTCOME_UNKNOWN');
    } finally {
      restore();
    }
  });
}

test('valid 2xx stays blocking until caller schema validation and durable acknowledgement', async () => {
  const restore = installAndroid();
  const { adapter, journal, store } = await adapterFor();
  setNativeRequestTransportForTests((async () => ({ status: 200, data: { success: true, version: 2 } })) as any);
  try {
    const response = await adapter.fetchWithRetry(
      'http://10.0.0.129:3001/api/sync/collections/products/push',
      { method: 'POST', body: '{}' }, 2, 1, 'background', 'PUSH_MASTERS',
    );
    assert.equal(journal.hasBlockingMutations(), true);
    await adapter.acknowledgeLegacyJsonResponse(response, 'push:products:1', (payload: any) => payload?.success === true);
    assert.equal(journal.hasBlockingMutations(), false);
    assert.equal([...store.rows.values()][0]?.state, 'CLOSED');
  } finally {
    restore();
  }
});

test('operational LAN caller closes only after its endpoint validator accepts the response', async () => {
  const restore = installAndroid();
  const { adapter, journal, store } = await adapterFor();
  adapter.authenticateOperationalTarget = async () => ({
    baseUrl: 'http://10.0.0.129:3001/api/sync',
    terminalId: 'terminal-a',
    token: 'token-a',
    useLocalTarget: true,
    kind: 'LOCAL_MASTER',
  });
  setNativeRequestTransportForTests((async () => ({
    status: 200,
    data: { processedIds: ['movement-a'], success: true },
  })) as any);
  try {
    const result = await adapter.postOperationalPayload('/inventory/movements', { items: [{ id: 'movement-a' }] }, {
      callerAck: {
        reference: 'pushInventoryMovement:movement-a',
        validate: (payload: any) => assert.deepEqual(payload.processedIds, ['movement-a']),
      },
    });
    assert.equal(result.success, true);
    assert.equal(journal.hasBlockingMutations(), false);
    assert.equal([...store.rows.values()][0]?.callerAckReference, 'pushInventoryMovement:movement-a');
  } finally {
    restore();
  }
});

test('operational LAN response without a migrated caller ACK becomes OUTCOME_UNKNOWN', async () => {
  const restore = installAndroid();
  const { adapter, journal } = await adapterFor();
  adapter.authenticateOperationalTarget = async () => ({
    baseUrl: 'http://10.0.0.129:3001/api/sync',
    terminalId: 'terminal-a',
    token: 'token-a',
    useLocalTarget: true,
    kind: 'LOCAL_MASTER',
  });
  setNativeRequestTransportForTests((async () => ({ status: 200, data: { success: true } })) as any);
  try {
    await assert.rejects(
      adapter.postOperationalPayload('/unmigrated', { id: 'x' }),
      /CALLER_ACK_REQUIRED/,
    );
    assert.equal(journal.hasOutcomeUnknown(), true);
  } finally {
    restore();
  }
});

test('malformed 2xx is ambiguous and remains blocking', async () => {
  const restore = installAndroid();
  const { adapter, journal } = await adapterFor();
  setNativeRequestTransportForTests((async () => ({ status: 200, data: 'not-json' })) as any);
  try {
    const response = await adapter.fetchWithRetry(
      'http://10.0.0.129:3001/api/sync/transactions',
      { method: 'POST', body: '{}' }, 2, 1, 'sales', 'PUSH_OPERATIONS',
    );
    await assert.rejects(adapter.acknowledgeLegacyJsonResponse(response, 'transaction:x'), /SCHEMA_INVALID/);
    assert.equal(journal.hasOutcomeUnknown(), true);
  } finally {
    restore();
  }
});

test('LAN auth is global single-flight across sales and background and stays outside the mutation journal', async () => {
  const restore = installAndroid();
  const previousStorage = (globalThis as any).localStorage;
  const values = new Map<string, string>([['pos_device_id', 'device-a']]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  const { adapter, journal } = await adapterFor();
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  setNativeRequestTransportForTests((async () => {
    requests += 1;
    await gate;
    return { status: 200, data: { token: 'lan-token-12345678' } };
  }) as any);
  try {
    const sales = adapter.authenticate(true, 'sales');
    const background = adapter.authenticate(true, 'background');
    await Promise.resolve();
    release();
    await Promise.all([sales, background]);
    assert.equal(requests, 1);
    assert.equal(journal.hasBlockingMutations(), false);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage });
    restore();
  }
});
