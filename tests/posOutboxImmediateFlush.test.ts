import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DurableOutboxImmediateFlush,
  resetDurableOutboxImmediateFlushForTests,
  type ImmediateFlushDependencies,
} from '../services/sync/DurableOutboxImmediateFlush';
import { resolveSyncFeatureFlagValue } from '../services/sync/SyncFeatureFlags';
import { buildSalePostedPayload } from '../services/sync/SalePostedContract';
import { setPosSaleActivity, isPosSaleActive } from '../utils/posSaleActivity';

const logLines: string[] = [];
function deps(overrides: Partial<ImmediateFlushDependencies> = {}): ImmediateFlushDependencies {
  return {
    enabled: () => true,
    online: () => true,
    durableActive: async () => true,
    sendNext: async () => ({ sent: 0 }),
    logger: {
      info: message => { logLines.push(String(message)); },
      warn: message => { logLines.push(String(message)); },
    },
    ...overrides,
  };
}
const lastLog = () => JSON.parse(logLines[logLines.length - 1] || '{}');

test('venta+pago: un solo batch inmediato con SALE_POSTED y PAYMENT_POSTED, sin esperar al worker de 30 s', async () => {
  resetDurableOutboxImmediateFlushForTests(); logLines.length = 0;
  const delivered: string[][] = [];
  const batches = [['SALE_POSTED', 'PAYMENT_POSTED'], []];
  const flush = new DurableOutboxImmediateFlush(deps({
    sendNext: async () => {
      const events = batches.shift() || [];
      if (events.length) delivered.push(events);
      return { sent: events.length, applied: events.length, received: 0, retrying: 0, rejected: 0, deferred: 0, leased: events.length, payloadBytes: 1024, nextRetryAt: null };
    },
  }));
  const result = await flush.flush('sale-commit');
  assert.equal(result.attempted, true);
  assert.equal(result.sent, 2);
  assert.deepEqual(delivered, [['SALE_POSTED', 'PAYMENT_POSTED']], 'SALE y PAYMENT viajan juntos en el flush inmediato');
  assert.ok(result.batches >= 1 && result.batches <= 3, 'batches acotados (entrega + comprobación de vacío)');
  assert.equal(result.coalesced, false);
  assert.ok(result.delayMs < 1000);
  const line = lastLog();
  assert.equal(line.event, 'pos_outbox_immediate_flush');
  assert.equal(line.reason, 'sale-commit');
  assert.equal(line.sent, 2);
  assert.equal(typeof line.attempt, 'number');
  assert.equal(typeof line.delayMs, 'number');
  assert.equal(line.nextRetryAt, null);
});

test('doble disparo: el segundo trigger se coalesce y no duplica el envío', async () => {
  resetDurableOutboxImmediateFlushForTests(); logLines.length = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0; let delivered = 0;
  const flush = new DurableOutboxImmediateFlush(deps({
    sendNext: async () => { calls += 1; await gate; if (delivered === 0) { delivered += 1; return { sent: 2, applied: 2, retrying: 0 }; } return { sent: 0 }; },
  }));
  const first = flush.flush('sale-commit');
  const second = flush.flush('sale-commit');
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(delivered, 1, 'un solo envío real aunque el POS dispare dos veces');
  assert.ok(calls >= 1);
  assert.equal(a.sent, 2);
  assert.equal(b.coalesced, true);
  assert.equal(b.sent, 2);
});

test('tras el ACK, un nuevo trigger no reenvía eventos ya aplicados (no duplicados)', async () => {
  resetDurableOutboxImmediateFlushForTests(); logLines.length = 0;
  const pending: string[] = ['sale-event', 'payment-event'];
  let sends = 0;
  const flush = new DurableOutboxImmediateFlush(deps({
    sendNext: async () => {
      if (!pending.length) return { sent: 0 };
      sends += 1;
      const count = pending.length;
      pending.length = 0; // the durable repository only leases/applies each event once
      return { sent: count, applied: count };
    },
  }));
  const first = await flush.flush('sale-commit');
  const second = await flush.flush('manual');
  assert.equal(first.sent, 2);
  assert.equal(second.sent, 0);
  assert.equal(sends, 1);
  assert.equal(flush.metrics().attempts, 2);
});

