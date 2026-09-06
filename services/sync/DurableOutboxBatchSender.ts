import { recordCheckoutDiagnostic } from '../CheckoutDiagnostics';
import { apiSyncAdapter } from './ApiSyncAdapter';
import {
    durableOutboxRepository,
    type DurableOutboxRecord,
    type DurableOutboxRepository,
} from './DurableOutboxRepository';
import { syncMetrics } from './SyncMetrics';

export const POS_2B_MAX_TRANSACTIONS = 25;
export const POS_2B_MAX_EVENTS = 50;
export const POS_2B_MAX_REQUEST_BYTES = 512 * 1024;
export const POS_2B_ENVELOPE_RESERVE_BYTES = 4 * 1024;
const LEASE_MS = 2 * 60_000;
const BASE_RETRY_MS = 5_000;
const MAX_RETRY_MS = 5 * 60_000;

export interface DurableOutboxWireEvent {
    eventId: string;
    localSequence: number;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    aggregateVersion: number;
    schemaVersion: number;
    terminalId?: string;
    transactionId?: string;
    payload: Record<string, any>;
    createdAt: string;
}

export interface DurableBatchSelection {
    events: DurableOutboxRecord[];
    deferred: DurableOutboxRecord[];
    oversized: DurableOutboxRecord[];
    payloadBytes: number;
}

export interface DurableBatchSendSummary {
    leased: number;
    sent: number;
    applied: number;
    received: number;
    retrying: number;
    rejected: number;
    deferred: number;
    payloadBytes: number;
}

type BatchTransport = (events: DurableOutboxWireEvent[]) => Promise<any>;

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

export const toDurableWireEvent = (record: DurableOutboxRecord): DurableOutboxWireEvent => ({
    eventId: record.eventId,
    localSequence: record.localSequence,
    eventType: record.eventType,
    aggregateType: record.aggregateType,
    aggregateId: record.aggregateId,
    aggregateVersion: Number(record.payload?.aggregateVersion || record.payload?.transaction?.version || 1),
    schemaVersion: record.schemaVersion,
    ...(record.payload?.transaction?.terminalId ? { terminalId: String(record.payload.transaction.terminalId) } : {}),
    ...(isTransactionEvent(record) ? { transactionId: record.aggregateId } : {}),
    payload: record.payload,
    createdAt: record.createdAt,
});

const measureEvents = (records: DurableOutboxRecord[]): number => utf8Bytes(JSON.stringify({
    events: records.map(toDurableWireEvent),
}));

const isTransactionEvent = (record: DurableOutboxRecord): boolean =>
    record.aggregateType.trim().toUpperCase() === 'TRANSACTION';

export const selectDurableBatch = (
    leased: DurableOutboxRecord[],
    maxRequestBytes = POS_2B_MAX_REQUEST_BYTES,
): DurableBatchSelection => {
    const payloadBudget = Math.max(1, maxRequestBytes - POS_2B_ENVELOPE_RESERVE_BYTES);
    const events: DurableOutboxRecord[] = [];
    const oversized: DurableOutboxRecord[] = [];
    const transactionIds = new Set<string>();
    let cursor = 0;

    for (; cursor < leased.length && events.length < POS_2B_MAX_EVENTS; cursor++) {
        const record = leased[cursor];
        const nextTransactionIds = new Set(transactionIds);
        if (isTransactionEvent(record)) nextTransactionIds.add(record.aggregateId);
        if (nextTransactionIds.size > POS_2B_MAX_TRANSACTIONS) break;

        const candidate = [...events, record];
        const candidateBytes = measureEvents(candidate);
        if (candidateBytes > payloadBudget) {
            if (events.length === 0) {
                oversized.push(record);
                continue;
            }
            break;
        }

        events.push(record);
        if (isTransactionEvent(record)) transactionIds.add(record.aggregateId);
    }

    const selectedIds = new Set([...events, ...oversized].map(record => record.eventId));
    return {
        events,
        oversized,
        deferred: leased.filter(record => !selectedIds.has(record.eventId)),
        payloadBytes: measureEvents(events),
    };
};

const normalizeStatus = (result: any): string => String(
    result?.disposition || result?.inboxStatus || result?.inbox_status
    || result?.status || result?.state || result?.appliedStatus || result?.applied_status || ''
).trim().toUpperCase();

const resultEventId = (result: any): string => String(
    result?.eventId || result?.event_id || result?.id || ''
).trim();

const responseResults = (response: any): any[] => {
    if (Array.isArray(response?.eventResults)) return response.eventResults;
    if (Array.isArray(response?.results)) return response.results;
    if (Array.isArray(response?.events)) return response.events;
    if (Array.isArray(response?.items)) return response.items;
    return [];
};

