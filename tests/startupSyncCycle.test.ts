/**
 * Regression coverage for the repetitive STARTUP cycle observed on Caja 6
 * (APK 1.1.689): three consecutive STARTUP syncs ~10.2 s apart. Each STARTUP
 * fetched the terminal manifest and then the terminal config; the config reply
 * replaced `config.terminals`, which changed the identity of the
 * `getCurrentTerminal` callback, which re-ran the ERP lifecycle effect, which
 * armed a new 8 s STARTUP timer… forever.
 *
 * The lifecycle effect must only be re-created when the effective binding
 * identity changes (tenant / local terminal / ERP terminal / device binding).
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { resolveErpBindingIdentity } from '../utils/erpBindingIdentity';

const appSource = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
const syncSettingsSource = await readFile(new URL('../components/SyncSettings.tsx', import.meta.url), 'utf8');
const syncStatusSource = await readFile(new URL('../components/SyncStatusIndicator.tsx', import.meta.url), 'utf8');
const syncManagerSource = await readFile(new URL('../services/sync/SyncManager.ts', import.meta.url), 'utf8');

const lifecycleStart = appSource.lastIndexOf(
  'useEffect(() => {',
  appSource.indexOf('const setupPending = hasPendingTerminalSetup'),
);
const lifecycleEnd = appSource.indexOf('// --- RECONNECTION BANNER ---', lifecycleStart);
const lifecycleEffect = appSource.slice(lifecycleStart, lifecycleEnd);

const lifecycleDependencyArrays = [...lifecycleEffect.matchAll(/\},\s*\[([^\]]*)\]\);/g)];
const lifecycleDependencies = (lifecycleDependencyArrays.at(-1)?.[1] || '')
  .split(',')
  .map((dependency) => dependency.trim())
  .filter(Boolean);

const bindingSnapshot = (overrides: Record<string, any> = {}) => ({
  id: 'local-terminal-6',
  name: 'Caja 6',
  config: {
    stationNumber: '6',
    erpTerminalId: '11111111-2222-4333-8444-555555555555',
    currentDeviceId: 'device-caja-6',
    isPrimaryNode: true,
    erpBinding: {
      terminalId: '11111111-2222-4333-8444-555555555555',
      tenantId: 'tenant-caja-6',
      stationNumber: '6',
    },
    ...overrides,
  },
});

const identityInput = (overrides: Record<string, any> = {}) => ({
  terminal: bindingSnapshot(),
  deviceId: 'device-caja-6',
  configTenantId: 'tenant-caja-6',
  storedTenantId: 'tenant-caja-6',
  storedActiveTerminalId: 'local-terminal-6',
  storedErpTerminalId: '11111111-2222-4333-8444-555555555555',
  ...overrides,
});

// --- Fix 1: effective binding identity gates the lifecycle effect ------------

test('ordinary configUpdated snapshots keep the same effective binding identity', () => {
  const baselineKey = resolveErpBindingIdentity(identityInput()).key;

  // Every configUpdated replaces config.terminals with a new array and every
  // terminal with a new object, while the binding values stay identical.
  for (let snapshot = 0; snapshot < 5; snapshot += 1) {
    const nextSnapshot = bindingSnapshot({
      metadata: { snapshot, touchedAt: new Date().toISOString() },
      allowedCurrencyCodes: ['DOP'],
    });
    const identity = resolveErpBindingIdentity(identityInput({ terminal: nextSnapshot }));
    assert.equal(identity.key, baselineKey, 'una actualización ordinaria no cambia la identidad');
    assert.equal(identity.bound, true);
  }
});

test('real binding changes produce a different identity', () => {
  const baselineKey = resolveErpBindingIdentity(identityInput()).key;
  const changes: Array<[string, Record<string, any>]> = [
    ['tenant', { terminal: bindingSnapshot({ erpBinding: { terminalId: '11111111-2222-4333-8444-555555555555', tenantId: 'otro-tenant', stationNumber: '6' } }) }],
    ['local terminal', { terminal: { ...bindingSnapshot(), id: 'local-terminal-7' } }],
    ['station number', { terminal: bindingSnapshot({ stationNumber: '7' }) }],
    ['erp terminal', { terminal: bindingSnapshot({ erpTerminalId: '99999999-8888-4777-8666-555555555555', erpBinding: { terminalId: '99999999-8888-4777-8666-555555555555', tenantId: 'tenant-caja-6', stationNumber: '6' } }) }],
    ['device binding', { terminal: bindingSnapshot({ currentDeviceId: 'device-otro' }) }],
    ['binding mode', { terminal: bindingSnapshot({ isPrimaryNode: false }) }],
  ];

  for (const [label, override] of changes) {
    const key = resolveErpBindingIdentity(identityInput(override)).key;
    assert.notEqual(key, baselineKey, `un cambio real de ${label} debe cambiar la identidad`);
  }
});

test('binding identity is resolved from primitives, before and after config loads', () => {
  const unbound = resolveErpBindingIdentity({
    terminal: null,
    deviceId: 'device-caja-6',
    storedTenantId: 'tenant-caja-6',
    storedActiveTerminalId: 'local-terminal-6',
    storedErpTerminalId: '11111111-2222-4333-8444-555555555555',
  });
  const bound = resolveErpBindingIdentity(identityInput());

  assert.equal(unbound.bound, false);
  assert.equal(bound.bound, true);
  assert.notEqual(unbound.key, bound.key, 'la resolución de la terminal cambia la identidad');
  assert.equal(bound.tenantId, 'tenant-caja-6');
  assert.equal(bound.terminalId, 'local-terminal-6');
  assert.equal(bound.localTerminalId, '6');
  assert.equal(bound.erpTerminalId, '11111111-2222-4333-8444-555555555555');
  assert.equal(bound.deviceId, 'device-caja-6');
  assert.equal(bound.bindingMode, 'MASTER');
});

test('the ERP lifecycle effect depends on the binding identity, not on getCurrentTerminal', () => {
  assert.ok(lifecycleEffect.length > 0, 'efecto ERP localizado en App.tsx');
  assert.ok(lifecycleDependencies.length > 0, 'arreglo de dependencias localizado');
  assert.ok(
    !lifecycleDependencies.includes('getCurrentTerminal'),
    `el efecto no debe re-crearse por el callback inestable getCurrentTerminal: ${lifecycleDependencies.join(', ')}`,
  );
  assert.ok(
    lifecycleDependencies.includes('erpBindingIdentityKey'),
    'el efecto debe depender de la identidad efectiva de la vinculación',
  );
  assert.ok(
    !lifecycleDependencies.includes('currentView'),
    'cambiar de vista no debe re-crear los timers del ciclo ERP',
  );
  assert.match(appSource, /import \{ resolveErpBindingIdentity \} from '\.\/utils\/erpBindingIdentity'/);
  assert.match(appSource, /const erpBindingIdentity = React\.useMemo\([\s\S]*?resolveErpBindingIdentity\(/);
  assert.match(appSource, /const erpBindingIdentityKey = erpBindingIdentity\.key;/);
});

test('runtime handlers read the latest terminal through a ref and keep ONLINE/FOREGROUND/STARTUP contracts', () => {
  assert.match(appSource, /const currentTerminalRef = React\.useRef/);
  assert.match(lifecycleEffect, /currentTerminalRef\.current/);
  assert.match(lifecycleEffect, /window\.addEventListener\('online', handleErpOnline\)/);
  assert.match(lifecycleEffect, /document\.addEventListener\('visibilitychange', handleErpAppResume\)/);
  assert.match(lifecycleEffect, /syncTriggerCoordinator\.request\(\{ reason: 'ONLINE' \}\)/);
  assert.match(lifecycleEffect, /syncTriggerCoordinator\.request\(\{ reason: 'FOREGROUND' \}\)/);
  // STARTUP keeps its 8 s operator grace period and its forceManifestRefresh path.
  assert.match(lifecycleEffect, /reason: 'STARTUP'/);
  assert.match(lifecycleEffect, /\}, 8000\);/);
  assert.match(appSource, /authenticatedRequestSucceeded = await syncLifecycle\(\{ forceManifestRefresh: isStartup, reason \}\)/);
});

test('reconnection, foreground and explicit manual sync keep their independent triggers', () => {
  assert.match(lifecycleEffect, /handleErpOnline/);
  assert.match(lifecycleEffect, /requestConditionalTerminalConfig\('connection_restored'\)/);
  assert.match(lifecycleEffect, /requestConditionalTerminalConfig\('safety_check'\)/);
  assert.match(lifecycleEffect, /handleErpAppResume/);
  // Explicit operator sync lives in the settings surfaces and is not gated by
  // the STARTUP binding guard. `SyncSettings` dispatches the coordinator MANUAL
  // reason; `SyncStatusIndicator` calls the manual sync API directly (both
  // paths end in `/sync`).
  assert.match(syncSettingsSource, /syncTriggerCoordinator\.request\(\{ reason: 'MANUAL' \}\)/);
  assert.match(syncStatusSource, /syncManager\.manualSyncAll\(\)/);
  assert.match(syncManagerSource, /syncTriggerCoordinator\.request\(\{ reason: 'MANUAL' \}\)/);
});

test('STARTUP is re-armed only for a new binding identity', () => {
  assert.match(lifecycleEffect, /startupSyncBindingRef/);
  assert.match(
    lifecycleEffect,
    /startupSyncBindingRef\.current\?\.key !== erpBindingIdentityKey/,
    'un cambio de identidad reinicia el guard de arranque',
  );
  assert.match(
    lifecycleEffect,
    /startupSyncBindingRef\.current\.requested/,
    'un re-run del efecto por estado ordinario no re-arma el STARTUP de la misma vinculación',
  );
});

test('configUpdated still applies the synchronized snapshot to React state', () => {
  const occurrences = appSource.match(/setConfig\(incomingConfig\)/g) || [];
  assert.ok(occurrences.length >= 2, 'el handler sigue aplicando la config (con y sin cambios estructurales)');
  assert.match(appSource, /window\.addEventListener\('configUpdated', handleConfigUpdated/);
});

// --- Fix 1 measurement: same 30 s window, before vs after --------------------

const STARTUP_DELAY_MS = 8000;
// APK 1.1.689 trace: consecutive STARTUP cycles were ~10.2 s apart, i.e. the
// 8 s timer plus ~2.2 s of manifest + config round-trips.
const SYNC_COMPLETION_MS = 2200;
const MANIFEST_AT_MS = 800;
const CONFIG_AT_MS = 1600;
const MEASUREMENT_WINDOW_MS = 30000;

interface SimulationOptions {
  /** Pre-fix: every configUpdated re-created the effect and re-armed STARTUP. */
  reschedulesOnConfigUpdate: boolean;
  /** Pre-fix: classification pre-flight with a null base forced a config GET. */
  classificationGapForcesConfig: boolean;
  /** Real re-binding during the window (ms), if any. */
  rebindAtMs?: number;
}

