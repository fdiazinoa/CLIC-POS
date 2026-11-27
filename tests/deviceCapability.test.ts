import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildCapabilityProfile,
    computeCapacityScore,
    computeFrameBudgetMs,
    computePressureFlags,
    computeRuntimeScore,
    DCP_SCORING_LIMITS,
    mergeSignals,
    parseWebViewMajor,
    selectTier,
    type CapabilityProfile,
    type DeviceSignals,
} from '../services/performance/deviceCapabilityScore';
import {
    DCP_CACHE_KEY,
    DCP_CACHE_SCHEMA_VERSION,
    DCP_CACHE_TTL_MS,
    DCP_TIER_B_FLAG_KEY,
    DCP_TIER_B_TIMEOUT_MS,
    collectTierBWith,
    initDeviceCapabilityShadow,
    loadCachedProfile,
    parseCachedProfile,
    resolveDeviceCapabilityShadowProfile,
    resolveTierBEnabled,
    runDeviceCapabilityShadow,
    storeProfile,
    type DeviceCapabilityShadowDeps,
    type DcpStorage,
} from '../services/performance/deviceCapability';

// --- helpers M1 (dependencias inyectadas, sin DOM ni plugin real) ---

interface MemoryStorage extends DcpStorage {
    values: Map<string, string>;
}

function createMemoryStorage(initial: Record<string, string> = {}): MemoryStorage {
    const values = new Map(Object.entries(initial));
    return {
        values,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
            values.set(key, value);
        },
    };
}

function createShadowDeps(overrides: Partial<DeviceCapabilityShadowDeps> = {}): DeviceCapabilityShadowDeps {
    return {
        storage: createMemoryStorage(),
        now: () => 1_000_000,
        readTierBFlag: () => null,
        collectTierA: async () => ({
            hardwareConcurrency: 4,
            screenWidthPx: 800,
            devicePixelRatio: 1,
            prefersReducedMotion: false,
            reducedMotion: false,
        }),
        collectTierB: async () => ({}),
        measureRuntimeP95: async () => 16.7,
        isSaleActive: () => false,
        isModalOpen: () => false,
        waitForSaleIdle: async () => {},
        scheduleAfterFirstPaint: callback => callback(),
        publish: () => {},
        log: () => {},
        warn: () => {},
        calibrationWaitTimeoutMs: 50,
        ...overrides,
    };
}

// --- scoring base (sin presión) ---

test('computeCapacityScore clasifica dispositivos bajo, medio y alto', () => {
    const low: DeviceSignals = {
        totalMemMb: 1024,
        cores: 1,
        webViewMajor: 80,
        freeStorageMb: 128,
        widthPx: 1024,
        devicePixelRatio: 1,
    };
    const mid: DeviceSignals = {
        totalMemMb: 4096,
        cores: 4,
        webViewMajor: 110,
        freeStorageMb: 2048,
        widthPx: 1600,
        devicePixelRatio: 1,
    };
    const high: DeviceSignals = {
        totalMemMb: 8192,
        cores: 8,
        webViewMajor: 120,
        freeStorageMb: 4096,
        widthPx: 1920,
        devicePixelRatio: 2,
    };

    assert.equal(computeCapacityScore(low), 30); // 5 + 3 + 3 + 3 + 6 + 10 base
    assert.equal(computeCapacityScore(mid), 75); // 22 + 13 + 12 + 12 + 6 + 10 base
    assert.equal(computeCapacityScore(high), 100); // 30 + 20 + 15 + 15 + 10 + 10 base
});

