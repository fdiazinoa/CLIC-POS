/** Diagnostic-only, bounded counters. No payloads, IDs, product names or per-call logging. */
declare const __POS_DIAGNOSTIC_BUILD__: boolean;

type Counter = { count: number; processed: number; windowStartMs: number; windowCount: number };
type Milestone = { name: string; wallTime: string; elapsedMs: number; products?: number };

const active = typeof __POS_DIAGNOSTIC_BUILD__ !== 'undefined' && __POS_DIAGNOSTIC_BUILD__;
const startedAt = Date.now();
const counters = new Map<string, Counter>();
const timeline: Milestone[] = [];
const alerts: Array<{ name: string; wallTime: string; executionsInFiveSeconds: number }> = [];
const MAX_TIMELINE = 256;
const MAX_ALERTS = 64;

export function freezeCount(name: string, processed = 0): void {
  if (!active) return;
  const now = Date.now();
  let row = counters.get(name);
  if (!row) {
    row = { count: 0, processed: 0, windowStartMs: now, windowCount: 0 };
    counters.set(name, row);
  }
  row.count++;
  row.processed += processed;
  if (now - row.windowStartMs >= 5_000) {
    row.windowStartMs = now;
    row.windowCount = 0;
  }
  row.windowCount++;
  if (row.windowCount === 100 && alerts.length < MAX_ALERTS) {
    alerts.push({ name, wallTime: new Date(now).toISOString(), executionsInFiveSeconds: row.windowCount });
  }
}

export function freezePhase(name: string, products?: number): void {
  if (!active) return;
  const now = Date.now();
  if (timeline.length >= MAX_TIMELINE) timeline.shift();
  timeline.push({ name, wallTime: new Date(now).toISOString(), elapsedMs: now - startedAt,
    ...(products === undefined ? {} : { products }) });
}

export function freezeSnapshot() {
  return {
    diagnostic: active,
    startedAt: new Date(startedAt).toISOString(),
    counters: Object.fromEntries([...counters].map(([key, value]) => [key, { count: value.count, processed: value.processed,
      currentFiveSecondWindow: value.windowCount }])),
    timeline: [...timeline],
    alerts: [...alerts],
  };
}

if (active) {
  (globalThis as any).__CLIC_FREEZE_DIAG__ = Object.freeze({ snapshot: freezeSnapshot });
  freezePhase('APP_START');
}
