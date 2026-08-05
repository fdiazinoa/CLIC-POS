import assert from 'node:assert/strict';
import test from 'node:test';

class MemoryStorage {
    private values = new Map<string, string>();
    getItem(key: string) { return this.values.get(key) ?? null; }
    setItem(key: string, value: string) { this.values.set(key, String(value)); }
    removeItem(key: string) { this.values.delete(key); }
    clear() { this.values.clear(); }
}

class TestCustomEvent {
    type: string;
    detail: unknown;
    constructor(type: string, options?: { detail?: unknown }) {
        this.type = type;
        this.detail = options?.detail;
    }
}

const localStorage = new MemoryStorage();
const sessionStorage = new MemoryStorage();
const dispatchedEvents: Array<{ type: string; detail?: unknown }> = [];
Object.assign(globalThis, {
    localStorage,
    sessionStorage,
    CustomEvent: TestCustomEvent,
    window: {
        localStorage,
        setTimeout,
        clearTimeout,
        dispatchEvent: (event: { type?: string; detail?: unknown }) => {
            if (event?.type) dispatchedEvents.push({ type: event.type, detail: event.detail });
            return true;
        },
    },
});

const { getInitialConfig } = await import('../constants');
const { db } = await import('../utils/db');
const lifecycle = await import('../utils/erpSyncLifecycle');
const { resolvePosSalesStartView } = await import('../utils/posStartupView');

const terminalId = '9ffc6771-7845-4976-afd3-20cebc3cc6e8';
const deviceId = 'DEV-QA-CONTRACT';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const collections = new Map<string, unknown>();

const resetHarness = () => {
    localStorage.clear();
    sessionStorage.clear();
    dispatchedEvents.length = 0;
    collections.clear();
    const config = getInitialConfig('Supermercado' as any);
    const localTerminalId = config.terminals[0].id;
    collections.set('config', clone(config));
    collections.set('products', []);
    collections.set('productPrices', []);
    localStorage.setItem('CLIC_ERP_BASE_URL', 'https://erp.example.test');
    localStorage.setItem('CLIC_POS_DEVICE_ID', deviceId);
    localStorage.setItem('clic_tenant_id', 'tenant-config-push-contract');
    localStorage.setItem('clic_erp_sync_tenant_id', 'tenant-config-push-contract');
    localStorage.setItem('clic_erp_sync_terminal_id', terminalId);
    localStorage.setItem('clic_erp_sync_local_terminal_id', localTerminalId);
    localStorage.setItem('active_terminal_id', localTerminalId);
    localStorage.setItem('clic_pos_config_push_v2_state', JSON.stringify({
        versionHash: null,
        domainVersions: {},
        inFlight: null,
    }));
    (db as any).get = async (collection: string) => clone(collections.get(collection) ?? []);
    (db as any).save = async (collection: string, value: unknown) => {
        collections.set(collection, clone(value));
    };
    return { config, localTerminalId };
};

const makeEvent = (id: string, scopes: string[], versions: Record<string, number>) => ({
    id,
    event_type: 'CONFIG_PUSH_V2',
    status: 'PROCESSING',
    payload: {
        contract_version: 2,
        snapshot_id: `snapshot-${id}`,
        version_hash: `hash-${id}`,
        versions,
        scopes,
        terminal_id: terminalId,
    },
});