test('computeCapacityScore aplica los umbrales exactos de cada peso', () => {
    // Resto fijo: cores 4 (13) + WebView 100 (9) + storage 1024 (9) + pantalla (6) + base 10 = 47.
    const ramCases: Array<[number, number]> = [
        [8192, 77],
        [6144, 74],
        [4096, 69],
        [3072, 63],
        [2048, 57],
        [1024, 52],
    ];
    for (const [totalMemMb, expected] of ramCases) {
        const signals: DeviceSignals = {
            totalMemMb,
            cores: 4,
            webViewMajor: 100,
            freeStorageMb: 1024,
            widthPx: 1600,
            devicePixelRatio: 1,
        };
        assert.equal(computeCapacityScore(signals), expected, `RAM ${totalMemMb} MB`);
    }

    // Resto fijo: RAM 4096 (22) + WebView 100 (9) + storage 1024 (9) + pantalla (6) + base 10 = 56.
    const coreCases: Array<[number, number]> = [
        [8, 76],
        [6, 73],
        [4, 69],
        [2, 63],
        [1, 59],
    ];
    for (const [cores, expected] of coreCases) {
        const signals: DeviceSignals = {
            totalMemMb: 4096,
            cores,
            webViewMajor: 100,
            freeStorageMb: 1024,
            widthPx: 1600,
            devicePixelRatio: 1,
        };
        assert.equal(computeCapacityScore(signals), expected, `${cores} cores`);
    }

    // Resto fijo: RAM 4096 (22) + cores 4 (13) + storage 1024 (9) + pantalla (6) + base 10 = 60.
    const webViewCases: Array<[number, number]> = [
        [120, 75],
        [110, 72],
        [100, 69],
        [90, 66],
        [80, 63],
    ];
    for (const [webViewMajor, expected] of webViewCases) {
        const signals: DeviceSignals = {
            totalMemMb: 4096,
            cores: 4,
            webViewMajor,
            freeStorageMb: 1024,
            widthPx: 1600,
            devicePixelRatio: 1,
        };
        assert.equal(computeCapacityScore(signals), expected, `WebView ${webViewMajor}`);
    }

    // Resto fijo: RAM 4096 (22) + cores 4 (13) + WebView 100 (9) + pantalla (6) + base 10 = 60.
    const storageCases: Array<[number, number]> = [
        [4096, 75],
        [2048, 72],
        [1024, 69],
        [512, 66],
        [256, 63],
    ];
    for (const [freeStorageMb, expected] of storageCases) {
        const signals: DeviceSignals = {
            totalMemMb: 4096,
            cores: 4,
            webViewMajor: 100,
            freeStorageMb,
            widthPx: 1600,
            devicePixelRatio: 1,
        };
        assert.equal(computeCapacityScore(signals), expected, `storage ${freeStorageMb} MB`);
    }
});

test('computeCapacityScore puntúa conservador cuando las señales son desconocidas', () => {
    // RAM 16 + cores 7 + WebView 6 + storage 6 + pantalla 6 + base 10.
    assert.equal(computeCapacityScore({}), 51);
    // Señales Tier B no numéricas/no evaluables no elevan el puntaje.
    assert.equal(computeCapacityScore({ lowRamDevice: false, lowMemory: false, powerSaveMode: false }), 51);
    // Un equipo con señales parciales no supera el máximo.
    assert.equal(
        computeCapacityScore({
            totalMemMb: 999999,
            cores: 64,
            webViewMajor: 999,
            freeStorageMb: 9999999,
            widthPx: 4096,
            devicePixelRatio: 4,
        }),
        100,
    );
});

test('computeCapacityScore usa la pantalla por ancho físico o por DPR alto', () => {
    const base: DeviceSignals = {
        totalMemMb: 4096, // 22
        cores: 4, // 13
        webViewMajor: 100, // 9
        freeStorageMb: 1024, // 9
    };
    // 22 + 13 + 9 + 9 + 10 + 10 base.
    assert.equal(computeCapacityScore({ ...base, widthPx: 1920 }), 73);
    assert.equal(computeCapacityScore({ ...base, screenWidthPx: 800, devicePixelRatio: 2 }), 73);
    // 22 + 13 + 9 + 9 + 6 + 10 base.
    assert.equal(computeCapacityScore({ ...base, widthPx: 1280, devicePixelRatio: 1 }), 69);
});

test('computeCapacityScore prefiere las señales Tier B y calcula storage libre por cuota', () => {
    // totalMemMb Tier B manda sobre deviceMemoryGb de Tier A.
    const tierB = computeCapacityScore({
        deviceMemoryGb: 2,
        totalMemMb: 8192,
        hardwareConcurrency: 2,
        cores: 8,
        webViewMajor: 120,
        freeStorageMb: 4096,
        widthPx: 1920,
        devicePixelRatio: 1,
    });
    assert.equal(tierB, 100);

    // Sin freeStorageMb: libre = cuota - uso (7000 MB ⇒ 15 puntos).
    // RAM 16 + cores 7 + WebView 6 + storage 15 + pantalla 6 + base 10.
    assert.equal(
        computeCapacityScore({ storageQuotaMb: 10000, storageUsageMb: 3000 }),
        60,
    );
    // freeStorageMb Tier B manda sobre la estimación del WebView (128 MB ⇒ 3 puntos).
    // RAM 16 + cores 7 + WebView 6 + storage 3 + pantalla 6 + base 10.
    assert.equal(
        computeCapacityScore({ storageQuotaMb: 10000, storageUsageMb: 0, freeStorageMb: 128 }),
        48,
    );
});

// --- B2: consumo de señales Tier B en el scoring ---

