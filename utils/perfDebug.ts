import { useLayoutEffect, useRef } from 'react';

type PerfDetail = Record<string, unknown>;

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'debug']);
const rawPerfFlag = String(import.meta.env?.VITE_POS_PERF_DEBUG || '').trim().toLowerCase();

export const POS_PERF_DEBUG = TRUE_VALUES.has(rawPerfFlag);

let measureId = 0;
let longTaskLoggerStarted = false;
let activeContext: { label: string; detail?: PerfDetail; expiresAt: number } | null = null;
let pendingVisualInteraction: { label: string; detail?: PerfDetail; startedAt: number } | null = null;
const sensitiveKeyPattern = /(customer|client|product|item|warehouse|barcode|code|name|email|phone|address|token|secret|password|ncf|rnc|id|ref)/i;
const safeStringKeys = new Set([
  'label',
  'component',
  'collection',
  'currentView',
  'categoryFilter',
  'method',
  'channel',
  'type',
  'documentType',
  'discountType',
  'adapterType',
  'url',
]);

const hasPerformanceApi = (): boolean =>
  typeof window !== 'undefined' && typeof window.performance !== 'undefined';

const getActiveContext = () => {
  if (!activeContext) return null;
  if (Date.now() > activeContext.expiresAt) {
    activeContext = null;
    return null;
  }
  return activeContext;
};

const sanitizePerfValue = (key: string, value: unknown): unknown => {
  if (value == null) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((entry, index) => sanitizePerfValue(`${key}.${index}`, entry));
  if (typeof value === 'object') {
    const sanitized: PerfDetail = {};
    Object.entries(value as PerfDetail).forEach(([entryKey, entryValue]) => {
      sanitized[entryKey] = sanitizePerfValue(entryKey, entryValue);
    });
    return sanitized;
  }
  if (typeof value === 'string') {
    if (safeStringKeys.has(key)) return value.slice(0, 160);
    if (sensitiveKeyPattern.test(key)) return '[redacted]';
    return value.length > 48 ? `${value.slice(0, 48)}...` : value;
  }
  return String(value);
};

const sanitizePerfPayload = (payload: PerfDetail): PerfDetail => {
  const sanitized: PerfDetail = {};
  Object.entries(payload).forEach(([key, value]) => {
    sanitized[key] = sanitizePerfValue(key, value);
  });
  return sanitized;
};

const logPerf = (label: string, payload: PerfDetail = {}) => {
  if (!POS_PERF_DEBUG) return;
  const sanitizedPayload = sanitizePerfPayload(payload);
  try {
    const bridge = (window as any)?.AndroidPrinter;
    if (bridge && typeof bridge.debugLog === 'function') {
      bridge.debugLog(JSON.stringify({
        tag: 'ClicPOSPerf',
        message: `[POS PERF] ${label}`,
        data: sanitizedPayload,
      }));
    }
  } catch {
    // Native logging is best-effort; console output still works in browser DevTools.
  }
  // eslint-disable-next-line no-console
  console.log(`[POS PERF] ${label}`, sanitizedPayload);
};

export const setPerfContext = (label: string, holdMs = 2500, detail?: PerfDetail) => {
  if (!POS_PERF_DEBUG) return;
  activeContext = {
    label,
    detail,
    expiresAt: Date.now() + holdMs,
  };
};

export const markPerfInteraction = (label: string, holdMs = 3500, detail?: PerfDetail) => {
  if (!POS_PERF_DEBUG || !hasPerformanceApi()) return;
  setPerfContext(label, holdMs, detail);
  pendingVisualInteraction = {
    label,
    detail,
    startedAt: performance.now(),
  };
};

export const perfMark = (name: string, detail?: PerfDetail) => {
  if (!POS_PERF_DEBUG || !hasPerformanceApi()) return;
  performance.mark(name);
  logPerf(`mark:${name}`, { context: getActiveContext(), ...detail });
};

export const measureSync = <T,>(name: string, fn: () => T, detail?: PerfDetail): T => {
  if (!POS_PERF_DEBUG || !hasPerformanceApi()) {
    return fn();
  }

  const id = `${name}:${++measureId}`;
  const start = `${id}:start`;
  const end = `${id}:end`;
  performance.mark(start);

  try {
    return fn();
  } finally {
    performance.mark(end);
    const entry = performance.measure(name, start, end);
    logPerf(name, {
      durationMs: Number(entry.duration.toFixed(2)),
      context: getActiveContext(),
      ...detail,
    });
    performance.clearMarks(start);
    performance.clearMarks(end);
    performance.clearMeasures(name);
  }
};

export const measureAsync = async <T,>(name: string, fn: () => Promise<T>, detail?: PerfDetail): Promise<T> => {
  if (!POS_PERF_DEBUG || !hasPerformanceApi()) {
    return fn();
  }

  const id = `${name}:${++measureId}`;
  const start = `${id}:start`;
  const end = `${id}:end`;
  performance.mark(start);

  try {
    return await fn();
  } finally {
    performance.mark(end);
    const entry = performance.measure(name, start, end);
    logPerf(name, {
      durationMs: Number(entry.duration.toFixed(2)),
      context: getActiveContext(),
      ...detail,
    });
    performance.clearMarks(start);
    performance.clearMarks(end);
    performance.clearMeasures(name);
  }
};

export const initLongTaskLogger = () => {
  if (!POS_PERF_DEBUG || longTaskLoggerStarted || typeof PerformanceObserver === 'undefined') return;
  longTaskLoggerStarted = true;

  try {
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (entry.duration < 50) return;
        logPerf('longtask', {
          durationMs: Number(entry.duration.toFixed(2)),
          startTimeMs: Number(entry.startTime.toFixed(2)),
          context: getActiveContext(),
        });
      });
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch (error) {
    logPerf('longtask.unsupported', { error: error instanceof Error ? error.message : String(error) });
  }
};

export const useRenderPerfDebug = (componentName: string, detail?: PerfDetail) => {
  const renderCountRef = useRef(0);
  const renderStartRef = useRef(0);

  renderCountRef.current += 1;
  if (POS_PERF_DEBUG && hasPerformanceApi()) {
    renderStartRef.current = performance.now();
  }

  useLayoutEffect(() => {
    if (!POS_PERF_DEBUG) return;
    logPerf(`render:${componentName}`, {
      renderCount: renderCountRef.current,
      renderCommitMs: hasPerformanceApi() ? Number((performance.now() - renderStartRef.current).toFixed(2)) : undefined,
      context: getActiveContext(),
      ...detail,
    });
  });
};

export const useVisualUpdatePerfDebug = (componentName: string, detail?: PerfDetail) => {
  useLayoutEffect(() => {
    if (!POS_PERF_DEBUG || !hasPerformanceApi() || !pendingVisualInteraction) return;

    const interaction = pendingVisualInteraction;
    pendingVisualInteraction = null;

    logPerf('visualUpdate', {
      component: componentName,
      interactionLabel: interaction.label,
      durationMs: Number((performance.now() - interaction.startedAt).toFixed(2)),
      interactionDetail: interaction.detail,
      ...detail,
    });
  });
};