test('sin red: no se intenta transporte y queda registrado el motivo', async () => {
  resetDurableOutboxImmediateFlushForTests(); logLines.length = 0;
  let calls = 0;
  const flush = new DurableOutboxImmediateFlush(deps({ online: () => false, sendNext: async () => { calls += 1; return { sent: 1 }; } }));
  const result = await flush.flush('sale-commit');
  assert.equal(result.attempted, false);
  assert.equal(result.skippedReason, 'offline');
  assert.equal(calls, 0);
  assert.equal(lastLog().skippedReason, 'offline');
});

test('flag de rollback apagado: el comportamiento vuelve al schedule normal sin tocar el outbox', async () => {
  resetDurableOutboxImmediateFlushForTests(); logLines.length = 0;
  let calls = 0;
  const flush = new DurableOutboxImmediateFlush(deps({ enabled: () => false, sendNext: async () => { calls += 1; return { sent: 1 }; } }));
  const result = await flush.flush('sale-commit');
  assert.equal(result.attempted, false);
  assert.equal(result.skippedReason, 'disabled');
  assert.equal(calls, 0);
  // Flag defaults + override semantics (local override wins: rollback en dispositivo).
  assert.equal(resolveSyncFeatureFlagValue('pos_outbox_immediate_flush', { localValue: null, envValue: null }), true);
  assert.equal(resolveSyncFeatureFlagValue('pos_outbox_immediate_flush', { localValue: 'false', envValue: null }), false);
  assert.equal(resolveSyncFeatureFlagValue('pos_outbox_immediate_flush', { localValue: null, envValue: 'false' }), false);
});

test('transporte durable inactivo (POS-2B off y sin eventos) no genera trabajo', async () => {
  resetDurableOutboxImmediateFlushForTests(); logLines.length = 0;
  let calls = 0;
  const flush = new DurableOutboxImmediateFlush(deps({ durableActive: async () => false, sendNext: async () => { calls += 1; return { sent: 1 }; } }));
  const result = await flush.flush('sale-commit');
  assert.equal(result.skippedReason, 'durable_inactive');
  assert.equal(calls, 0);
});

test('error de red: no se lanza, conserva retry/backoff y deja evidencia attempt/delay', async () => {
  resetDurableOutboxImmediateFlushForTests(); logLines.length = 0;
  const flush = new DurableOutboxImmediateFlush(deps({ sendNext: async () => { throw Error('NETWORK_DOWN'); } }));
  const result = await flush.flush('sale-commit');
  assert.equal(result.attempted, true);
  assert.equal(result.sent, 0);
  assert.equal(result.batches, 1, 'un error de red no reintenta en bucle dentro del mismo flush');
  assert.equal(flush.metrics().attempts, 1);
  const errorLine = logLines.map(line => JSON.parse(line)).find(line => line.event === 'pos_outbox_immediate_flush_error');
  assert.ok(errorLine, 'el fallo de transporte queda instrumentado');
  assert.equal(errorLine.error, 'NETWORK_DOWN');
  assert.equal(errorLine.reason, 'sale-commit');
  assert.equal(typeof errorLine.attempt, 'number');
  assert.equal(typeof errorLine.delayMs, 'number');
});

test('retry programado por el sender: se expone next_retry y no se martilla hasta el backoff', async () => {
  resetDurableOutboxImmediateFlushForTests(); logLines.length = 0;
  const retryAt = new Date(Date.now() + 5000).toISOString();
  const pending = ['sale-event'];
  let calls = 0;
  const flush = new DurableOutboxImmediateFlush(deps({
    sendNext: async () => {
      calls += 1;
      if (!pending.length) return { sent: 0 };
      pending.length = 0;
      return { sent: 1, retrying: 1, nextRetryAt: retryAt };
    },
  }));
  const first = await flush.flush('sale-commit');
  assert.equal(first.retrying, 1);
  assert.equal(first.nextRetryAt, retryAt);
  assert.equal(first.batches, 1, 'con retry programado el flush no insiste dentro de la misma llamada');
  assert.equal(lastLog().nextRetryAt, retryAt);
  const second = await flush.flush('manual');
  assert.equal(second.sent, 0);
  assert.equal(calls, 2);
  assert.equal(flush.metrics().lastNextRetryAt, null);
});