test('B2: computePressureFlags detecta gama baja, presión de memoria, térmica y ahorro', () => {
    assert.deepEqual(computePressureFlags({}), {
        lowRamDevice: false,
        memoryPressure: false,
        thermalPressure: false,
        powerSaveMode: false,
    });
    assert.equal(computePressureFlags({ lowRamDevice: true }).lowRamDevice, true);
    assert.equal(computePressureFlags({ lowMemory: true }).memoryPressure, true);
    // avail/total = 409/4096 = 9.98 % ⇒ presión; 410/4096 = 10.01 % ⇒ sin presión.
    assert.equal(computePressureFlags({ totalMemMb: 4096, availMemMb: 409 }).memoryPressure, true);
    assert.equal(computePressureFlags({ totalMemMb: 4096, availMemMb: 410 }).memoryPressure, false);
    assert.equal(computePressureFlags({ thermalStatus: 2 }).thermalPressure, false);
    assert.equal(computePressureFlags({ thermalStatus: 3 }).thermalPressure, true);
    assert.equal(computePressureFlags({ powerSaveMode: true }).powerSaveMode, true);
});

test('B2: lowRamDevice capa capacity a 44 y memoryPressure penaliza −10 (mínimo 0)', () => {
    const high: DeviceSignals = {
        totalMemMb: 8192,
        cores: 8,
        webViewMajor: 120,
        freeStorageMb: 4096,
        widthPx: 1920,
        devicePixelRatio: 2,
    };
    assert.equal(computeCapacityScore(high), 100);

    const lowRam = computeCapacityScore({ ...high, lowRamDevice: true });
    assert.equal(lowRam, DCP_SCORING_LIMITS.lowRamCapacityCap);
    assert.ok(lowRam <= 44);
    assert.notEqual(selectTier(lowRam, 100), 'PERFORMANCE');

    // lowMemory ⇒ −10 y cap MV2-1 a 60 (100 → 90 → 60).
    assert.equal(computeCapacityScore({ ...high, lowMemory: true }), 60);
    // avail/total < 10 % ⇒ −10 y cap 60 (92 → 82 → 60).
    const memoryPressureBase = { ...high, totalMemMb: 4096 }; // RAM 22 + 20 + 15 + 15 + 10 + 10 = 92
    assert.equal(computeCapacityScore({ ...memoryPressureBase, availMemMb: 409 }), 60);
    assert.equal(computeCapacityScore({ ...memoryPressureBase, availMemMb: 410 }), 92);
    // Ambas presiones: primero cap 44, después −10 ⇒ 34, y nunca negativo.
    assert.equal(computeCapacityScore({ ...high, lowRamDevice: true, lowMemory: true }), 34);
    assert.equal(computeCapacityScore({ lowRamDevice: true, lowMemory: true }), 34);
});

test('MV2-1: presión de memoria acota capacity≤60 y runtime≤70 ⇒ tier nunca PERFORMANCE', () => {
    // Escenario del review v2: 3 GB / 8 núcleos, avail 200/3072 = 6,5 %, lowRamDevice=false.
    const threeGb8c: DeviceSignals = {
        totalMemMb: 3072,
        availMemMb: 200,
        cores: 8,
        webViewMajor: 120,
        freeStorageMb: 4096,
        widthPx: 1920,
        devicePixelRatio: 1,
        lowRamDevice: false,
    };
    // capacity: 16 + 20 + 15 + 15 + 10 + 10 = 86 → −10 = 76 → cap 60; runtime 100 → cap 70.
    const capacity = computeCapacityScore(threeGb8c);
    const runtime = computeRuntimeScore(16, threeGb8c);
    assert.equal(capacity, 60);
    assert.equal(runtime, 70);
    const tier = selectTier(capacity, runtime);
    assert.equal(tier, 'BALANCED');
    assert.notEqual(tier, 'PERFORMANCE');

    // lowMemory=true dispara el mismo cap (aunque no haya ratio calculable).
    assert.equal(computeCapacityScore({ ...threeGb8c, availMemMb: null, lowMemory: true }), 60);
    assert.equal(computeRuntimeScore(16, { lowMemory: true }), 70);
    // Frontera: 307/3072 = 9,99 % ⇒ presión; 308/3072 = 10,03 % ⇒ sin presión.
    assert.equal(computeCapacityScore({ ...threeGb8c, availMemMb: 307 }), 60);
    assert.equal(computeCapacityScore({ ...threeGb8c, availMemMb: 308 }), 86);

    // lowRamDevice=true ⇒ capacity ≤44 ⇒ ECO.
    const lowRamCapacity = computeCapacityScore({ ...threeGb8c, lowRamDevice: true });
    assert.ok(lowRamCapacity <= 44);
    assert.equal(
        selectTier(lowRamCapacity, computeRuntimeScore(16, { ...threeGb8c, lowRamDevice: true })),
        'ECO',
    );

    // Sin presión y equipo alto ⇒ PERFORMANCE.
    const high: DeviceSignals = {
        totalMemMb: 8192,
        availMemMb: 6000,
        cores: 8,
        webViewMajor: 120,
        freeStorageMb: 4096,
        widthPx: 1920,
        devicePixelRatio: 2,
    };
    assert.equal(computeCapacityScore(high), 100);
    assert.equal(computeRuntimeScore(16, high), 100);
    assert.equal(selectTier(computeCapacityScore(high), computeRuntimeScore(16, high)), 'PERFORMANCE');

    // Presión + térmica: runtime 55 ⇒ ECO, siempre ≤ BALANCED y nunca PERFORMANCE.
    const combined = { ...threeGb8c, thermalStatus: 3 };
    const combinedCapacity = computeCapacityScore(combined);
    const combinedRuntime = computeRuntimeScore(16, combined);
    assert.ok(combinedCapacity <= 60);
    assert.equal(combinedRuntime, 55);
    const combinedTier = selectTier(combinedCapacity, combinedRuntime);
    assert.equal(combinedTier, 'ECO');
    assert.notEqual(combinedTier, 'PERFORMANCE');
});

