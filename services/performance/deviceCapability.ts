/**
 * DCP (Device Capability Profiler) — recolección Tier A + Tier B, caché y shadow (APE-0 v2).
 *
 * Este módulo SOLO mide y expone un perfil informativo. No cambia animaciones,
 * virtualización, cadencias de sync, ventas, fiscal ni DB. Si algo falla, el
 * arranque continúa: `initDeviceCapabilityShadow()` nunca lanza y se ejecuta
 * diferido a idle post-primer-render.
 *
 * ---------------------------------------------------------------------------
 * FLAG RUNTIME `CLIC_POS_DCP_TIER_B` (A/B sin recompilar)
 * ---------------------------------------------------------------------------
 * Se lee de `localStorage['CLIC_POS_DCP_TIER_B']`; valores `off` / `on`; default `on`.
 * Se evalúa al inicializar el shadow: para A/B basta fijar la clave y recargar la
 * app (sin recompilar). La clave es independiente de la caché del perfil.
 *
 * - MODO ON (default): Tier A estático + Tier B (plugin Android) + calibración
 *   rAF diferida a idle, con aborto si hay venta/carrito/modal activo. Cachea el
 *   perfil calibrado en `localStorage['clic_dcp_profile_v1']` (schemaVersion 1,
 *   TTL 24 h) y publica UN log `[DCP]`.
 *   Evidencia que produce: `source: 'TIER_A_TIER_B'` en Android (o `'TIER_A'` si
 *   el plugin no está disponible), `runtimeP95Ms` numérico si la calibración
 *   completó, `runtimeCalibrated: true`, `pressure`/`frameBudgetMs`, escritura de
 *   la clave de caché y `window.__CLIC_POS_DEVICE__` actualizado.
 * - MODO OFF (A/B): solo Tier A estático. NO llama al plugin Tier B, NO mide
 *   runtime (rAF), NO lee ni escribe la caché. Publica UN log `[DCP]`.
 *   Evidencia que produce: `source: 'TIER_A'`, `runtimeP95Ms: null`,
 *   `runtimeCalibrated: false`, `runtimeScore: 0`/tier conservador en memoria,
 *   sin escritura de caché. Sirve como baseline de overhead para el gate de
 *   performance (comparar DCP-on vs DCP-off con el mismo APK).
 *
 * Notas de alcance:
 * - Persistencia en `localStorage` (no Capacitor Preferences): 0 dependencias
 *   nuevas, try/catch, funciona en WebView; si falla (cuota/privado) el perfil
 *   sigue funcionando sin caché.
 * - Sin `ACCESS_*` nuevos: el plugin no pide permisos, no hace red ni escritura
 *   nativa; `ACCESS_NETWORK_STATE` ya existía en el manifest.
 * - El global `window.__CLIC_POS_DEVICE__` solo lo escribe este módulo (shadow).
 */

import { registerPlugin } from '@capacitor/core';

import { getPosSaleActivity, isPosSaleActive, waitForPosSaleIdle } from '../../utils/posSaleActivity';

import {
    buildCapabilityProfile,
    parseWebViewMajor,
    type CapabilityProfile,
    type DeviceSignals,
} from './deviceCapabilityScore';

export type { CapabilityProfile, CapabilityProfileSource, DevicePressure, DeviceSignals, PerformanceTier } from './deviceCapabilityScore';

/** Flag runtime A/B: `off` desactiva Tier B y la calibración; cualquier otro valor = `on`. */
export const DCP_TIER_B_FLAG_KEY = 'CLIC_POS_DCP_TIER_B';
/** Caché del perfil calibrado (24 h). */
export const DCP_CACHE_KEY = 'clic_dcp_profile_v1';
export const DCP_CACHE_SCHEMA_VERSION = 1;
export const DCP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Timeout del puente Tier B (auditoría §12.3: < 5 ms esperado; 1,5 s como cota dura). */
export const DCP_TIER_B_TIMEOUT_MS = 1500;
export const DCP_RUNTIME_SAMPLE_MAX_FRAMES = 45;
export const DCP_RUNTIME_SAMPLE_MAX_DURATION_MS = 2000;
/** Cota de espera a que no haya venta activa antes de abortar la calibración. */
export const DCP_CALIBRATION_WAIT_MAX_MS = 15000;
/** Si `requestIdleCallback` no existe/no dispara, el perfil se publica igualmente tras este timeout. */
export const DCP_FIRST_PAINT_IDLE_TIMEOUT_MS = 2500;

