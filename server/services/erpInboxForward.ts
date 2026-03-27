/**
 * Forwards normalized POS transactions to CLIC-ERP `POST /api/sync/inbox`.
 * Align with CLIC-ERP `server/routes/syncInbox.js` (event_id, toStableUuid, payload).
 */
import { createHash } from 'node:crypto';
import { getSetting, saveSetting } from '../db.js';

const FETCH_TIMEOUT_MS = 15000;

export function toStableUuid(seed: string): string {
    const hash = createHash('sha1').update(String(seed || 'sync-event')).digest('hex').slice(0, 32);
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function normalizeBaseUrl(url: string): string {
    return url.replace(/\/$/, '');
}

function asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function asArray(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
}

function getUsedLoyaltyPoints(transaction: any): number {
    const record = transaction || {};
    const n = Number(
        record.loyaltyPointsUsed ?? record.pointsUsed ?? record.redeemedPoints ?? (record.loyalty && record.loyalty.pointsUsed)
    );
    return Number.isFinite(n) ? n : 0;
}

function extractCouponCodes(transaction: any): string[] {
    const rawCoupons = asArray(transaction?.coupons);
    const out: string[] = [];
    for (const coupon of rawCoupons) {
        if (typeof coupon === 'string') out.push(coupon.trim());
        else if (coupon && typeof coupon === 'object') {
            const c = coupon as Record<string, unknown>;
            const code = asString(c.code ?? c.couponCode ?? c.id);
            if (code) out.push(code);
        }
    }
    return out.filter(Boolean);
}

function buildTransactionSummary(transaction: any) {
    const record = transaction || {};
    const payments = asArray(record.payments);
    const items = asArray(record.items);

    return {
        transaction_id: asString(record.id),
        display_id: asString(record.displayId || record.id),
        document_type: asString(record.documentType).toUpperCase() || 'TICKET',
        status: asString(record.status).toUpperCase() || 'COMPLETED',
        total: asNumber(record.total),
        tax_amount: asNumber(record.taxAmount),
        net_amount: asNumber(record.netAmount),
        discount_amount: asNumber(record.discountAmount),
        item_count: items.length,
        payment_count: payments.length,
        customer_id: asString(record.customerId),
        customer_name: asString(record.customerName),
        user_id: asString(record.userId),
        user_name: asString(record.userName),
        ncf: asString(record.ncf),
        ncf_type: asString(record.ncfType),
        due_date: asString(record.dueDate),
        pending_balance: asNumber(record.pendingBalance),
        wallet_payment_amount: asNumber(record.walletPaymentAmount),
        wallet_deposit_amount: asNumber(record.walletDepositAmount),
        loyalty_points_used: getUsedLoyaltyPoints(record),
        coupon_codes: extractCouponCodes(record)
    };
}

export interface BuildSaleInboxBodyOptions {
    fallbackTerminalId?: string | null;
}

export function buildSalePostedInboxBody(txn: any, options?: BuildSaleInboxBodyOptions) {
    const summary = buildTransactionSummary(txn);
    const documentType = summary.document_type;
    const isCreditNote = documentType === 'REFUND' || summary.ncf_type === 'B04';
    const eventBase = summary.transaction_id || `${documentType || 'TXN'}-${Date.now()}`;
    const eventType = isCreditNote ? 'SALES_CREDIT_NOTE_POSTED' : 'SALE_POSTED';
    const eventId = toStableUuid(`${eventBase}:${eventType}`);
    const terminalId =
        asString(txn.terminalId) ||
        asString(txn.source_terminal_id) ||
        asString(txn.sourceTerminalId) ||
        asString(txn.terminal_id) ||
        asString(options?.fallbackTerminalId);

    const tenantRaw = asString(getSetting('active_tenant_id')) || asString(getSetting('tenant_id'));
    const payload: Record<string, unknown> = {
        occurred_at: asString(txn.date) || new Date().toISOString(),
        summary,
        transaction: txn
    };
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantRaw)) {
        payload.tenant_id = tenantRaw;
    }

    return {
        event_id: eventId,
        terminal_id: terminalId,
        event_type: eventType,
        payload
    };
}

function resolveErpBaseUrlFromSettings(): string | null {
    try {
        const ctx = getSetting('erp_setup_context') as Record<string, unknown> | null;
        const fromCtx = ctx && typeof ctx.erpBaseUrl === 'string' ? ctx.erpBaseUrl.trim() : '';
        if (fromCtx) return normalizeBaseUrl(fromCtx);

        const meta = getSetting('syncMetadata') as Record<string, unknown> | null;
        if (meta) {
            const a = typeof meta.erpBaseUrl === 'string' ? meta.erpBaseUrl.trim() : '';
            const b = typeof meta.syncApiUrl === 'string' ? meta.syncApiUrl.trim() : '';
            const c = typeof meta.masterSyncUrl === 'string' ? meta.masterSyncUrl.trim() : '';
            if (a) return normalizeBaseUrl(a);
            if (b) return normalizeBaseUrl(b);
            if (c) return normalizeBaseUrl(c);
        }
    } catch {
        /* ignore */
    }
    return null;
}

function persistClientErpBaseUrl(url: string): void {
    try {
        const existing = (getSetting('erp_setup_context') as Record<string, unknown> | null) || {};
        saveSetting('erp_setup_context', {
            ...existing,
            erpBaseUrl: url,
            erp_base_url: url,
            source: 'sync_transactions_body'
        });
    } catch (e) {
        console.warn('[ERP_INBOX] Could not persist erp_setup_context:', e);
    }
}

