/**
 * DCP (Device Capability Profiler) — scoring puro y sin dependencias.
 *
 * Este módulo no importa Capacitor, React ni DOM: solo tipos y funciones puras.
 * Se usa tanto desde `deviceCapability.ts` (runtime Tier A/B) como desde tests
 * `tsx --test`. El perfil resultante es informativo (modo sombra): no altera
 * ventas, fiscal, sync, DB ni ninguna decisión de la aplicación.
 *
 * Pesos del capacity score (auditoría §2.5): RAM 30, núcleos 20, WebView 15,
 * pantalla 10 y almacenamiento 25. El almacenamiento se reparte como
 * storage 15 + base 10 = 25: la base es la parte constante del peso de
 * almacenamiento (no altera el orden de tiers de los casos de prueba).
 *
 * Consumo de Tier B (obligatorio en v2):
 * - `lowRamDevice === true` ⇒ capacity ≤ 44 (nunca PERFORMANCE).
 * - `lowMemory === true` o `availMemMb / totalMemMb < 0.10` ⇒ −10 capacity (mínimo 0).
 * - `thermalStatus >= 3` o `powerSaveMode === true` ⇒ runtimeScore ≤ 55.
 * - `refreshRateHz`/`maxRefreshRateHz` ⇒ presupuesto de frame informativo en el perfil.
 */

export type PerformanceTier = 'ECO' | 'BALANCED' | 'PERFORMANCE';

export type CapabilityProfileSource = 'TIER_A' | 'TIER_A_TIER_B' | 'CACHE';

/** Motivos de presión detectados en las señales (quedan registrados en el perfil). */
export interface DevicePressure {
    lowRamDevice: boolean;
    memoryPressure: boolean;
    thermalPressure: boolean;
    powerSaveMode: boolean;
}

/** Límites deterministas del scoring, compartidos con los tests. */
export const DCP_SCORING_LIMITS = {
    lowRamCapacityCap: 44,
    memoryPressurePenalty: 10,
    memoryPressureAvailRatio: 0.1,
    /** Presión de memoria real: capacity ≤ 60 y runtime ≤ 70 ⇒ tier nunca PERFORMANCE. */
    memoryPressureCapacityCap: 60,
    memoryPressureRuntimeCap: 70,
    pressureRuntimeCap: 55,
    severeThermalStatus: 3,
} as const;

/** Señales crudas de hardware/sistema. Tier A las obtiene del WebView; Tier B del plugin Android. */
export interface DeviceSignals {
    // --- Tier A (JS/WebView) ---
    hardwareConcurrency?: number | null;
    deviceMemoryGb?: number | null;
    jsHeapUsedMb?: number | null;
    jsHeapLimitMb?: number | null;
    screenWidthPx?: number | null;
    screenHeightPx?: number | null;
    devicePixelRatio?: number | null;
    prefersReducedMotion?: boolean | null;
    /** Alias de `prefersReducedMotion` exigido por `qa/perf/device-capability-check.mjs`. */
    reducedMotion?: boolean | null;
    storageQuotaMb?: number | null;
    storageUsageMb?: number | null;
    webViewMajor?: number | null;
    /** p95 (ms) del delta entre frames medido con requestAnimationFrame en idle. */
    frameP95Ms?: number | null;

    // --- Tier B (plugin Android de solo lectura) ---
    sdkInt?: number | null;
    release?: string | null;
    abis?: string[] | null;
    cores?: number | null;
    totalMemMb?: number | null;
    availMemMb?: number | null;
    thresholdMb?: number | null;
    lowMemory?: boolean | null;
    lowRamDevice?: boolean | null;
    memoryClassMb?: number | null;
    largeMemoryClassMb?: number | null;
    refreshRateHz?: number | null;
    maxRefreshRateHz?: number | null;
    densityDpi?: number | null;
    widthPx?: number | null;
    heightPx?: number | null;
    powerSaveMode?: boolean | null;
    deviceIdleMode?: boolean | null;
    thermalStatus?: number | null;
    freeStorageMb?: number | null;
    totalStorageMb?: number | null;
    webViewPackage?: string | null;
    webViewVersion?: string | null;
    online?: boolean | null;
    metered?: boolean | null;
    vpn?: boolean | null;
    capturedAt?: number | null;
}

