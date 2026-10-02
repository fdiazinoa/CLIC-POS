import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LegacyMutationJournal,
  type LegacyMutationJournalEntry,
  type LegacyMutationJournalStore,
} from '../services/sync/LegacyMutationJournal';
import {
  reconcileMasterParkedTicketOutcome,
  reconcileMasterRejectedTableMutations,
} from '../services/sync/masterParkedTicketReconciliation';

class Store implements LegacyMutationJournalStore {
  rows = new Map<string, LegacyMutationJournalEntry>();
  async getCollection<T>(): Promise<T[]> { return [...this.rows.values()] as T[]; }
  async saveDocument<T extends { id: string }>(_collection: string, doc: T): Promise<void> {
    this.rows.set(doc.id, { ...doc } as unknown as LegacyMutationJournalEntry);
  }
  async deleteDocument(_collection: string, id: string): Promise<void> { this.rows.delete(id); }
}

const ticket = { id: 'order-4', tableId: 'table-4', items: [{ id: 'water', quantity: 2 }], total: 283.2 };
const origin = 'http://10.0.0.129:3001';
const terminalId = 'client-terminal';
const generation = 7;

const persistedLegacy409 = (overrides: Partial<LegacyMutationJournalEntry> = {}): LegacyMutationJournalEntry => ({
  id: 'legacy-409',
  operationCorrelationId: 'PARKED_TICKETS_SYNC:legacy',
  authorityFingerprint: `${origin}|${terminalId}`,
  generation,
  method: 'PUT',
  canonicalPath: '/api/mesas/parked-tickets',
  diagnosticRequestId: 'legacy-409',
  state: 'OUTCOME_UNKNOWN',
  createdAt: '2026-10-02T20:14:34.000Z',
  dispatchedAt: '2026-10-02T20:14:35.000Z',
  httpStatus: 409,
  classification: 'OUTCOME_UNKNOWN',
  callerAckAt: null,
  callerAckReference: null,
  closedAt: null,
  ...overrides,
});

const fixture = async (operationCorrelationId = 'MASTER_PARKED_TICKETS_SYNC:one') => {
  const store = new Store();
  const journal = new LegacyMutationJournal(store);
  await journal.initializeForStartup();
  const entry = await journal.begin({
    operationCorrelationId,
    authorityFingerprint: `${origin}|master-terminal`,
    generation: 1,
    method: 'PUT',
    url: `${origin}/api/mesas/parked-tickets`,
    diagnosticRequestId: operationCorrelationId,
  });
  await journal.prepareDispatch(entry.id, entry.authorityFingerprint, 1);
  await journal.markOutcomeUnknown(entry.id, null);
  const nowMs = Date.parse(journal.getEntry(entry.id)!.dispatchedAt!) + 16_000;
  const reconcile = (parkedTickets: unknown, overrides: Record<string, unknown> = {}) =>
    reconcileMasterParkedTicketOutcome({
      journal,
      tickets: [ticket],
      tableId: 'table-4',
      authorityOrigin: origin,
      readNativeSnapshot: async () => ({ revision: 42, parkedTickets }),
      nowMs,
      ...overrides,
    });
  return { store, journal, entry, reconcile };
};

test('Master closes an old ambiguous self-write only after exact native snapshot match', async () => {
  const { journal, entry, reconcile } = await fixture();
  assert.equal(await reconcile([ticket]), 42);
  assert.equal(journal.hasBlockingMutations(), false);
  assert.equal(journal.getEntry(entry.id)?.callerAckReference, 'RECONCILED_NATIVE_MASTER_SNAPSHOT:42');
});

