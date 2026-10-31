const STORAGE_KEY = 'clic_checkout_trace_v1';
const LIMIT = 200;

export type CheckoutTraceKind =
  | 'WAREHOUSE_ALIGNED'
  | 'CART_REANCHORED'
  | 'ATTEMPT_RELEASED'
  | 'ATTEMPT_HELD'
  | 'AMOUNT_CHANGED'
  | 'BOOT_RECONCILED'
  | 'PAYMENT_RESUMED';

export type CheckoutTraceEntry = {
  id: string;
  at: string;
  kind: CheckoutTraceKind;
  detail: string;
  severity: 'INFO' | 'WARNING';
};

const read = (): CheckoutTraceEntry[] => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed)
      ? parsed.filter(row => row && typeof row.at === 'string' && typeof row.detail === 'string')
      : [];
  } catch { return []; }
};

const write = (rows: CheckoutTraceEntry[]): void => {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(rows.slice(0, LIMIT))); } catch { /* best effort */ }
};

/**
 * Local, bounded trace of everything the POS reconciled without asking the cashier.
 * It is the support record behind the silent flow: the ticket never shows this.
 */
export const recordCheckoutTrace = (kind: CheckoutTraceKind, detail: string): void => {
  const text = String(detail || '').trim();
  if (!text) return;
  const entry: CheckoutTraceEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    kind,
    detail: text.slice(0, 400),
    severity: kind === 'ATTEMPT_HELD' || kind === 'AMOUNT_CHANGED' ? 'WARNING' : 'INFO',
  };
  write([entry, ...read()]);
  console.info('[checkout]', kind, text);
};

export const readCheckoutTrace = (): CheckoutTraceEntry[] => read();

export const clearCheckoutTrace = (): void => {
  try { globalThis.localStorage?.removeItem(STORAGE_KEY); } catch { /* best effort */ }
};