export interface CapabilityProfile {
    signals: DeviceSignals;
    capacityScore: number;
    runtimeScore: number;
    /** p95 de frames medido (contrato QA: `profile.runtimeP95Ms`). null = no calibrado. */
    runtimeP95Ms: number | null;
    /** true solo cuando `runtimeP95Ms` viene de una calibración rAF completada. */
    runtimeCalibrated: boolean;
    tier: PerformanceTier;
    source: CapabilityProfileSource;
    capturedAt: number;
    /** Presupuesto de frame a la tasa de refresco real (1000 / refreshRateHz), en ms. */
    frameBudgetMs: number | null;
    /** Presupuesto de frame a la tasa máxima soportada (1000 / maxRefreshRateHz), en ms. */
    maxFrameBudgetMs: number | null;
    /** Motivos de presión usados por el scoring (evidencia diagnóstica). */
    pressure: DevicePressure;
}

/** Entrada pura de `buildCapabilityProfile`. */
export interface CapabilityProfileInput {
    tierA: DeviceSignals;
    tierB: DeviceSignals;
    runtimeP95Ms: number | null;
    tierBEnabled: boolean;
    now: number;
}

/** Pesos del capacity score: RAM 30, cores 20, WebView 15, storage 15, pantalla 10, base 10. */
const CAPACITY_BASE_POINTS = 10;