test('B2: thermalStatus>=3 o powerSaveMode acotan runtimeScore a 55 (tier ≤ BALANCED)', () => {
    assert.equal(computeRuntimeScore(16), 100);
    assert.equal(computeRuntimeScore(16, {}), 100);
    assert.equal(computeRuntimeScore(16, { thermalStatus: 2 }), 100);
    assert.equal(computeRuntimeScore(16, { thermalStatus: 3 }), DCP_SCORING_LIMITS.pressureRuntimeCap);
    assert.equal(computeRuntimeScore(16, { thermalStatus: 4 }), DCP_SCORING_LIMITS.pressureRuntimeCap);
    assert.equal(computeRuntimeScore(16, { powerSaveMode: true }), DCP_SCORING_LIMITS.pressureRuntimeCap);
    // Un runtime ya peor que el cap no se eleva.
    assert.equal(computeRuntimeScore(80, { powerSaveMode: true }), 35);
    // Cap 55 < 60 ⇒ ECO (siempre ≤ BALANCED, nunca PERFORMANCE).
    const capped = computeRuntimeScore(16, { thermalStatus: 3 });
    assert.equal(selectTier(100, capped), 'ECO');
    assert.notEqual(selectTier(100, capped), 'PERFORMANCE');
});

test('B2: refreshRateHz/maxRefreshRateHz producen presupuesto de frame informativo', () => {
    assert.equal(computeFrameBudgetMs(60), 16.67);
    assert.equal(computeFrameBudgetMs(90), 11.11);
    assert.equal(computeFrameBudgetMs(120), 8.33);
    assert.equal(computeFrameBudgetMs(59.999), 16.67);
    assert.equal(computeFrameBudgetMs(null), null);
    assert.equal(computeFrameBudgetMs(undefined), null);
    assert.equal(computeFrameBudgetMs(0), null);
    assert.equal(computeFrameBudgetMs(1000), null);
});

// --- B4: contrato del global (runtimeP95Ms + reducedMotion) y profile building ---

test('B4/B2: buildCapabilityProfile expone runtimeP95Ms, reducedMotion, presión y frame budget', () => {
    const profile = buildCapabilityProfile({
        tierA: {
            hardwareConcurrency: 4,
            screenWidthPx: 800,
            devicePixelRatio: 1,
            prefersReducedMotion: true,
        },
        tierB: {
            sdkInt: 30,
            cores: 4,
            totalMemMb: 3000,
            availMemMb: 300, // 10.0 % exacto ⇒ sin presión por ratio
            lowRamDevice: true,
            thermalStatus: 3,
            powerSaveMode: false,
            refreshRateHz: 60,
            maxRefreshRateHz: 90,
            webViewVersion: '116.0.5845.163',
            webViewMajor: 116,
            freeStorageMb: 2048,
        },
        runtimeP95Ms: 16.7,
        tierBEnabled: true,
        now: 1_000_000,
    });

    assert.equal(profile.source, 'TIER_A_TIER_B');
    assert.equal(profile.runtimeP95Ms, 16.7);
    assert.equal(profile.runtimeCalibrated, true);
    assert.equal(profile.capturedAt, 1_000_000);
    assert.equal(profile.signals.reducedMotion, true); // alias contrato QA
    assert.equal(profile.signals.prefersReducedMotion, true);
    assert.equal(profile.signals.webViewMajor, 116);
    assert.equal(profile.frameBudgetMs, 16.67);
    assert.equal(profile.maxFrameBudgetMs, 11.11);
    assert.equal(profile.signals.frameP95Ms, 16.7);
    assert.equal(profile.pressure.lowRamDevice, true);
    assert.equal(profile.pressure.memoryPressure, false);
    assert.equal(profile.pressure.thermalPressure, true);
    assert.ok(profile.capacityScore <= 44);
    assert.ok(profile.runtimeScore <= 55);
    assert.notEqual(profile.tier, 'PERFORMANCE');
});

