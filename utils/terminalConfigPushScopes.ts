export type TerminalConfigPushMasterScope = 'items' | 'customers' | 'suppliers' | 'sellers';
export type TerminalConfigPushResolvedScope = 'pricing' | 'inventory' | 'documents' | 'catalog' | 'promotions';

export type TerminalConfigSyncRequestDetail = {
    source?: string;
    eventId?: string | null;
    terminalId?: string | null;
    localTerminalId?: string | null;
    masterScopes?: TerminalConfigPushMasterScope[];
    resolvedScopes?: TerminalConfigPushResolvedScope[];
    selective?: boolean;
};

const TERMINAL_CONFIG_MASTER_SCOPE_SET = new Set<TerminalConfigPushMasterScope>(['items', 'customers', 'suppliers', 'sellers']);
const TERMINAL_CONFIG_RESOLVED_SCOPE_SET = new Set<TerminalConfigPushResolvedScope>(['pricing', 'inventory', 'documents', 'catalog', 'promotions']);

const asObject = (value: unknown): Record<string, unknown> => (
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {}
);

const hasOwn = (record: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(record, key);

const normalizeScopes = <T extends string>(value: unknown, supported: Set<T>): T[] => {
    const values = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(',')
            : [];

    return Array.from(new Set(
        values
            .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
            .filter((entry): entry is T => Boolean(entry) && supported.has(entry as T))
    ));
};

export const extractTerminalConfigRequestedScopes = (value: unknown) => {
    const record = asObject(value);
    const hasMasterScopes = hasOwn(record, 'master_scopes') || hasOwn(record, 'masterScopes');
    const hasResolvedScopes = hasOwn(record, 'resolved_scopes') || hasOwn(record, 'resolvedScopes');
    const selective = hasMasterScopes || hasResolvedScopes;

    if (!selective) {
        return {
            selective: false,
            masterScopes: undefined,
            resolvedScopes: undefined,
        };
    }

    return {
        selective: true,
        masterScopes: normalizeScopes(record.masterScopes ?? record.master_scopes, TERMINAL_CONFIG_MASTER_SCOPE_SET),
        resolvedScopes: normalizeScopes(record.resolvedScopes ?? record.resolved_scopes, TERMINAL_CONFIG_RESOLVED_SCOPE_SET),
    };
};

export const buildTerminalConfigRefreshRequest = (value: unknown) => {
    const scopes = extractTerminalConfigRequestedScopes(value);

    if (!scopes.selective) {
        return {
            forceRemoteFetch: true as const,
            forceFullCatalog: true,
        };
    }

    return {
        forceRemoteFetch: true as const,
        forceFullCatalog: false,
        masterScopes: scopes.masterScopes ?? [],
        resolvedScopes: scopes.resolvedScopes ?? [],
    };
};