const BYTES_PER_MB = 1024 * 1024;

interface NativeDeviceCapabilityPlugin {
    getInfo(): Promise<Record<string, unknown>>;
}

const nativeDeviceCapability = registerPlugin<NativeDeviceCapabilityPlugin>('DeviceCapability');

/** Subconjunto de `Storage` usado por la caché (inyectable en tests). */
export interface DcpStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

interface CachedProfilePayload {
    schemaVersion: number;
    cachedAt: number;
    signals: DeviceSignals;
    runtimeP95Ms: number | null;
}

// --- flag runtime ---

/** Semántica del flag: solo `off` (case-insensitive, trim) apaga Tier B; default `on`. */
export function resolveTierBEnabled(rawFlagValue: string | null | undefined): boolean {
    if (typeof rawFlagValue !== 'string') return true;
    return rawFlagValue.trim().toLowerCase() !== 'off';
}

function readDefaultFlag(): string | null {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage.getItem(DCP_TIER_B_FLAG_KEY);
    } catch {
        return null;
    }
}

function defaultStorage(): DcpStorage | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

// --- helpers de saneamiento (nunca lanzan) ---

function positiveNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function nonNegativeNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

function textOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function stringArrayOrNull(value: unknown): string[] | null {
    if (!Array.isArray(value)) return null;
    const values = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
    return values.length > 0 ? values : null;
}

function bytesToMb(value: unknown): number | null {
    const bytes = nonNegativeNumber(value);
    return bytes === null ? null : bytes / BYTES_PER_MB;
}

function majorFromVersionString(version: string | null): number | null {
    if (version === null) return null;
    const match = /^(\d+)/.exec(version.trim());
    if (!match) return null;
    const major = Number.parseInt(match[1], 10);
    return Number.isFinite(major) && major > 0 ? major : null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('DCP Tier B timeout')), Math.max(0, timeoutMs));
        promise.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

// --- Tier B: plugin Android (solo lectura, sin permisos) ---

function mapTierBSignals(raw: Record<string, unknown>): DeviceSignals {
    const webViewVersion = textOrNull(raw.webViewVersion);
    return {
        sdkInt: positiveNumber(raw.sdkInt),
        release: textOrNull(raw.release),
        abis: stringArrayOrNull(raw.abis),
        cores: positiveNumber(raw.cores),
        totalMemMb: nonNegativeNumber(raw.totalMemMb),
        availMemMb: nonNegativeNumber(raw.availMemMb),
        thresholdMb: nonNegativeNumber(raw.thresholdMb),
        lowMemory: booleanOrNull(raw.lowMemory),
        lowRamDevice: booleanOrNull(raw.lowRamDevice),
        memoryClassMb: positiveNumber(raw.memoryClassMb),
        largeMemoryClassMb: positiveNumber(raw.largeMemoryClassMb),
        refreshRateHz: positiveNumber(raw.refreshRateHz),
        maxRefreshRateHz: positiveNumber(raw.maxRefreshRateHz),
        densityDpi: positiveNumber(raw.densityDpi),
        widthPx: positiveNumber(raw.widthPx),
        heightPx: positiveNumber(raw.heightPx),
        powerSaveMode: booleanOrNull(raw.powerSaveMode),
        deviceIdleMode: booleanOrNull(raw.deviceIdleMode),
        thermalStatus: nonNegativeNumber(raw.thermalStatus),
        freeStorageMb: nonNegativeNumber(raw.freeStorageMb),
        totalStorageMb: nonNegativeNumber(raw.totalStorageMb),
        webViewPackage: textOrNull(raw.webViewPackage),
        webViewVersion,
        webViewMajor: majorFromVersionString(webViewVersion),
        online: booleanOrNull(raw.online),
        metered: booleanOrNull(raw.metered),
        vpn: booleanOrNull(raw.vpn),
        capturedAt: positiveNumber(raw.capturedAt),
    };
}

