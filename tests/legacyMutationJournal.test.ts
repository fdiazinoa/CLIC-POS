import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LegacyMutationJournal,
  LEGACY_MUTATION_JOURNAL_COLLECTION,
  type LegacyMutationJournalEntry,
  type LegacyMutationJournalStore,
} from '../services/sync/LegacyMutationJournal';

class MemoryJournalStore implements LegacyMutationJournalStore {
  readonly rows = new Map<string, LegacyMutationJournalEntry>();
  failWrites = false;

  async getCollection<T>(_collectionName: string): Promise<T[]> {
    return [...this.rows.values()].map(row => ({ ...row })) as T[];
  }

  async saveDocument<T extends { id: string }>(collectionName: string, document: T): Promise<void> {
    assert.equal(collectionName, LEGACY_MUTATION_JOURNAL_COLLECTION);
    if (this.failWrites) throw new Error('disk unavailable');
    this.rows.set(document.id, { ...document } as unknown as LegacyMutationJournalEntry);
  }

  async deleteDocument(collectionName: string, id: string): Promise<void> {
    assert.equal(collectionName, LEGACY_MUTATION_JOURNAL_COLLECTION);
    this.rows.delete(id);
  }
}

const begin = (journal: LegacyMutationJournal, index: number) => journal.begin({
  operationCorrelationId: `operation-${index}`,
  authorityFingerprint: 'http://10.0.0.129:3001|terminal-a',
  generation: 7,
  method: 'POST',
  url: `http://10.0.0.129:3001/api/sync/transactions?attempt=${index}`,
  diagnosticRequestId: `request-${index}`,
});

test('journal confirms one durable row per concurrent mutation and closes only the acknowledged row', async () => {
  const store = new MemoryJournalStore();
  const journal = new LegacyMutationJournal(store);
  await journal.initializeForStartup();
  const entries = await Promise.all(Array.from({ length: 10 }, (_, index) => begin(journal, index)));
  assert.equal(new Set(entries.map(entry => entry.id)).size, 10);
  assert.equal(store.rows.size, 10);
  assert.equal(journal.getBlockingIds().length, 10);

  await journal.acknowledge(entries[0].id, 'RESPONSE_VALID', 'caller:transaction:0');
  assert.equal(journal.getBlockingIds().length, 9);
  assert.equal(store.rows.get(entries[0].id)?.state, 'CLOSED');
  assert.equal(store.rows.get(entries[1].id)?.state, 'DISPATCHED');
});

test('persistence failure remains blocked in memory and prevents any later mutation admission', async () => {
  const store = new MemoryJournalStore();
  const journal = new LegacyMutationJournal(store);
  await journal.initializeForStartup();
  store.failWrites = true;
  await assert.rejects(begin(journal, 1), /LEGACY_MUTATION_JOURNAL_UNAVAILABLE/);
  assert.equal(journal.hasBlockingMutations(), true);
  await assert.rejects(begin(journal, 2), /LEGACY_MUTATION_JOURNAL_UNAVAILABLE/);
});

test('restart promotes every open DISPATCHED row to OUTCOME_UNKNOWN before authority admission', async () => {
  const store = new MemoryJournalStore();
  const first = new LegacyMutationJournal(store);
  await first.initializeForStartup();
  const dispatched = await begin(first, 1);

  const restarted = new LegacyMutationJournal(store);
  await restarted.initializeForStartup();
  assert.equal(store.rows.get(dispatched.id)?.state, 'OUTCOME_UNKNOWN');
  assert.throws(() => restarted.assertRemoteAuthorityAllowed('http://10.0.0.130:3001'), /HANDOFF_BLOCKED/);
  await assert.rejects(begin(restarted, 2), /OUTCOME_UNKNOWN/);
});

test('generation or fingerprint change immediately before transport becomes ambiguous', async () => {
  const store = new MemoryJournalStore();
  const journal = new LegacyMutationJournal(store);
  await journal.initializeForStartup();
  const entry = await begin(journal, 1);
  await assert.rejects(
    journal.prepareDispatch(entry.id, 'http://10.0.0.130:3001|terminal-a', 8),
    /AUTHORITY_CHANGED/,
  );
  assert.equal(store.rows.get(entry.id)?.state, 'OUTCOME_UNKNOWN');
  assert.equal(journal.hasOutcomeUnknown(), true);
});

test('an open DISPATCHED row permits same-authority concurrency but blocks generation rotation', async () => {
  const store = new MemoryJournalStore();
  const journal = new LegacyMutationJournal(store);
  await journal.initializeForStartup();
  await journal.begin({
    authorityFingerprint: 'http://10.0.0.129:3001|terminal-a',
    generation: 7,
    method: 'POST',
    url: 'http://10.0.0.129:3001/api/sync/transactions',
    diagnosticRequestId: 'dispatch-a',
  });
  assert.doesNotThrow(() => journal.assertRemoteAuthorityAllowed('http://10.0.0.129:3001'));
  assert.throws(() => journal.assertAuthorityGenerationChangeAllowed(), /GENERATION_BLOCKED/);
});

test('pruning bounds closed history and never removes open or unknown rows', async () => {
  const store = new MemoryJournalStore();
  const journal = new LegacyMutationJournal(store);
  await journal.initializeForStartup();
  for (let index = 0; index < 205; index += 1) {
    const entry = await begin(journal, index);
    await journal.acknowledge(entry.id, 'RESPONSE_VALID', `caller:${index}`);
  }
  const open = await begin(journal, 999);
  await journal.markOutcomeUnknown(open.id, 500);
  assert.equal([...store.rows.values()].filter(row => row.state === 'CLOSED').length, 200);
  assert.equal(store.rows.get(open.id)?.state, 'OUTCOME_UNKNOWN');
});