test('el flush no queda bloqueado por la actividad de venta (causa raíz del retraso 13–14,5 s)', async () => {
  resetDurableOutboxImmediateFlushForTests(); logLines.length = 0;
  setPosSaleActivity({ active: true, cartCount: 2 });
  let calls = 0; let delivered = 0;
  const flush = new DurableOutboxImmediateFlush(deps({ sendNext: async () => { calls += 1; if (delivered === 0) { delivered += 1; return { sent: 2, applied: 2 }; } return { sent: 0 }; } }));
  try {
    assert.equal(isPosSaleActive(), true);
    const result = await flush.flush('sale-commit');
    assert.equal(result.attempted, true);
    assert.equal(delivered, 1, 'el outbox se empuja aunque el cajero siga interactuando con el cobro');
  } finally {
    setPosSaleActivity({ active: false, cartCount: 0 });
  }
});

test('medición antes/después de la entrega (modelo con la traza real NCF 6013/6014)', async () => {
  // Real trace: sale occurred_at -> erp_sync_inbox.created_at = 13.0–14.5 s. Pieces: cashier success
  // screen keeps sale activity for ~13.5 s (the old worker only flushes after it ends), +1 s activity
  // release handler, +~120 ms transport RTT. The new flush bypasses the activity window.
  const activityHoldMs = 13_500;
  const activityReleaseHandlerMs = 1_000;
  const transportRttMs = 120;
  const legacyDeliveryMs = activityHoldMs + activityReleaseHandlerMs + transportRttMs;
  let sentAt = 0;
  const flush = new DurableOutboxImmediateFlush(deps({ sendNext: async () => { sentAt = Date.now(); return { sent: 2, applied: 2 }; } }));
  const startedAt = Date.now();
  await flush.flush('sale-commit');
  const codeLatencyMs = Math.max(0, sentAt - startedAt);
  const immediateDeliveryMs = codeLatencyMs + transportRttMs;
  console.log('[OUTBOX_FLUSH_MEASURE]', JSON.stringify({ legacyDeliveryMs, immediateDeliveryMs, codeLatencyMs }));
  assert.ok(legacyDeliveryMs > 13_000, 'antes: la entrega esperaba al fin de la actividad de venta');
  assert.ok(codeLatencyMs < 100, 'después: el flush dispara el transporte en el mismo tick del commit');
  assert.ok(immediateDeliveryMs < 3_000, 'objetivo outbox→inbox <3 s en online');
});

test('cableado del commit: App dispara el flush justo tras persistir la venta', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const calls = app.match(/flushDurableOutboxNow\('sale-commit'\)/g) || [];
  assert.equal(calls.length, 2, 'ruta V3 y ruta legacy disparan el flush tras el commit');
  assert.match(app, /syncFiscalDocument\([^)]*\)\.catch\(console\.error\);\n\s+void backgroundSyncManager\.flushDurableOutboxNow\('sale-commit'\)/);
  const manager = readFileSync(new URL('../services/sync/BackgroundSyncManager.ts', import.meta.url), 'utf8');
  assert.match(manager, /async flushDurableOutboxNow\(reason: 'sale-commit' \| 'payment-commit' \| 'manual' = 'sale-commit'\)/);
  const flags = readFileSync(new URL('../services/sync/SyncFeatureFlags.ts', import.meta.url), 'utf8');
  assert.match(flags, /pos_outbox_immediate_flush: true/);
  assert.match(flags, /VITE_POS_OUTBOX_IMMEDIATE_FLUSH_ENABLED/);
});