/**
 * Recolecta Tier B con un `getInfo` inyectable + timeout. Nunca lanza: plugin
 * ausente, rechazo, respuesta no objeto o timeout devuelven `{}` (fallback Tier A).
 */
export async function collectTierBWith(
    getInfo: () => Promise<unknown> | unknown,
    timeoutMs: number = DCP_TIER_B_TIMEOUT_MS,
): Promise<DeviceSignals> {
    try {
        const raw = await withTimeout(Promise.resolve().then(() => getInfo()), timeoutMs);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
        return mapTierBSignals(raw as Record<string, unknown>);
    } catch {
        return {};
    }
}

/** Recolecta Tier B del plugin Capacitor real. Nunca lanza. */
export async function collectTierB(): Promise<DeviceSignals> {
    return collectTierBWith(() => nativeDeviceCapability.getInfo());
}

// --- Tier A: JS/WebView (estático; la medición rAF vive en measureRuntimeP95) ---

function readPrefersReducedMotion(): boolean | null {
    try {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return null;
    }
}

async function estimateStorage(): Promise<{ quotaMb: number | null; usageMb: number | null } | null> {
    try {
        if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.estimate !== 'function') {
            return null;
        }
        const estimate = await navigator.storage.estimate();
        return { quotaMb: bytesToMb(estimate.quota), usageMb: bytesToMb(estimate.usage) };
    } catch {
        return null;
    }
}

/**
 * Recolecta el Tier A estático (sin rAF). Nunca lanza: cada grupo va protegido y
 * las señales no disponibles quedan como null. `reducedMotion` se publica como
 * alias de `prefersReducedMotion` (contrato QA).
 */
export async function collectTierA(): Promise<DeviceSignals> {
    const signals: DeviceSignals = {};

    try {
        if (typeof navigator !== 'undefined') {
            signals.hardwareConcurrency = positiveNumber(navigator.hardwareConcurrency);
            const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
            signals.deviceMemoryGb = positiveNumber(deviceMemory);
            signals.webViewMajor = parseWebViewMajor(navigator.userAgent);
        }
    } catch {
        // Señales opcionales: se dejan como null.
    }

    try {
        if (typeof performance !== 'undefined') {
            const memory = (performance as Performance & {
                memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number };
            }).memory;
            if (memory) {
                signals.jsHeapUsedMb = bytesToMb(memory.usedJSHeapSize);
                signals.jsHeapLimitMb = bytesToMb(memory.jsHeapSizeLimit);
            }
        }
    } catch {
        // performance.memory es no estándar; si falla se ignora.
    }

    try {
        if (typeof window !== 'undefined' && window.screen) {
            signals.screenWidthPx = positiveNumber(window.screen.width);
            signals.screenHeightPx = positiveNumber(window.screen.height);
            signals.devicePixelRatio = positiveNumber(window.devicePixelRatio);
        }
    } catch {
        // Pantalla/DPR opcionales.
    }

    const reducedMotion = readPrefersReducedMotion();
    signals.prefersReducedMotion = reducedMotion;
    signals.reducedMotion = reducedMotion;

    const storage = await estimateStorage();
    if (storage) {
        signals.storageQuotaMb = storage.quotaMb;
        signals.storageUsageMb = storage.usageMb;
    }

    signals.frameP95Ms = null; // se completa solo con measureRuntimeP95
    signals.capturedAt = Date.now();
    return signals;
}

// --- calibración rAF (diferida a idle, cancelable) ---

function percentile(values: number[], percentileValue: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const rank = Math.ceil((percentileValue / 100) * sorted.length) - 1;
    const index = Math.min(Math.max(rank, 0), sorted.length - 1);
    return sorted[index];
}

export interface RuntimeMeasurementOptions {
    shouldAbort?: () => boolean;
    maxFrames?: number;
    maxDurationMs?: number;
}

