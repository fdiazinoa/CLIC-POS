import {diagLegacy} from '../diagnostics/runtime';
export type PosInteractionOperation =
  | 'PIN_LOGIN'
  | 'PRODUCT_SEARCH_INPUT'
  | 'BARCODE_SCAN'
  | 'ADD_TICKET_ITEM'
  | 'OPEN_TABLE'
  | 'CHANGE_TABLE'
  | 'CLOSE_TABLE_MAP'
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
  | 'SYNC_END'
  | 'LOCAL_UNLOCK'
  | 'VISUAL_ACK'
  | 'NAVIGATION_START'
  | 'NAVIGATION_END'
  | 'TABLE_MAP_UNMOUNT_START'
  | 'TABLE_MAP_UNMOUNT_END'
  | 'TABLE_MAP_HIDE'
  | 'POS_UPDATE_START'
  | 'POS_UPDATE_END'
  | 'FIRST_FRAME_VISIBLE'
  | 'FIRST_FRAME_INTERACTIVE';

export interface PosInteractionTrace {
  id: string;
  operation: PosInteractionOperation;
  startedAt: number;
  stages: Partial<Record<PosInteractionStage, number>>;
  durations: Partial<Record<'handler' | 'render' | 'sql' | 'filter' | 'sync' | 'navigation' | 'tableMapUnmount' | 'posUpdate' | 'inputToVisible' | 'inputToInteractive' | 'inputToLocalUnlock', number>>;
  renderCount: number;
  allocationsApprox: number;
  metadata?: Record<string, unknown>;
  renderTarget?: string;
  destinationMode?: boolean;
  status: 'pending' | 'completed' | 'cancelled' | 'failed' | 'expired';
  destinationCommitScheduled?: boolean;
  longTasks: Array<{ startMs: number; durationMs: number }>;
  memory: Array<{ stage: PosInteractionStage; usedJsHeapBytes?: number; totalJsHeapBytes?: number }>;
}

const MAX_TRACES = 300;
// Lazy expiry: telemetry never adds an idle timer or cancels business work.
const TRACE_TTL_MS = 60_000;
const MAX_PENDING_EMISSIONS = MAX_TRACES * 32;
const traces: PosInteractionTrace[] = [];
const pendingByRenderTarget = new Map<string, PosInteractionTrace[]>();
let sequence = 0;
let emissionScheduled = false;
const pendingEmissions: Array<{
  trace: PosInteractionTrace;
  stage: PosInteractionStage;
  stageAt: number;
}> = [];

const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
const round = (value: number) => Math.round(value * 100) / 100;
const readMemory = (stage: PosInteractionStage) => {
  if (typeof performance === 'undefined') return { stage };
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number } }).memory;
  return {
    stage,
    usedJsHeapBytes: memory?.usedJSHeapSize,
    totalJsHeapBytes: memory?.totalJSHeapSize,
  };
};

const flushEmissions = () => {
  emissionScheduled = false;
  const emissions = pendingEmissions.splice(0, pendingEmissions.length);
  for (const { trace, stage, stageAt } of emissions) {
    console.info('[POS_INTERACTION]', JSON.stringify({
      id: trace.id,
      operation: trace.operation,
      stage,
      elapsedMs: round(stageAt - trace.startedAt),
      durationsMs: trace.durations,
      renderCount: trace.renderCount,
      allocationsApprox: trace.allocationsApprox,
      metadata: trace.metadata,
    }));
  }
};

const emit = (trace: PosInteractionTrace, stage: PosInteractionStage) => {
  pendingEmissions.push({ trace, stage, stageAt: trace.stages[stage] ?? now() });
  if (pendingEmissions.length > MAX_PENDING_EMISSIONS) pendingEmissions.splice(0, pendingEmissions.length - MAX_PENDING_EMISSIONS);
  if (emissionScheduled) return;
  emissionScheduled = true;
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(flushEmissions, { timeout: 2000 });
    return;
  }
  setTimeout(flushEmissions, 500);
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
    ['NAVIGATION_END', 'navigation'],
    ['TABLE_MAP_UNMOUNT_END', 'tableMapUnmount'],
    ['POS_UPDATE_END', 'posUpdate'],
  ];
  for (const [endStage, durationName] of pairs) {
    if (stage !== endStage) continue;
    const startStage = endStage.replace('_END', '_START') as PosInteractionStage;
    const start = trace.stages[startStage];
    if (start !== undefined) trace.durations[durationName] = round(value - start);
  }
  if (stage === 'FIRST_FRAME_VISIBLE' || (stage === 'RENDER_END' && trace.stages.FIRST_FRAME_VISIBLE === undefined)) {
    trace.durations.inputToVisible = round(value - trace.startedAt);
  }
  if (stage === 'FIRST_FRAME_INTERACTIVE') {
    trace.durations.inputToInteractive = round(value - trace.startedAt);
  }
  if (stage === 'LOCAL_UNLOCK') {
    trace.durations.inputToLocalUnlock = round(value - trace.startedAt);
  }
};

