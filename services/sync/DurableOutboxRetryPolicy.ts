/** Bounded retry rules for the durable outbox transport.
 * A committed offline sale is immutable: an authority rotation may NEVER be allowed to abort its push in
 * a 5-minute loop (the real incident reached 136 `Authority request aborted` attempts). Only real network
 * failures are retried; an authority-context abort escalates to an explicit long hold after a few tries. */

export const AUTHORITY_CONTEXT_ABORT_MAX_ATTEMPTS = 5;
export const AUTHORITY_CONTEXT_ABORT_HOLD_MS = 30 * 60_000;
export const AUTHORITY_CONTEXT_RETRY_HELD = 'AUTHORITY_CONTEXT_RETRY_HELD';

export const isAuthorityContextAbort = (errorMessage: unknown): boolean => {
    const message = String(errorMessage ?? '');
    return /authority request aborted|master authority changed|MASTER_AUTHORITY_CHANGED|RECOVERY_SCOPE_CHANGED|AUTHORITY_CONTEXT_CHANGED/i.test(message);
};

export interface BoundedDurableRetry { delayMs: number; held: boolean }

/** Exponential backoff capped by the caller, with an explicit long hold for repeated authority aborts. */
export const boundedDurableRetry = (
    attemptCount: number,
    errorMessage: unknown,
    baseDelayMs: number,
    maxDelayMs: number,
): BoundedDurableRetry => {
    const attempt = Math.max(1, Number(attemptCount) || 1);
    if (isAuthorityContextAbort(errorMessage) && attempt >= AUTHORITY_CONTEXT_ABORT_MAX_ATTEMPTS) {
        return { delayMs: AUTHORITY_CONTEXT_ABORT_HOLD_MS, held: true };
    }
    const exponent = Math.max(0, Math.min(6, attempt - 1));
    return { delayMs: Math.min(maxDelayMs, baseDelayMs * (2 ** exponent)), held: false };
};