/**
 * Muestreo acotado de rAF (≤45 frames y ≤2 s por defecto) con aborto cooperative:
 * `shouldAbort()` se evalúa en cada frame y el timer duro actúa de escape.
 * Devuelve p95 de deltas o null si no hay frames o se aborta.
 */
export function measureRuntimeP95(options: RuntimeMeasurementOptions = {}): Promise<number | null> {
    const maxFrames = options.maxFrames ?? DCP_RUNTIME_SAMPLE_MAX_FRAMES;
    const maxDurationMs = options.maxDurationMs ?? DCP_RUNTIME_SAMPLE_MAX_DURATION_MS;
    const shouldAbort = options.shouldAbort ?? (() => false);
    return new Promise<number | null>(resolve => {
        if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
            resolve(null);
            return;
        }

        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let rafId: number | null = null;
        const deltas: number[] = [];
        let startedAt: number | null = null;
        let lastFrameAt: number | null = null;

        const finish = (value: number | null): void => {
            if (settled) return;
            settled = true;
            if (timer !== undefined) clearTimeout(timer);
            if (rafId !== null && typeof window.cancelAnimationFrame === 'function') {
                try {
                    window.cancelAnimationFrame(rafId);
                } catch {
                    // El frame ya no existe: nada que cancelar.
                }
            }
            resolve(value);
        };

        const abortIfRequested = (): boolean => {
            try {
                return shouldAbort();
            } catch {
                return true; // ante duda se aborta (conservador)
            }
        };

        const onFrame = (timestamp: number): void => {
            if (settled) return;
            if (abortIfRequested()) {
                finish(null);
                return;
            }
            if (startedAt === null) {
                startedAt = timestamp;
                lastFrameAt = timestamp;
            } else if (lastFrameAt !== null) {
                const delta = timestamp - lastFrameAt;
                if (Number.isFinite(delta) && delta >= 0) deltas.push(delta);
                lastFrameAt = timestamp;
            }
            const timedOut = startedAt !== null && timestamp - startedAt >= maxDurationMs;
            if (deltas.length >= Math.max(1, maxFrames - 1) || timedOut) {
                finish(percentile(deltas, 95));
                return;
            }
            try {
                rafId = window.requestAnimationFrame(onFrame);
            } catch {
                finish(percentile(deltas, 95));
            }
        };

        timer = setTimeout(() => finish(percentile(deltas, 95)), maxDurationMs + 500);
        try {
            rafId = window.requestAnimationFrame(onFrame);
        } catch {
            finish(null);
        }
    });
}

// --- caché del perfil calibrado ---

const NUMERIC_SIGNAL_KEYS = [
    'hardwareConcurrency', 'deviceMemoryGb', 'jsHeapUsedMb', 'jsHeapLimitMb',
    'screenWidthPx', 'screenHeightPx', 'devicePixelRatio', 'storageQuotaMb', 'storageUsageMb',
    'webViewMajor', 'frameP95Ms', 'sdkInt', 'cores', 'totalMemMb', 'availMemMb', 'thresholdMb',
    'memoryClassMb', 'largeMemoryClassMb', 'refreshRateHz', 'maxRefreshRateHz', 'densityDpi',
    'widthPx', 'heightPx', 'thermalStatus', 'freeStorageMb', 'totalStorageMb', 'capturedAt',
] as const;

const BOOLEAN_SIGNAL_KEYS = [
    'prefersReducedMotion', 'reducedMotion', 'lowMemory', 'lowRamDevice', 'powerSaveMode',
    'deviceIdleMode', 'online', 'metered', 'vpn',
] as const;

const STRING_SIGNAL_KEYS = ['release', 'webViewPackage', 'webViewVersion'] as const;

