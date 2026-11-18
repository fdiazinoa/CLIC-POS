/** Context readiness is recoverable only for these two dedicated audit queues. */
export const AUDIT_CONTEXT_RETRY_DELAY_MS = 60000;
const contextCode = 'ERP_CONTEXT_MISSING';
const auditCollection = (collection: string) => collection === 'posAuditEvents' || collection === 'invoiceAuditEvents';
const bodyHasContextCode = (body: unknown): boolean => {
    try {
        const parsed = typeof body === 'string' ? JSON.parse(body) : body;
        return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            && Object.prototype.hasOwnProperty.call(parsed, 'code') && (parsed as {code?: unknown}).code === contextCode);
    } catch { return false; }
};

/** No substring inference, generic 409 recovery, nested codes, or fallback past conflicting HTTP metadata. */
export function isAuditContextMissing(collection: string, error: unknown): boolean {
    if (!auditCollection(collection)) return false;
    if (error && typeof error === 'object' && ('httpStatus' in error || 'responseBody' in error)) {
        const structured = error as {httpStatus?: unknown; responseBody?: unknown};
        return structured.httpStatus === 409 && bodyHasContextCode(structured.responseBody);
    }
    const message = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
    if (message === contextCode) return true;
    // Historical worker rows persisted only Error.message. Require its entire original envelope.
    const historical = /^Operational sync failed(?: after re-auth)?: 409(?: [A-Za-z][A-Za-z -]*)?\s+—\s+(\{[\s\S]*\})$/.exec(message);
    return Boolean(historical && bodyHasContextCode(historical[1]));
}

export function isAuditContextBlocked(collection: string, item: {syncStatus?: unknown; syncBlockedReason?: unknown; syncError?: unknown}): boolean {
    if (item.syncStatus !== 'BLOCKED_FUNCTIONAL' || !auditCollection(collection)) return false;
    const values = [item.syncBlockedReason,item.syncError];
    if (values.some(value => value != null && value !== '' && typeof value !== 'string')) return false;
    const reasons = values.filter(value => typeof value === 'string' && value.length > 0);
    return reasons.length > 0 && reasons.every(reason => isAuditContextMissing(collection,reason));
}
