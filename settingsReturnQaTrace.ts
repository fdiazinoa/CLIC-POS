type Event = { name: string; startMs: number; durationMs?: number; ok?: boolean; query?: number };

function createTrace() {
  let run: { started: number; events: Event[]; queries: Map<string, number>; dropped: number } | undefined;
  return {
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

export const markSettingsReturnQa = (name: string) => trace?.mark(name);
export function measureSettingsReturnQa<T>(name: string, operation: () => Promise<T>, sql?: string, values?: unknown) {
  return trace ? trace.measure(name, operation, sql, values) : operation();
}
export const settingsReturnQaEnabled = Boolean(trace);

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