/** Sanea las señales leídas de caché contra una lista blanca de claves y tipos. */
function sanitizeCachedSignals(raw: unknown): DeviceSignals | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const source = raw as Record<string, unknown>;
    const signals: DeviceSignals = {};
    const mutable = signals as Record<string, unknown>;
    for (const key of NUMERIC_SIGNAL_KEYS) {
        const value = source[key];
        if (typeof value === 'number' && Number.isFinite(value)) mutable[key] = value;
    }
    for (const key of BOOLEAN_SIGNAL_KEYS) {
        const value = source[key];
        if (typeof value === 'boolean') mutable[key] = value;
    }
    for (const key of STRING_SIGNAL_KEYS) {
        const value = source[key];
        if (typeof value === 'string' && value.trim() !== '') mutable[key] = value;
    }
    const abis = source.abis;
    if (Array.isArray(abis)) {
        const values = abis.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
        if (values.length > 0) signals.abis = values;
    }
    return signals;
}

/**
 * Valida y reconstruye un perfil cacheado. Descarta schemaVersion/TTL inválidos,
 * señales corruptas o runtime no calibrado; además recalcula scores/tier/presión
 * desde las señales saneadas, de modo que una caché manipulada nunca inyecta un
 * tier incoherente. Devuelve `source: 'CACHE'`.
 */
export function parseCachedProfile(rawValue: string | null, now: number): CapabilityProfile | null {
    if (typeof rawValue !== 'string' || rawValue === '') return null;
    try {
        const parsed = JSON.parse(rawValue) as Partial<CachedProfilePayload> | null;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        if (parsed.schemaVersion !== DCP_CACHE_SCHEMA_VERSION) return null;
        if (typeof parsed.cachedAt !== 'number' || !Number.isFinite(parsed.cachedAt)) return null;
        const age = now - parsed.cachedAt;
        if (age < 0 || age > DCP_CACHE_TTL_MS) return null;
        const signals = sanitizeCachedSignals(parsed.signals);
        if (!signals) return null;
        const runtimeP95Ms = parsed.runtimeP95Ms;
        if (typeof runtimeP95Ms !== 'number' || !Number.isFinite(runtimeP95Ms) || runtimeP95Ms <= 0) return null;
        const profile = buildCapabilityProfile({
            tierA: signals,
            tierB: {},
            runtimeP95Ms,
            tierBEnabled: true,
            now: parsed.cachedAt,
        });
        return { ...profile, source: 'CACHE' };
    } catch {
        return null;
    }
}

/** Lee y valida la caché; nunca lanza. */
export function loadCachedProfile(storage: DcpStorage | null, now: number): CapabilityProfile | null {
    try {
        if (!storage) return null;
        return parseCachedProfile(storage.getItem(DCP_CACHE_KEY), now);
    } catch {
        return null;
    }
}

/**
 * Persiste SOLO perfiles calibrados (runtime medido). Un perfil conservador
 * (sin runtime) nunca se cachea: si se aborta la calibración, queda solo en memoria.
 */
export function storeProfile(storage: DcpStorage | null, profile: CapabilityProfile, now: number): boolean {
    if (!storage || !profile.runtimeCalibrated || profile.runtimeP95Ms === null) return false;
    const payload: CachedProfilePayload = {
        schemaVersion: DCP_CACHE_SCHEMA_VERSION,
        cachedAt: now,
        signals: profile.signals,
        runtimeP95Ms: profile.runtimeP95Ms,
    };
    try {
        storage.setItem(DCP_CACHE_KEY, JSON.stringify(payload));
        return true;
    } catch {
        return false; // cuota llena/modo privado: el DCP no debe afectar a la app
    }
}

// --- shadow: orquestación diferida a idle ---

export interface DeviceCapabilityShadowDeps {
    storage: DcpStorage | null;
    now: () => number;
    readTierBFlag: () => string | null;
    collectTierA: () => Promise<DeviceSignals>;
    collectTierB: () => Promise<DeviceSignals>;
    measureRuntimeP95: (shouldAbort: () => boolean) => Promise<number | null>;
    isSaleActive: () => boolean;
    isModalOpen: () => boolean;
    waitForSaleIdle: () => Promise<void>;
    /** Programa el trabajo tras el primer render (requestIdleCallback con fallback). */
    scheduleAfterFirstPaint: (callback: () => void) => void;
    publish: (profile: CapabilityProfile) => void;
    log: (profile: CapabilityProfile) => void;
    warn: (error: unknown) => void;
    calibrationWaitTimeoutMs?: number;
}

