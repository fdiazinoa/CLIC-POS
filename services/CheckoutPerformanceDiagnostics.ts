import type { BusinessConfig } from '../types';
import { getLatestPosInteraction } from '../utils/interactionPerformance';

type JsonObject = Record<string, unknown>;

export type CheckoutDiagnosticEnvironment = {
    device: JsonObject;
    display: JsonObject;
    browser: JsonObject;
    storage: JsonObject;
    posConfig: JsonObject;
};

export type CheckoutPerformanceSnapshot = {
    source: 'android_native' | 'browser';
    memory?: JsonObject;
    cpu?: JsonObject;
    storage?: JsonObject;
    power?: JsonObject;
    network?: JsonObject;
    responsiveness?: JsonObject;
    interaction?: JsonObject;
    durations?: JsonObject;
};

const PERFORMANCE_STAGES = new Set([
    'TRACKING_ENABLED', 'CHECKOUT_OPEN', 'CHECKOUT_CONFIRM', 'PAYMENT_MODAL_CONFIRM', 'PAYMENT_RESULT',
    'FINANCIAL_COMMIT_START', 'FINANCIAL_COMMIT_OK', 'LEGACY_PERSIST_OK',
    'OUTBOX_BUILD', 'OUTBOX_SEND', 'OUTBOX_RESULT', 'PRINT_REQUEST', 'PRINT_RESULT',
]);

const round = (value: number, decimals = 2) => {
    const multiplier = 10 ** decimals;
    return Math.round(value * multiplier) / multiplier;
};

const finite = (value: unknown): number | null => {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : null;
};

const parseBridgeJson = (method: 'getDiagnosticDeviceContext' | 'getDiagnosticPerformanceSnapshot'): JsonObject => {
    try {
        const bridge = (window as Window & {
            ClicPOSAppBridge?: Record<string, (() => string) | undefined>;
        }).ClicPOSAppBridge;
        const read = bridge?.[method];
        if (typeof read !== 'function') return {};
        const parsed = JSON.parse(read.call(bridge));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : {};
    } catch {
        return {};
    }
};

const stableJson = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value as JsonObject)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
};

