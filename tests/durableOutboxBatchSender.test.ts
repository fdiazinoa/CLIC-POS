import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
    DurableOutboxBatchSender,
    POS_2B_MAX_EVENTS,
    POS_2B_MAX_REQUEST_BYTES,
    POS_2B_MAX_TRANSACTIONS,
    selectDurableBatch,
    type DurableOutboxWireEvent,
} from '../services/sync/DurableOutboxBatchSender';
import type { DurableOutboxRecord } from '../services/sync/DurableOutboxRepository';

const record = (index: number, options: {
    aggregateType?: string;
    aggregateId?: string;
    payload?: Record<string, any>;
} = {}): DurableOutboxRecord => ({
    localSequence: index,
    eventId: `event-${index}`,
    eventType: options.aggregateType === 'INVENTORY' ? 'INVENTORY_CHANGED' : 'TRANSACTION_CREATED',
    aggregateType: options.aggregateType || 'TRANSACTION',
    aggregateId: options.aggregateId || `sale-${index}`,
    schemaVersion: 1,
    payload: options.payload || { transactionId: `sale-${index}` },
    status: 'SENDING',
    attemptCount: 1,
    nextRetryAt: null,
    leaseOwner: 'test-worker',
    leaseExpiresAt: '2026-08-22T18:02:00.000Z',
    createdAt: `2026-08-22T18:00:${String(index % 60).padStart(2, '0')}.000Z`,
    updatedAt: '2026-08-22T18:00:00.000Z',
    lastError: null,
});

test('batch selection stops at 25 transactions while preserving FIFO', () => {
    const leased = Array.from({ length: 40 }, (_, index) => record(index + 1));
    const selection = selectDurableBatch(leased);

    assert.equal(selection.events.length, POS_2B_MAX_TRANSACTIONS);
    assert.deepEqual(selection.events.map(event => event.localSequence), Array.from({ length: 25 }, (_, index) => index + 1));
    assert.equal(selection.deferred.length, 15);
});

test('batch selection accepts up to 50 non-transaction events', () => {
    const leased = Array.from({ length: 60 }, (_, index) => record(index + 1, {
        aggregateType: 'INVENTORY',
    }));
    const selection = selectDurableBatch(leased);

    assert.equal(selection.events.length, POS_2B_MAX_EVENTS);
    assert.equal(selection.deferred.length, 10);
});

test('batch selection respects the 512 KB uncompressed request ceiling', () => {
    const leased = [
        record(1, { payload: { value: 'a'.repeat(300 * 1024) } }),
        record(2, { payload: { value: 'b'.repeat(300 * 1024) } }),
    ];
    const selection = selectDurableBatch(leased);

    assert.equal(selection.events.length, 1);
    assert.equal(selection.deferred.length, 1);
    assert.ok(selection.payloadBytes < POS_2B_MAX_REQUEST_BYTES);

    const oversized = selectDurableBatch([
        record(3, { payload: { value: 'x'.repeat(POS_2B_MAX_REQUEST_BYTES) } }),
    ]);
    assert.deepEqual(oversized.oversized.map(event => event.eventId), ['event-3']);
    assert.equal(oversized.events.length, 0);
});

test('individual results apply, durably receive, retry and reject without replaying successful eventIds', async () => {
    const leased = [record(1), record(2), record(3), record(4)];
    const calls: Array<{ method: string; eventId: string }> = [];
    const repository = {
        recoverExpiredLeases: async () => 0,
        leaseDue: async () => leased,
        releaseUnsent: async (ids: string[]) => ids.forEach(eventId => calls.push({ method: 'release', eventId })),
        markRejected: async (eventId: string) => { calls.push({ method: 'rejected', eventId }); },
        markRetry: async (eventId: string) => { calls.push({ method: 'retry', eventId }); },
        markAppliedErp: async (eventId: string) => { calls.push({ method: 'applied', eventId }); },
        markSyncedMaster: async (eventId: string) => { calls.push({ method: 'received', eventId }); },
    };
    let sent: DurableOutboxWireEvent[] = [];
    const sender = new DurableOutboxBatchSender(
        repository as any,
        async events => {
            sent = events;
            return {
                results: [
                    { eventId: 'event-1', status: 'APPLIED' },
                    { event_id: 'event-2', status: 'RECEIVED' },
                    { eventId: 'event-3', status: 'FAILED', retryable: true, error: 'temporary' },
                    { eventId: 'event-4', status: 'REJECTED', retryable: false, error: 'invalid payload' },
                ],
            };
        },
    );

    const summary = await sender.sendNext(new Date('2026-08-22T18:00:00.000Z'));
    assert.deepEqual(sent.map(event => event.eventId), leased.map(event => event.eventId));
    assert.deepEqual(calls, [
        { method: 'applied', eventId: 'event-1' },
        { method: 'received', eventId: 'event-2' },
        { method: 'retry', eventId: 'event-3' },
        { method: 'rejected', eventId: 'event-4' },
    ]);
    assert.deepEqual(
        { applied: summary.applied, received: summary.received, retrying: summary.retrying, rejected: summary.rejected },
        { applied: 1, received: 1, retrying: 1, rejected: 1 },
    );
});