function waitForIdleBounded(deps: DeviceCapabilityShadowDeps): Promise<boolean> {
    const timeoutMs = deps.calibrationWaitTimeoutMs ?? DCP_CALIBRATION_WAIT_MAX_MS;
    return new Promise<boolean>(resolve => {
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                resolve(false);
            }
        }, Math.max(0, timeoutMs));
        Promise.resolve()
            .then(() => deps.waitForSaleIdle())
            .then(
                () => {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        resolve(true);
                    }
                },
                () => {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        resolve(false);
                    }
                },
            );
    });
}

/**
 * Flujo del perfil en sombra (sin scheduling): flag → caché → Tier A/B estático →
 * espera/idle → calibración rAF con aborto → caché solo si calibra.
 * Exportado para tests deterministas con dependencias inyectadas.
 */
export async function resolveDeviceCapabilityShadowProfile(
    deps: DeviceCapabilityShadowDeps,
): Promise<CapabilityProfile> {
    const now = deps.now();
    const tierBEnabled = resolveTierBEnabled(deps.readTierBFlag());

    // MODO OFF (A/B): sin Tier B, sin caché, sin medición de runtime.
    if (!tierBEnabled) {
        const tierA = await deps.collectTierA();
        return buildCapabilityProfile({ tierA, tierB: {}, runtimeP95Ms: null, tierBEnabled: false, now });
    }

    const cached = loadCachedProfile(deps.storage, now);
    if (cached) return cached;

    const tierA = await deps.collectTierA();
    const tierB = await deps.collectTierB();
    const uncalibrated = buildCapabilityProfile({ tierA, tierB, runtimeP95Ms: null, tierBEnabled: true, now });

    // Nunca calibrar durante venta/carrito/modal: perfil conservador solo en memoria.
    if (deps.isSaleActive() || deps.isModalOpen()) return uncalibrated;

    const idleReached = await waitForIdleBounded(deps);
    if (!idleReached || deps.isSaleActive() || deps.isModalOpen()) return uncalibrated;

    const shouldAbort = (): boolean => deps.isSaleActive() || deps.isModalOpen();
    const runtimeP95Ms = await deps.measureRuntimeP95(shouldAbort);
    if (runtimeP95Ms === null) return uncalibrated; // abortado/sin frames: no se cachea runtime

    const calibrated = buildCapabilityProfile({
        tierA,
        tierB,
        runtimeP95Ms,
        tierBEnabled: true,
        now: deps.now(),
    });
    storeProfile(deps.storage, calibrated, deps.now());
    return calibrated;
}

/**
 * Ejecuta el shadow completo: programa tras el primer render, resuelve el perfil,
 * publica UNA vez en `window.__CLIC_POS_DEVICE__` y emite UN log `[DCP]`.
 * Nunca lanza; resuelve su promesa cuando termina (o cae a warn).
 */
export async function runDeviceCapabilityShadow(deps: DeviceCapabilityShadowDeps): Promise<void> {
    await new Promise<void>(resolve => {
        let settled = false;
        const settle = (): void => {
            if (settled) return;
            settled = true;
            resolve();
        };
        const fail = (error: unknown): void => {
            try {
                deps.warn(error);
            } catch {
                // El warning tampoco puede romper el arranque.
            }
            settle();
        };

        try {
            deps.scheduleAfterFirstPaint(() => {
                void (async () => {
                    try {
                        const profile = await resolveDeviceCapabilityShadowProfile(deps);
                        try {
                            deps.publish(profile);
                        } catch (error) {
                            fail(error);
                            return;
                        }
                        try {
                            deps.log(profile);
                        } catch {
                            // Un log roto no invalida el perfil publicado.
                        }
                        settle();
                    } catch (error) {
                        fail(error);
                    }
                })();
            });
        } catch (error) {
            fail(error);
        }
    });
}