test('B4: perfil no calibrado es conservador y el alias reducedMotion también existe', () => {
    const profile = buildCapabilityProfile({
        tierA: { prefersReducedMotion: true },
        tierB: {},
        runtimeP95Ms: null,
        tierBEnabled: false,
        now: 5,
    });
    assert.equal(profile.runtimeP95Ms, null);
    assert.equal(profile.runtimeCalibrated, false);
    assert.equal(profile.runtimeScore, 0);
    assert.equal(profile.tier, 'ECO');
    assert.equal(profile.source, 'TIER_A');
    assert.equal(profile.signals.reducedMotion, true);
    assert.equal(profile.frameBudgetMs, null);
    assert.equal(profile.capturedAt, 5);
});

test('B4/m1: source ignora respuestas Tier B sin señales definidas', () => {
    const profile = buildCapabilityProfile({
        tierA: { hardwareConcurrency: 4 },
        tierB: { sdkInt: null, cores: null, abis: [], lowRamDevice: undefined },
        runtimeP95Ms: 16.7,
        tierBEnabled: true,
        now: 1,
    });
    assert.equal(profile.source, 'TIER_A');
});

// --- runtime score y tier (scoring base) ---

test('computeRuntimeScore convierte el p95 de frames en 0–100', () => {
    assert.equal(computeRuntimeScore(16), 100);
    assert.equal(computeRuntimeScore(18), 100);
    assert.equal(computeRuntimeScore(19), 90);
    assert.equal(computeRuntimeScore(25), 90);
    assert.equal(computeRuntimeScore(26), 75);
    assert.equal(computeRuntimeScore(33), 75);
    assert.equal(computeRuntimeScore(34), 55);
    assert.equal(computeRuntimeScore(50), 55);
    assert.equal(computeRuntimeScore(51), 35);
    assert.equal(computeRuntimeScore(500), 35);
    assert.equal(computeRuntimeScore(0), 0);
    assert.equal(computeRuntimeScore(-1), 0);
    assert.equal(computeRuntimeScore(null), 0);
    assert.equal(computeRuntimeScore(undefined), 0);
    assert.equal(computeRuntimeScore(Number.NaN), 0);
    assert.equal(computeRuntimeScore(Number.POSITIVE_INFINITY), 0);
});

test('selectTier aplica la regla de mínimo entre capacidad y runtime', () => {
    // Runtime malo ⇒ ECO aunque la capacidad sea excelente.
    assert.equal(selectTier(100, 40), 'ECO');
    assert.equal(selectTier(100, 59), 'ECO');
    // PERFORMANCE solo con capacidad y runtime altos.
    assert.equal(selectTier(72, 85), 'PERFORMANCE');
    assert.equal(selectTier(100, 100), 'PERFORMANCE');
    // Capacidad alta pero runtime por debajo de 85 ⇒ BALANCED (regla de mínimo).
    assert.equal(selectTier(90, 84), 'BALANCED');
    assert.equal(selectTier(72, 60), 'BALANCED');
    // Capacidad por debajo de 72 nunca llega a PERFORMANCE.
    assert.equal(selectTier(71, 90), 'BALANCED');
    // Fronteras inferiores.
    assert.equal(selectTier(45, 60), 'BALANCED');
    assert.equal(selectTier(44, 60), 'ECO');
    assert.equal(selectTier(100, 60), 'BALANCED');
});

test('mergeSignals deja que Tier B pise Tier A solo con valores definidos', () => {
    const tierA: DeviceSignals = {
        totalMemMb: 4096,
        cores: 4,
        lowRamDevice: true,
        screenWidthPx: 800,
        abis: ['arm64-v8a'],
        webViewMajor: 116,
    };
    const tierB: DeviceSignals = {
        totalMemMb: 8192,
        lowRamDevice: false,
        screenWidthPx: 1080,
        abis: [],
        webViewMajor: null,
        cores: undefined,
    };

    const merged = mergeSignals(tierA, tierB);

    assert.equal(merged.totalMemMb, 8192); // Tier B pisa
    assert.equal(merged.lowRamDevice, false); // Tier B pisa
    assert.equal(merged.screenWidthPx, 1080); // Tier B pisa
    assert.equal(merged.abis?.length, 1); // array vacío de Tier B no pisa
    assert.deepEqual(merged.abis, ['arm64-v8a']);
    assert.equal(merged.webViewMajor, 116); // null de Tier B no pisa
    assert.equal(merged.cores, 4); // undefined de Tier B no pisa
    // El merge no muta la entrada Tier A.
    assert.equal(tierA.totalMemMb, 4096);
    assert.equal(tierA.lowRamDevice, true);
});