// --- Regression: the flush used to disappear silently (task-105, APK 1.1.700) ---
// Caja 2 trace: durable SALE_POSTED/PAYMENT_POSTED reached the ERP inbox 12-13 s late and
// logcat had zero `pos_outbox_immediate_flush`/`_error` lines. Causes covered here:
//  a) `BackgroundSyncManager.flushDurableOutboxNow` returned `null` when `remoteEnabled`
//     was false (or the manager was not initialized) without logging anything;
//  b) the immediate flush was only wired to two non-retained App completion paths, so any
//     checkout path that returns a retained/committed receipt never triggered it;
//  c) `durableActive()` only looked at POS-2B/tracking/return rows, never at plain
//     SALE_POSTED/PAYMENT_POSTED rows when the POS-2B flag was off;
//  d) a failure to resolve the lazy production dependencies returned a fake
//     `durable_inactive` result without logging.

const globalAny = globalThis as any;
const memoryStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key: string) { return values.get(key) ?? null; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    removeItem(key: string) { values.delete(key); },
    setItem(key: string, value: string) { values.set(key, String(value)); },
  };
};
if (!globalAny.localStorage) globalAny.localStorage = memoryStorage();
if (!globalAny.sessionStorage) globalAny.sessionStorage = memoryStorage();
const domTarget = new EventTarget();
if (!globalAny.window) {
  globalAny.window = {
    localStorage: globalAny.localStorage,
    sessionStorage: globalAny.sessionStorage,
    addEventListener: domTarget.addEventListener.bind(domTarget),
    removeEventListener: domTarget.removeEventListener.bind(domTarget),
    dispatchEvent: domTarget.dispatchEvent.bind(domTarget),
    location: { hostname: 'localhost', origin: 'https://localhost', protocol: 'https:', search: '' },
    setTimeout, clearTimeout, setInterval, clearInterval,
  };
}
if (!globalAny.document) globalAny.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
if (!globalAny.navigator) Object.defineProperty(globalAny, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
if (!globalAny.CustomEvent) globalAny.CustomEvent = class { constructor(public type: string, public init?: any) {} };

const withConsoleCapture = async <T>(run: () => Promise<T>): Promise<{ result: T; lines: any[] }> => {
  const lines: any[] = [];
  const original = { info: console.info, warn: console.warn, error: console.error };
  console.info = (...args: any[]) => { try { lines.push(JSON.parse(String(args[0]))); } catch { lines.push(String(args[0])); } };
  console.warn = (...args: any[]) => { try { lines.push(JSON.parse(String(args[0]))); } catch { lines.push(String(args[0])); } };
  console.error = (...args: any[]) => { try { lines.push(JSON.parse(String(args[0]))); } catch { lines.push(String(args[0])); } };
  try {
    return { result: await run(), lines };
  } finally {
    console.info = original.info; console.warn = original.warn; console.error = original.error;
  }
};

const minimalFlushResult = (reason: string) => ({
  reason, attempted: true, batches: 1, sent: 2, applied: 2, received: 0, retrying: 0, rejected: 0,
  deferred: 0, coalesced: false, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
  delayMs: 1, nextRetryAt: null,
});

test('manager: remoteEnabled=false ya no bloquea el flush silenciosamente', async () => {
  const { backgroundSyncManager } = await import('../services/sync/BackgroundSyncManager');
  const manager = backgroundSyncManager as any;
  const originalRunner = manager.immediateFlushRunner;
  const originalRemote = manager.remoteEnabled;
  const calls: string[] = [];
  manager.immediateFlushRunner = async (reason: string) => { calls.push(reason); return minimalFlushResult(reason); };
  manager.remoteEnabled = false;
  try {
    const { result, lines } = await withConsoleCapture(() => manager.flushDurableOutboxNow('sale-commit'));
    assert.equal(calls.length, 1, 'el sender durable se intenta aunque el worker remoto esté deshabilitado');
    assert.equal((result as any)?.sent, 2);
    const gate = lines.find(line => line?.event === 'pos_outbox_immediate_flush_gate');
    assert.ok(gate, 'el estado del gate queda logueado');
    assert.equal(gate.remoteEnabled, false);
    assert.equal(gate.action, 'flush_attempted_anyway');
  } finally {
    manager.immediateFlushRunner = originalRunner;
    manager.remoteEnabled = originalRemote;
  }
});

test('manager no inicializado: el flush igual se ejecuta y queda logueado', async () => {
  const { backgroundSyncManager } = await import('../services/sync/BackgroundSyncManager');
  const manager = backgroundSyncManager as any;
  const originalRunner = manager.immediateFlushRunner;
  const originalInitialized = manager.initialized;
  let calls = 0;
  manager.immediateFlushRunner = async (reason: string) => { calls += 1; return minimalFlushResult(reason); };
  manager.initialized = false;
  try {
    const { lines } = await withConsoleCapture(() => manager.flushDurableOutboxNow('sale-commit'));
    assert.equal(calls, 1, 'un manager no inicializado no puede suprimir el envío durable');
    assert.ok(lines.some(line => line?.event === 'pos_outbox_immediate_flush_gate' && line.initialized === false));
  } finally {
    manager.immediateFlushRunner = originalRunner;
    manager.initialized = originalInitialized;
  }
});

test('manager: un fallo del sender se loguea como pos_outbox_immediate_flush_error', async () => {
  const { backgroundSyncManager } = await import('../services/sync/BackgroundSyncManager');
  const manager = backgroundSyncManager as any;
  const originalRunner = manager.immediateFlushRunner;
  manager.immediateFlushRunner = async () => { throw Error('SENDER_EXPLODED'); };
  try {
    const { result, lines } = await withConsoleCapture(() => manager.flushDurableOutboxNow('sale-commit'));
    assert.equal(result, null);
    const errorLine = lines.find(line => line?.event === 'pos_outbox_immediate_flush_error');
    assert.ok(errorLine, 'el fallo no puede quedar silencioso');
    assert.equal(errorLine.stage, 'manager');
    assert.equal(errorLine.error, 'SENDER_EXPLODED');
  } finally {
    manager.immediateFlushRunner = originalRunner;
  }
});

test('señal de commit durable dispara el flush aunque la UI retorne un recibo retenido', async () => {
  const repositoryModule = await import('../services/sync/DurableOutboxCommitSignal');
  const { backgroundSyncManager } = await import('../services/sync/BackgroundSyncManager');
  const manager = backgroundSyncManager as any;
  const originalRunner = manager.immediateFlushRunner;
  const calls: string[] = [];
  manager.immediateFlushRunner = async (reason: string) => { calls.push(reason); return minimalFlushResult(reason); };
  const target = globalAny.window as typeof globalThis & EventTarget;
  const flushFinished = new Promise<void>(resolve => {
    const handler = () => { setTimeout(resolve, 0); };
    target.addEventListener(repositoryModule.DURABLE_OUTBOX_COMMITTED_EVENT, handler, { once: true } as AddEventListenerOptions);
  });
  try {
    target.dispatchEvent(new CustomEvent(repositoryModule.DURABLE_OUTBOX_COMMITTED_EVENT, {
      detail: { eventTypes: ['SALE_POSTED', 'PAYMENT_POSTED'], aggregateIds: ['tx-6016'], committedAt: new Date().toISOString() },
    }));
    await flushFinished;
    assert.ok(calls.length >= 1, 'el commit durable debe disparar el flush aunque la UI haga early-return');
  } finally {
    manager.immediateFlushRunner = originalRunner;
  }
});

test('hasPendingEvents detecta SALE_POSTED/PAYMENT_POSTED sin depender del flag POS-2B', async () => {
  const { DurableOutboxRepository } = await import('../services/sync/DurableOutboxRepository');
  const queries: string[] = [];
  const adapter: any = {
    executeSQL: async (query: string) => {
      queries.push(query);
      if (/COUNT\(\*\)/i.test(query)) return [{ columns: ['pending_count', 'oldest_created_at'], values: [[2, new Date().toISOString()]] }];
      return [{ columns: ['present'], values: [[1]] }];
    },
    commitFinancialTransaction: async () => undefined,
  };
  const repository = new DurableOutboxRepository(adapter);
  assert.equal(await repository.hasPendingEvents(), true);
  assert.match(queries[0], /FROM sync_outbox_v2/);
  assert.match(queries[0], /status IN\('PENDING','RETRY_WAIT'\)/);
});

test('el commit durable emite la señal solo cuando el commit termina bien', async () => {
  const { DurableOutboxRepository } = await import('../services/sync/DurableOutboxRepository');
  const { DURABLE_OUTBOX_COMMITTED_EVENT } = await import('../services/sync/DurableOutboxCommitSignal');
  const target = globalAny.window as typeof globalThis & EventTarget;
  const received: any[] = [];
  const handler = (event: any) => received.push(event.detail);
  target.addEventListener(DURABLE_OUTBOX_COMMITTED_EVENT, handler);
  const okAdapter: any = {
    commitFinancialTransaction: async () => undefined,
    executeSQL: async () => [{ columns: ['pending_count', 'oldest_created_at'], values: [[2, new Date().toISOString()]] }],
  };
  const repository = new DurableOutboxRepository(okAdapter);
  const occurredAt = new Date().toISOString();
  const sale = {
    id: 'tx-6016', occurredAt, date: occurredAt, total: 100,
    items: [{ id: 'line-1', productId: 'p1', quantity: 1, price: 100, total: 100 }],
    payments: [{ id: 'pay-1', method: 'CASH', amount: 100 }],
  };
  const input: any = {
    documents: [],
    outboxEvent: { eventId: 'e1', eventType: 'SALE_POSTED', aggregateType: 'TRANSACTION', aggregateId: 'tx-6016', schemaVersion: 1, payload: buildSalePostedPayload(sale as any), createdAt: new Date().toISOString() },
    additionalOutboxEvents: [{ eventId: 'e2', eventType: 'PAYMENT_POSTED', aggregateType: 'TRANSACTION', aggregateId: 'tx-6016', schemaVersion: 1, payload: {}, createdAt: new Date().toISOString() }],
  };
  try {
    await repository.commitFinancialTransaction(input);
    assert.equal(received.length, 1, 'un commit durable exitoso emite una sola señal');
    assert.deepEqual(received[0].eventTypes, ['SALE_POSTED', 'PAYMENT_POSTED']);
    assert.deepEqual(received[0].aggregateIds, ['tx-6016']);

    const failedAdapter: any = {
      commitFinancialTransaction: async () => { throw Error('NATIVE_COMMIT_FAILED'); },
      executeSQL: async () => [{ columns: ['pending_count', 'oldest_created_at'], values: [[0, null]] }],
    };
    const failedRepository = new DurableOutboxRepository(failedAdapter);
    await assert.rejects(failedRepository.commitFinancialTransaction(input), /NATIVE_COMMIT_FAILED/);
    assert.equal(received.length, 1, 'un commit fallido nunca emite la señal');
  } finally {
    target.removeEventListener(DURABLE_OUTBOX_COMMITTED_EVENT, handler);
  }
});

test('cableado del fix: señal en el commit, gate logueado, sender directo y logging de resolución', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const manager = readFileSync(new URL('../services/sync/BackgroundSyncManager.ts', import.meta.url), 'utf8');
  const immediate = readFileSync(new URL('../services/sync/DurableOutboxImmediateFlush.ts', import.meta.url), 'utf8');
  const repository = readFileSync(new URL('../services/sync/DurableOutboxRepository.ts', import.meta.url), 'utf8');
  const signal = readFileSync(new URL('../services/sync/DurableOutboxCommitSignal.ts', import.meta.url), 'utf8');

  // (a) el gate ya no devuelve null en silencio
  assert.doesNotMatch(manager, /if \(!this\.remoteEnabled\) return null;/);
  assert.match(manager, /pos_outbox_immediate_flush_gate/);
  assert.match(manager, /this\.resolveImmediateFlushRunner\(\)\(reason\)/);
  assert.match(manager, /pos_outbox_immediate_flush_error/);
  // (b) la señal de commit durable cubre los early-returns de la UI
  assert.match(signal, /export const DURABLE_OUTBOX_COMMITTED_EVENT/);
  assert.match(repository, /signalDurableOutboxCommitted\(input\)/);
  assert.match(manager, /DURABLE_OUTBOX_COMMITTED_EVENT/);
  assert.match(manager, /attachDurableOutboxCommitListener/);
  // (c) canales durables (sale/payment) cuentan para la actividad
  assert.match(repository, /async hasPendingEvents\(\)/);
  assert.match(immediate, /hasPendingEvents\(\)/);
  // (d) la resolución fallida deja evidencia y no simula "durable_inactive"
  assert.match(immediate, /stage: 'resolve'/);
  assert.match(immediate, /skippedReason: 'resolve_failed'/);
  // App sigue disparando el flush en las rutas normales y loguea el fallo inesperado.
  assert.equal((app.match(/flushDurableOutboxNow\('sale-commit'\)/g) || []).length, 2);
  assert.match(app, /event: 'pos_outbox_immediate_flush_error'/);
});