function scheduleAfterFirstPaint(callback: () => void): void {
    try {
        if (typeof window === 'undefined') {
            setTimeout(callback, 0);
            return;
        }
        const scheduleIdle = (): void => {
            try {
                const win = window as Window & {
                    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
                };
                if (typeof win.requestIdleCallback === 'function') {
                    win.requestIdleCallback(() => callback(), { timeout: DCP_FIRST_PAINT_IDLE_TIMEOUT_MS });
                    return;
                }
                window.setTimeout(callback, 0);
            } catch {
                try {
                    callback();
                } catch {
                    // Sin scheduling posible: el shadow simplemente no corre.
                }
            }
        };
        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => {
                try {
                    window.requestAnimationFrame(scheduleIdle);
                } catch {
                    scheduleIdle();
                }
            });
        } else {
            scheduleIdle();
        }
    } catch {
        setTimeout(callback, 0);
    }
}

function defaultIsSaleActive(): boolean {
    try {
        return isPosSaleActive() || getPosSaleActivity().cartCount > 0;
    } catch {
        return true; // ante duda no se calibra
    }
}

function defaultIsModalOpen(): boolean {
    try {
        if (typeof document === 'undefined') return false;
        return document.querySelector('[role="dialog"][aria-modal="true"], [aria-modal="true"]') !== null;
    } catch {
        return false;
    }
}

function defaultWaitForSaleIdle(): Promise<void> {
    try {
        return waitForPosSaleIdle();
    } catch {
        return Promise.resolve();
    }
}

function defaultPublish(profile: CapabilityProfile): void {
    try {
        if (typeof window !== 'undefined') window.__CLIC_POS_DEVICE__ = profile;
    } catch {
        // El global es diagnóstico: si no se puede escribir, no pasa nada.
    }
}

function defaultLog(profile: CapabilityProfile): void {
    try {
        console.info('[DCP]', {
            tier: profile.tier,
            capacityScore: profile.capacityScore,
            runtimeScore: profile.runtimeScore,
            runtimeP95Ms: profile.runtimeP95Ms,
            runtimeCalibrated: profile.runtimeCalibrated,
            source: profile.source,
            frameBudgetMs: profile.frameBudgetMs,
            pressure: profile.pressure,
        });
    } catch {
        // Ni siquiera el log puede romper el arranque.
    }
}

function defaultWarn(error: unknown): void {
    try {
        console.warn('[DCP] shadow profile unavailable', error);
    } catch {
        // Ignorado: el shadow nunca lanza.
    }
}

/** Dependencias reales (DOM, Capacitor, `utils/posSaleActivity`). */
export function createDefaultDeviceCapabilityShadowDeps(): DeviceCapabilityShadowDeps {
    return {
        storage: defaultStorage(),
        now: () => Date.now(),
        readTierBFlag: readDefaultFlag,
        collectTierA,
        collectTierB,
        measureRuntimeP95: (shouldAbort: () => boolean) => measureRuntimeP95({ shouldAbort }),
        isSaleActive: defaultIsSaleActive,
        isModalOpen: defaultIsModalOpen,
        waitForSaleIdle: defaultWaitForSaleIdle,
        scheduleAfterFirstPaint,
        publish: defaultPublish,
        log: defaultLog,
        warn: defaultWarn,
    };
}

declare global {
    interface Window {
        /** Perfil DCP de solo lectura expuesto por `initDeviceCapabilityShadow`. */
        __CLIC_POS_DEVICE__?: CapabilityProfile;
    }
}

let shadowInitialization: Promise<void> | null = null;

/**
 * APE-0 v2: inicializa el DCP en sombra, diferido a idle post-primer-render.
 * Idempotente: llamadas repetidas comparten la misma promesa y producen un solo
 * log/global. No lanza nunca y no influye en ninguna decisión de la app.
 */
export function initDeviceCapabilityShadow(): Promise<void> {
    if (shadowInitialization) return shadowInitialization;
    shadowInitialization = runDeviceCapabilityShadow(createDefaultDeviceCapabilityShadowDeps());
    return shadowInitialization;
}
