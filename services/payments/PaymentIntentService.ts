import { dbAdapter } from '../db';
import type { DatabaseAdapter } from '../db/DatabaseAdapter';
import { isSyncFeatureEnabled } from '../sync/SyncFeatureFlags';

export type PaymentIntentStatus =
    | 'CREATED'
    | 'AUTHORIZING'
    | 'AUTHORIZED'
    | 'DECLINED'
    | 'UNKNOWN'
    | 'COMMITTED'
    | 'RECONCILIATION_REQUIRED';

export interface PaymentIntentHandle {
    intentId: string;
    idempotencyKey: string;
}

const createId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `PAYINT-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
};

const clean = (value: unknown): string => String(value || '').trim();

export class PaymentIntentService {
    constructor(
        private readonly database: DatabaseAdapter = dbAdapter,
        private readonly enabled: () => boolean = () => isSyncFeatureEnabled('sqlite_outbox_v2'),
    ) {}

    isEnabled(): boolean {
        return this.enabled() && typeof this.database.executeSQL === 'function';
    }

    async create(input: {
        paymentId: string;
        provider: string;
        integrationId?: string;
        amount: number;
        currencyCode: string;
    }): Promise<PaymentIntentHandle | null> {
        if (!this.isEnabled()) return null;
        const intentId = createId();
        const idempotencyKey = `pos-payment:${clean(input.paymentId)}`;
        const now = new Date().toISOString();
        await this.database.executeSQL!(
            `INSERT INTO payment_intents_v2 (
                intent_id, idempotency_key, payment_id, provider, integration_id,
                amount, currency_code, status, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CREATED', ?, ?)
             ON CONFLICT(idempotency_key) DO NOTHING`,
            [intentId, idempotencyKey, clean(input.paymentId), clean(input.provider), clean(input.integrationId) || null,
                Number(input.amount || 0), clean(input.currencyCode) || 'DOP', now, now]
        );
        const result = await this.database.executeSQL!(
            'SELECT intent_id, idempotency_key FROM payment_intents_v2 WHERE idempotency_key = ? LIMIT 1',
            [idempotencyKey]
        );
        const columns = result?.[0]?.columns || [];
        const values = result?.[0]?.values?.[0] || [];
        const row = columns.reduce((acc: Record<string, any>, column: string, index: number) => {
            acc[column] = values[index];
            return acc;
        }, {});
        return { intentId: String(row.intent_id || intentId), idempotencyKey: String(row.idempotency_key || idempotencyKey) };
    }

    async markAuthorizing(intentId: string): Promise<void> {
        await this.update(intentId, 'AUTHORIZING');
    }

    async markAuthorized(intentId: string, result: {
        providerReference?: string;
        authorizationCode?: string;
        responseCode?: string;
    }): Promise<void> {
        if (!this.isEnabled()) return;
        const now = new Date().toISOString();
        await this.database.executeSQL!(
            `UPDATE payment_intents_v2
             SET status = 'AUTHORIZED', provider_reference = ?, authorization_code = ?,
                 response_code = ?, authorized_at = ?, updated_at = ?, last_error = NULL
             WHERE intent_id = ?`,
            [clean(result.providerReference) || null, clean(result.authorizationCode) || null,
                clean(result.responseCode) || null, now, now, intentId]
        );
    }

    async markFailed(intentId: string, input: { declined: boolean; error: string; responseCode?: string }): Promise<void> {
        if (!this.isEnabled()) return;
        const now = new Date().toISOString();
        await this.database.executeSQL!(
            `UPDATE payment_intents_v2
             SET status = ?, response_code = ?, last_error = ?, updated_at = ?
             WHERE intent_id = ?`,
            [input.declined ? 'DECLINED' : 'RECONCILIATION_REQUIRED', clean(input.responseCode) || null,
                clean(input.error).slice(0, 1_000), now, intentId]
        );
    }

    async recoverAbandoned(cutoff = new Date(Date.now() - 2 * 60_000)): Promise<number> {
        if (!this.isEnabled()) return 0;
        const now = new Date().toISOString();
        const result = await this.database.executeSQL!(
            `UPDATE payment_intents_v2
             SET status = 'RECONCILIATION_REQUIRED',
                 last_error = COALESCE(last_error, 'INTERRUPTED_AFTER_GATEWAY_START'),
                 updated_at = ?
             WHERE status IN ('AUTHORIZING','AUTHORIZED','UNKNOWN')
               AND updated_at <= ?
               AND transaction_id IS NULL`,
            [now, cutoff.toISOString()]
        );
        return Number(result?.changes?.changes ?? result?.changes ?? 0);
    }

    private async update(intentId: string, status: PaymentIntentStatus): Promise<void> {
        if (!this.isEnabled()) return;
        await this.database.executeSQL!(
            'UPDATE payment_intents_v2 SET status = ?, updated_at = ? WHERE intent_id = ?',
            [status, new Date().toISOString(), intentId]
        );
    }
}

export const paymentIntentService = new PaymentIntentService();