export const markInteractionStage = (trace: PosInteractionTrace | null | undefined, stage: PosInteractionStage) => {
  // Legacy traces may still record deferred sync/SQL after their visual marker.
  // Destination traces, unlike those legacy samples, have a terminal lifetime.
  if (!trace || (trace.destinationMode ? !isInteractionPending(trace) : !traces.includes(trace))) return;
  diagLegacy(trace.operation, stage, trace.metadata);
  // The acceptance metric is time to the first visible response. A later state
  // update or render must never replace the first marker and inflate the result.
  if (trace.stages[stage] !== undefined) return;
  trace.stages[stage] = now();
  if (stage === 'INPUT_RECEIVED' || stage === 'FIRST_FRAME_VISIBLE' || stage === 'FIRST_FRAME_INTERACTIVE') {
    trace.memory.push(readMemory(stage));
  }
  updateDuration(trace, stage);
  emit(trace, stage);
};

export const beginPosInteraction = (
  operation: PosInteractionOperation,
  metadata?: Record<string, unknown>,
  inputStartedAt?: number,
): PosInteractionTrace => {
  const handlerStartedAt = now();
  pruneInteractions();
  const inputBoundaryValidated = inputStartedAt !== undefined && Number.isFinite(inputStartedAt)
    && inputStartedAt >= 0 && inputStartedAt <= handlerStartedAt && handlerStartedAt - inputStartedAt < 60_000
    ;
  const startedAt = inputBoundaryValidated ? inputStartedAt! : handlerStartedAt;
  const trace: PosInteractionTrace = {
    id: `${operation}-${Date.now()}-${++sequence}`,
    operation,
    startedAt,
    status: 'pending',
    stages: { INPUT_RECEIVED: startedAt, HANDLER_START: handlerStartedAt },
    durations: {},
    renderCount: 0,
    allocationsApprox: 0,
    metadata: metadata?.measurementBoundary === 'authorized-input-to-destination'
      ? { ...metadata, inputBoundaryValidated, inputBoundarySource: inputBoundaryValidated ? 'authorized-last-pin' : 'handler-fallback', longTaskAttributionWindowMs: 10_000 }
      : metadata,
    longTasks: [],
    memory: [readMemory('INPUT_RECEIVED')],
  };
  traces.push(trace);
  while (traces.length > MAX_TRACES) {
    const oldest = traces[0];
    finishInteraction(oldest, 'expired');
    traces.shift();
  }
  emit(trace, 'INPUT_RECEIVED');
  emit(trace, 'HANDLER_START');
  return trace;
};

export const expectInteractionRender = (trace: PosInteractionTrace, renderTarget: string) => {
  if (!isInteractionPending(trace) || trace.destinationMode) return;
  // Keep the first requested visual target. Some flows continue toward a second
  // screen, but the interaction has already responded visibly by then.
  if (trace.renderTarget) return;
  trace.renderTarget = renderTarget;
  const pending = pendingByRenderTarget.get(renderTarget) || [];
  pending.push(trace);
  pendingByRenderTarget.set(renderTarget, pending.slice(-20));
};

const removePending = (trace: PosInteractionTrace) => {
  for (const [target, pending] of pendingByRenderTarget) {
    const remaining = pending.filter(candidate => candidate !== trace);
    if (remaining.length) pendingByRenderTarget.set(target, remaining);
    else pendingByRenderTarget.delete(target);
  }
};

export const finishInteraction = (
  trace: PosInteractionTrace | null | undefined,
  status: Exclude<PosInteractionTrace['status'], 'pending'>,
) => {
  if (!trace || trace.status !== 'pending') return;
  trace.status = status;
  removePending(trace);
};

const pruneInteractions = () => {
  for (const trace of traces) {
    if (trace.status === 'pending' && now() - trace.startedAt >= TRACE_TTL_MS) finishInteraction(trace, 'expired');
  }
};

export const isInteractionPending = (trace: PosInteractionTrace | null | undefined): trace is PosInteractionTrace => {
  if (!trace || !traces.includes(trace) || trace.status !== 'pending') return false;
  if (now() - trace.startedAt >= TRACE_TTL_MS) finishInteraction(trace, 'expired');
  return trace.status === 'pending';
};

