/**
 * Forwards normalized POS transactions to CLIC-ERP `POST /api/sync/inbox`.
 * Align with CLIC-ERP `server/routes/syncInbox.js` (event_id, toStableUuid, payload).
 */
import { createHash } from 'node:crypto';
import { coerceTransactionItemsForErp } from '../../services/sync/erpOutboundPayloads.js';
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
    const txnForErp = coerceTransactionItemsForErp(txn);
    const summary = buildTransactionSummary(txnForErp);
    const documentType = summary.document_type;
    const isCreditNote = documentType === 'REFUND' || summary.ncf_type === 'B04';
    const eventBase = summary.transaction_id || `${documentType || 'TXN'}-${Date.now()}`;
    const eventType = isCreditNote ? 'SALES_CREDIT_NOTE_POSTED' : 'SALE_POSTED';
    const eventId = toStableUuid(`${eventBase}:${eventType}`);
    const terminalId =
        asString(txnForErp.terminalId) ||
        asString(txnForErp.source_terminal_id) ||
        asString(txnForErp.sourceTerminalId) ||
        asString(txnForErp.terminal_id) ||
        asString(options?.fallbackTerminalId);

    const tenantRaw = asString(getSetting('active_tenant_id')) || asString(getSetting('tenant_id'));
    const payload: Record<string, unknown> = {
        occurred_at: asString(txnForErp.date) || new Date().toISOString(),
        summary,
        transaction: txnForErp
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
    /** ERP inbox row id — required to run `/inbox/apply/:id` (inbox POST alone only queues RECEIVED). */
    syncId?: string;
    applyHttpStatus?: number;
    /** Present when apply validated materialization (erp_sales_documents.id). */
    erpDocumentId?: string;
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

/**
 * ERP returns HTTP 200 with `{ status, result }` even when `result.skipped` or materialization failed.
 * Treat missing `document_id` for sale/credit-note events as forward failure so POS does not mark COMPLETED.
 */
function validateErpApplyResponse(
    eventType: string,
    applyText: string
): { ok: boolean; error?: string; documentId?: string } {
    let parsed: any;
    try {
        parsed = JSON.parse(applyText);
    } catch {
        return { ok: false, error: 'APPLY_RESPONSE_NOT_JSON' };
    }
    const top = String(parsed?.status || '').toLowerCase();
    if (top && top !== 'success') {
        return { ok: false, error: `APPLY_TOP_STATUS_${parsed?.status}` };
    }
    const result = parsed?.result;
    if (!result || typeof result !== 'object') {
        return { ok: false, error: 'APPLY_MISSING_RESULT' };
    }
    const docId =
        typeof result.applicationResult?.document_id === 'string' && result.applicationResult.document_id.trim()
            ? result.applicationResult.document_id.trim()
            : undefined;
    if (result.skipped === true) {
        const reason = String(result.reason || '');
        if (reason === 'ALREADY_APPLIED' && docId) {
            return { ok: true, documentId: docId };
        }
        return { ok: false, error: `APPLY_SKIPPED:${reason || 'unknown'}` };
    }
    if (eventType === 'SALE_POSTED' || eventType === 'SALES_CREDIT_NOTE_POSTED') {
        if (!docId) {
            return { ok: false, error: 'APPLY_MISSING_DOCUMENT_ID' };
        }
        return { ok: true, documentId: docId };
    }
    return { ok: true, documentId: docId };
}

/**
 * CLIC-ERP: `POST /api/sync/inbox` inserts `erp_sync_inbox` with status RECEIVED only.
 * `POST /api/sync/transactions` on ERP auto-applies; inbox alone does not — must call apply.
 * @see CLIC-ERP server/routes/syncInbox.js router.post('/inbox') vs storePosEventBatch
 */
async function applyErpInboxRow(
    baseUrl: string,
    syncId: string,
    eventType: string
): Promise<{ ok: boolean; status: number; text: string; documentId?: string; applyError?: string }> {
    const applyUrl = `${normalizeBaseUrl(baseUrl)}/api/sync/inbox/apply/${encodeURIComponent(syncId)}`;
    console.log(`[ERP_INBOX] POST ${applyUrl} (immediate apply after inbox) event_type=${eventType}`);
    const applyRes = await fetchWithTimeout(applyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
    });
    const applyText = await applyRes.text();
    if (!applyRes.ok) {
        return { ok: false, status: applyRes.status, text: applyText };
    }
    const validated = validateErpApplyResponse(eventType, applyText);
    if (!validated.ok) {
        console.error(
            `[ERP_INBOX] apply HTTP 200 but invalid materialization: ${validated.error} snip=${applyText.slice(0, 1200)}`
        );
        return {
            ok: false,
            status: applyRes.status,
            text: applyText,
            applyError: validated.error
        };
    }
    console.log(
        `[ERP_INBOX] apply validated event_type=${eventType} document_id=${validated.documentId || '(n/a)'} snip=${applyText.slice(0, 500)}`
    );
    return { ok: true, status: applyRes.status, text: applyText, documentId: validated.documentId };
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
        const lineItems = asArray((body.payload as any)?.transaction?.items);
        const firstLine = lineItems[0] && typeof lineItems[0] === 'object' ? Object.keys(lineItems[0] as object).slice(0, 12).join(',') : '';
        const fl = lineItems[0] && typeof lineItems[0] === 'object' ? (lineItems[0] as Record<string, unknown>) : null;
        const firstRef = fl
            ? `productId=${asString(fl.productId || fl.product_id || fl.id)} sku=${asString((fl as any).sku)} barcode=${asString((fl as any).barcode)}`
            : 'n/a';
        console.log(
            `[ERP_INBOX] transaction lines: count=${lineItems.length} tx.id=${asString((body.payload as any)?.transaction?.id)} source_tx=${asString((body.payload as any)?.summary?.transaction_id)} source_terminal=${asString((body.payload as any)?.transaction?.source_terminal_id) || asString((body.payload as any)?.transaction?.terminalId)} firstLineKeys=${firstLine || 'n/a'} firstRef=${firstRef}`
        );
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
            const inboxStatus = String(parsed?.status || parsed?.response?.status || '').toUpperCase();
            const syncIdRaw =
                (typeof parsed?.sync_id === 'string' && parsed.sync_id) ||
                (typeof parsed?.response?.sync_id === 'string' && parsed.response.sync_id) ||
                '';
            const syncId = syncIdRaw.trim();

            if (res.ok) {
                console.log(
                    `[ERP_INBOX] inbox response http=${res.status} duplicate=${duplicate} status=${inboxStatus || 'n/a'} sync_id=${syncId || 'MISSING'} applyFailedCount=${parsed?.applyFailedCount ?? 'n/a'} fullKeys=${parsed && typeof parsed === 'object' ? Object.keys(parsed).join(',') : 'n/a'} snip=${text.slice(0, 600)}`
                );

                // Legacy sync_events inserts with status APPLIED but does not materialize POS sales.
                if (
                    inboxStatus === 'APPLIED' &&
                    (body.event_type === 'SALE_POSTED' || body.event_type === 'SALES_CREDIT_NOTE_POSTED')
                ) {
                    console.error(
                        '[ERP_INBOX] ERP returned APPLIED for a sale event (legacy sync_events path). No erp_sales_documents row. Use erp_sync_inbox-first routing on ERP (see syncInbox POST /inbox).'
                    );
                    results.push({
                        eventId: body.event_id,
                        eventType: body.event_type,
                        ok: false,
                        httpStatus: res.status,
                        duplicate,
                        syncId: syncId || undefined,
                        error: 'ERP_INBOX_LEGACY_APPLIED_WITHOUT_SALE_MATERIALIZATION'
                    });
                    return { skipped: false, failed: true, results, erpBaseUrlUsed: baseUrl };
                }

                if (inboxStatus === 'APPLIED') {
                    results.push({
                        eventId: body.event_id,
                        eventType: body.event_type,
                        ok: true,
                        httpStatus: res.status,
                        duplicate,
                        syncId: syncId || undefined
                    });
                    continue;
                }

                if (!syncId) {
                    console.error('[ERP_INBOX] inbox OK but missing sync_id — cannot apply; sale will not appear in ERP');
                    results.push({
                        eventId: body.event_id,
                        eventType: body.event_type,
                        ok: false,
                        httpStatus: res.status,
                        duplicate,
                        error: 'INBOX_MISSING_SYNC_ID'
                    });
                    return { skipped: false, failed: true, results, erpBaseUrlUsed: baseUrl };
                }

                const applied = await applyErpInboxRow(baseUrl, syncId, body.event_type);
                if (!applied.ok) {
                    const errDetail =
                        applied.applyError ||
                        (applied.status >= 400 ? applied.text.slice(0, 400) : applied.text.slice(0, 800));
                    console.error(
                        `[ERP_INBOX] apply FAILED sync_id=${syncId} http=${applied.status} detail=${errDetail}`
                    );
                    results.push({
                        eventId: body.event_id,
                        eventType: body.event_type,
                        ok: false,
                        httpStatus: res.status,
                        duplicate,
                        syncId,
                        applyHttpStatus: applied.status,
                        error: errDetail
                    });
                    return { skipped: false, failed: true, results, erpBaseUrlUsed: baseUrl };
                }

                console.log(
                    `[ERP_INBOX] apply OK sync_id=${syncId} http=${applied.status} erp_document_id=${applied.documentId || 'n/a'}`
                );
                results.push({
                    eventId: body.event_id,
                    eventType: body.event_type,
                    ok: true,
                    httpStatus: res.status,
                    duplicate,
                    syncId,
                    applyHttpStatus: applied.status,
                    erpDocumentId: applied.documentId
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