const runEvent = async (input: {
    id: string;
    scopes: string[];
    versions: Record<string, number>;
    domains?: Record<string, unknown>;
    snapshotResponses?: Response[];
}) => {
    const event = makeEvent(input.id, input.scopes, input.versions);
    let outboxServed = false;
    const acks: Array<Record<string, unknown>> = [];
    const snapshotUrls: string[] = [];
    const responses = [...(input.snapshotResponses || [])];
    globalThis.fetch = (async (request: string | URL | Request, init?: RequestInit) => {
        const url = String(request);
        if (url.includes('/outbox/pull')) {
            if (outboxServed) return Response.json({ status: 'success', events: [], count: 0 });
            outboxServed = true;
            return Response.json({ status: 'success', events: [event], count: 1 });
        }
        if (url.includes('/config-snapshots/')) {
            snapshotUrls.push(url);
            const queued = responses.shift();
            if (queued) return queued;
            return Response.json({
                status: 'success',
                snapshot_id: event.payload.snapshot_id,
                version_hash: event.payload.version_hash,
                versions: input.versions,
                scopes: input.scopes,
                domains: input.domains || {},
            });
        }
        if (url.includes('/outbox/ack')) {
            const body = JSON.parse(String(init?.body || '{}'));
            acks.push(body);
            return Response.json({ status: 'success', outbox_id: body.outbox_id, applied_status: body.status });
        }
        throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const result = await lifecycle.triggerErpSyncOutbox('manual_sync');
    return { result, acks, snapshotUrls };
};

test('maps ERP prices { cursor, prices } to canonical productPrices', async () => {
    resetHarness();
    const prices = Array.from({ length: 6 }, (_, index) => ({
        product_id: `product-${index}`,
        item_id: `item-${index}`,
        tariff_id: 'tariff-1',
        tariff_code: 'GENERAL',
        price: index + 10,
        updated_at: '2026-07-14T00:00:00.000Z',
    }));
    const writes = await lifecycle.buildConfigPushV2DomainWrites('prices', { cursor: 'cursor-1', prices });
    assert.deepEqual(writes.map((write) => write.collection), ['productPrices']);
    assert.equal((writes[0].value as unknown[]).length, 6);
    assert.equal((writes[0].value as any[])[0].productId, 'product-0');
    assert.equal((writes[0].value as any[])[0].tariffId, 'tariff-1');
});

test('migrates legacy config and documents version keys to canonical ERP domains', () => {
    resetHarness();
    localStorage.setItem('clic_pos_config_push_v2_state', JSON.stringify({
        versionHash: 'legacy-domain-state',
        domainVersions: { config: 7, terminal_config: 6, documents: 4 },
    }));

    assert.deepEqual(lifecycle.getConfigPushV2Diagnostics().domainVersions, {
        terminal_config: 7,
        fiscal: 4,
    });
});

test('accepts an empty ERP prices array as an authoritative clear', async () => {
    resetHarness();
    const writes = await lifecycle.buildConfigPushV2DomainWrites('prices', { cursor: 'cursor-empty', prices: [] });
    assert.equal(writes[0].collection, 'productPrices');
    assert.deepEqual(writes[0].value, []);
});

test('keeps compatibility with legacy productPrices', async () => {
    resetHarness();
    const writes = await lifecycle.buildConfigPushV2DomainWrites('prices', {
        productPrices: [{ productId: 'p1', tariffId: 't1', price: 25 }],
    });
    assert.equal(writes[0].collection, 'productPrices');
    assert.equal((writes[0].value as any[])[0].price, 25);
});

test('maps terminal_config to the existing terminal without replacing BusinessConfig', async () => {
    const { config, localTerminalId } = resetHarness();
    const writes = await lifecycle.buildConfigPushV2DomainWrites('config', {
        terminal: {
            terminal_id: terminalId,
            config: { session: { autoLockMinutes: 7 } },
        },
        resolved: {},
    });
    const nextConfig = writes.find((write) => write.collection === 'config')?.value as any;
    assert.equal(nextConfig.currencySymbol, config.currencySymbol);
    assert.equal(nextConfig.terminals.find((terminal: any) => terminal.id === localTerminalId).config.security.autoLogoutMinutes, 7);
});

test('applies and persists USD from CONFIG_PUSH_V2 while keeping DOP enabled', async () => {
    const { localTerminalId } = resetHarness();
    const { result, acks } = await runEvent({
        id: 'usd-base-currency',
        scopes: ['terminal_config'],
        versions: { terminal_config: 7 },
        domains: {
            terminal_config: {
                terminal: {
                    terminal_id: terminalId,
                    config: {
                        currency_code: 'USD',
                        currencies: {
                            default: 'USD',
                            base: 'USD',
                            list: [
                                { code: 'DOP', symbol: 'RD$', exchange_rate: 1, is_base: false, enabled: true },
                                { code: 'USD', symbol: 'US$', exchange_rate: 59, is_base: true, enabled: true },
                            ],
                        },
                    },
                },
                resolved: {},
            },
        },
    });

    assert.equal(result?.applied, 1);
    assert.equal(acks[0].status, 'APPLIED');

    const persisted = clone(collections.get('config')) as any;
    const persistedTerminal = persisted.terminals.find((terminal: any) => terminal.id === localTerminalId);
    assert.ok(persistedTerminal);
    assert.equal(persisted.currencies.find((currency: any) => currency.code === 'USD')?.isBase, true);
    assert.equal(persisted.currencies.find((currency: any) => currency.code === 'USD')?.isEnabled, true);
    assert.equal(persisted.currencies.find((currency: any) => currency.code === 'DOP')?.isBase, false);
    assert.equal(persisted.currencies.find((currency: any) => currency.code === 'DOP')?.isEnabled, true);
    assert.equal(persisted.currencySymbol, 'US$');
    assert.equal(persistedTerminal.config.currencies.list.find((currency: any) => currency.code === 'USD')?.enabled, true);
    assert.equal(persistedTerminal.config.currencies.list.find((currency: any) => currency.code === 'DOP')?.enabled, true);

    const configEvent = dispatchedEvents.find((event) => event.type === 'configUpdated');
    assert.deepEqual(configEvent?.detail, persisted);

    const configReloadedAfterRestart = clone(collections.get('config')) as any;
    assert.equal(configReloadedAfterRestart.currencies.find((currency: any) => currency.isBase)?.code, 'USD');
    assert.equal(configReloadedAfterRestart.currencySymbol, 'US$');

    const diagnostics = lifecycle.getConfigPushV2Diagnostics();
    assert.equal(diagnostics.versionHash, 'hash-usd-base-currency');
    assert.equal(diagnostics.domainVersions.terminal_config, 7);
    assert.ok(diagnostics.appliedAt);
});

test('applies DOP, EUR and USD from terminal.config when resolved data is present', async () => {
    const { localTerminalId } = resetHarness();
    const { result, acks } = await runEvent({
        id: 'terminal-multicurrency-list',
        scopes: ['terminal_config'],
        versions: { terminal_config: 8 },
        domains: {
            terminal_config: {
                currency_code: 'DOP',
                terminal: {
                    terminal_id: terminalId,
                    config: {
                        currency_code: 'DOP',
                        allowed_currency_codes: ['DOP', 'EUR', 'USD'],
                        currencies: {
                            default: 'DOP',
                            base: 'DOP',
                            list: [
                                { code: 'DOP', name: 'Peso Dominicano', symbol: 'RD$', exchange_rate: 1, is_base: true, enabled: true },
                                { code: 'EUR', name: 'Euro', symbol: '€', exchange_rate: 70, is_base: false, enabled: true },
                                { code: 'USD', name: 'Dólar Estadounidense', symbol: '$', exchange_rate: 60, is_base: false, enabled: true },
                            ],
                        },
                    },
                },
                resolved: {
                    pricing: {
                        tariffs: [],
                    },
                },
            },
        },
    });

    assert.equal(result?.applied, 1);
    assert.equal(acks[0].status, 'APPLIED');

    const persisted = clone(collections.get('config')) as any;
    const persistedTerminal = persisted.terminals.find((terminal: any) => terminal.id === localTerminalId);
    assert.deepEqual(
        persisted.currencies.map((currency: any) => currency.code),
        ['DOP', 'EUR', 'USD']
    );
    assert.equal(persisted.currencies.find((currency: any) => currency.code === 'DOP')?.isBase, true);
    assert.equal(persisted.currencies.find((currency: any) => currency.code === 'EUR')?.rate, 70);
    assert.equal(persisted.currencies.find((currency: any) => currency.code === 'USD')?.rate, 60);
    assert.deepEqual(persistedTerminal.config.allowedCurrencyCodes, ['DOP', 'EUR', 'USD']);
    assert.deepEqual(persistedTerminal.config.financial.acceptedCurrencies, ['DOP', 'EUR', 'USD']);
    assert.deepEqual(
        persistedTerminal.config.currencies.list.map((currency: any) => currency.code),
        ['DOP', 'EUR', 'USD']
    );

    const configReloadedAfterRestart = clone(collections.get('config')) as any;
    assert.deepEqual(
        configReloadedAfterRestart.currencies.map((currency: any) => currency.code),
        ['DOP', 'EUR', 'USD']
    );
});

test('applies RETAIL to RESTAURANT terminal_config, persists it and refreshes runtime state', async () => {
    const { localTerminalId } = resetHarness();
    const { result, acks } = await runEvent({
        id: 'restaurant-mode',
        scopes: ['terminal_config'],
        versions: { terminal_config: 2 },
        domains: {
            terminal_config: {
                terminal: { terminal_id: terminalId, config: {} },
                business_config: {
                    vertical_negocio: 'RESTAURANT',
                    businessVertical: 'RESTAURANT',
                    usa_mesas: true,
                    useTables: true,
                    pantalla_inicio: 'MAPA_MESAS',
                },
                operational: {
                    vertical_negocio: 'RESTAURANT',
                    usa_mesas: true,
                    pantalla_inicio: 'MAPA_MESAS',
                },
                vertical_negocio: 'RESTAURANT',
                usa_mesas: true,
                useTables: true,
                pantalla_inicio: 'MAPA_MESAS',
            },
        },
    });

    assert.equal(result?.applied, 1);
    assert.equal(acks[0].status, 'APPLIED');
    const persisted = clone(collections.get('config')) as any;
    const terminal = persisted.terminals.find((entry: any) => entry.id === localTerminalId);
    assert.equal(persisted.vertical, 'RESTAURANT');
    assert.equal(persisted.business_config.vertical_negocio, 'RESTAURANT');
    assert.equal(persisted.business_config.businessVertical, 'RESTAURANT');
    assert.equal(persisted.business_config.usa_mesas, true);
    assert.equal(persisted.business_config.useTables, true);
    assert.equal(persisted.business_config.pantalla_inicio, 'MAPA_MESAS');
    assert.equal(persisted.operational.vertical_negocio, 'RESTAURANT');
    assert.equal(terminal.config.operational.vertical_negocio, 'RESTAURANT');
    assert.equal(terminal.config.operational.usa_mesas, true);
    assert.equal(terminal.config.operational.pantalla_inicio, 'MAPA_MESAS');

    const configEvent = dispatchedEvents.find((event) => event.type === 'configUpdated');
    assert.deepEqual(configEvent?.detail, persisted);

    const configReloadedAfterRestart = clone(collections.get('config')) as any;
    const reloadedTerminal = configReloadedAfterRestart.terminals.find((entry: any) => entry.id === localTerminalId);
    assert.equal(resolvePosSalesStartView(configReloadedAfterRestart, reloadedTerminal.config), 'TABLE_MAP');
});

test('persists ORDER_TAKER contract from CONFIG_PUSH_V2 across restart', async () => {
    const { localTerminalId } = resetHarness();
    const { result, acks } = await runEvent({
        id: 'order-taker-contract',
        scopes: ['terminal_config'],
        versions: { terminal_config: 12 },
        domains: {
            terminal_config: {
                terminal: {
                    terminal_id: terminalId,
                    terminal_type: 'ORDER_TAKER',
                    master_terminal_id: 'master-terminal-001',
                    capabilities: ['TABLES', 'ORDERS', 'KDS_SEND'],
                    restrictions: ['NO_OFFLINE', 'NO_PAYMENTS', 'NO_FISCAL_DOCUMENTS', 'NO_CASH_SESSION', 'NO_Z_CLOSE'],
                    config: {
                        terminal_type: 'ORDER_TAKER',
                        master_terminal_id: 'master-terminal-001',
                        capabilities: ['TABLES', 'ORDERS', 'KDS_SEND'],
                        restrictions: ['NO_OFFLINE', 'NO_PAYMENTS', 'NO_FISCAL_DOCUMENTS', 'NO_CASH_SESSION', 'NO_Z_CLOSE'],
                    },
                },
                resolved: {
                    terminal: {
                        terminal_type: 'ORDER_TAKER',
                        master_terminal_id: 'master-terminal-001',
                    },
                },
            },
        },
    });

    assert.equal(result?.applied, 1);
    assert.equal(acks[0].status, 'APPLIED');

    const persisted = clone(collections.get('config')) as any;
    const terminal = persisted.terminals.find((entry: any) => entry.id === localTerminalId);
    assert.equal(terminal.config.deviceRole.role, 'ORDER_TAKER');
    assert.equal(terminal.config.terminal_type, 'ORDER_TAKER');
    assert.equal(terminal.config.master_terminal_id, 'master-terminal-001');
    assert.deepEqual(terminal.config.capabilities, ['TABLES', 'ORDERS', 'KDS_SEND']);
    assert.ok(terminal.config.restrictions.includes('NO_OFFLINE'));
    assert.ok(terminal.config.restrictions.includes('NO_PAYMENTS'));

    const reloaded = clone(collections.get('config')) as any;
    const reloadedTerminal = reloaded.terminals.find((entry: any) => entry.id === localTerminalId);
    assert.equal(reloadedTerminal.config.deviceRole.role, 'ORDER_TAKER');
    assert.equal(reloadedTerminal.config.master_terminal_id, 'master-terminal-001');
});

test('same terminal_config version hash is idempotent and does not download or reapply', async () => {
    resetHarness();
    const input = {
        id: 'restaurant-idempotent',
        scopes: ['terminal_config'],
        versions: { terminal_config: 2 },
        domains: {
            terminal_config: {
                terminal: { terminal_id: terminalId, config: {} },
                business_config: {
                    vertical_negocio: 'RESTAURANT',
                    usa_mesas: true,
                    pantalla_inicio: 'MAPA_MESAS',
                },
            },
        },
    };
    const first = await runEvent(input);
    const second = await runEvent(input);

    assert.equal(first.result?.applied, 1);
    assert.equal(second.result?.applied, 1);
    assert.equal(second.snapshotUrls.length, 0);
    assert.equal(second.acks[0].status, 'APPLIED');
});

test('terminal_config persistence failure never ACKs APPLIED', async () => {
    const { config } = resetHarness();
    let failNextConfigWrite = true;
    (db as any).save = async (collection: string, value: unknown) => {
        if (collection === 'config' && failNextConfigWrite) {
            failNextConfigWrite = false;
            throw new Error('simulated config persistence failure');
        }
        collections.set(collection, clone(value));
    };

    const { result, acks } = await runEvent({
        id: 'restaurant-persistence-failure',
        scopes: ['terminal_config'],
        versions: { terminal_config: 2 },
        domains: {
            terminal_config: {
                terminal: { terminal_id: terminalId, config: {} },
                business_config: {
                    vertical_negocio: 'RESTAURANT',
                    usa_mesas: true,
                    pantalla_inicio: 'MAPA_MESAS',
                },
            },
        },
    });

    assert.equal(result?.applied, 0);
    assert.equal(result?.failed, 1);
    assert.equal(acks[0].status, 'FAILED');
    assert.equal((collections.get('config') as any).vertical, config.vertical);
});

test('maps nested loyalty into BusinessConfig and legacy loyalty collections', async () => {
    resetHarness();
    const writes = await lifecycle.buildConfigPushV2DomainWrites('loyalty', {
        loyalty: {
            config: { isEnabled: true, earnRate: 2, redeemRate: 0.5, minRedemptionPoints: 10, expirationMonths: 12, excludedCategories: [] },
            loyaltyPrograms: [{ id: 'program-1' }],
            loyaltyTiers: [{ id: 'tier-1' }],
            campaigns: [],
            coupons: [],
        },
    });
    assert.deepEqual((writes.find((write) => write.collection === 'loyaltyPrograms')?.value as any[]).map((row) => row.id), ['program-1']);
    assert.deepEqual((writes.find((write) => write.collection === 'loyaltyTiers')?.value as any[]).map((row) => row.id), ['tier-1']);
    assert.deepEqual(writes.find((write) => write.collection === 'campaigns')?.value, []);
    assert.deepEqual(writes.find((write) => write.collection === 'coupons')?.value, []);
    assert.equal((writes.find((write) => write.collection === 'config')?.value as any).loyalty.earnRate, 2);
});

test('applies prices + terminal_config + loyalty atomically and ACKs APPLIED', async () => {
    resetHarness();
    const { result, acks, snapshotUrls } = await runEvent({
        id: 'multi-domain',
        scopes: ['prices', 'terminal_config', 'loyalty'],
        versions: { prices: 2, terminal_config: 3, loyalty: 4 },
        domains: {
            prices: { cursor: 'p2', prices: [{ product_id: 'p1', tariff_id: 't1', price: 12 }] },
            terminal_config: { terminal: { terminal_id: terminalId, config: { session: { autoLockMinutes: 9 } } }, resolved: {} },
            loyalty: { loyalty: { config: { isEnabled: true, earnRate: 1, redeemRate: 1, minRedemptionPoints: 0, expirationMonths: 0, excludedCategories: [] }, campaigns: [], coupons: [] } },
        },
    });
    assert.equal(result?.applied, 1);
    assert.equal(acks[0].status, 'APPLIED');
    assert.match(snapshotUrls[0], /scopes=prices%2Cterminal_config%2Cloyalty/);
    assert.equal((collections.get('productPrices') as any[]).length, 1);
    const state = JSON.parse(localStorage.getItem('clic_pos_config_push_v2_state') || '{}');
    assert.deepEqual(state.domainVersions, { prices: 2, terminal_config: 3, loyalty: 4 });
});

test('rolls back every prior collection when a later domain is invalid', async () => {
    resetHarness();
    const original = [{ id: 'old', productId: 'p0', tariffId: 't0', price: 1, updatedAt: 'old' }];
    collections.set('productPrices', clone(original));
    const { result, acks } = await runEvent({
        id: 'rollback',
        scopes: ['prices', 'loyalty'],
        versions: { prices: 2, loyalty: 2 },
        domains: {
            prices: { prices: [{ product_id: 'p1', tariff_id: 't1', price: 50 }] },
            loyalty: {},
        },
    });
    assert.equal(result?.failed, 1);
    assert.equal(acks[0].status, 'FAILED');
    assert.deepEqual(collections.get('productPrices'), original);
    const state = JSON.parse(localStorage.getItem('clic_pos_config_push_v2_state') || '{}');
    assert.equal(state.versionHash, null);
    assert.deepEqual(state.domainVersions, {});
});

test('retries a BUILDING snapshot and applies it once READY', async () => {
    resetHarness();
    const eventId = 'building';
    const event = makeEvent(eventId, ['prices'], { prices: 2 });
    const building = new Response(JSON.stringify({ status: 'pending', code: 'SYNC_SNAPSHOT_BUILDING', retry_after_ms: 1 }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
    });
    const ready = Response.json({
        status: 'success',
        snapshot_id: event.payload.snapshot_id,
        version_hash: event.payload.version_hash,
        versions: { prices: 2 },
        scopes: ['prices'],
        domains: { prices: { prices: [] } },
    });
    const { result, acks } = await runEvent({
        id: eventId,
        scopes: ['prices'],
        versions: { prices: 2 },
        snapshotResponses: [building, ready],
    });
    assert.equal(result?.applied, 1);
    assert.equal(acks.length, 1);
    assert.equal(acks[0].status, 'APPLIED');
});

test('ACKs FAILED for a non-retryable snapshot failure', async () => {
    resetHarness();
    const failed = new Response(JSON.stringify({ status: 'error', code: 'SYNC_SNAPSHOT_FAILED' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
    });
    const { result, acks } = await runEvent({
        id: 'snapshot-failed',
        scopes: ['prices'],
        versions: { prices: 2 },
        snapshotResponses: [failed],
    });
    assert.equal(result?.failed, 1);
    assert.equal(acks[0].status, 'FAILED');
});

test('maps the nested catalog contract', async () => {
    resetHarness();
    const writes = await lifecycle.buildConfigPushV2DomainWrites('catalog', {
        masters: { items: [{ id: 'p1' }], customers: [{ id: 'c1' }], suppliers: [], pos_users: [], pos_roles: [] },
        catalog: { product_groups: [{ id: 'g1' }], categories: [{ id: 'cat1' }] },
    });
    assert.deepEqual(writes.map((write) => write.collection), ['products', 'customers', 'suppliers', 'users', 'roles', 'categories', 'productGroups']);
});

test('maps inventory balances to canonical productStocks', async () => {
    resetHarness();
    const writes = await lifecycle.buildConfigPushV2DomainWrites('inventory', {
        cursor: 'inventory-1',
        balances: [{ item_id: 'p1', warehouse_id: 'w1', qty_on_hand: 8, qty_committed: 3 }],
    });
    const stock = (writes.find((write) => write.collection === 'productStocks')?.value as any[])[0];
    assert.deepEqual({ productId: stock.productId, warehouseId: stock.warehouseId, qtyAvailable: stock.qtyAvailable }, { productId: 'p1', warehouseId: 'w1', qtyAvailable: 5 });
});

test('maps fiscal documents and taxes without discarding config', async () => {
    resetHarness();
    const writes = await lifecycle.buildConfigPushV2DomainWrites('documents', {
        documents: { document_series: [{ id: 'series-1' }], fiscal_ranges: [], fiscal_allocations: [] },
        taxes: [{ id: 'tax-1', rate: 18 }],
        fiscal: {},
    });
    assert.ok(writes.some((write) => write.collection === 'documentSeries'));
    assert.ok(writes.some((write) => write.collection === 'taxes'));
    assert.ok(writes.some((write) => write.collection === 'config'));
});

test('maps promotions, purchase orders and transfers contracts', async () => {
    resetHarness();
    const promotions = await lifecycle.buildConfigPushV2DomainWrites('promotions', { promotions: [{ id: 'promo-1' }] });
    const orders = await lifecycle.buildConfigPushV2DomainWrites('purchase_orders', { purchase_orders: [{ id: 'po-1' }] });
    const transfers = await lifecycle.buildConfigPushV2DomainWrites('transfers', { transfers: [{ id: 'tr-1' }] });
    assert.equal(promotions[0].collection, 'promotions');
    assert.equal(orders[0].collection, 'purchaseOrders');
    assert.equal(transfers[0].collection, 'transfers');
});
