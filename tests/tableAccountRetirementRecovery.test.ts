import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LegacyMutationJournal, type LegacyMutationJournalEntry, type LegacyMutationJournalStore,
} from '../services/sync/LegacyMutationJournal';
import { reconcileClientRetiredAccountBeforeAuthorityAssertion, reconcileRetiredTableAccountOutcome } from '../services/sync/masterParkedTicketReconciliation';

class Store implements LegacyMutationJournalStore {
  rows = new Map<string, LegacyMutationJournalEntry>();
  async getCollection<T>(): Promise<T[]> { return [...this.rows.values()] as T[]; }
  async saveDocument<T extends { id: string }>(_collection: string, value: T): Promise<void> {
    this.rows.set(value.id, structuredClone(value) as unknown as LegacyMutationJournalEntry);
  }
  async deleteDocument(_collection: string, id: string): Promise<void> { this.rows.delete(id); }
}

const origin = 'http://10.0.0.129:3001';
const source = { id: 'source', tableId: 'mesa-7', joinedTableIds: ['mesa-7', 'mesa-8'], items: [{ id: 'water', quantity: 1 }], total: 100 };
const targetBefore = { id: 'target', tableId: 'mesa-7', joinedTableIds: ['mesa-7', 'mesa-8'], items: [], total: 0 };
const targetAfter = { ...targetBefore, items: [{ id: 'water', quantity: 1, transferredFromTicketId: 'source' }], total: 100 };
const other = { id: 'third', tableId: 'mesa-9', items: [], total: 0 };
const pre = [source, targetBefore];
const post = [targetAfter];

const makeJournal = async () => {
  const store = new Store();
  let journal = new LegacyMutationJournal(store);
  await journal.initializeForStartup();
  const entry = await journal.begin({
    operationCorrelationId: 'PARKED_TICKETS_SYNC:retire-source',
    authorityFingerprint: `${origin}|client-1`, generation: 7,
    method: 'PUT', url: `${origin}/api/mesas/parked-tickets`, diagnosticRequestId: 'retire-source',
    reconciliationContext: {
      kind: 'TABLE_ACCOUNT_RETIRE_V1', tableId: 'mesa-7', sourceId: 'source',
      expectedTableTickets: post, preTableTickets: pre,
      lockOwnerId: 'device-1', lockToken: 'old-token',
    },
  });
  await journal.prepareDispatch(entry.id, entry.authorityFingerprint, 7);
  await journal.markOutcomeUnknown(entry.id, null);
  const restart = async () => {
    journal = new LegacyMutationJournal(store);
    await journal.initializeForStartup();
    return journal;
  };
  return { store, journal, entry, restart };
};

const reconcile = (journal: LegacyMutationJournal, readSnapshot: () => Promise<{ revision: number; parkedTickets: unknown[] }>, fenceOldLock?: (lock: { tableId: string; ownerId: string; token: string }) => Promise<boolean>) =>
  reconcileRetiredTableAccountOutcome({ journal, authorityOrigin: origin, terminalId: 'client-1', readSnapshot, fenceOldLock });

test('timeout después de aplicar y restart cierran journal solo con scope exacto; no liberan lock', async () => {
  const fixture = await makeJournal();
  const restarted = await fixture.restart();
  let fences = 0;
  assert.equal(await reconcile(restarted, async () => ({ revision: 42, parkedTickets: [other, ...post] }), async () => { fences++; return true; }), true);
  assert.equal(fences, 0);
  assert.equal(restarted.hasBlockingMutations(), false);
  assert.equal(restarted.getEntry(fixture.entry.id)?.classification, 'RESPONSE_VALID');
});

test('timeout antes de aplicar requiere release confirmado y segundo GET; PUT tardío con token viejo falla', async () => {
  const fixture = await makeJournal();
  const restarted = await fixture.restart();
  let oldLockActive = true;
  const events: string[] = [];
  const readSnapshot = async () => {
    events.push('GET');
    return { revision: oldLockActive ? 41 : 42, parkedTickets: [other, ...pre] };
  };
  const result = await reconcile(restarted, readSnapshot, async lock => {
    events.push('RELEASE');
    assert.deepEqual(lock, { tableId: 'mesa-7', ownerId: 'device-1', token: 'old-token' });
    oldLockActive = false;
    return true;
  });
  const delayedPutCanApply = oldLockActive;
  assert.equal(result, true);
  assert.deepEqual(events, ['GET', 'RELEASE', 'GET']);
  assert.equal(delayedPutCanApply, false);
  assert.equal(restarted.getEntry(fixture.entry.id)?.classification, 'SAFE_PRE_SIDE_EFFECT');
});

test('PUT que gana carrera antes del release se reconoce aplicado en segundo GET', async () => {
  const fixture = await makeJournal();
  let current = [other, ...pre];
  let reads = 0;
  assert.equal(await reconcile(fixture.journal, async () => ({ revision: 41 + ++reads, parkedTickets: current }), async () => {
    current = [other, ...post]; // serialized PUT completed before synchronized release
    return true;
  }), true);
  assert.equal(reads, 2);
  assert.equal(fixture.journal.getEntry(fixture.entry.id)?.classification, 'RESPONSE_VALID');
});