function finiteNonNegative(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** RAM total: Tier B (`totalMemMb`) manda sobre la estimación gruesa del WebView (`deviceMemoryGb`). */
function totalRamMb(signals: DeviceSignals): number | null {
    const tierB = finiteNonNegative(signals.totalMemMb);
    if (tierB !== null && tierB > 0) return tierB;
    const deviceMemoryGb = finiteNonNegative(signals.deviceMemoryGb);
    if (deviceMemoryGb !== null && deviceMemoryGb > 0) return deviceMemoryGb * 1024;
    return null;
}

/** Storage libre: Tier B (`freeStorageMb`) manda; si falta, cuota menos uso de `navigator.storage.estimate()`. */
function freeStorageMb(signals: DeviceSignals): number | null {
    const tierB = finiteNonNegative(signals.freeStorageMb);
    if (tierB !== null) return tierB;
    const quota = finiteNonNegative(signals.storageQuotaMb);
    if (quota === null || quota <= 0) return null;
    const usage = finiteNonNegative(signals.storageUsageMb) ?? 0;
    return Math.max(0, quota - usage);
}

/** Ancho físico comparable: `widthPx` nativo o ancho CSS × DPR. */
function physicalWidthPx(signals: DeviceSignals): number | null {
    const tierB = finiteNonNegative(signals.widthPx);
    if (tierB !== null && tierB > 0) return tierB;
    const cssWidth = finiteNonNegative(signals.screenWidthPx);
    const dpr = finiteNonNegative(signals.devicePixelRatio);
    if (cssWidth !== null && cssWidth > 0 && dpr !== null && dpr > 0) return cssWidth * dpr;
    return null;
}

function ramPoints(signals: DeviceSignals): number {
    const ramMb = totalRamMb(signals);
    if (ramMb === null) return 16; // desconocido → punto medio-bajo conservador
    if (ramMb >= 8192) return 30;
    if (ramMb >= 6144) return 27;
    if (ramMb >= 4096) return 22;
    if (ramMb >= 3072) return 16;
    if (ramMb >= 2048) return 10;
    return 5;
}

function coresPoints(signals: DeviceSignals): number {
    const cores = finiteNonNegative(signals.cores) ?? finiteNonNegative(signals.hardwareConcurrency);
    if (cores === null || cores <= 0) return 7; // desconocido
    if (cores >= 8) return 20;
    if (cores >= 6) return 17;
    if (cores >= 4) return 13;
    if (cores >= 2) return 7;
    return 3;
}

function webViewPoints(signals: DeviceSignals): number {
    const major = finiteNonNegative(signals.webViewMajor);
    if (major === null || major <= 0) return 6; // desconocido
    if (major >= 120) return 15;
    if (major >= 110) return 12;
    if (major >= 100) return 9;
    if (major >= 90) return 6;
    return 3;
}

function storagePoints(signals: DeviceSignals): number {
    const freeMb = freeStorageMb(signals);
    if (freeMb === null) return 6; // desconocido
    if (freeMb >= 4096) return 15;
    if (freeMb >= 2048) return 12;
    if (freeMb >= 1024) return 9;
    if (freeMb >= 512) return 6;
    return 3;
}

function screenPoints(signals: DeviceSignals): number {
    const width = physicalWidthPx(signals);
    const dpr = finiteNonNegative(signals.devicePixelRatio);
    const highDensity = dpr !== null && dpr >= 2;
    const wide = width !== null && width >= 1920;
    return wide || highDensity ? 10 : 6;
}

/**
 * Motivos de presión Tier B. Un ratio de RAM libre < 10 % se considera presión
 * real (auditoría §2.2/§12.5) aunque `MemoryInfo.lowMemory` aún no haya saltado.
 */
export function computePressureFlags(signals: DeviceSignals): DevicePressure {
    const totalMb = finiteNonNegative(signals.totalMemMb);
    const availableMb = finiteNonNegative(signals.availMemMb);
    const availRatio = totalMb !== null && totalMb > 0 && availableMb !== null ? availableMb / totalMb : null;
    return {
        lowRamDevice: signals.lowRamDevice === true,
        memoryPressure: signals.lowMemory === true
            || (availRatio !== null && availRatio < DCP_SCORING_LIMITS.memoryPressureAvailRatio),
        thermalPressure: (finiteNonNegative(signals.thermalStatus) ?? 0) >= DCP_SCORING_LIMITS.severeThermalStatus,
        powerSaveMode: signals.powerSaveMode === true,
    };
}

/** Presupuesto de frame (ms) a partir de una tasa de refresco; null si no es plausible. */
export function computeFrameBudgetMs(refreshRateHz: number | null | undefined): number | null {
    const hz = finiteNonNegative(refreshRateHz);
    if (hz === null || hz <= 0 || hz > 240) return null;
    return Math.round((1000 / hz) * 100) / 100;
}

/**
 * Capacidad estática del dispositivo, 0–100 (más alto = más capaz).
 * Consume las señales de presión Tier B; señales desconocidas puntúan
 * conservador (nunca elevan el perfil).
 */
export function computeCapacityScore(signals: DeviceSignals): number {
    const weighted =
        ramPoints(signals) +
        coresPoints(signals) +
        webViewPoints(signals) +
        storagePoints(signals) +
        screenPoints(signals) +
        CAPACITY_BASE_POINTS;
    const pressure = computePressureFlags(signals);
    let capacity = weighted;
    if (pressure.lowRamDevice) capacity = Math.min(capacity, DCP_SCORING_LIMITS.lowRamCapacityCap);
    if (pressure.memoryPressure) {
        capacity = Math.max(0, capacity - DCP_SCORING_LIMITS.memoryPressurePenalty);
        // MV2-1: con presión real (lowMemory o avail < 10 %) el tier no puede ser
        // PERFORMANCE ni aunque el hardware declarado sea alto: máx. BALANCED.
        capacity = Math.min(capacity, DCP_SCORING_LIMITS.memoryPressureCapacityCap);
    }
    return Math.max(0, Math.min(100, Math.round(capacity)));
}

/**
 * Calidad de ejecución a partir del p95 de frames (ms), 0–100.
 * Sin medición válida devuelve 0 (sin evidencia → tier ECO conservador).
 * Bajo presión de memoria real el runtime se acota a 70 y bajo presión
 * térmica/ahorro de energía a 55 (en ambos casos el tier no puede ser PERFORMANCE).
 */
export function computeRuntimeScore(frameP95Ms: number | null | undefined, signals: DeviceSignals = {}): number {
    const p95 = finiteNonNegative(frameP95Ms);
    if (p95 === null || p95 <= 0) return 0;
    let score: number;
    if (p95 <= 18) score = 100;
    else if (p95 <= 25) score = 90;
    else if (p95 <= 33) score = 75;
    else if (p95 <= 50) score = 55;
    else score = 35;
    const pressure = computePressureFlags(signals);
    if (pressure.memoryPressure) {
        score = Math.min(score, DCP_SCORING_LIMITS.memoryPressureRuntimeCap);
    }
    if (pressure.thermalPressure || pressure.powerSaveMode) {
        score = Math.min(score, DCP_SCORING_LIMITS.pressureRuntimeCap);
    }
    return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Tier sugerido. Regla de mínimo: PERFORMANCE exige capacidad y runtime altos;
 * un equipo potente con runtime degradado nunca sube de BALANCED, y un runtime
 * malo fuerza ECO aunque la capacidad sea alta.
 */
export function selectTier(capacityScore: number, runtimeScore: number): PerformanceTier {
    const capacity = Number.isFinite(capacityScore) ? capacityScore : 0;
    const runtime = Number.isFinite(runtimeScore) ? runtimeScore : 0;
    if (runtime < 60) return 'ECO';
    if (capacity >= 72 && runtime >= 85) return 'PERFORMANCE';
    if (capacity >= 45) return 'BALANCED';
    return 'ECO';
}

/**
 * Fusiona Tier A y Tier B. Tier B solo pisa con valores definidos: null, undefined
 * o arrays vacíos de Tier B conservan la señal de Tier A (fallback).
 */
export function mergeSignals(tierA: DeviceSignals, tierB: DeviceSignals): DeviceSignals {
    const merged: DeviceSignals = { ...tierA };
    for (const key of Object.keys(tierB) as (keyof DeviceSignals)[]) {
        const value = tierB[key];
        if (value === undefined || value === null) continue;
        if (Array.isArray(value) && value.length === 0) continue;
        (merged as Record<string, unknown>)[key] = value;
    }
    return merged;
}

/** Claves de Tier B con valor definido (para derivar `source` sin falsos positivos). */
function definedTierBSignalCount(tierB: DeviceSignals): number {
    let count = 0;
    for (const value of Object.values(tierB)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value) && value.length === 0) continue;
        count += 1;
    }
    return count;
}

