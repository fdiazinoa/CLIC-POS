import type { DurableBatchSendSummary } from './DurableOutboxBatchSender';

/**
 * Immediate, idempotent flush of the durable POS outbox after a sale/payment commit.
 *
 * The background worker only pushes every ~30 s, and `triggerSync()` is dropped while the sale
 * activity guard is active; after the commit the cashier still interacts with the success screen,
 * so SALE_POSTED+PAYMENT_POSTED used to leave the device 13–14.5 s later (real trace NCF 6013/6014).
 * This flush pushes only the already-durable outbox batch, right after the commit, without waiting
 * for the UI window and without changing the sync/fiscal contract.
 *
 * Safety: never creates or rewrites events (it leases what the durable commit already stored), is
 * coalesced per process (double trigger shares one promise), bounded per call, skipped offline or
 * when the durable outbox is inactive, and tolerates transport errors leaving the existing retry /
 * backoff / ordering semantics untouched. Rollback: disable flag `pos_outbox_immediate_flush`
 * (local override `clic_pos_feature_pos_outbox_immediate_flush=false` or
 * `VITE_POS_OUTBOX_IMMEDIATE_FLUSH_ENABLED=false`); the previous schedule-only behavior returns.
 */
export type OutboxFlushSkipReason = 'disabled' | 'offline' | 'durable_inactive' | 'resolve_failed';
export type OutboxFlushReason = 'sale-commit' | 'payment-commit' | 'manual';

export interface OutboxFlushResult {
    reason: OutboxFlushReason;
    attempted: boolean;
    skippedReason?: OutboxFlushSkipReason;
    batches: number;
    sent: number;
    applied: number;
    received: number;
    retrying: number;
    rejected: number;
    deferred: number;
    /** true when a second trigger joined an in-flight flush instead of duplicating it. */
    coalesced: boolean;
    startedAt: string;
    finishedAt: string;
    delayMs: number;
    /** When the durable sender scheduled a retry, the earliest retry instant (metrics/rollback visibility). */
    nextRetryAt: string | null;
}

export interface OutboxFlushMetrics {
    attempts: number;
    lastReason: OutboxFlushReason | null;
    lastDelayMs: number;
    lastNextRetryAt: string | null;
    lastFinishedAt: string | null;
}

export interface ImmediateFlushDependencies {
    sendNext(now?: Date): Promise<Partial<DurableBatchSendSummary> & { nextRetryAt?: string | null }>;
    /** Durable outbox transport is active (POS-2B flag or pending tracking/return events). */
    durableActive(): Promise<boolean>;
    /** Rollback flag `pos_outbox_immediate_flush`. */
    enabled(): boolean;
    online(): boolean;
    now?(): Date;
    logger?: { info?(message: string): void; warn?(message: string): void };
    maxBatches?: number;
}

const DEFAULT_MAX_BATCHES = 3;

export class DurableOutboxImmediateFlush {
    private inFlight: Promise<OutboxFlushResult> | null = null;
    private readonly metricsState: OutboxFlushMetrics = {
        attempts: 0, lastReason: null, lastDelayMs: 0, lastNextRetryAt: null, lastFinishedAt: null,
    };

    constructor(private readonly deps: ImmediateFlushDependencies) {}

    metrics(): OutboxFlushMetrics {
        return { ...this.metricsState };
    }

    private now(): Date {
        return this.deps.now ? this.deps.now() : new Date();
    }

    private result(reason: OutboxFlushReason, started: Date, partial: Partial<OutboxFlushResult> & { skippedReason?: OutboxFlushSkipReason }): OutboxFlushResult {
        const now = this.now();
        return {
            reason, attempted: partial.attempted ?? false, skippedReason: partial.skippedReason,
            batches: partial.batches ?? 0, sent: partial.sent ?? 0, applied: partial.applied ?? 0,
            received: partial.received ?? 0, retrying: partial.retrying ?? 0, rejected: partial.rejected ?? 0,
            deferred: partial.deferred ?? 0, coalesced: partial.coalesced ?? false,
            startedAt: started.toISOString(), finishedAt: now.toISOString(),
            delayMs: Math.max(0, now.getTime() - started.getTime()), nextRetryAt: partial.nextRetryAt ?? null,
        };
    }

    private record(result: OutboxFlushResult): OutboxFlushResult {
        this.metricsState.attempts += result.attempted ? 1 : 0;
        this.metricsState.lastReason = result.reason;
        this.metricsState.lastDelayMs = result.delayMs;
        this.metricsState.lastNextRetryAt = result.nextRetryAt;
        this.metricsState.lastFinishedAt = result.finishedAt;
        const line = JSON.stringify({
            event: 'pos_outbox_immediate_flush',
            attempt: this.metricsState.attempts,
            reason: result.reason,
            attempted: result.attempted,
            skippedReason: result.skippedReason ?? null,
            batches: result.batches,
            sent: result.sent,
            applied: result.applied,
            received: result.received,
            retrying: result.retrying,
            rejected: result.rejected,
            deferred: result.deferred,
            coalesced: result.coalesced,
            delayMs: result.delayMs,
            nextRetryAt: result.nextRetryAt,
        });
        if (result.attempted) this.deps.logger?.info?.(line);
        else this.deps.logger?.warn?.(line);
        return result;
    }