const retryDelay = (attemptCount: number): number => {
    const exponent = Math.max(0, Math.min(6, attemptCount - 1));
    return Math.min(MAX_RETRY_MS, BASE_RETRY_MS * (2 ** exponent));
};

export class DurableOutboxBatchSender {
    constructor(
        private readonly repository: DurableOutboxRepository = durableOutboxRepository,
        private readonly transport: BatchTransport = events => apiSyncAdapter.pushDurableOutboxBatch(events),
    ) {}

    async sendNext(now = new Date()): Promise<DurableBatchSendSummary> {
        const owner = `pos-2b:${now.getTime()}:${Math.random().toString(36).slice(2, 10)}`;
        await this.repository.recoverExpiredLeases(now);
        await this.repository.repairLegacyEventContracts?.(now);
        const leased = await this.repository.leaseDue({
            owner,
            limit: POS_2B_MAX_EVENTS,
            leaseMs: LEASE_MS,
            now,
        });
        const selection = selectDurableBatch(leased);
        const summary: DurableBatchSendSummary = {
            leased: leased.length,
            sent: selection.events.length,
            applied: 0,
            received: 0,
            retrying: 0,
            rejected: selection.oversized.length,
            deferred: selection.deferred.length,
            payloadBytes: selection.payloadBytes,
        };

        await this.repository.releaseUnsent(selection.deferred.map(record => record.eventId));
        for (const record of selection.oversized) {
            await this.repository.markRejected(record.eventId, 'PAYLOAD_TOO_LARGE_LOCAL: event exceeds the POS-2B request budget');
        }
        if (selection.events.length === 0) return summary;

        let response: any;
        try {
            for (const event of selection.events) {
                if (event.eventType === 'SALE_POSTED') recordCheckoutDiagnostic('OUTBOX_SEND', {
                    items: event.payload.transaction?.items, total: event.payload.transaction?.total,
                    transactionId: event.payload.transaction?.id, displayId: event.payload.transaction?.displayId,
                    eventId: event.eventId, aggregateId: event.aggregateId, status: event.status,
                    summaryItemCount: event.payload.summary?.item_count,
                });
            }
            response = await this.transport(selection.events.map(toDurableWireEvent));
            syncMetrics.increment('pushes_total');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error || 'BATCH_TRANSPORT_FAILED');
            const requestedRetryAfterMs = Number((error as { retryAfterMs?: unknown } | null)?.retryAfterMs);
            const retryAfterMs = Number.isFinite(requestedRetryAfterMs) && requestedRetryAfterMs > 0
                ? Math.min(MAX_RETRY_MS, requestedRetryAfterMs)
                : null;
            for (const record of selection.events) {
                await this.repository.markRetry(
                    record.eventId,
                    message,
                    new Date(now.getTime() + (retryAfterMs || retryDelay(record.attemptCount))),
                );
                summary.retrying++;
            }
            return summary;
        }

        const results = new Map(responseResults(response).map(result => [resultEventId(result), result]));
        for (const record of selection.events) {
            const result = results.get(record.eventId);
            const status = normalizeStatus(result);
            recordCheckoutDiagnostic('OUTBOX_RESULT', { transactionId: record.aggregateId, eventId: record.eventId, status });
            if (['APPLIED', 'APPLIED_ERP', 'DUPLICATE', 'DUPLICATE_APPLIED', 'ALREADY_APPLIED'].includes(status)) {
                await this.repository.markAppliedErp(record.eventId, now);
                summary.applied++;
                syncMetrics.increment('ack_total');
                continue;
            }
            if (['RECEIVED', 'STAGED', 'APPLY_PENDING', 'PROCESSING', 'SYNCED_MASTER'].includes(status)) {
                await this.repository.markSyncedMaster(record.eventId, now);
                summary.received++;
                syncMetrics.increment('ack_total');
                continue;
            }

            const retryable = result?.retryable !== false && !['REJECTED', 'FAILED_FINAL', 'INVALID'].includes(status);
            const error = String(result?.error || result?.message || (result ? `BATCH_EVENT_${status || 'UNKNOWN'}` : 'BATCH_RESULT_MISSING'));
            if (retryable) {
                await this.repository.markRetry(
                    record.eventId,
                    error,
                    new Date(now.getTime() + retryDelay(record.attemptCount)),
                );
                summary.retrying++;
            } else {
                await this.repository.markRejected(record.eventId, error);
                summary.rejected++;
            }
        }

        syncMetrics.setBatchSize(selection.events.length);
        syncMetrics.markAckFinished(now.toISOString());
        return summary;
    }
}

export const durableOutboxBatchSender = new DurableOutboxBatchSender();
