import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LegacyMutationJournal,
  type LegacyMutationJournalEntry,
  type LegacyMutationJournalStore,
} from '../services/sync/LegacyMutationJournal';
import { reconcileMasterParkedTicketOutcome } from '../services/sync/masterParkedTicketReconciliation';

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