const hashSummary = (value: unknown): string => {
    const input = stableJson(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index++) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const countEnabled = (items: unknown): number => Array.isArray(items)
    ? items.filter(item => !(item && typeof item === 'object' && (item as JsonObject).isEnabled === false)).length
    : 0;

const safePosConfigSummary = (config: BusinessConfig, terminal: unknown): JsonObject => {
    const source = config as unknown as JsonObject;
    const terminalRow = terminal && typeof terminal === 'object' ? terminal as JsonObject : {};
    const terminalConfig = terminalRow.config && typeof terminalRow.config === 'object' ? terminalRow.config as JsonObject : {};
    const workflow = terminalConfig.workflow && typeof terminalConfig.workflow === 'object' ? terminalConfig.workflow as JsonObject : {};
    const inventory = workflow.inventory && typeof workflow.inventory === 'object' ? workflow.inventory as JsonObject : {};
    const session = workflow.session && typeof workflow.session === 'object' ? workflow.session as JsonObject : {};
    const offline = workflow.offline && typeof workflow.offline === 'object' ? workflow.offline as JsonObject : {};
    const financial = terminalConfig.financial && typeof terminalConfig.financial === 'object' ? terminalConfig.financial as JsonObject : {};
    const catalog = terminalConfig.catalog && typeof terminalConfig.catalog === 'object' ? terminalConfig.catalog as JsonObject : {};
    const deviceRole = terminalConfig.deviceRole && typeof terminalConfig.deviceRole === 'object' ? terminalConfig.deviceRole as JsonObject : {};
    const hardware = terminalConfig.hardware && typeof terminalConfig.hardware === 'object' ? terminalConfig.hardware as JsonObject : {};
    const operational = terminalConfig.operational && typeof terminalConfig.operational === 'object' ? terminalConfig.operational as JsonObject : {};
    const ux = terminalConfig.ux && typeof terminalConfig.ux === 'object' ? terminalConfig.ux as JsonObject : {};
    const customerDisplay = hardware.customerDisplay && typeof hardware.customerDisplay === 'object' ? hardware.customerDisplay as JsonObject : {};
    const features = source.features && typeof source.features === 'object' ? source.features as JsonObject : {};
    const baseCurrency = Array.isArray(source.currencies)
        ? source.currencies.find(item => item && typeof item === 'object' && (item as JsonObject).isBase === true) as JsonObject | undefined
        : undefined;
    const printerAssignments = hardware.printerAssignments && typeof hardware.printerAssignments === 'object'
        ? hardware.printerAssignments as JsonObject : {};
    const summary: JsonObject = {
        vertical: typeof source.vertical === 'string' ? source.vertical : null,
        subVertical: typeof source.subVertical === 'string' ? source.subVertical : null,
        terminals: Array.isArray(source.terminals) ? source.terminals.length : 0,
        currenciesEnabled: countEnabled(source.currencies),
        paymentMethodsEnabled: countEnabled(source.paymentMethods),
        taxes: Array.isArray(source.taxes) ? source.taxes.length : 0,
        activeTariffs: Array.isArray(source.tariffs) ? source.tariffs.filter(item => (item as JsonObject)?.active !== false).length : 0,
        baseCurrencyCode: typeof baseCurrency?.code === 'string' ? baseCurrency.code : null,
        stockTracking: features.stockTracking === true,
        terminalPrimaryNode: terminalConfig.isPrimaryNode === true,
        terminalRole: typeof deviceRole.role === 'string' ? deviceRole.role : null,
        terminalAuthLevel: typeof deviceRole.authLevel === 'string' ? deviceRole.authLevel : null,
        allowedModules: Array.isArray(deviceRole.allowedModules) ? deviceRole.allowedModules.length : 0,
        allowedCategories: Array.isArray(catalog.allowedCategories) ? catalog.allowedCategories.length : 0,
        documentSeries: Array.isArray(terminalConfig.documentSeries) ? terminalConfig.documentSeries.length : 0,
        printerAssignments: Object.keys(printerAssignments).length,
        cashDrawerTrigger: typeof hardware.cashDrawerTrigger === 'string' ? hardware.cashDrawerTrigger : null,
        customerDisplayEnabled: customerDisplay.isEnabled === true,
        usesTables: operational.usa_mesas === true,
        usesKitchenModules: operational.usa_modulos_cocina === true,
        startScreen: typeof operational.pantalla_inicio === 'string' ? operational.pantalla_inicio : null,
        viewMode: typeof ux.viewMode === 'string' ? ux.viewMode : null,
        gridDensity: typeof ux.gridDensity === 'string' ? ux.gridDensity : null,
        showProductImages: ux.showProductImages === true,
        inventoryRealTimeValidation: inventory.realTimeValidation === true,
        inventoryAllowNegativeStock: inventory.allowNegativeStock === true,
        inventoryReserveStockOnCart: inventory.reserveStockOnCart === true,
        sessionBlindClose: session.blindClose === true,
        sessionAllowSalesWithOpenZ: session.allowSalesWithOpenZ === true,
        sessionAutoPrintZReport: session.autoPrintZReport === true,
        offlineMode: typeof offline.mode === 'string' ? offline.mode : null,
        offlineMaxTransactions: finite(offline.maxOfflineTransactionLimit),
        roundingMethod: typeof financial.roundingMethod === 'string' ? financial.roundingMethod : null,
        taxInclusivePrices: financial.taxInclusivePrices === true,
        acceptedCurrencies: Array.isArray(financial.acceptedCurrencies) ? financial.acceptedCurrencies.length : 0,
    };
    return { ...summary, configHash: hashSummary(summary) };
};

type BrowserPerformanceMemory = {
    usedJSHeapSize?: number;
    totalJSHeapSize?: number;
    jsHeapSizeLimit?: number;
};

type NetworkInformation = {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
};

let longTaskObserver: PerformanceObserver | null = null;
let longTaskCount = 0;
let longTaskTotalMs = 0;
let longestLongTaskMs = 0;
let lastNativeCpu: { wallMs: number; cpuMs: number } | null = null;
let checkoutOpenedAt: number | null = null;
let checkoutConfirmedAt: number | null = null;
const financialStartedAt = new Map<string, number>();
const outboxStartedAt = new Map<string, number>();
const printStartedAt = new Map<string, number>();

export const startCheckoutPerformanceCapture = (): void => {
    longTaskCount = 0;
    longTaskTotalMs = 0;
    longestLongTaskMs = 0;
    lastNativeCpu = null;
    if (typeof PerformanceObserver === 'undefined' || longTaskObserver) return;
    try {
        longTaskObserver = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                longTaskCount++;
                longTaskTotalMs += entry.duration;
                longestLongTaskMs = Math.max(longestLongTaskMs, entry.duration);
            }
        });
        longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch {
        longTaskObserver = null;
    }
};

