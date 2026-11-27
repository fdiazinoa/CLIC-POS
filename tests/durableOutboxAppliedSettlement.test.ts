import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DurableOutboxBatchSender} from '../services/sync/DurableOutboxBatchSender';
import {
  AUTHORITY_CONTEXT_ABORT_HOLD_MS,
  AUTHORITY_CONTEXT_RETRY_HELD,
  boundedDurableRetry,
  isAuthorityContextAbort,
} from '../services/sync/DurableOutboxRetryPolicy';

type FakeRecord = Record<string, any>;

const saleEvent = (eventId: string): FakeRecord => ({
  eventId, localSequence: 1, eventType: 'SALE_POSTED', aggregateType: 'TRANSACTION', aggregateId: 'tx-1',
  schemaVersion: 1, payload: {transaction: {id: 'tx-1'}, summary: {}, occurred_at: '2026-01-01T00:00:00.000Z'},
  status: 'PENDING', attemptCount: 0, nextRetryAt: null, leaseOwner: null, leaseExpiresAt: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', lastError: null,
});

class FakeRepository {
  records: FakeRecord[];
  retries: Array<{id: string; error: string; at: Date}> = [];
  applied: string[] = [];
  rejected: string[] = [];
  constructor(records: FakeRecord[]) { this.records = records; }
  async recoverExpiredLeases(): Promise<number> { return 0; }
  async repairLegacyEventContracts(): Promise<number> { return 0; }
  async leaseDue(): Promise<FakeRecord[]> {
    return this.records.filter(record => record.status !== 'APPLIED_ERP').map(record => ({...record, status: 'SENDING'}));
  }
  async releaseUnsent(): Promise<void> { /* no-op */ }
  async markRejected(id: string): Promise<void> { this.rejected.push(id); }
  async markRetry(id: string, error: string, at?: Date): Promise<void> {
    this.retries.push({id, error: String(error), at: at || new Date()});
    const record = this.records.find(row => row.eventId === id);
    if (record) { record.attemptCount += 1; record.status = 'RETRY_WAIT'; record.lastError = String(error); }
  }
  async markAppliedErp(id: string): Promise<void> {
    this.applied.push(id);
    const record = this.records.find(row => row.eventId === id);
    if (record) record.status = 'APPLIED_ERP';
  }
  async markSyncedMaster(id: string): Promise<void> { this.markAppliedErp(id); }
  async markDispatchAppliedErp(id: string): Promise<void> { this.markAppliedErp(id); }
}

const sender = (repository: FakeRepository, transport: (events: any[]) => Promise<any>) =>
  new DurableOutboxBatchSender(repository as any, transport as any, async () => []);

const readSource = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