test('mergeSignals sin señales Tier B devuelve una copia de Tier A', () => {
    const tierA: DeviceSignals = { totalMemMb: 4096, cores: 4, frameP95Ms: 16.6 };
    const merged = mergeSignals(tierA, {});
    assert.deepEqual(merged, tierA);
    assert.notEqual(merged, tierA);
});

test('parseWebViewMajor extrae el major de UA reales y casos borde', () => {
    const webView116 =
        'Mozilla/5.0 (Linux; Android 11; Pixel C Build/RQ3A.211001.001; wv) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Version/4.0 Chrome/116.0.5845.163 Safari/537.36';
    assert.equal(parseWebViewMajor(webView116), 116);

    const chrome120 =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/120.0.6099.144 Safari/537.36';
    assert.equal(parseWebViewMajor(chrome120), 120);

    const oldCrMo =
        'Mozilla/5.0 (Linux; U; Android 4.2; en-us; Galaxy Nexus Build/JOP40D) AppleWebKit/534.30 ' +
        '(KHTML, like Gecko) Version/4.0 CrMo/31.0.1650.11 Mobile Safari/534.30';
    assert.equal(parseWebViewMajor(oldCrMo), 31);

    assert.equal(parseWebViewMajor(null), null);
    assert.equal(parseWebViewMajor(undefined), null);
    assert.equal(parseWebViewMajor(''), null);
    assert.equal(parseWebViewMajor('   '), null);
    assert.equal(parseWebViewMajor('Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36'), null);
    assert.equal(parseWebViewMajor('Chrome/'), null);
    assert.equal(parseWebViewMajor('Chrome/abc.0'), null);
    assert.equal(parseWebViewMajor('Chrome/0.0.0.0'), null);
});

// --- M1: fallback Tier B, timeout, flag y caché ---

test('M1: collectTierBWith cae a {} cuando el plugin falta, falla o expira el timeout', async () => {
    assert.equal(DCP_TIER_B_TIMEOUT_MS, 1500);
    assert.deepEqual(await collectTierBWith(() => Promise.reject(new Error('plugin missing'))), {});
    assert.deepEqual(await collectTierBWith(() => {
        throw new Error('sync bridge failure');
    }), {});
    assert.deepEqual(await collectTierBWith(() => 'not-an-object'), {});

    const startedAt = Date.now();
    const timedOut = await collectTierBWith(() => new Promise(() => {}), 25);
    const elapsed = Date.now() - startedAt;
    assert.deepEqual(timedOut, {});
    assert.ok(elapsed >= 20, `timeout demasiado pronto: ${elapsed} ms`);
    assert.ok(elapsed < 1000, `timeout demasiado tarde: ${elapsed} ms`);

    const mapped = await collectTierBWith(
        () => ({ sdkInt: 30, cores: 4, totalMemMb: 3064, lowRamDevice: true, thermalStatus: 0, refreshRateHz: 60 }),
        100,
    );
    assert.equal(mapped.sdkInt, 30);
    assert.equal(mapped.cores, 4);
    assert.equal(mapped.lowRamDevice, true);
    assert.equal(mapped.refreshRateHz, 60);
});

test('M1/B1: flag CLIC_POS_DCP_TIER_B off evita Tier B, runtime y caché', async () => {
    assert.equal(DCP_TIER_B_FLAG_KEY, 'CLIC_POS_DCP_TIER_B');
    assert.equal(resolveTierBEnabled('off'), false);
    assert.equal(resolveTierBEnabled(' OFF '), false);
    assert.equal(resolveTierBEnabled('on'), true);
    assert.equal(resolveTierBEnabled(null), true);
    assert.equal(resolveTierBEnabled(undefined), true);
    assert.equal(resolveTierBEnabled('cualquier-otro-valor'), true);

    const storage = createMemoryStorage();
    let tierBCalls = 0;
    let runtimeCalls = 0;
    const profile = await resolveDeviceCapabilityShadowProfile(createShadowDeps({
        storage,
        readTierBFlag: () => 'off',
        collectTierB: async () => {
            tierBCalls += 1;
            return { totalMemMb: 8192, cores: 8 };
        },
        measureRuntimeP95: async () => {
            runtimeCalls += 1;
            return 10;
        },
    }));

    assert.equal(tierBCalls, 0);
    assert.equal(runtimeCalls, 0);
    assert.equal(profile.source, 'TIER_A');
    assert.equal(profile.runtimeP95Ms, null);
    assert.equal(profile.runtimeCalibrated, false);
    assert.equal(profile.runtimeScore, 0);
    assert.equal(profile.tier, 'ECO');
    assert.equal(storage.getItem(DCP_CACHE_KEY), null);
});