/**
 * Construye el perfil DCP completo (merge → presión → scores → tier → contrato QA).
 * Puro: sin DOM, sin Capacitor, sin caché. `runtimeP95Ms === null` produce un
 * perfil conservador no calibrado (`runtimeScore` 0) que nunca debe cachearse.
 */
export function buildCapabilityProfile(input: CapabilityProfileInput): CapabilityProfile {
    const signals = mergeSignals(input.tierA, input.tierB);
    if (signals.reducedMotion === undefined || signals.reducedMotion === null) {
        signals.reducedMotion = signals.prefersReducedMotion ?? null;
    }
    const measuredP95 = finiteNonNegative(input.runtimeP95Ms);
    const runtimeCalibrated = measuredP95 !== null && measuredP95 > 0;
    const runtimeP95Ms = runtimeCalibrated ? measuredP95 : null;
    if (runtimeP95Ms !== null) signals.frameP95Ms = runtimeP95Ms;
    const pressure = computePressureFlags(signals);
    const capacityScore = computeCapacityScore(signals);
    const runtimeScore = computeRuntimeScore(runtimeP95Ms, signals);
    const tier = selectTier(capacityScore, runtimeScore);
    const source: CapabilityProfileSource = !input.tierBEnabled
        ? 'TIER_A'
        : definedTierBSignalCount(input.tierB) > 0
            ? 'TIER_A_TIER_B'
            : 'TIER_A';
    return {
        signals,
        capacityScore,
        runtimeScore,
        runtimeP95Ms,
        runtimeCalibrated,
        tier,
        source,
        capturedAt: input.now,
        frameBudgetMs: computeFrameBudgetMs(signals.refreshRateHz),
        maxFrameBudgetMs: computeFrameBudgetMs(signals.maxRefreshRateHz),
        pressure,
    };
}

/**
 * Extrae el major de Chrome/WebView del userAgent. Devuelve null si no hay
 * versión reconocible (WebView antiguo, UA reducido o entrada no textual).
 */
export function parseWebViewMajor(userAgent: string | null | undefined): number | null {
    if (typeof userAgent !== 'string' || userAgent.trim() === '') return null;
    const match = /\b(?:Chrome|CrMo)\/(\d+)/.exec(userAgent);
    if (!match) return null;
    const major = Number.parseInt(match[1], 10);
    return Number.isFinite(major) && major > 0 ? major : null;
}