interface SimulationResult {
  startups: number;
  manifests: number;
  configFetches: number;
  configUpdates: number;
  startupsByBinding: Record<string, number>;
}

const simulateStartupWindow = (options: SimulationOptions): SimulationResult => {
  const result: SimulationResult = {
    startups: 0,
    manifests: 0,
    configFetches: 0,
    configUpdates: 0,
    startupsByBinding: {},
  };
  type QueuedEvent = { at: number; run: () => void };
  const queue: QueuedEvent[] = [];
  const schedule = (at: number, run: () => void) => queue.push({ at, run });
  const armed = new Set<string>();

  const runLifecycleEffect = (at: number, bindingKey: string) => {
    if (armed.has(bindingKey)) return; // STARTUP already requested for this binding
    armed.add(bindingKey);
    schedule(at + STARTUP_DELAY_MS, () => {
      const firedAt = at + STARTUP_DELAY_MS;
      result.startups += 1;
      result.startupsByBinding[bindingKey] = (result.startupsByBinding[bindingKey] || 0) + 1;
      schedule(firedAt + MANIFEST_AT_MS, () => { result.manifests += 1; });
      if (options.classificationGapForcesConfig) {
        schedule(firedAt + CONFIG_AT_MS, () => { result.configFetches += 1; });
      }
      // A config apply always ends with a configUpdated snapshot, even when no
      // config GET happened (e.g. sellers push); pre-fix it re-armed STARTUP.
      schedule(firedAt + SYNC_COMPLETION_MS, () => {
        result.configUpdates += 1;
        if (options.reschedulesOnConfigUpdate) {
          armed.delete(bindingKey);
          runLifecycleEffect(firedAt + SYNC_COMPLETION_MS, bindingKey);
        }
      });
    });
  };

  // Boot: the lifecycle effect mounts for the initial binding.
  runLifecycleEffect(0, 'binding-A');
  if (typeof options.rebindAtMs === 'number') {
    schedule(options.rebindAtMs, () => runLifecycleEffect(options.rebindAtMs!, 'binding-B'));
  }

  while (queue.length > 0) {
    queue.sort((left, right) => left.at - right.at);
    const next = queue.shift()!;
    if (next.at > MEASUREMENT_WINDOW_MS) break;
    next.run();
  }

  return result;
};

