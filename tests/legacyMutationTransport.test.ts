import assert from 'node:assert/strict';
import test from 'node:test';
import { Capacitor } from '@capacitor/core';
import { ApiSyncAdapter } from '../services/sync/ApiSyncAdapter';
import {
  completeLegacyMutationAfterDurableAck,
  LegacyMutationJournal,
  type LegacyMutationJournalEntry,
  type LegacyMutationJournalStore,
} from '../services/sync/LegacyMutationJournal';
import { setNativeRequestTransportForTests } from '../services/network/httpClient';
import {
  dispatchLegacyLanMutation,
  validateLegacyTableStateResponse,
} from '../services/sync/LegacyLanMutationTransport';
import { setTerminalCredentialNativeWriterForTests } from '../services/sync/TerminalCredentialStore';

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
    const provisional = await adapter.acknowledgeLegacyJsonResponse(response, 'push:products:1', (payload: any) => payload?.success === true);
    assert.equal(journal.hasBlockingMutations(), true);
    await completeLegacyMutationAfterDurableAck(provisional, 'caller:products:durable', journal);
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
      responseValidator: {
        reference: 'pushInventoryMovement:movement-a',
        validate: (payload: any) => assert.deepEqual(payload.processedIds, ['movement-a']),
      },
    });
    assert.equal(result.success, true);
    assert.equal(journal.hasBlockingMutations(), true);
    await completeLegacyMutationAfterDurableAck(result, 'caller:movement-a:durable', journal);
    assert.equal(journal.hasBlockingMutations(), false);
    assert.equal([...store.rows.values()][0]?.callerAckReference, 'caller:movement-a:durable');
  } finally {
    restore();
  }
});

test('LAN 401 replay keeps one correlation and closes the first attempt only after durable reauth state', async () => {
  const restore = installAndroid();
  const { adapter, journal, store } = await adapterFor();
  adapter.authenticateOperationalTarget = async () => ({
    baseUrl: 'http://10.0.0.129:3001/api/sync',
    terminalId: 'terminal-a',
    token: 'token-a',
    useLocalTarget: true,
    kind: 'LOCAL_MASTER',
  });
  let requests = 0;
  let writerStarted!: () => void;
  const writerStart = new Promise<void>(resolve => { writerStarted = resolve; });
  let releaseWriter!: () => void;
  const writerGate = new Promise<void>(resolve => { releaseWriter = resolve; });
  setTerminalCredentialNativeWriterForTests(async () => {
    writerStarted();
    await writerGate;
  });
  setNativeRequestTransportForTests((async () => {
    requests += 1;
    return requests === 1
      ? { status: 401, data: { error: 'expired' } }
      : { status: 200, data: { success: true, processedIds: ['movement-a'] } };
  }) as any);
  try {
    const pending = adapter.postOperationalPayload('/inventory/movements', { items: [{ id: 'movement-a' }] }, {
      responseValidator: {
        reference: 'pushInventoryMovement:movement-a',
        validate: (payload: any) => assert.deepEqual(payload.processedIds, ['movement-a']),
      },
    });
    await writerStart;
    assert.equal(requests, 1);
    assert.equal([...store.rows.values()][0]?.state, 'DISPATCHED');
    releaseWriter();
    const result = await pending;
    const rows = [...store.rows.values()];
    assert.equal(requests, 2);
    assert.equal(new Set(rows.map(row => row.operationCorrelationId)).size, 1);
    assert.equal(rows.filter(row => row.state === 'CLOSED').length, 1);
    assert.equal(rows.filter(row => row.state === 'DISPATCHED').length, 1);
    await completeLegacyMutationAfterDurableAck(result, 'caller:movement-a:durable', journal);
    assert.equal(journal.hasBlockingMutations(), false);
  } finally {
    setTerminalCredentialNativeWriterForTests(null);
    restore();
  }
});

test('kill after a valid response but before caller durable ACK promotes the row to OUTCOME_UNKNOWN', async () => {
  const restore = installAndroid();
  const { adapter, journal, store } = await adapterFor();
  setNativeRequestTransportForTests((async () => ({ status: 200, data: { success: true, version: 3 } })) as any);
  try {
    const response = await adapter.fetchWithRetry(
      'http://10.0.0.129:3001/api/sync/collections/products/push',
      { method: 'POST', body: '{}' }, 0, 1, 'background', 'PUSH_MASTERS',
    );
    await adapter.acknowledgeLegacyJsonResponse(response, 'provisional', (payload: any) => payload?.version === 3);
    assert.equal(journal.hasBlockingMutations(), true);
    const restarted = new LegacyMutationJournal(store);
    await restarted.initializeForStartup();
    assert.equal(restarted.hasOutcomeUnknown(), true);
  } finally {
    restore();
  }
});

