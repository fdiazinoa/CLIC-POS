/** Bounded drain of offline fiscal sales before a terminal reauthorization.
 * The ERP revokes the offline lease backing a sale when the terminal projection changes (re-register),
 * which makes an already-issued sale impossible to push. So the POS must try to drain the outbox first,
 * and if that is not possible it must NOT rotate authority. No contract/schema change: an ERP that
 * keeps the old behavior simply drains or defers exactly as today. */

export interface OfflineFiscalPushDrainOptions {
    count?: () => Promise<number>;
    sendNext?: () => Promise<unknown>;
    sleep?: (ms: number) => Promise<void>;
    maxAttempts?: number;
}

export interface OfflineFiscalPushDrainResult {
    pending: number;
    drained: boolean;
    attempts: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

const defaultCount = async (): Promise<number> => {
    const { durableOutboxRepository } = await import('./DurableOutboxRepository');
    return (await durableOutboxRepository.pendingOfflineFiscalSales()).pending;
};

const defaultSendNext = async (): Promise<unknown> => {
    const { durableOutboxBatchSender } = await import('./DurableOutboxBatchSender');
    return durableOutboxBatchSender.sendNext();
};

export const countPendingOfflineFiscalPush = async (): Promise<number> => {
    try { return await defaultCount(); } catch { return 0; }
};

/** Sends at most `maxAttempts` batches (default 3). Stops as soon as a pass does not reduce the queue, so
 * a duplicate/retry-wait ERP answer never turns into an infinite 5-minute loop. */
export async function drainPendingOfflineFiscalPush(options: OfflineFiscalPushDrainOptions = {}): Promise<OfflineFiscalPushDrainResult> {
    const count = options.count || defaultCount;
    const sendNext = options.sendNext || defaultSendNext;
    const sleep = options.sleep || defaultSleep;
    const maxAttempts = Math.max(1, Math.min(3, options.maxAttempts ?? 3));

    let pending = await count().catch(() => 0);
    if (pending === 0) return { pending: 0, drained: true, attempts: 0 };

    let attempts = 0;
    while (pending > 0 && attempts < maxAttempts) {
        attempts += 1;
        try { await sendNext(); } catch { /* bounded: the count below decides whether there is progress */ }
        await sleep(Math.min(1000, 150 * attempts));
        const next = await count().catch(() => pending);
        if (next >= pending) return { pending: next, drained: false, attempts };
        pending = next;
    }
    return { pending, drained: pending === 0, attempts };
}