export function resolveErpBaseUrl(clientOverride?: string | null): string | null {
    const trimmedOverride =
        typeof clientOverride === 'string' && clientOverride.trim() ? normalizeBaseUrl(clientOverride.trim()) : '';
    if (trimmedOverride) {
        console.log(`[ERP_INBOX] resolveErpBaseUrl: source=CLIENT_BODY effective=${trimmedOverride}`);
        persistClientErpBaseUrl(trimmedOverride);
        return trimmedOverride;
    }

    const env =
        typeof process !== 'undefined' && process.env?.ERP_BASE_URL && String(process.env.ERP_BASE_URL).trim()
            ? String(process.env.ERP_BASE_URL).trim()
            : '';
    if (env) {
        const u = normalizeBaseUrl(env);
        console.log(`[ERP_INBOX] resolveErpBaseUrl: source=ENV effective=${u}`);
        return u;
    }

    const fromSettings = resolveErpBaseUrlFromSettings();
    if (fromSettings) {
        console.log(`[ERP_INBOX] resolveErpBaseUrl: source=SETTINGS effective=${fromSettings}`);
        return fromSettings;
    }

    console.warn(
        '[ERP_INBOX] resolveErpBaseUrl: source=NONE — send erp_base_url on POST /api/sync/transactions (localStorage CLIC_ERP_BASE_URL), or ERP_BASE_URL env, or ERP setup.'
    );
    return null;
}

export interface ErpInboxForwardResult {
    eventId: string;
    eventType: string;
    ok: boolean;
    httpStatus?: number;
    duplicate?: boolean;
    error?: string;
}

export interface ErpInboxForwardSummary {
    skipped: boolean;
    reason?: string;
    failed?: boolean;
    results?: ErpInboxForwardResult[];
    erpBaseUrlUsed?: string;
}

export interface ForwardTransactionsOptions {
    erpBaseUrlOverride?: string | null;
    authTerminalId?: string | null;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(t);
    }
}

export async function forwardTransactionsToErpInbox(
    normalizedTxns: any[],
    options?: ForwardTransactionsOptions
): Promise<ErpInboxForwardSummary> {
    const baseUrl = resolveErpBaseUrl(options?.erpBaseUrlOverride ?? null);
    if (!baseUrl) {
        console.warn('[ERP_INBOX] forwardTransactionsToErpInbox: SKIPPED reason=NO_ERP_URL');
        return { skipped: true, reason: 'NO_ERP_URL' };
    }

    const url = `${baseUrl}/api/sync/inbox`;
    const results: ErpInboxForwardResult[] = [];

    console.log(
        `[ERP_INBOX] forwardTransactionsToErpInbox: count=${normalizedTxns.length} inboxUrl=${url} authTerminalFallback=${options?.authTerminalId || 'none'}`
    );

    for (const txn of normalizedTxns) {
        const body = buildSalePostedInboxBody(txn, { fallbackTerminalId: options?.authTerminalId });
        const preview = JSON.stringify(body).slice(0, 1200);
        console.log(`[ERP_INBOX] payload preview (truncated): ${preview}${preview.length >= 1200 ? '…' : ''}`);
        console.log(
            `[ERP_INBOX] POST ${url} | ${body.event_type} | event_id=${body.event_id} | terminal_id=${body.terminal_id || '(MISSING)'}`
        );

        if (!asString(body.terminal_id)) {
            console.error('[ERP_INBOX] FAIL: terminal_id still empty (ERP returns 400)');
            results.push({
                eventId: body.event_id,
                eventType: body.event_type,
                ok: false,
                error: 'MISSING_TERMINAL_ID_FOR_INBOX'
            });
            return { skipped: false, failed: true, results, erpBaseUrlUsed: baseUrl };
        }

        try {
            const res = await fetchWithTimeout(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const text = await res.text();
            let parsed: any = null;
            try {
                parsed = JSON.parse(text);
            } catch {
                /* non-JSON */
            }
            const duplicate = !!(parsed && (parsed.duplicate === true || parsed.response?.duplicate === true));

            if (res.ok) {
                console.log(
                    `[ERP_INBOX] ERP OK http=${res.status} duplicate=${duplicate} response_snip=${text.slice(0, 400)}`
                );
                results.push({
                    eventId: body.event_id,
                    eventType: body.event_type,
                    ok: true,
                    httpStatus: res.status,
                    duplicate
                });
            } else {
                console.error(`[ERP_INBOX] ERP REJECT http=${res.status} body=${text.slice(0, 800)}`);
                results.push({
                    eventId: body.event_id,
                    eventType: body.event_type,
                    ok: false,
                    httpStatus: res.status,
                    error: text.slice(0, 400)
                });
                return { skipped: false, failed: true, results, erpBaseUrlUsed: baseUrl };
            }
        } catch (e: any) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[ERP_INBOX] fetch error (${body.event_type}):`, msg);
            results.push({
                eventId: body.event_id,
                eventType: body.event_type,
                ok: false,
                error: msg
            });
            return { skipped: false, failed: true, results, erpBaseUrlUsed: baseUrl };
        }
    }

    return { skipped: false, failed: false, results, erpBaseUrlUsed: baseUrl };
}