test('M1: caché inválida o expirada fuerza recálculo y solo se cachea calibrado', async () => {
    const now = 2_000_000;
    const validPayload = {
        schemaVersion: DCP_CACHE_SCHEMA_VERSION,
        cachedAt: now,
        signals: { totalMemMb: 8192, cores: 8, refreshRateHz: 60 },
        runtimeP95Ms: 16.7,
    };
    const validRaw = JSON.stringify(validPayload);

    const cached = parseCachedProfile(validRaw, now);
    assert.ok(cached);
    assert.equal(cached.source, 'CACHE');
    assert.equal(cached.runtimeP95Ms, 16.7);
    assert.equal(cached.runtimeCalibrated, true);
    assert.equal(cached.frameBudgetMs, 16.67);

    // schemaVersion inválido / TTL expirado / futuro / JSON corrupto / runtime no calibrado.
    assert.equal(parseCachedProfile(JSON.stringify({ ...validPayload, schemaVersion: 99 }), now), null);
    assert.equal(parseCachedProfile(JSON.stringify({ ...validPayload, cachedAt: now - DCP_CACHE_TTL_MS - 1 }), now), null);
    assert.equal(parseCachedProfile(JSON.stringify({ ...validPayload, cachedAt: now + 1 }), now), null);
    assert.equal(parseCachedProfile('{json roto', now), null);
    assert.equal(parseCachedProfile(null, now), null);
    assert.equal(parseCachedProfile(JSON.stringify({ ...validPayload, runtimeP95Ms: null }), now), null);
    // Caché manipulada: se reconstruye el tier desde las señales, no se confía en el payload.
    const tampered = parseCachedProfile(JSON.stringify({
        ...validPayload,
        tier: 'PERFORMANCE',
        capacityScore: 100,
        signals: { lowRamDevice: true, totalMemMb: 3000, cores: 4 },
    }), now);
    assert.ok(tampered);
    assert.notEqual(tampered.tier, 'PERFORMANCE');
    assert.ok(tampered.capacityScore <= 44);

    // Caché expirada en storage ⇒ recálculo + reescritura calibrada.
    const storage = createMemoryStorage({
        [DCP_CACHE_KEY]: JSON.stringify({ ...validPayload, cachedAt: now - DCP_CACHE_TTL_MS - 1 }),
    });
    let tierACalls = 0;
    const profile = await resolveDeviceCapabilityShadowProfile(createShadowDeps({
        storage,
        now: () => now,
        collectTierA: async () => {
            tierACalls += 1;
            return { hardwareConcurrency: 4, prefersReducedMotion: false };
        },
        collectTierB: async () => ({ totalMemMb: 8192, cores: 8 }),
    }));
    assert.equal(tierACalls, 1);
    assert.equal(profile.source, 'TIER_A_TIER_B');
    assert.equal(profile.runtimeCalibrated, true);
    const rewritten = parseCachedProfile(storage.getItem(DCP_CACHE_KEY), now);
    assert.ok(rewritten);

    // Un perfil no calibrado nunca se persiste.
    const uncalibrated = buildCapabilityProfile({
        tierA: {}, tierB: {}, runtimeP95Ms: null, tierBEnabled: true, now,
    });
    const emptyStorage = createMemoryStorage();
    assert.equal(storeProfile(emptyStorage, uncalibrated, now), false);
    assert.equal(emptyStorage.getItem(DCP_CACHE_KEY), null);
});

test('M1: caché válida evita Tier A/B y calibración (source CACHE)', async () => {
    const now = 3_000_000;
    const storage = createMemoryStorage();
    const calibrated = buildCapabilityProfile({
        tierA: { totalMemMb: 8192, cores: 8, refreshRateHz: 60, prefersReducedMotion: false },
        tierB: {},
        runtimeP95Ms: 16.7,
        tierBEnabled: true,
        now,
    });
    assert.equal(storeProfile(storage, calibrated, now), true);
    assert.ok(loadCachedProfile(storage, now));

    let tierACalls = 0;
    let tierBCalls = 0;
    let runtimeCalls = 0;
    const profile = await resolveDeviceCapabilityShadowProfile(createShadowDeps({
        storage,
        now: () => now,
        collectTierA: async () => {
            tierACalls += 1;
            return {};
        },
        collectTierB: async () => {
            tierBCalls += 1;
            return {};
        },
        measureRuntimeP95: async () => {
            runtimeCalls += 1;
            return 10;
        },
    }));

    assert.equal(tierACalls, 0);
    assert.equal(tierBCalls, 0);
    assert.equal(runtimeCalls, 0);
    assert.equal(profile.source, 'CACHE');
    assert.equal(profile.runtimeCalibrated, true);
});