test('ERP-2B eventResults contract maps APPLIED and DUPLICATE_APPLIED to APPLIED_ERP', async () => {
    const leased = [record(1), record(2)];
    const applied: string[] = [];
    const repository = {
        recoverExpiredLeases: async () => 0,
        repairLegacyEventIds: async () => 0,
        leaseDue: async () => leased,
        releaseUnsent: async () => undefined,
        markRejected: async () => undefined,
        markRetry: async () => undefined,
        markAppliedErp: async (eventId: string) => { applied.push(eventId); },
        markSyncedMaster: async () => undefined,
    };
    const sender = new DurableOutboxBatchSender(repository as any, async () => ({
        success: true,
        status: 'accepted',
        eventResults: [
            { eventId: 'event-1', disposition: 'APPLIED', inboxStatus: 'APPLIED', retryable: false },
            { eventId: 'event-2', disposition: 'DUPLICATE_APPLIED', inboxStatus: 'APPLIED', retryable: false },
        ],
        retryableEventIds: [],
    }));

    const summary = await sender.sendNext(new Date('2026-08-22T18:00:00.000Z'));
    assert.deepEqual(applied, ['event-1', 'event-2']);
    assert.equal(summary.applied, 2);
    assert.equal(summary.retrying, 0);
});

test('transport failures retry the same durable eventIds and never acknowledge the batch globally', async () => {
    const leased = [record(1), record(2)];
    const retried: string[] = [];
    const repository = {
        recoverExpiredLeases: async () => 0,
        leaseDue: async () => leased,
        releaseUnsent: async () => undefined,
        markRejected: async () => undefined,
        markRetry: async (eventId: string) => { retried.push(eventId); },
        markAppliedErp: async () => undefined,
        markSyncedMaster: async () => undefined,
    };
    const sender = new DurableOutboxBatchSender(repository as any, async events => {
        assert.deepEqual(events.map(event => event.eventId), ['event-1', 'event-2']);
        throw new Error('network unavailable');
    });

    const summary = await sender.sendNext(new Date('2026-08-22T18:00:00.000Z'));
    assert.deepEqual(retried, ['event-1', 'event-2']);
    assert.equal(summary.retrying, 2);
    assert.equal(summary.applied, 0);
});

test('a global success without per-event results retries every event', async () => {
    const leased = [record(1), record(2)];
    const retried: string[] = [];
    const repository = {
        recoverExpiredLeases: async () => 0,
        leaseDue: async () => leased,
        releaseUnsent: async () => undefined,
        markRejected: async () => undefined,
        markRetry: async (eventId: string) => { retried.push(eventId); },
        markAppliedErp: async () => undefined,
        markSyncedMaster: async () => undefined,
    };
    const sender = new DurableOutboxBatchSender(repository as any, async () => ({ status: 'success' }));

    const summary = await sender.sendNext(new Date('2026-08-22T18:00:00.000Z'));
    assert.deepEqual(retried, ['event-1', 'event-2']);
    assert.equal(summary.retrying, 2);
    assert.equal(summary.applied, 0);
    assert.equal(summary.received, 0);
});

test('runtime wiring uses the ERP batch endpoint and disables duplicate legacy sale pushes', async () => {
    const [api, background, repository] = await Promise.all([
        readFile(new URL('../services/sync/ApiSyncAdapter.ts', import.meta.url), 'utf8'),
        readFile(new URL('../services/sync/BackgroundSyncManager.ts', import.meta.url), 'utf8'),
        readFile(new URL('../services/sync/DurableOutboxRepository.ts', import.meta.url), 'utf8'),
    ]);

    assert.match(api, /postOperationalPayload\('\/inbox\/batch',[\s\S]*?512 \* 1024/);
    assert.match(background, /durableOutboxBatchSender\.sendNext/);
    assert.match(background, /} else \{[\s\S]*?pushTransaction/);
    assert.match(background, /if \(!durableBatchActive\)[\s\S]*?pushInventoryMovement/);
    assert.match(repository, /status IN \('PENDING','SENDING','RETRY_WAIT'\)/);
});
