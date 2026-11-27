/**
 * Internal in-process signal emitted after a durable financial commit succeeds.
 *
 * The immediate outbox flush cannot rely on every UI completion path: retained
 * dispatch receipts, fiscal retry replays and article-format mirrors return
 * before the legacy/V3 call sites. Every durable commit (legacy checkout, V3,
 * dispatch reservation, invoices) goes through
 * `DurableOutboxRepository.commitFinancialTransaction`, so dispatching a DOM
 * event from that single choke point lets `BackgroundSyncManager` push the due
 * durable batch right after the commit, regardless of how the UI returns.
 */
export const DURABLE_OUTBOX_COMMITTED_EVENT = 'clic-pos:durable-outbox-committed';

export interface DurableOutboxCommittedDetail {
    eventTypes: string[];
    aggregateIds: string[];
    committedAt: string;
}

export interface DurableOutboxCommitInput {
    outboxEvent: { eventType?: string | null; aggregateId?: string | null };
    additionalOutboxEvents?: Array<{ eventType?: string | null; aggregateId?: string | null }>;
}

/** Best-effort signal: a failure here must never affect the committed sale. */
export const signalDurableOutboxCommitted = (input: DurableOutboxCommitInput): void => {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    try {
        const events = [input.outboxEvent, ...(input.additionalOutboxEvents || [])];
        window.dispatchEvent(new CustomEvent(DURABLE_OUTBOX_COMMITTED_EVENT, {
            detail: {
                eventTypes: events.map(event => String(event?.eventType || '')),
                aggregateIds: Array.from(new Set(events.map(event => String(event?.aggregateId || '')).filter(Boolean))),
                committedAt: new Date().toISOString(),
            } satisfies DurableOutboxCommittedDetail,
        }));
    } catch {
        // Diagnostics only: a failed signal must never affect the committed sale.
    }
};
