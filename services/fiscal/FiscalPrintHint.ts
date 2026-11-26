export const FISCAL_PRINT_HINT = 'FISCAL_PRINT_HINT';

type TerminalScope = { tenantId?: string | null; storeId?: string | null; terminalId?: string | null };
const listeners = new Map<string, Set<() => void>>();

export function receiveFiscalPrintHint(payload: unknown, scope: TerminalScope, binding: TerminalScope): void {
    if (!payload || typeof payload !== 'object') return;
    const hint = payload as Record<string, unknown>;
    if (hint.version !== 1 || typeof hint.transactionId !== 'string'
        || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(hint.transactionId)) return;
    if (!scope.tenantId || !scope.storeId || !scope.terminalId
        || hint.tenantId !== scope.tenantId || hint.storeId !== scope.storeId || hint.terminalId !== scope.terminalId
        || binding.tenantId !== scope.tenantId || binding.storeId !== scope.storeId || binding.terminalId !== scope.terminalId) return;
    for (const listener of listeners.get(hint.transactionId) ?? []) listener();
}

export function onFiscalPrintHint(transactionId: string, listener: () => void): () => void {
    const matching = listeners.get(transactionId) ?? new Set();
    matching.add(listener);
    listeners.set(transactionId, matching);
    return () => {
        matching.delete(listener);
        if (!matching.size) listeners.delete(transactionId);
    };
}