test('different items, a younger request, or a different operation stays blocked', async () => {
  const mismatch = await fixture();
  assert.equal(await mismatch.reconcile([{ ...ticket, items: [] }]), null);
  assert.equal(mismatch.journal.hasOutcomeUnknown(), true);

  const otherTableChanged = await fixture();
  assert.equal(await otherTableChanged.reconcile([ticket, { id: 'order-7', tableId: 'table-7', items: [] }]), null);
  assert.equal(otherTableChanged.journal.hasOutcomeUnknown(), true);

  const young = await fixture();
  assert.equal(await young.reconcile([ticket], { nowMs: Date.parse(young.journal.getEntry(young.entry.id)!.dispatchedAt!) + 5_000 }), null);
  assert.equal(young.journal.hasOutcomeUnknown(), true);

  const unrelated = await fixture('OTHER_MUTATION:one');
  assert.equal(await unrelated.reconcile([ticket]), null);
  assert.equal(unrelated.journal.hasOutcomeUnknown(), true);
});

test('an additional ambiguous mutation prevents automatic reconciliation', async () => {
  const store = new Store();
  const journal = new LegacyMutationJournal(store);
  await journal.initializeForStartup();
  const first = await journal.begin({
    operationCorrelationId: 'MASTER_PARKED_TICKETS_SYNC:first',
    authorityFingerprint: `${origin}|master-terminal`,
    generation: 1,
    method: 'PUT',
    url: `${origin}/api/mesas/parked-tickets`,
    diagnosticRequestId: 'first',
  });
  const second = await journal.begin({
    authorityFingerprint: `${origin}|master-terminal`,
    generation: 1,
    method: 'POST',
    url: `${origin}/api/sales`,
    diagnosticRequestId: 'other',
  });
  await journal.markOutcomeUnknown(first.id, null);
  await journal.markOutcomeUnknown(second.id, null);
  assert.equal(await reconcileMasterParkedTicketOutcome({
    journal,
    tickets: [ticket],
    tableId: 'table-4',
    authorityOrigin: origin,
    readNativeSnapshot: async () => ({ revision: 42, parkedTickets: [ticket] }),
  }), null);
  assert.equal(journal.hasBlockingMutations(), true);
});

test('an old client 409 table rejection is closed before a later table acquire', async () => {
  const store = new Store();
  const entry = persistedLegacy409();
  store.rows.set(entry.id, entry);
  const journal = new LegacyMutationJournal(store);
  await journal.initializeForStartup();
  const nowMs = Date.parse(entry.dispatchedAt!) + 16_000;
  assert.equal(await reconcileMasterRejectedTableMutations({
    journal,
    authorityOrigin: origin,
    terminalId,
    generation,
    nowMs,
  }), 1);
  assert.equal(journal.hasBlockingMutations(), false);
  assert.equal(journal.getEntry(entry.id)?.classification, 'SAFE_PRE_SIDE_EFFECT');
  await assert.doesNotReject(journal.begin({
    operationCorrelationId: 'TABLE_LOCK_ACQUIRE:next',
    authorityFingerprint: `${origin}|${terminalId}`,
    generation,
    method: 'POST',
    url: `${origin}/api/mesas/bloquear`,
    diagnosticRequestId: 'next-acquire',
  }));
});

test('legacy recovery rejects ambiguous, unrelated, wrong identity, wrong generation and recent rows', async () => {
  for (const scenario of [
    { method: 'PUT', path: '/api/mesas/parked-tickets', status: null, authority: origin, rowTerminalId: terminalId, rowGeneration: generation, ageMs: 16_000 },
    { method: 'POST', path: '/api/mesas/unir', status: 409, authority: origin, rowTerminalId: terminalId, rowGeneration: generation, ageMs: 16_000 },
    { method: 'PUT', path: '/api/mesas/parked-tickets', status: 409, authority: 'http://10.0.0.28:3001', rowTerminalId: terminalId, rowGeneration: generation, ageMs: 16_000 },
    { method: 'PUT', path: '/api/mesas/parked-tickets', status: 409, authority: origin, rowTerminalId: 'other-terminal', rowGeneration: generation, ageMs: 16_000 },
    { method: 'PUT', path: '/api/mesas/parked-tickets', status: 409, authority: origin, rowTerminalId: terminalId, rowGeneration: generation - 1, ageMs: 16_000 },
    { method: 'PUT', path: '/api/mesas/parked-tickets', status: 409, authority: origin, rowTerminalId: terminalId, rowGeneration: generation, ageMs: 5_000 },
  ]) {
    const store = new Store();
    const entry = persistedLegacy409({
      id: `candidate-${scenario.authority}-${scenario.rowTerminalId}-${scenario.rowGeneration}-${scenario.ageMs}`,
      authorityFingerprint: `${scenario.authority}|${scenario.rowTerminalId}`,
      generation: scenario.rowGeneration,
      method: scenario.method,
      canonicalPath: scenario.path,
      httpStatus: scenario.status,
    });
    store.rows.set(entry.id, entry);
    const journal = new LegacyMutationJournal(store);
    await journal.initializeForStartup();
    const nowMs = Date.parse(journal.getEntry(entry.id)!.dispatchedAt!) + scenario.ageMs;
    assert.equal(await reconcileMasterRejectedTableMutations({
      journal,
      authorityOrigin: origin,
      terminalId,
      generation,
      nowMs,
    }), 0);
    assert.equal(journal.hasOutcomeUnknown(), true);
  }
});