export const stopCheckoutPerformanceCapture = (): void => {
    longTaskObserver?.disconnect();
    longTaskObserver = null;
    checkoutOpenedAt = null;
    checkoutConfirmedAt = null;
    financialStartedAt.clear();
    outboxStartedAt.clear();
    printStartedAt.clear();
};

export const collectCheckoutDiagnosticEnvironment = async (
    config: BusinessConfig,
    terminal: unknown,
): Promise<CheckoutDiagnosticEnvironment> => {
    const native = typeof window !== 'undefined' ? parseBridgeJson('getDiagnosticDeviceContext') : {};
    const storageEstimate: { usage?: number; quota?: number } = typeof navigator !== 'undefined' && navigator.storage?.estimate
        ? await navigator.storage.estimate().catch(() => ({}))
        : {};
    const connection = typeof navigator !== 'undefined'
        ? (navigator as Navigator & { connection?: NetworkInformation }).connection
        : undefined;
    return {
        device: Object.keys(native).length ? native : {
            platform: typeof navigator !== 'undefined' ? navigator.platform?.slice(0, 80) || null : null,
            hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || null : null,
            deviceMemoryGb: typeof navigator !== 'undefined'
                ? finite((navigator as Navigator & { deviceMemory?: number }).deviceMemory) : null,
        },
        display: typeof window !== 'undefined' ? {
            widthPx: window.screen?.width || null,
            heightPx: window.screen?.height || null,
            devicePixelRatio: finite(window.devicePixelRatio),
        } : {},
        browser: typeof navigator !== 'undefined' ? {
            language: navigator.language?.slice(0, 20) || null,
            online: navigator.onLine,
            connectionType: connection?.effectiveType || null,
            saveData: connection?.saveData === true,
        } : {},
        storage: {
            originUsageBytes: finite(storageEstimate.usage),
            originQuotaBytes: finite(storageEstimate.quota),
        },
        posConfig: safePosConfigSummary(config, terminal),
    };
};

const keyFrom = (input: JsonObject, ...fields: string[]): string => {
    for (const field of fields) {
        const value = input[field];
        if (typeof value === 'string' && value) return value;
    }
    return 'current';
};

const elapsed = (startedAt: number | undefined | null, now: number): number | null =>
    startedAt == null ? null : round(Math.max(0, now - startedAt));

const stageDurations = (stage: string, input: JsonObject, now: number): JsonObject => {
    const durations: JsonObject = {};
    if (stage === 'CHECKOUT_OPEN') checkoutOpenedAt = now;
    if (stage === 'CHECKOUT_CONFIRM') {
        durations.checkoutOpenToConfirmMs = elapsed(checkoutOpenedAt, now);
        checkoutConfirmedAt = now;
    }
    if (stage === 'PAYMENT_RESULT') durations.checkoutConfirmToResultMs = elapsed(checkoutConfirmedAt, now);

    const transactionKey = keyFrom(input, 'transactionId', 'aggregateId');
    if (stage === 'FINANCIAL_COMMIT_START') financialStartedAt.set(transactionKey, now);
    if (stage === 'FINANCIAL_COMMIT_OK' || stage === 'LEGACY_PERSIST_OK') {
        durations.financialCommitMs = elapsed(financialStartedAt.get(transactionKey), now);
        financialStartedAt.delete(transactionKey);
    }

    const eventKey = keyFrom(input, 'eventId', 'transactionId', 'aggregateId');
    if (stage === 'OUTBOX_SEND') outboxStartedAt.set(eventKey, now);
    if (stage === 'OUTBOX_RESULT') {
        durations.outboxRoundTripMs = elapsed(outboxStartedAt.get(eventKey), now);
        outboxStartedAt.delete(eventKey);
    }

    const printKey = keyFrom(input, 'transactionId', 'displayId');
    if (stage === 'PRINT_REQUEST') printStartedAt.set(printKey, now);
    if (stage === 'PRINT_RESULT') {
        durations.printPipelineMs = elapsed(printStartedAt.get(printKey), now);
        printStartedAt.delete(printKey);
    }
    return Object.fromEntries(Object.entries(durations).filter(([, value]) => value !== null));
};