test('measurement (30 s window): one STARTUP after the fix vs three before', () => {
  const legacy = simulateStartupWindow({
    reschedulesOnConfigUpdate: true,
    classificationGapForcesConfig: true,
  });
  assert.deepEqual(
    { startups: legacy.startups, manifests: legacy.manifests, configFetches: legacy.configFetches },
    { startups: 3, manifests: 3, configFetches: 3 },
    'el modelo del comportamiento previo reproduce los tres ciclos de la traza de Caja 6',
  );

  const onlyStartupFix = simulateStartupWindow({
    reschedulesOnConfigUpdate: false,
    classificationGapForcesConfig: true,
  });
  assert.deepEqual(
    { startups: onlyStartupFix.startups, manifests: onlyStartupFix.manifests, configFetches: onlyStartupFix.configFetches },
    { startups: 1, manifests: 1, configFetches: 1 },
  );

  const fixed = simulateStartupWindow({
    reschedulesOnConfigUpdate: false,
    classificationGapForcesConfig: false,
  });
  assert.deepEqual(
    { startups: fixed.startups, manifests: fixed.manifests, configFetches: fixed.configFetches },
    { startups: 1, manifests: 1, configFetches: 0 },
  );

  // The current source must behave like the fixed model: the unstable callback
  // is not a dependency anymore.
  const sourceReschedules = lifecycleDependencies.includes('getCurrentTerminal');
  assert.equal(sourceReschedules, false);
});

test('a real re-binding re-arms STARTUP once for the new binding, never for the old one', () => {
  const result = simulateStartupWindow({
    reschedulesOnConfigUpdate: false,
    classificationGapForcesConfig: false,
    rebindAtMs: 12000,
  });

  assert.deepEqual(result.startupsByBinding, { 'binding-A': 1, 'binding-B': 1 });
  assert.equal(result.startups, 2);
  assert.equal(result.manifests, 2);
  assert.equal(result.configFetches, 0, 'un rebind real no reutiliza clasificaciones del ámbito previo');
});