test('M1/B3: la calibración se aborta con venta/carrito/modal y no cachea runtime', async () => {
    for (const abortFlag of ['isSaleActive', 'isModalOpen'] as const) {
        const storage = createMemoryStorage();
        let runtimeCalls = 0;
        const profile = await resolveDeviceCapabilityShadowProfile(createShadowDeps({
            storage,
            [abortFlag]: () => true,
            measureRuntimeP95: async () => {
                runtimeCalls += 1;
                return 10;
            },
        }));
        assert.equal(runtimeCalls, 0);
        assert.equal(profile.runtimeP95Ms, null);
        assert.equal(profile.runtimeCalibrated, false);
        assert.equal(profile.runtimeScore, 0);
        assert.equal(profile.tier, 'ECO');
        assert.equal(storage.getItem(DCP_CACHE_KEY), null);
    }

    // Aborto durante el muestreo ⇒ null ⇒ conservador solo en memoria, sin caché.
    const storage = createMemoryStorage();
    const profile = await resolveDeviceCapabilityShadowProfile(createShadowDeps({
        storage,
        measureRuntimeP95: async () => null,
    }));
    assert.equal(profile.runtimeP95Ms, null);
    assert.equal(profile.runtimeCalibrated, false);
    assert.equal(storage.getItem(DCP_CACHE_KEY), null);
});

test('M1: el shadow publica/loguea una vez por init y nunca lanza', async () => {
    const published: CapabilityProfile[] = [];
    const logged: CapabilityProfile[] = [];
    await runDeviceCapabilityShadow(createShadowDeps({
        publish: profile => published.push(profile),
        log: profile => logged.push(profile),
    }));
    assert.equal(published.length, 1);
    assert.equal(logged.length, 1);
    assert.equal(published[0].runtimeCalibrated, true);
    assert.equal(published[0].runtimeP95Ms, 16.7);
    assert.equal(published[0].source, 'TIER_A');

    const warnings: unknown[] = [];
    await runDeviceCapabilityShadow(createShadowDeps({
        publish: () => {
            throw new Error('publish boom');
        },
        warn: error => warnings.push(error),
    }));
    assert.equal(warnings.length, 1);

    await runDeviceCapabilityShadow(createShadowDeps({
        scheduleAfterFirstPaint: () => {
            throw new Error('schedule boom');
        },
        warn: error => warnings.push(error),
    }));
    assert.equal(warnings.length, 2);
});

test('M1/B1/B4: initDeviceCapabilityShadow es idempotente y publica el contrato QA', async () => {
    const globalAny = globalThis as unknown as { window?: unknown; localStorage?: unknown };
    const previousWindow = globalAny.window;
    const previousLocalStorage = globalAny.localStorage;
    const previousConsoleInfo = console.info;
    const values = new Map<string, string>();
    let frame = 0;
    let infoCalls = 0;
    const fakeWindow: Record<string, unknown> = {
        screen: { width: 800, height: 600 },
        devicePixelRatio: 1,
        matchMedia: () => ({ matches: false }),
        requestAnimationFrame: (callback: (timestamp: number) => void) => {
            frame += 16.7;
            callback(frame);
            return 1;
        },
        cancelAnimationFrame: () => {},
        setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
    };
    globalAny.window = fakeWindow;
    globalAny.localStorage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
            values.set(key, value);
        },
    };
    console.info = () => {
        infoCalls += 1;
    };

    try {
        const first = initDeviceCapabilityShadow();
        const second = initDeviceCapabilityShadow();
        assert.equal(first, second); // idempotente: misma promesa, un solo init
        await first;
        assert.equal(infoCalls, 1); // un único log [DCP]

        const profile = fakeWindow.__CLIC_POS_DEVICE__ as CapabilityProfile | undefined;
        assert.ok(profile, 'el shadow debe publicar window.__CLIC_POS_DEVICE__');
        // En Node no hay plugin Tier B ⇒ fallback total a Tier A.
        assert.equal(profile.source, 'TIER_A');
        assert.equal(profile.runtimeCalibrated, true);
        assert.equal(typeof profile.runtimeP95Ms, 'number');
        assert.equal(profile.signals.reducedMotion, false);
        assert.ok(values.get(DCP_CACHE_KEY), 'la caché del perfil calibrado debe escribirse');
    } finally {
        console.info = previousConsoleInfo;
        if (previousWindow === undefined) delete globalAny.window;
        else globalAny.window = previousWindow;
        if (previousLocalStorage === undefined) delete globalAny.localStorage;
        else globalAny.localStorage = previousLocalStorage;
    }
});