/** Only this trace's owner can acknowledge its final destination. */
export const beginDestinationInteraction = (
  operation: PosInteractionOperation,
  inputTimeStamp?: number,
  previous?: PosInteractionTrace | null,
) => {
  finishInteraction(previous, 'cancelled');
  const trace = beginPosInteraction(operation, { measurementBoundary: 'authorized-input-to-destination' }, inputTimeStamp);
  trace.destinationMode = true;
  trace.metadata = { ...trace.metadata, inputBoundarySource: trace.metadata?.inputBoundaryValidated ? 'event-timeStamp' : 'handler-fallback' };
  return trace;
};

export const expectInteractionDestination = (trace: PosInteractionTrace | null | undefined, target: string) => {
  if (!isInteractionPending(trace) || !trace.destinationMode || trace.renderTarget) return;
  trace.renderTarget = target;
};

export const commitInteractionDestination = (
  trace: PosInteractionTrace | null | undefined,
  target: string,
  onInteractive?: () => void,
  isCurrent?: () => boolean,
) => {
  if (isInteractionPending(trace) && trace.destinationMode && trace.renderTarget === target && !trace.destinationCommitScheduled) {
    trace.destinationCommitScheduled = true;
    trace.renderCount += 1;
    markInteractionStage(trace, 'RENDER_END');
    markInteractionVisibleAndInteractive(trace, onInteractive, isCurrent);
  } else if (onInteractive) {
    // Functional transition completion must not depend on telemetry lifetime.
    markInteractionVisibleAndInteractive(null, onInteractive);
  }
};

/** Observes an existing async flow; never changes its result or error. */
export const observeDestinationAttempt = async <T>(trace: PosInteractionTrace, work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    finishInteraction(trace, 'failed');
    throw error;
  } finally {
    markInteractionStage(trace, 'HANDLER_END');
    if (!trace.renderTarget) finishInteraction(trace, 'cancelled');
  }
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
  pruneInteractions();
  for (const trace of pendingByRenderTarget.get(renderTarget) || []) {
    trace.renderCount += 1;
    if (trace.stages.RENDER_START === undefined) markInteractionStage(trace, 'RENDER_START');
  }
};

