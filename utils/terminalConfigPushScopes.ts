export type TerminalConfigPushMasterScope =
    | 'items'
    | 'customers'
    | 'suppliers'
    | 'sellers'
    | 'users'
    | 'pos_users'
    | 'roles'
    | 'pos_roles';
export type TerminalConfigPushBlockScope = 'inventory' | 'product_prices';
export type TerminalConfigPushResolvedScope = 'pricing' | 'inventory' | 'documents' | 'catalog' | 'promotions';

export type TerminalConfigSyncRequestDetail = {
    source?: string;
    eventId?: string | null;
    terminalId?: string | null;
    localTerminalId?: string | null;
    masterScopes?: TerminalConfigPushMasterScope[];
    blockScopes?: TerminalConfigPushBlockScope[];
    resolvedScopes?: TerminalConfigPushResolvedScope[];
    selective?: boolean;
};

const TERMINAL_CONFIG_MASTER_SCOPE_SET = new Set<TerminalConfigPushMasterScope>([
    'items',
    'customers',
    'suppliers',
    'sellers',
    'users',
    'pos_users',
    'roles',
    'pos_roles',
]);
const TERMINAL_CONFIG_BLOCK_SCOPE_SET = new Set<TerminalConfigPushBlockScope>(['inventory', 'product_prices']);
const TERMINAL_CONFIG_RESOLVED_SCOPE_SET = new Set<TerminalConfigPushResolvedScope>(['pricing', 'inventory', 'documents', 'catalog', 'promotions']);
const TERMINAL_CONFIG_MASTER_SCOPE_ALIASES: Record<string, TerminalConfigPushMasterScope> = {
    user: 'users',
    usuarios: 'users',
    usuario: 'users',
    operador: 'users',
    operadores: 'users',
    operator: 'users',
    operators: 'users',
    pos_user: 'pos_users',
    pos_users: 'pos_users',
    usuarios_pos: 'pos_users',
    usuario_pos: 'pos_users',
    pos_operator: 'pos_users',
    pos_operators: 'pos_users',
    role: 'roles',
    roles: 'roles',
    rol: 'roles',
    pos_role: 'pos_roles',
    pos_roles: 'pos_roles',
    rol_pos: 'pos_roles',
    roles_pos: 'pos_roles',
};
const TERMINAL_CONFIG_BLOCK_SCOPE_ALIASES: Record<string, TerminalConfigPushBlockScope> = {
    inventory: 'inventory',
    inventories: 'inventory',
    inventory_stock: 'inventory',
    inventory_stocks: 'inventory',
    stock: 'inventory',
    stocks: 'inventory',
    stock_balance: 'inventory',
    stock_balances: 'inventory',
    product_price: 'product_prices',
    product_prices: 'product_prices',
    price: 'product_prices',
    prices: 'product_prices',
    tariff: 'product_prices',
    tariffs: 'product_prices',
    tarifa: 'product_prices',
    tarifas: 'product_prices',
};

const asObject = (value: unknown): Record<string, unknown> => (
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {}
);

const hasOwn = (record: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(record, key);

const scopeToken = (value: unknown): string => (
    typeof value === 'string'
        ? value.trim().toLowerCase().replace(/[\s-]+/g, '_')
        : ''
);

const normalizeScopes = <T extends string>(
    value: unknown,
    supported: Set<T>,
    aliases: Record<string, T> = {},
): T[] => {
    const values = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(',')
            : [];

    return Array.from(new Set(
        values
            .map((entry) => {
                const token = scopeToken(entry);
                return aliases[token] || token;
            })
            .filter((entry): entry is T => Boolean(entry) && supported.has(entry as T))
    ));
};

const mergeScopeInputs = (...values: unknown[]): unknown[] => (
    values.flatMap((value) => {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') return value.split(',');
        return [];
    })
);

export const extractTerminalConfigRequestedScopes = (value: unknown) => {
    const record = asObject(value);
    const hasMasterScopes = hasOwn(record, 'master_scopes') || hasOwn(record, 'masterScopes');
    const hasBlockScopes =
        hasOwn(record, 'block_scopes') ||
        hasOwn(record, 'blockScopes') ||
        hasOwn(record, 'blocks') ||
        hasOwn(record, 'scopes');
    const hasResolvedScopes = hasOwn(record, 'resolved_scopes') || hasOwn(record, 'resolvedScopes');
    const selective = hasMasterScopes || hasBlockScopes || hasResolvedScopes;

    if (!selective) {
        return {
            selective: false,
            masterScopes: undefined,
            blockScopes: undefined,
            resolvedScopes: undefined,
        };
    }

    return {
        selective: true,
        masterScopes: normalizeScopes(
            record.masterScopes ?? record.master_scopes,
            TERMINAL_CONFIG_MASTER_SCOPE_SET,
            TERMINAL_CONFIG_MASTER_SCOPE_ALIASES,
        ),
        blockScopes: normalizeScopes(
            mergeScopeInputs(record.blockScopes, record.block_scopes, record.blocks, record.scopes),
            TERMINAL_CONFIG_BLOCK_SCOPE_SET,
            TERMINAL_CONFIG_BLOCK_SCOPE_ALIASES,
        ),
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
            blockScopes: scopes.blockScopes ?? [],
            resolvedScopes: scopes.resolvedScopes ?? [],
        };
};