const interactionSnapshot = (stage: string): JsonObject | undefined => {
    const operation = stage === 'CHECKOUT_OPEN' ? 'CHECKOUT_OPEN'
        : ['PAYMENT_MODAL_CONFIRM', 'CHECKOUT_CONFIRM', 'PAYMENT_RESULT'].includes(stage) ? 'PAYMENT_CONFIRM'
            : null;
    if (!operation) return undefined;
    const trace = getLatestPosInteraction(operation);
    if (!trace) return undefined;
    return {
        operation: trace.operation,
        durationsMs: { ...trace.durations },
        renderCount: trace.renderCount,
        allocationsApprox: trace.allocationsApprox,
    };
};

export const captureCheckoutPerformance = (
    stage: string,
    input: JsonObject = {},
): CheckoutPerformanceSnapshot | undefined => {
    if (!PERFORMANCE_STAGES.has(stage) || typeof window === 'undefined') return undefined;
    const now = performance.now();
    const native = parseBridgeJson('getDiagnosticPerformanceSnapshot');
    const nativeCpuMs = finite(native.processCpuTimeMs);
    let processCpuPercent: number | null = null;
    if (nativeCpuMs !== null && lastNativeCpu) {
        const wallDelta = now - lastNativeCpu.wallMs;
        const cpuDelta = nativeCpuMs - lastNativeCpu.cpuMs;
        if (wallDelta > 0 && cpuDelta >= 0) processCpuPercent = round((cpuDelta / wallDelta) * 100);
    }
    if (nativeCpuMs !== null) lastNativeCpu = { wallMs: now, cpuMs: nativeCpuMs };

    const memory = (performance as Performance & { memory?: BrowserPerformanceMemory }).memory;
    const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
    const interaction = interactionSnapshot(stage);
    const durations = stageDurations(stage, input, now);
    return {
        source: Object.keys(native).length ? 'android_native' : 'browser',
        memory: {
            appPssKb: finite(native.appPssKb),
            javaHeapUsedBytes: finite(native.javaHeapUsedBytes),
            javaHeapMaxBytes: finite(native.javaHeapMaxBytes),
            nativeHeapAllocatedBytes: finite(native.nativeHeapAllocatedBytes),
            systemAvailableBytes: finite(native.systemAvailableBytes),
            systemLowMemory: native.systemLowMemory === true,
            jsHeapUsedBytes: finite(memory?.usedJSHeapSize),
            jsHeapTotalBytes: finite(memory?.totalJSHeapSize),
            jsHeapLimitBytes: finite(memory?.jsHeapSizeLimit),
        },
        cpu: { processCpuTimeMs: nativeCpuMs, processCpuPercent },
        storage: {
            appStorageAvailableBytes: finite(native.appStorageAvailableBytes),
            appStorageTotalBytes: finite(native.appStorageTotalBytes),
        },
        power: {
            batteryPercent: finite(native.batteryPercent),
            powerSaveMode: native.powerSaveMode === true,
            thermalStatus: finite(native.thermalStatus),
        },
        network: {
            online: navigator.onLine,
            effectiveType: connection?.effectiveType || null,
            downlinkMbps: finite(connection?.downlink),
            rttMs: finite(connection?.rtt),
            saveData: connection?.saveData === true,
        },
        responsiveness: {
            longTaskCount,
            longTaskTotalMs: round(longTaskTotalMs),
            longestLongTaskMs: round(longestLongTaskMs),
        },
        ...(interaction ? { interaction } : {}),
        ...(Object.keys(durations).length ? { durations } : {}),
    };
};