test('direct LAN mutation remains DISPATCHED while the high-level durable commit is pending', async () => {
  const restore = installAndroid();
  const store = new Store();
  const journal = new LegacyMutationJournal(store);
  await journal.initializeForStartup();
  setNativeRequestTransportForTests((async () => ({ status: 200, data: { success: true, revision: 9 } })) as any);
  let release!: () => void;
  const durableGate = new Promise<void>(resolve => { release = resolve; });
  try {
    const receipt = await dispatchLegacyLanMutation<any>({
      url: 'http://10.0.0.129:3001/api/mesas/abrir',
      method: 'POST',
      body: '{}',
      operation: 'TABLE_OPEN',
      validateResponse: (data) => {
        assert.equal(data.success, true);
        assert.equal(data.revision, 9);
      },
      journal,
      authorityState: { revision: 7, terminalId: 'terminal-a' },
    });
    const completion = receipt.completeAfterDurableCommit('TableMap:open:1', async () => durableGate);
    await Promise.resolve();
    assert.equal(journal.hasBlockingMutations(), true);
    assert.equal([...store.rows.values()][0]?.state, 'DISPATCHED');
    release();
    await completion;
    assert.equal(journal.hasBlockingMutations(), false);
    assert.equal([...store.rows.values()][0]?.callerAckReference, 'TableMap:open:1');
  } finally {
    restore();
  }
});

test('explicitly idempotent KDS timeout is journaled then closed for durable replay', async () => {
  const restore = installAndroid();
  const store = new Store();
  const journal = new LegacyMutationJournal(store);
  await journal.initializeForStartup();
  setNativeRequestTransportForTests((async () => ({ status: 504, data: { error: 'late response' } })) as any);
  try {
    await assert.rejects(
      dispatchLegacyLanMutation<any>({
        url: 'http://10.0.0.129:3001/api/ordenes/enviar-comanda/order-1',
        method: 'POST',
        body: '{}',
        operation: 'KDS_ORDER_DISPATCH',
        correlationId: 'kds:order-1:kitchen:cart-1:KDS_ORDER_DISPATCH',
        validateResponse: () => undefined,
        idempotentReplaySafe: true,
        journal,
        authorityState: { revision: 7, terminalId: 'terminal-a' },
      }),
      /LEGACY_MUTATION_OUTCOME_UNKNOWN:504/,
    );
    const row = [...store.rows.values()][0];
    assert.equal(row?.state, 'CLOSED');
    assert.equal(row?.classification, 'SAFE_IDEMPOTENT_REPLAY');
    assert.equal(journal.hasBlockingMutations(), false);
  } finally {
    restore();
  }
});

for (const invalidPayload of [{ success: false }, { message: 'missing explicit acknowledgement' }]) {
  test(`2xx legacy mutation with invalid schema becomes OUTCOME_UNKNOWN: ${JSON.stringify(invalidPayload)}`, async () => {
    const restore = installAndroid();
    const store = new Store();
    const journal = new LegacyMutationJournal(store);
    await journal.initializeForStartup();
    setNativeRequestTransportForTests((async () => ({ status: 200, data: invalidPayload })) as any);
    try {
      await assert.rejects(
        dispatchLegacyLanMutation<any>({
          url: 'http://10.0.0.129:3001/api/mesas/liberar',
          method: 'POST',
          body: '{}',
          operation: 'TABLE_RELEASE',
          validateResponse: (data) => {
            if (data?.success !== true) throw new Error('SUCCESS_ACK_REQUIRED');
          },
          journal,
          authorityState: { revision: 7, terminalId: 'terminal-a' },
        }),
        /LEGACY_MUTATION_RESPONSE_SCHEMA_INVALID/,
      );
      assert.equal([...store.rows.values()][0]?.state, 'OUTCOME_UNKNOWN');
    } finally {
      restore();
    }
  });
}

test('Android 1.1.435 table state response validates the nested table identity and snapshots', () => {
  const validate = validateLegacyTableStateResponse('table-7');
  assert.doesNotThrow(() => validate({
    success: true,
    table: { id: 'table-7', status: 'OCCUPIED' },
    tables: [{ id: 'table-7' }],
    parkedTickets: [{ id: 'order-1', tableId: 'table-7' }],
    revision: 19,
  }));
});

for (const [label, payload] of [
  ['success false', { success: false, table: { id: 'table-7' }, tables: [], parkedTickets: [], revision: 19 }],
  ['top-level id only', { success: true, id: 'table-7', tables: [], parkedTickets: [], revision: 19 }],
  ['wrong nested table', { success: true, table: { id: 'table-8' }, tables: [], parkedTickets: [], revision: 19 }],
  ['missing tables snapshot', { success: true, table: { id: 'table-7' }, parkedTickets: [], revision: 19 }],
  ['missing parked tickets snapshot', { success: true, table: { id: 'table-7' }, tables: [], revision: 19 }],
  ['missing revision', { success: true, table: { id: 'table-7' }, tables: [], parkedTickets: [] }],
] as const) {
  test(`table state response rejects ${label}`, () => {
    assert.throws(() => validateLegacyTableStateResponse('table-7')(payload));
  });
}

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