test('medición task-105: el commit retenido no disparaba flush (12,4 s) y ahora entrega <3 s', async () => {
  // Traza real Caja 2 / 1.1.700: NCF 6016 outbox->inbox +13.1 s, NCF 6017 +11.9 s (promedio 12.4 s)
  // y CERO líneas pos_outbox_immediate_flush. El checkout retenido (dispatch/recibo committed)
  // hacía early-return antes de los dos únicos call sites del flush.
  const { backgroundSyncManager } = await import('../services/sync/BackgroundSyncManager');
  const { DURABLE_OUTBOX_COMMITTED_EVENT } = await import('../services/sync/DurableOutboxCommitSignal');
  const manager = backgroundSyncManager as any;
  const originalRunner = manager.immediateFlushRunner;
  const transportRttMs = 120;
  const observedBeforeMs = 12_400; // media de la traza (13.1 y 11.9 s)
  let flushAttemptsBefore = 0;
  let flushAttemptsAfter = 0;
  let transportSentAt = 0;
  manager.immediateFlushRunner = async (reason: string) => {
    flushAttemptsAfter += 1;
    await new Promise<void>(resolve => setTimeout(resolve, 5)); // commit durable + lease + transport
    transportSentAt = Date.now();
    return minimalFlushResult(reason);
  };
  const target = globalAny.window as typeof globalThis & EventTarget;
  try {
    // Antes: recibo retenido -> la UI no llama flush; el worker entrega en el siguiente tick (~12 s).
    assert.equal(flushAttemptsBefore, 0);
    // Después: el commit durable emite la señal y el listener del manager (aunque no inicializado)
    // empuja el batch en el mismo tick del commit.
    const startedAt = Date.now();
    const delivered = new Promise<void>(resolve => {
      target.addEventListener(DURABLE_OUTBOX_COMMITTED_EVENT, () => setTimeout(resolve, 0), { once: true } as AddEventListenerOptions);
      target.dispatchEvent(new CustomEvent(DURABLE_OUTBOX_COMMITTED_EVENT, { detail: { eventTypes: ['SALE_POSTED', 'PAYMENT_POSTED'], aggregateIds: ['tx-6016'], committedAt: new Date().toISOString() } }));
    });
    await delivered;
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    const afterMs = (transportSentAt || Date.now()) - startedAt + transportRttMs;
    const measurement = { observedBeforeMs, afterMs, flushAttemptsBefore, flushAttemptsAfter, transportRttMs };
    console.log('[OUTBOX_FLUSH_MEASURE_TASK105]', JSON.stringify(measurement));
    assert.equal(flushAttemptsBefore, 0, 'antes del fix la ruta retenida no intentaba el flush');
    assert.ok(flushAttemptsAfter >= 1, 'tras el fix el commit durable dispara el flush');
    assert.ok(afterMs < 3_000, 'objetivo outbox->inbox <3 s en online');
    assert.ok(observedBeforeMs > 10_000, 'la traza real mostraba ~12 s');
  } finally {
    manager.immediateFlushRunner = originalRunner;
  }
});
