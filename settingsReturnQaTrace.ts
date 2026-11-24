type Event = { name: string; startMs: number; durationMs?: number; ok?: boolean; query?: number };

function createTrace() {
  let run: { started: number; events: Event[]; queries: Map<string, number>; dropped: number } | undefined;
  return {
    active: () => Boolean(run),
    start() { run = { started: performance.now(), events: [], queries: new Map(), dropped: 0 }; },
    stop() {
      const captured = run;
      run = undefined;
      if (!captured) return;
      const groups = new Map<number, number>();
      for (const event of captured.events) {
        if (event.query !== undefined) groups.set(event.query, (groups.get(event.query) ?? 0) + 1);
      }
      const queries = [...groups].map(([id, count]) => ({ id, count }));
      return {
        events: captured.events,
        queries,
        repeatedReads: queries.reduce((sum, query) => sum + query.count - 1, 0),
        dropped: captured.dropped,
      };
    },
    measure<T>(name: string, operation: () => Promise<T>, sql?: string, values?: unknown) {
      const captured = run;
      if (!captured) return operation();
      if (captured.events.length >= 2000) {
        captured.dropped++;
        return operation();
      }
      const start = performance.now();
      const event: Event = { name, startMs: start - captured.started };
      if (sql !== undefined) {
        // Compare exact statements and bound values in memory. Export only a run-local ID.
        const key = JSON.stringify([sql, values ?? []]);
        event.query = captured.queries.get(key) ?? captured.queries.size + 1;
        captured.queries.set(key, event.query);
      }
      captured.events.push(event);
      const finish = (ok: boolean) => {
        event.durationMs = performance.now() - start;
        event.ok = ok;
      };
      try {
        return operation().then(value => { finish(true); return value; }, error => { finish(false); throw error; });
      } catch (error) {
        finish(false);
        throw error;
      }
    },
    mark(name: string) {
      if (!run) return;
      if (run.events.length >= 2000) { run.dropped++; return; }
      run.events.push({ name, startMs: performance.now() - run.started });
    },
  };
}

const trace = import.meta.env?.VITE_POS_SETTINGS_RETURN_TRACE === 'true' ? createTrace() : undefined;
if (trace && typeof window !== 'undefined') Object.assign(window, {
  posSettingsReturnTrace: { start: trace.start, stop: trace.stop },
});

/** Export bundle coordinates only. Call this before the async persistence queue loses its caller. */
export function captureSettingsReturnQaCaller(): string | undefined {
  if (!trace?.active()) return;
  const frames = (new Error().stack ?? '').match(/\b[\w.-]+\.js:\d+:\d+\b/g)?.slice(1, 6);
  return frames?.length ? frames.join('|') : undefined;
}

export const markSettingsReturnQa = (name: string) => trace?.mark(name);
export function measureSettingsReturnQa<T>(name: string, operation: () => Promise<T>, sql?: string, values?: unknown) {
  return trace ? trace.measure(name, operation, sql, values) : operation();
}
export const settingsReturnQaEnabled = Boolean(trace);

const v3ErrorCodes = new Set([
  'SYNC_V3_BINDING_CHANGED', 'SYNC_V3_RUNTIME_VERSION_CHANGED',
  'SYNC_V3_UI_CONTEXT_CHANGED', 'SYNC_V3_OFFLINE_CACHED_RUNTIME_REQUIRED',
  'SYNC_V3_NATIVE_STORE_UNAVAILABLE', 'SYNC_V3_BASE_URL_REQUIRED',
  'SYNC_V3_TARIFF_UNAVAILABLE', 'SYNC_V3_CONFIGURED_TARIFF_WAREHOUSE_REQUIRED',
]);
const v3BindingReasons = new Set(['IDENTITY', 'ORIGIN', 'CREDENTIAL', 'CONFIG_SCOPE', 'OWNER', 'TRANSITION', 'RUNTIME']);

export function markSettingsReturnV3Failure(stage: 'resume' | 'acquire' | 'add' | 'add-ui-queue' | 'add-initial-config' | 'add-recheck-config', error: unknown) {
  if (!trace) return;
  const value = error as { code?: unknown; message?: unknown; bindingReason?: unknown } | null;
  const rawCode = value?.code ?? value?.message;
  const code = typeof rawCode === 'string' && v3ErrorCodes.has(rawCode) ? rawCode : 'OTHER';
  const reason = typeof value?.bindingReason === 'string' && v3BindingReasons.has(value.bindingReason)
    ? value.bindingReason : 'UNSPECIFIED';
  trace.mark(`v3.failure.${stage}.${code}.${reason}`);
}

let traceSequence = 0;
let traceTimer: ReturnType<typeof setTimeout> | undefined;

export function beginSettingsReturnQa() {
  if (!trace) return;
  const bridge = (window as Window & {
    ClicPOSAppBridge?: { recordSettingsReturnTrace?: (line: string) => void };
  }).ClicPOSAppBridge;
  if (!bridge?.recordSettingsReturnTrace) {
    trace.mark('settings.close');
    return;
  }
  if (traceTimer !== undefined) clearTimeout(traceTimer);
  const id = ++traceSequence;
  trace.start();
  trace.mark('settings.close');
  traceTimer = setTimeout(() => {
    traceTimer = undefined;
    const report = trace.stop();
    if (!report) return;
    for (const event of report.events) {
      bridge.recordSettingsReturnTrace?.([
        id, event.name, Math.round(event.startMs),
        event.durationMs === undefined ? -1 : Math.round(event.durationMs),
        event.ok === undefined ? -1 : event.ok ? 1 : 0,
        event.query ?? 0,
      ].join(' '));
    }
    bridge.recordSettingsReturnTrace?.([id, 'summary', report.events.length, report.repeatedReads, report.dropped, 0].join(' '));
  }, 12000);
}