test('release fallida, GET distinto, fingerprint ajeno y ghost source permanecen bloqueados', async () => {
  const failure = await makeJournal();
  let reads = 0;
  assert.equal(await reconcile(failure.journal, async () => ({ revision: ++reads, parkedTickets: [other, ...pre] }), async () => false), false);
  assert.equal(reads, 1);
  assert.equal(failure.journal.hasOutcomeUnknown(), true);

  const mismatch = await makeJournal();
  assert.equal(await reconcile(mismatch.journal, async () => ({ revision: 42, parkedTickets: [other, { ...targetAfter, total: 999 }] })), false);
  assert.equal(mismatch.journal.hasOutcomeUnknown(), true);

  const ghost = await makeJournal();
  assert.equal(await reconcile(ghost.journal, async () => ({ revision: 42, parkedTickets: [other, { ...source, tableId: 'mesa-9' }, ...post] })), false);
  assert.equal(ghost.journal.hasOutcomeUnknown(), true);

  const wrongAuthority = await makeJournal();
  assert.equal(await reconcileRetiredTableAccountOutcome({ journal: wrongAuthority.journal, authorityOrigin: 'http://other:3001', terminalId: 'client-1', readSnapshot: async () => ({ revision: 42, parkedTickets: post }) }), false);
});

test('completion fallida/restart recupera ACK aplicado sin repetir transferencia', async () => {
  const fixture = await makeJournal();
  // A receipt with a failed durable completion remains open on restart.
  const restarted = await fixture.restart();
  assert.equal(restarted.hasOutcomeUnknown(), true);
  assert.equal(await reconcile(restarted, async () => ({ revision: 43, parkedTickets: [other, ...post] })), true);
  assert.equal(restarted.hasBlockingMutations(), false);
});

test('arranque frío reconcilia antes de autoridad con GET, release y GET en origen durable', async () => {
  const fixture = await makeJournal();
  const restarted = await fixture.restart();
  let released = false;
  const requests: string[] = [];
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    requests.push(`${init?.method || 'GET'} ${path}`);
    if (path === '/api/mesas/desbloquear') {
      assert.deepEqual(JSON.parse(String(init?.body)), { tableId: 'mesa-7', ownerId: 'device-1', token: 'old-token' });
      released = true;
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ revision: released ? 42 : 41, parkedTickets: [other, ...pre] }), { status: 200 });
  };
  assert.equal(await reconcileClientRetiredAccountBeforeAuthorityAssertion({
    journal: restarted, authorityBaseUrl: origin, terminalId: 'client-1', fetcher: fetcher as typeof fetch,
  }), true);
  assert.deepEqual(requests, ['GET /api/mesas', 'POST /api/mesas/desbloquear', 'GET /api/mesas']);
  restarted.assertRemoteAuthorityAllowed();
});

test('restart cierra solo heartbeat de lock efímero y permite reconciliar PUT retiro separado', async () => {
  const fixture = await makeJournal();
  const retiredRow = fixture.store.rows.get(fixture.entry.id)!;
  fixture.store.rows.set('heartbeat', {
    ...retiredRow, id: 'heartbeat', operationCorrelationId: 'TABLE_LOCK_ACQUIRE:heartbeat',
    method: 'POST', canonicalPath: '/api/mesas/bloquear', state: 'DISPATCHED',
    classification: null, closedAt: null,
  });
  const restarted = await fixture.restart();
  assert.equal(restarted.getEntry('heartbeat')?.classification, 'NON_BLOCKING_MAINTENANCE');
  assert.equal(restarted.getEntry(fixture.entry.id)?.state, 'OUTCOME_UNKNOWN');
  assert.equal(await reconcile(restarted, async () => ({ revision: 42, parkedTickets: [other, ...post] })), true);
  restarted.assertRemoteAuthorityAllowed();
});

test('un heartbeat no autoriza cerrar una mutación ajena que también quedó incierta', async () => {
  const fixture = await makeJournal();
  const retiredRow = fixture.store.rows.get(fixture.entry.id)!;
  fixture.store.rows.set('heartbeat', {
    ...retiredRow, id: 'heartbeat', operationCorrelationId: 'TABLE_LOCK_ACQUIRE:heartbeat',
    method: 'POST', canonicalPath: '/api/mesas/bloquear', state: 'DISPATCHED', closedAt: null,
  });
  fixture.store.rows.set('sale', {
    ...retiredRow, id: 'sale', operationCorrelationId: 'SALE_POST:other',
    method: 'POST', canonicalPath: '/api/sales', state: 'DISPATCHED', closedAt: null,
  });
  const restarted = await fixture.restart();
  assert.equal(restarted.getEntry('heartbeat')?.classification, 'NON_BLOCKING_MAINTENANCE');
  assert.equal(restarted.getEntry('sale')?.state, 'OUTCOME_UNKNOWN');
  assert.equal(await reconcile(restarted, async () => ({ revision: 42, parkedTickets: [other, ...post] })), false);
  assert.equal(restarted.hasOutcomeUnknown(), true);
});
