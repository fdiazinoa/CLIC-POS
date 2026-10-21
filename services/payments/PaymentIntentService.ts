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
    status?: PaymentIntentStatus; providerReference?: string; authorizationCode?: string; responseCode?: string;
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
        retainedOperation?: boolean;
        futureCheckout?: {checkoutId:string;transactionId:string};
    }): Promise<PaymentIntentHandle | null> {
        if (!this.isEnabled()){if(input.futureCheckout)throw new Error('PAYMENT_INTENT_NATIVE_REQUIRED');return null;}
        const intentId = createId();
        const idempotencyKey = `pos-payment:${clean(input.paymentId)}`;
        const now = new Date().toISOString();
        await this.database.executeSQL!(
            `INSERT INTO payment_intents_v2 (
                intent_id, idempotency_key, payment_id, provider, integration_id,
                amount, currency_code, status, created_at, updated_at, transaction_id
             ) SELECT ?, ?, ?, ?, ?, ?, ?, 'CREATED', ?, ?, ?
             ${input.futureCheckout?'WHERE NOT EXISTS(SELECT 1 FROM pos_fiscal_checkout_retirements_v1 WHERE transaction_id=?)':''}
             ON CONFLICT(idempotency_key) DO NOTHING`,
            [intentId, idempotencyKey, clean(input.paymentId), clean(input.provider), clean(input.integrationId) || null,
                Number(input.amount || 0), clean(input.currencyCode) || 'DOP', now, now,input.futureCheckout?.transactionId||null,...(input.futureCheckout?[input.futureCheckout.transactionId]:[])]
        );
        const result = await this.database.executeSQL!(
            'SELECT * FROM payment_intents_v2 WHERE idempotency_key = ? LIMIT 1',
            [idempotencyKey]
        );
        const columns = result?.[0]?.columns || [];
        const values = result?.[0]?.values?.[0] || [];
        const row = columns.reduce((acc: Record<string, any>, column: string, index: number) => {
            acc[column] = values[index];
            return acc;
        }, {});
        if(input.futureCheckout&&!row.intent_id)throw new Error('FISCAL_WORKFLOW_RETIREMENT_FENCED');
        if ((input.retainedOperation||input.futureCheckout) && (row.provider !== clean(input.provider) || String(row.integration_id || '') !== clean(input.integrationId)
          || Number(row.amount) !== input.amount || row.currency_code !== clean(input.currencyCode)
          || !['CREATED','AUTHORIZED'].includes(row.status) || input.futureCheckout&&row.transaction_id!==input.futureCheckout.transactionId)) throw new Error('PAYMENT_INTENT_RECONCILIATION_REQUIRED');
        return { ...((input.retainedOperation||input.futureCheckout) ? {status:row.status,providerReference:row.provider_reference,
            authorizationCode:row.authorization_code,responseCode:row.response_code} : {}), intentId: String(row.intent_id || intentId), idempotencyKey: String(row.idempotency_key || idempotencyKey) };
    }

    async markAuthorizing(intentId: string, retainedOperation = false,futureCheckout?:{checkoutId:string;transactionId:string}): Promise<void> {
        if(futureCheckout){
            if(retainedOperation||!this.isEnabled())throw new Error('PAYMENT_INTENT_RECONCILIATION_REQUIRED');
            const result=await this.database.executeSQL!(`UPDATE payment_intents_v2 SET status='AUTHORIZING',updated_at=? WHERE intent_id=? AND status='CREATED' AND transaction_id=?
             AND EXISTS(SELECT 1 FROM pos_fiscal_checkouts_v2 c JOIN pos_fiscal_checkout_current_v2 p ON p.checkout_id=c.checkout_id
              WHERE c.checkout_id=? AND c.transaction_id=payment_intents_v2.transaction_id AND c.phase='EFFECT_POSSIBLE'
              AND NOT EXISTS(SELECT 1 FROM pos_fiscal_checkout_retirements_v1 retired WHERE retired.checkout_id=c.checkout_id)
              AND EXISTS(SELECT 1 FROM json_each(c.checkout_json,'$.paymentIds') refs WHERE refs.value=payment_intents_v2.payment_id))`,[new Date().toISOString(),intentId,futureCheckout.transactionId,futureCheckout.checkoutId]);
            if(Number(result?.changes?.changes)!==1)throw new Error('PAYMENT_INTENT_RECONCILIATION_REQUIRED');return;
        }
        if (retainedOperation) {
            if (!this.isEnabled()) throw new Error('PAYMENT_INTENT_NATIVE_REQUIRED');
            const result = await this.database.executeSQL!(`UPDATE payment_intents_v2 SET status='AUTHORIZING',updated_at=? WHERE intent_id=? AND status='CREATED'
              AND EXISTS (SELECT 1 FROM documents c JOIN documents r ON r.collection_name='reservations'
                AND r.doc_id=json_extract(c.data,'$.sourceId') WHERE c.collection_name='v3RestoredTicketSources'
                AND json_extract(c.data,'$.sourceCollection')='reservations' AND json_extract(c.data,'$.state')='PENDING'
                AND substr(payment_intents_v2.payment_id,1,length(c.doc_id)+9)=c.doc_id || ':payment:'
                AND r.data=json_extract(c.data,'$.sourceExpected') AND json_extract(r.data,'$.status')='ACTIVE'
                AND julianday(json_extract(r.data,'$.expiryDate'))>julianday('now'))`,[new Date().toISOString(),intentId]);
            if (Number(result?.changes?.changes) !== 1) throw new Error('PAYMENT_INTENT_RECONCILIATION_REQUIRED');
            return;
        }
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