    /**
     * Flush due durable events now. Coalesces concurrent triggers, never throws, and stops after
     * `maxBatches` (a sale+pago normally travels in one batch).
     */
    async flush(reason: OutboxFlushReason = 'sale-commit'): Promise<OutboxFlushResult> {
        const started = this.now();
        if (this.inFlight) {
            const existing = this.inFlight;
            const result = await existing;
            return { ...result, coalesced: true };
        }
        const run = (async (): Promise<OutboxFlushResult> => {
            if (!this.deps.enabled()) return this.record(this.result(reason, started, { skippedReason: 'disabled' }));
            if (!this.deps.online()) return this.record(this.result(reason, started, { skippedReason: 'offline' }));
            try {
                if (!(await this.deps.durableActive())) {
                    return this.record(this.result(reason, started, { skippedReason: 'durable_inactive' }));
                }
            } catch {
                return this.record(this.result(reason, started, { skippedReason: 'durable_inactive' }));
            }
            const maxBatches = Math.max(1, this.deps.maxBatches ?? DEFAULT_MAX_BATCHES);
            let batches = 0, sent = 0, applied = 0, received = 0, retrying = 0, rejected = 0, deferred = 0;
            let nextRetryAt: string | null = null;
            for (let index = 0; index < maxBatches; index++) {
                try {
                    const summary = await this.deps.sendNext(this.now());
                    batches += 1;
                    sent += Number(summary.sent || 0);
                    applied += Number(summary.applied || 0);
                    received += Number(summary.received || 0);
                    retrying += Number(summary.retrying || 0);
                    rejected += Number(summary.rejected || 0);
                    deferred += Number(summary.deferred || 0);
                    if (summary.nextRetryAt && (!nextRetryAt || summary.nextRetryAt < nextRetryAt)) nextRetryAt = summary.nextRetryAt;
                    // Everything due is already in flight/applied; a retry schedule means the next
                    // attempt belongs to the sender backoff, so do not hammer it in this call.
                    if (Number(summary.sent || 0) === 0 || Number(summary.retrying || 0) > 0 || nextRetryAt) break;
                } catch (error) {
                    // The durable sender never drops events: lease/backoff survives this rejected call.
                    this.deps.logger?.warn?.(JSON.stringify({
                        event: 'pos_outbox_immediate_flush_error',
                        reason, attempt: this.metricsState.attempts + 1,
                        delayMs: Math.max(0, this.now().getTime() - started.getTime()),
                        error: error instanceof Error ? error.message : String(error || 'FLUSH_FAILED'),
                    }));
                    batches += 1;
                    break;
                }
            }
            return this.record(this.result(reason, started, {
                attempted: true, batches, sent, applied, received, retrying, rejected, deferred, nextRetryAt,
            }));
        })();
        this.inFlight = run;
        try {
            return await run;
        } finally {
            this.inFlight = null;
        }
    }
}

let sharedFlush: DurableOutboxImmediateFlush | null = null;

/** Lazily resolve the production dependencies so importing this module stays side-effect free. */
async function resolveSharedFlush(): Promise<DurableOutboxImmediateFlush> {
    if (sharedFlush) return sharedFlush;
    const [{ durableOutboxBatchSender }, { durableOutboxRepository }, { isSyncFeatureEnabled }] = await Promise.all([
        import('./DurableOutboxBatchSender'),
        import('./DurableOutboxRepository'),
        import('./SyncFeatureFlags'),
    ]);
    sharedFlush = new DurableOutboxImmediateFlush({
        enabled: () => isSyncFeatureEnabled('pos_outbox_immediate_flush'),
        online: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
        durableActive: async () => isSyncFeatureEnabled('sqlite_outbox_v2')
            || await durableOutboxRepository.hasPendingEvents()
            || await durableOutboxRepository.hasPendingTrackingEvents()
            || await durableOutboxRepository.hasPendingReturnEvents(),
        sendNext: now => durableOutboxBatchSender.sendNext(now),
        logger: console,
    });
    return sharedFlush;
}

/** Production entry point used after a sale/payment commit (App.tsx). Never throws. */
export const flushDurableOutboxNow = async (reason: OutboxFlushReason = 'sale-commit'): Promise<OutboxFlushResult> => {
    try {
        return await (await resolveSharedFlush()).flush(reason);
    } catch (error) {
        // Never swallow a resolution/transport failure silently: the previous
        // implementation returned a fake "durable_inactive" result with no log,
        // which is how the immediate flush could disappear from device traces.
        try {
            console.error(JSON.stringify({
                event: 'pos_outbox_immediate_flush_error',
                stage: 'resolve',
                reason,
                error: error instanceof Error ? error.message : String(error || 'FLUSH_FAILED'),
            }));
        } catch {
            // Logging must never break the checkout path.
        }
        return {
            reason, attempted: false, skippedReason: 'resolve_failed', batches: 0, sent: 0, applied: 0,
            received: 0, retrying: 0, rejected: 0, deferred: 0, coalesced: false,
            startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), delayMs: 0, nextRetryAt: null,
        };
    }
};

/** Test-only: drop the lazily built production singleton. */
export const resetDurableOutboxImmediateFlushForTests = () => { sharedFlush = null; };