export const markRenderEnd = (renderTarget: string) => {
  pruneInteractions();
  const pending = pendingByRenderTarget.get(renderTarget) || [];
  if (pending.length === 0) return;
  pendingByRenderTarget.delete(renderTarget);
  const destination = pending.filter(trace => trace.metadata?.measurementBoundary === 'authorized-input-to-destination');
  for (const trace of destination) {
    markInteractionStage(trace, 'RENDER_END');
    markInteractionVisibleAndInteractive(trace);
  }
  const legacy = pending.filter(trace => !destination.includes(trace));
  if (legacy.length === 0) return;
  window.requestAnimationFrame(() => {
    for (const trace of legacy) {
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
  pruneInteractions();
  const operations = Array.from(new Set(traces.map(trace => trace.operation)));
  return Object.fromEntries(operations.map(operation => {
    const samples = traces.filter(trace => trace.operation === operation);
    const measured = samples.filter(trace => (!trace.destinationMode || trace.status === 'completed') && (trace.metadata?.measurementBoundary !== 'authorized-input-to-destination' || trace.metadata.inputBoundaryValidated === true));
    const visible = measured.flatMap(trace => trace.metadata?.measurementBoundary === 'authorized-input-to-destination'
      && trace.stages.FIRST_FRAME_VISIBLE === undefined ? [] : trace.durations.inputToVisible ?? []);
    const interactive = measured.flatMap(trace => trace.durations.inputToInteractive ?? []);
    const filters = samples.flatMap(trace => trace.durations.filter ?? []);
    const localUnlocks = samples.flatMap(trace => trace.durations.inputToLocalUnlock ?? []);
    return [operation, {
      samples: samples.length,
      invalidInputBoundarySamples: samples.filter(trace => trace.metadata?.measurementBoundary === 'authorized-input-to-destination' && trace.metadata.inputBoundaryValidated !== true).length,
      terminatedWithoutDestinationSamples: samples.filter(trace => trace.destinationMode && !['pending', 'completed'].includes(trace.status)).length,
      longTaskAttributionTruncatedSamples: samples.filter(trace => trace.metadata?.longTaskAttributionTruncated).length,
      visibleSamples: visible.length,
      interactiveSamples: interactive.length,
      markerSemantics: 'FIRST_FRAME_VISIBLE=rAF prepaint proxy; FIRST_FRAME_INTERACTIVE=next-task proxy; legacy RENDER_END=rAF commit proxy. None is DisplayPresent or measured input responsiveness.',
      destinations: Object.fromEntries([...new Set(samples.filter(trace => trace.destinationMode).map(trace => trace.renderTarget || 'unresolved'))].map(target => {
        const destinationSamples = samples.filter(trace => trace.destinationMode && (trace.renderTarget || 'unresolved') === target);
        const completed = destinationSamples.filter(trace => trace.status === 'completed');
        return [target, {
          samples: destinationSamples.length,
          completed: completed.length,
          handlerToDestinationP95Ms: percentile(completed.flatMap(trace => trace.stages.FIRST_FRAME_INTERACTIVE === undefined ? [] : trace.stages.FIRST_FRAME_INTERACTIVE - trace.stages.HANDLER_START!), 0.95),
          inputToDestinationP95Ms: percentile(completed.flatMap(trace => trace.metadata?.inputBoundaryValidated ? trace.durations.inputToInteractive ?? [] : []), 0.95),
        }];
      })),
      inputLatencyP50Ms: percentile(visible, 0.5),
      inputLatencyP95Ms: percentile(visible, 0.95),
      inputLatencyP99Ms: percentile(visible, 0.99),
      inputToInteractiveP50Ms: percentile(interactive, 0.5),
      inputToInteractiveP95Ms: percentile(interactive, 0.95),
      inputToInteractiveP99Ms: percentile(interactive, 0.99),
      localUnlockP50Ms: percentile(localUnlocks, 0.5),
      localUnlockP95Ms: percentile(localUnlocks, 0.95),
      localUnlockP99Ms: percentile(localUnlocks, 0.99),
      filterP50Ms: percentile(filters, 0.5),
      rendersPerInput: round(samples.reduce((sum, trace) => sum + trace.renderCount, 0) / Math.max(1, samples.length)),
      allocationsApprox: samples.reduce((sum, trace) => sum + trace.allocationsApprox, 0),
    }];
  }));
};

export const getLatestPosInteraction = (operation: PosInteractionOperation) =>
  [...traces].reverse().find(trace => trace.operation === operation);

export const markInteractionVisibleAndInteractive = (
  trace: PosInteractionTrace | null | undefined,
  onInteractive?: () => void,
  isCurrent?: () => boolean,
) => {
  if (typeof window === 'undefined') { onInteractive?.(); return; }
  window.requestAnimationFrame(() => {
    if (isCurrent && !isCurrent()) finishInteraction(trace, 'cancelled');
    markInteractionStage(trace, 'VISUAL_ACK');
    markInteractionStage(trace, 'FIRST_FRAME_VISIBLE');
    // The DOM has committed and the frame is ready to paint. Probe the next
    // task instead of waiting another display frame; event handlers are ready
    // as soon as control returns to the browser event loop.
    window.setTimeout(() => {
      if (isCurrent && !isCurrent()) finishInteraction(trace, 'cancelled');
      markInteractionStage(trace, 'FIRST_FRAME_INTERACTIVE');
      if (trace?.destinationMode) finishInteraction(trace, 'completed');
      onInteractive?.();
    }, 0);
  });
};

if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
  try {
    new PerformanceObserver(list => {
      const active = traces.filter(trace => {
        if (trace.destinationMode && !['pending', 'completed'].includes(trace.status)) return false;
        if (!['CLOSE_TABLE_MAP', 'OPEN_SALE_SCREEN', 'OPEN_TABLE', 'CHANGE_TABLE'].includes(trace.operation)) return false;
        const completion = trace.stages.FIRST_FRAME_INTERACTIVE ?? (trace.metadata?.measurementBoundary === 'authorized-input-to-destination' ? undefined : trace.stages.RENDER_END);
        if (completion !== undefined) return true; // observer delivery may follow the completion marker
        if (now() - trace.startedAt < 10_000) return true;
        trace.metadata = { ...trace.metadata, longTaskAttributionTruncated: true };
        return false;
      });
      for (const entry of list.getEntries()) {
        for (const trace of active) {
          const completion = trace.stages.FIRST_FRAME_INTERACTIVE ?? (trace.metadata?.measurementBoundary === 'authorized-input-to-destination' ? undefined : trace.stages.RENDER_END);
          if (entry.startTime + entry.duration < trace.startedAt || (completion !== undefined && entry.startTime > completion)) continue;
          trace.longTasks.push({ startMs: round(entry.startTime - trace.startedAt), durationMs: round(entry.duration) });
          if (trace.longTasks.length > 50) trace.longTasks.splice(0, trace.longTasks.length - 50);
        }
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    // Capability is optional on older Android WebViews.
  }
}

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
    getTraces: () => traces.map(trace => ({ ...trace, stages: { ...trace.stages }, durations: { ...trace.durations }, longTasks: [...trace.longTasks], memory: [...trace.memory] })),
    clear: () => {
      for (const trace of traces) finishInteraction(trace, 'cancelled');
      traces.splice(0, traces.length);
      pendingByRenderTarget.clear();
      pendingEmissions.splice(0, pendingEmissions.length);
    },
  };
}
