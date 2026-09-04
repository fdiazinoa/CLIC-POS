export type PosInteractionOperation =
  | 'PIN_LOGIN'
  | 'PRODUCT_SEARCH_INPUT'
  | 'BARCODE_SCAN'
  | 'ADD_TICKET_ITEM'
  | 'OPEN_TABLE'
  | 'CHANGE_TABLE'
  | 'OPEN_SALE_SCREEN'
  | 'CHECKOUT_OPEN'
  | 'PAYMENT_CONFIRM';

export type PosInteractionStage =
  | 'INPUT_RECEIVED'
  | 'HANDLER_START'
  | 'HANDLER_END'
  | 'STATE_UPDATE'
  | 'RENDER_START'
  | 'RENDER_END'
  | 'SQL_START'
  | 'SQL_END'
  | 'FILTER_START'
  | 'FILTER_END'
  | 'SYNC_START'
  | 'SYNC_END';

export interface PosInteractionTrace {
  id: string;
  operation: PosInteractionOperation;
  startedAt: number;
  stages: Partial<Record<PosInteractionStage, number>>;
  durations: Partial<Record<'handler' | 'render' | 'sql' | 'filter' | 'sync' | 'inputToVisible', number>>;
  renderCount: number;
  allocationsApprox: number;
  metadata?: Record<string, unknown>;
  renderTarget?: string;
}

const MAX_TRACES = 300;
const traces: PosInteractionTrace[] = [];
const pendingByRenderTarget = new Map<string, PosInteractionTrace[]>();
let sequence = 0;

const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
const round = (value: number) => Math.round(value * 100) / 100;

const emit = (trace: PosInteractionTrace, stage: PosInteractionStage) => {
  console.info('[POS_INTERACTION]', JSON.stringify({
    id: trace.id,
    operation: trace.operation,
    stage,
    elapsedMs: round((trace.stages[stage] ?? now()) - trace.startedAt),
    durationsMs: trace.durations,
    renderCount: trace.renderCount,
    allocationsApprox: trace.allocationsApprox,
    metadata: trace.metadata,
  }));
};

const updateDuration = (trace: PosInteractionTrace, stage: PosInteractionStage) => {
  const value = trace.stages[stage];
  if (value === undefined) return;
  const pairs: Array<[PosInteractionStage, keyof PosInteractionTrace['durations']]> = [
    ['HANDLER_END', 'handler'],
    ['RENDER_END', 'render'],
    ['SQL_END', 'sql'],
    ['FILTER_END', 'filter'],
    ['SYNC_END', 'sync'],
  ];
  for (const [endStage, durationName] of pairs) {
    if (stage !== endStage) continue;
    const startStage = endStage.replace('_END', '_START') as PosInteractionStage;
    const start = trace.stages[startStage];
    if (start !== undefined) trace.durations[durationName] = round(value - start);
  }
  if (stage === 'RENDER_END') {
    trace.durations.inputToVisible = round(value - trace.startedAt);
  }
};

export const markInteractionStage = (trace: PosInteractionTrace | null | undefined, stage: PosInteractionStage) => {
  if (!trace) return;
  trace.stages[stage] = now();
  updateDuration(trace, stage);
  emit(trace, stage);
};

export const beginPosInteraction = (
  operation: PosInteractionOperation,
  metadata?: Record<string, unknown>,
): PosInteractionTrace => {
  const startedAt = now();
  const trace: PosInteractionTrace = {
    id: `${operation}-${Date.now()}-${++sequence}`,
    operation,
    startedAt,
    stages: { INPUT_RECEIVED: startedAt, HANDLER_START: startedAt },
    durations: {},
    renderCount: 0,
    allocationsApprox: 0,
    metadata,
  };
  traces.push(trace);
  if (traces.length > MAX_TRACES) traces.splice(0, traces.length - MAX_TRACES);
  emit(trace, 'INPUT_RECEIVED');
  emit(trace, 'HANDLER_START');
  return trace;
};

export const expectInteractionRender = (trace: PosInteractionTrace, renderTarget: string) => {
  trace.renderTarget = renderTarget;
  const pending = pendingByRenderTarget.get(renderTarget) || [];
  pending.push(trace);
  pendingByRenderTarget.set(renderTarget, pending.slice(-20));
};

export const markInteractionStateUpdate = (
  trace: PosInteractionTrace | null | undefined,
  allocationsApprox = 0,
) => {
  if (!trace) return;
  trace.allocationsApprox += Math.max(0, Math.round(allocationsApprox));
  markInteractionStage(trace, 'STATE_UPDATE');
};

export const markRenderStart = (renderTarget: string) => {
  for (const trace of pendingByRenderTarget.get(renderTarget) || []) {
    trace.renderCount += 1;
    if (trace.stages.RENDER_START === undefined) markInteractionStage(trace, 'RENDER_START');
  }
};

export const markRenderEnd = (renderTarget: string) => {
  const pending = pendingByRenderTarget.get(renderTarget) || [];
  if (pending.length === 0) return;
  pendingByRenderTarget.delete(renderTarget);
  window.requestAnimationFrame(() => {
    for (const trace of pending) {
      if (trace.stages.RENDER_END === undefined) markInteractionStage(trace, 'RENDER_END');
    }
  });
};

export const measureInteractionStage = async <T>(
  trace: PosInteractionTrace | null | undefined,
  start: Extract<PosInteractionStage, `${string}_START`>,
  end: Extract<PosInteractionStage, `${string}_END`>,
  work: () => T | Promise<T>,
): Promise<T> => {
  markInteractionStage(trace, start);
  try {
    return await work();
  } finally {
    markInteractionStage(trace, end);
  }
};

const percentile = (values: number[], fraction: number) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]);
};

export const getPosInteractionReport = () => {
  const operations = Array.from(new Set(traces.map(trace => trace.operation)));
  return Object.fromEntries(operations.map(operation => {
    const samples = traces.filter(trace => trace.operation === operation);
    const visible = samples.flatMap(trace => trace.durations.inputToVisible ?? []);
    const filters = samples.flatMap(trace => trace.durations.filter ?? []);
    return [operation, {
      samples: samples.length,
      inputLatencyP50Ms: percentile(visible, 0.5),
      inputLatencyP95Ms: percentile(visible, 0.95),
      inputLatencyP99Ms: percentile(visible, 0.99),
      filterP50Ms: percentile(filters, 0.5),
      rendersPerInput: round(samples.reduce((sum, trace) => sum + trace.renderCount, 0) / Math.max(1, samples.length)),
      allocationsApprox: samples.reduce((sum, trace) => sum + trace.allocationsApprox, 0),
    }];
  }));
};

export const getLatestPosInteraction = (operation: PosInteractionOperation) =>
  [...traces].reverse().find(trace => trace.operation === operation);

declare global {
  interface Window {
    __CLIC_POS_PERFORMANCE__?: {
      getReport: typeof getPosInteractionReport;
      getTraces: () => PosInteractionTrace[];
      clear: () => void;
    };
  }
}

if (typeof window !== 'undefined') {
  window.__CLIC_POS_PERFORMANCE__ = {
    getReport: getPosInteractionReport,
    getTraces: () => traces.map(trace => ({ ...trace, stages: { ...trace.stages }, durations: { ...trace.durations } })),
    clear: () => {
      traces.splice(0, traces.length);
      pendingByRenderTarget.clear();
    },
  };
}