test('a new marked parked-ticket conflict remains blocked after the legacy recovery age', async () => {
  const store = new Store();
  const journal = new LegacyMutationJournal(store);
  await journal.initializeForStartup();
  const entry = await journal.begin({
    operationCorrelationId: 'PARKED_TICKETS_SYNC:other-conflict',
    authorityFingerprint: `${origin}|${terminalId}`,
    generation,
    method: 'PUT',
    url: `${origin}/api/mesas/parked-tickets`,
    diagnosticRequestId: 'other-conflict',
    reconciliationContext: { serverCode: 'OTHER_CONFLICT' },
  });
  await journal.prepareDispatch(entry.id, entry.authorityFingerprint, generation);
  await journal.recordHttpStatus(entry.id, 409);
  await journal.markOutcomeUnknown(entry.id, 409);
  const persisted = journal.getEntry(entry.id)!;
  assert.deepEqual(persisted.reconciliationContext, {
    serverCode: 'OTHER_CONFLICT',
    legacyMutationContractVersion: 2,
  });
  const nowMs = Date.parse(persisted.dispatchedAt!) + 16_000;
  assert.equal(await reconcileMasterRejectedTableMutations({
    journal,
    authorityOrigin: origin,
    terminalId,
    generation,
    nowMs,
  }), 0);
  assert.equal(journal.hasOutcomeUnknown(), true);
});

for (const [label, reconciliationContext] of [
  ['null marker', { legacyMutationContractVersion: null }],
  ['empty marker', { legacyMutationContractVersion: '' }],
  ['false marker', { legacyMutationContractVersion: false }],
  ['NaN string marker', { legacyMutationContractVersion: 'NaN' }],
] as const) {
  test(`legacy recovery rejects ${label}`, async () => {
    const store = new Store();
    const entry = persistedLegacy409({ id: `malformed-${label}`, reconciliationContext });
    store.rows.set(entry.id, entry);
    const journal = new LegacyMutationJournal(store);
    await journal.initializeForStartup();
    assert.equal(await reconcileMasterRejectedTableMutations({
      journal,
      authorityOrigin: origin,
      terminalId,
      generation,
      nowMs: Date.parse(entry.dispatchedAt!) + 16_000,
    }), 0);
    assert.equal(journal.hasOutcomeUnknown(), true);
  });
}

for (const [label, reconciliationContext] of [
  ['absent marker', undefined],
  ['null context', null],
  ['numeric version 1', { legacyMutationContractVersion: 1 }],
] as const) {
  test(`legacy recovery accepts ${label}`, async () => {
    const store = new Store();
    const entry = persistedLegacy409({
      id: `legacy-${label}`,
      reconciliationContext: reconciliationContext as Record<string, unknown> | undefined,
    });
    store.rows.set(entry.id, entry);
    const journal = new LegacyMutationJournal(store);
    await journal.initializeForStartup();
    assert.equal(await reconcileMasterRejectedTableMutations({
      journal,
      authorityOrigin: origin,
      terminalId,
      generation,
      nowMs: Date.parse(entry.dispatchedAt!) + 16_000,
    }), 1);
    assert.equal(journal.hasBlockingMutations(), false);
  });
}