test('C2 a committed outbox push survives an authority rotation in flight (immutable push)', async () => {
  const {ApiSyncAdapter} = await import('../services/sync/ApiSyncAdapter');
  const api = new ApiSyncAdapter() as any;
  // ERP cloud origin differs from the LAN master: the batch is a remote cloud push, not a legacy LAN mutation.
  api.config = {masterUrl: 'https://master.invalid', terminalId: 'terminal-a'};
  api.isOnline = true;
  api.authToken = 'synthetic-token';
  api.operationalAuthorityEnabled = true;
  api.operationalAuthorityRevision = 1;
  const controller = new AbortController();
  api.operationalAuthorityAbortController = controller;
  api.resolveCapacitorPlatform = () => 'web';
  api.normalizeFetchHeaders = (headers: Record<string, string>) => headers;
  const originalFetch = globalThis.fetch;
  let authorityAbortObserved = 0;
  globalThis.fetch = ((_url: any, init: any) => new Promise((resolve, reject) => {
    init?.signal?.addEventListener?.('abort', () => {
      authorityAbortObserved += 1;
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    });
    // The authority rotates while the immutable outbox request is in flight.
    setTimeout(() => controller.abort(), 5);
    setTimeout(() => resolve(new Response(JSON.stringify({results: [{eventId: 'e1', disposition: 'APPLIED'}]}), {
      status: 200, headers: {'Content-Type': 'application/json'},
    })), 40);
  })) as any;
  try {
    const response = await api.fetchWithRetry(
      'https://erp.invalid/api/sync/inbox/batch',
      {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}', durableOutboxPush: true},
      0, 10, 'sales', 'PUSH_OPERATIONS', 1, controller.signal, 'durable-push',
    );
    assert.equal(response.status, 200, 'the applied batch response is accepted after the rotation');
    assert.equal(authorityAbortObserved, 0, 'the immutable push does not subscribe to the authority abort signal');
    // Backward compatibility: an authority-bound request with the same aborted signal still fails closed.
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(api.fetchWithRetry(
      'https://erp.invalid/api/sync/other',
      {method: 'GET'}, 0, 10, 'sales', 'PUSH_OPERATIONS', 1, aborted.signal, 'bound-request',
    ), /Master authority changed|aborted/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('C2 repair wiring: only the durable outbox batch opts out of the authority abort signal', () => {
  const adapter = readSource('services/sync/ApiSyncAdapter.ts');
  assert.match(adapter, /durableOutboxPush\?: boolean/);
  assert.match(adapter, /durableOutboxPush: true/);
  assert.match(adapter, /const durablePush = options\.durableOutboxPush === true;/);
  assert.match(adapter, /signal: durablePush \? undefined : authoritySignal/);
  assert.match(adapter, /if \(!durablePush\) this\.assertOperationalAuthorityCurrent/);
  const senderSource = readSource('services/sync/DurableOutboxBatchSender.ts');
  assert.match(senderSource, /boundedDurableRetry\(record\.attemptCount \+ 1, message/);
});

test('C2 an already-applied ERP replay settles APPLIED_ERP and stops retrying (0 duplicates)', async () => {
  const repository = new FakeRepository([saleEvent('sale-1'), saleEvent('sale-2')]);
  const summary = await sender(repository, async () => ({results: [
    {eventId: 'sale-1', disposition: 'ALREADY_APPLIED'},
    // ERP variants that only report the applied flags must settle too.
    {eventId: 'sale-2', applied: true, duplicate: true, alreadyApplied: true},
  ]})).sendNext(new Date('2026-01-01T00:00:00.000Z'));
  assert.deepEqual(repository.applied, ['sale-1', 'sale-2']);
  assert.equal(repository.retries.length, 0, 'no retry for an already-applied replay');
  assert.equal(summary.applied, 2);
  assert.deepEqual(repository.records.map(record => record.status), ['APPLIED_ERP', 'APPLIED_ERP']);
});

test('C2 a lost ACK converges on the next replay to APPLIED_ERP without duplicating', async () => {
  const repository = new FakeRepository([saleEvent('sale-1')]);
  let attempt = 0;
  const outbox = sender(repository, async () => {
    attempt += 1;
    if (attempt === 1) throw Object.assign(new Error('Authority request aborted'), {name: 'AbortError'});
    return {results: [{eventId: 'sale-1', disposition: 'DUPLICATE_APPLIED'}]};
  });
  const first = await outbox.sendNext(new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(first.retrying, 1);
  assert.equal(repository.applied.length, 0);
  assert.equal(repository.retries.length, 1);
  const second = await outbox.sendNext(new Date('2026-01-01T00:05:00.000Z'));
  assert.equal(second.applied, 1);
  assert.deepEqual(repository.applied, ['sale-1'], 'the replay is settled once, never duplicated');
  assert.equal(repository.retries.length, 1, 'the settled event is not retried again');
  assert.equal(repository.records[0].status, 'APPLIED_ERP');
});

test('C2 an ERP authority result (not already-applied) keeps the C1 bounded retry behavior', async () => {
  const repository = new FakeRepository([saleEvent('sale-1')]);
  const summary = await sender(repository, async () => ({results: [
    {eventId: 'sale-1', status: 'FAILED', error: 'FISCAL_OFFLINE_AUTHORITY_CHANGED', retryable: true},
  ]})).sendNext(new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(summary.retrying, 1);
  assert.equal(repository.applied.length, 0);
  assert.equal(repository.retries.length, 1);
  assert.equal(repository.retries[0].error, 'FISCAL_OFFLINE_AUTHORITY_CHANGED');
  const delay = repository.retries[0].at.getTime() - Date.parse('2026-01-01T00:00:00.000Z');
  assert.ok(delay > 0 && delay <= 5 * 60_000, `bounded C1 retry delay (${delay}ms)`);
});

test('C2 a repeated authority abort is capped: explicit 30 min hold instead of a 5 min infinite loop', async () => {
  const stuck = {...saleEvent('sale-1'), attemptCount: 10};
  const repository = new FakeRepository([stuck]);
  await sender(repository, async () => { throw Object.assign(new Error('Authority request aborted'), {name: 'AbortError'}); })
    .sendNext(new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(repository.retries.length, 1);
  assert.match(repository.retries[0].error, new RegExp(AUTHORITY_CONTEXT_RETRY_HELD));
  const delay = repository.retries[0].at.getTime() - Date.parse('2026-01-01T00:00:00.000Z');
  assert.equal(delay, AUTHORITY_CONTEXT_ABORT_HOLD_MS);
  assert.ok(delay > 5 * 60_000, 'the old capped 5 minute loop is gone for this cause');
});

test('C2 retry policy classifies and bounds only authority-context aborts', () => {
  assert.equal(isAuthorityContextAbort('Authority request aborted'), true);
  assert.equal(isAuthorityContextAbort('Master authority changed'), true);
  assert.equal(isAuthorityContextAbort('FETCH timed out'), false);
  assert.equal(boundedDurableRetry(1, 'Authority request aborted', 5000, 300000).held, false);
  assert.deepEqual(boundedDurableRetry(5, 'Authority request aborted', 5000, 300000), {delayMs: AUTHORITY_CONTEXT_ABORT_HOLD_MS, held: true});
  assert.deepEqual(boundedDurableRetry(2, 'socket hang up', 5000, 300000), {delayMs: 10000, held: false});
});
