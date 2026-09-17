/** Opt-in build only. No listeners, storage, field values or permanent timers. */
export type FocusAction = 'default-resume' | 'manual-resume' | 'host-reveal' | 'manual-touch' | 'control';
export type ElementKind = 'receiver' | 'manual' | 'other-editable' | 'body' | 'other';
export type FocusReason = 'mount' | 'click' | 'focus' | 'focusout' | 'focusin' | 'visible' | 'hidden' | 'host-visible' | 'host-hidden' | 'blur' | 'cleanup' | 'other';
export type FocusPoint = 'restore' | 'schedule' | 'cancel' | 'run' | 'focus-total' | 'guards-simple' | 'blocked-query' | 'closest' | 'DOM-focus' | 'manual-pointer' | 'manual-callback' | 'manual-bridge-call-site';
interface Context { doc: Document; input?: HTMLElement | null; reason?: Event | FocusReason; bridgePresent?: boolean }
interface Scope { action: number; actionKind: FocusAction; intent: 'manual' | 'automatic'; point: FocusPoint; reason: FocusReason; startMs: number; active: ElementKind; target: ElementKind; visible: boolean; bridgePresent?: boolean }
export interface FocusRecord extends Scope { endMs: number; durationMs: number; activeAfter?: ElementKind; guardResult?: boolean }
interface Platform { now(): number; timeOrigin: number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void }
const kinds = new Set<FocusReason>(['mount', 'click', 'focus', 'focusout', 'focusin', 'visible', 'hidden', 'host-visible', 'host-hidden', 'blur', 'cleanup']);
const actions = new Set<FocusAction>(['default-resume', 'manual-resume', 'host-reveal', 'manual-touch', 'control']);
function classify(el: HTMLElement | null, doc: Document): ElementKind {
  if (!el || el === doc.body) return 'body';
  if (el.dataset?.posScannerReceiver === 'true') return 'receiver';
  if (el.dataset?.barcodeScannerTarget === 'true') return 'manual';
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable ? 'other-editable' : 'other';
}

export function createScannerFocusCapture(platform: Platform) {
  let records: FocusRecord[] = [];
  let documents = new WeakMap<Scope, Document>();
  let action = 0, details = 0, dropped = 0, deadline = 0;
  let observerErrors = 0;
  let actionKind: FocusAction | undefined;
  let expiry: unknown;
  let armed = false;
  const disarm = () => { armed = false; platform.clearTimeout(expiry); expiry = undefined; };
  const begin = (point: FocusPoint, context: () => Context): Scope | undefined => {
    if (!armed) return;
    if (details >= 64 || records.length >= 512) { dropped++; return; }
    try {
      const startMs = platform.now();
      if (startMs > deadline) { disarm(); return; }
      const { doc, input, reason, bridgePresent } = context();
      const rawReason = typeof reason === 'string' ? reason : reason?.type;
      const scope: Scope = { action, actionKind: actionKind!, intent: point.startsWith('manual-') ? 'manual' : 'automatic', point, reason: kinds.has(rawReason as FocusReason) ? rawReason as FocusReason : 'other',
        startMs, active: classify(doc.activeElement as HTMLElement | null, doc), target: classify(input ?? null, doc),
        visible: doc.visibilityState === 'visible', ...(bridgePresent === undefined ? {} : { bridgePresent }) };
      details++;
      documents.set(scope, doc);
      return scope;
    } catch { observerErrors++; return; } // Observability must never change an operational result.
  };
  const end = (scope: Scope | undefined, guardResult?: boolean) => {
    if (!scope) return;
    try {
      if (!documents.has(scope)) { dropped++; return; }
      const endMs = platform.now();
      if (scope.action !== action || !armed || endMs > deadline || records.length >= 512) { dropped++; return; }
      const doc = documents.get(scope);
      const activeAfter = doc && (scope.point === 'focus-total' || scope.point === 'DOM-focus')
        ? classify(doc.activeElement as HTMLElement | null, doc) : undefined;
      records.push({ ...scope, endMs, durationMs: endMs - scope.startMs,
        ...(activeAfter === undefined ? {} : { activeAfter }), ...(guardResult === undefined ? {} : { guardResult }) });
    } catch { observerErrors++; /* An observer failure cannot replace an operational exception. */ }
  };
  return {
    begin, end,
    point(point: FocusPoint, context: () => Context) { const scope = begin(point, context); end(scope); return scope?.reason; },
    measure<T>(scope: Scope | undefined, point: FocusPoint, operation: () => T): T {
      let child: Scope | undefined;
      if (scope) {
        // Reuse classifications; segment timing must not add another DOM traversal.
        try {
          if (armed && details < 64 && records.length < 512) {
            child = { ...scope, point, startMs: platform.now() }; details++;
            const doc = documents.get(scope); if (doc) documents.set(child, doc);
          }
          else if (armed) dropped++;
        } catch { observerErrors++; /* Still execute operation once. */ }
      }
      let result: T;
      let returned = false;
      try { result = operation(); returned = true; return result; }
      finally { end(child, child && returned && ['guards-simple', 'blocked-query', 'closest'].includes(point) ? Boolean(result!) : undefined); }
    },
    startCapture() { disarm(); records = []; documents = new WeakMap(); action = 0; details = 0; dropped = 0; observerErrors = 0; actionKind = undefined; },
    arm(kind: FocusAction, durationMs = 5000) {
      if (!actions.has(kind) || !Number.isFinite(durationMs) || durationMs <= 0) throw new Error('Invalid diagnostic action');
      disarm(); action++; details = 0; actionKind = kind;
      deadline = platform.now() + Math.min(durationMs, 5000); armed = true;
      expiry = platform.setTimeout(disarm, Math.min(durationMs, 5000));
    },
    disarm,
    snapshot() { return { schemaVersion: 1, diagnostic: true, timeOrigin: platform.timeOrigin, armed, action, actionKind,
      limits: { windowMs: 5000, perAction: 64, perCapture: 512 }, dropped, observerErrors, records: records.map(record => ({ ...record })) }; },
    cleanup() { disarm(); records = []; documents = new WeakMap(); actionKind = undefined; },
  };
}

let capture: ReturnType<typeof createScannerFocusCapture> | undefined;
export function scannerFocusBegin(point: FocusPoint, context: () => Context) { return capture?.begin(point, context); }
export function scannerFocusEnd(scope: Scope | undefined) { capture?.end(scope); }
export function scannerFocusPoint(point: FocusPoint, context: () => Context) { return capture?.point(point, context); }
export function scannerFocusMeasure<T>(scope: Scope | undefined, point: FocusPoint, operation: () => T): T {
  if (!capture) return operation();
  return capture.measure(scope, point, operation);
}
export function installScannerFocusDiagnostics(win: Window) {
  try {
  capture?.cleanup();
  const instance = capture = createScannerFocusCapture({ now: () => win.performance.now(), timeOrigin: win.performance.timeOrigin,
    setTimeout: (fn, ms) => win.setTimeout(fn, ms), clearTimeout: id => win.clearTimeout(id as number) });
  const api = { startCapture: instance.startCapture, arm: instance.arm, disarm: instance.disarm, snapshot: instance.snapshot,
    cleanup() { instance.cleanup(); if (capture === instance) capture = undefined;
      if ((win as any).__CLIC_POS_SCANNER_FOCUS__ === api) delete (win as any).__CLIC_POS_SCANNER_FOCUS__; } };
  Object.defineProperty(win, '__CLIC_POS_SCANNER_FOCUS__', { configurable: true, value: api });
  } catch { capture = undefined; } // Diagnostic installation must not block the app bootstrap.
}
