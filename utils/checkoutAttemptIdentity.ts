const STORAGE_KEY = 'clic_checkout_attempt_ids_v1';
const LIMIT = 20;

type AttemptMap = Record<string, string>;

const read = (): AttemptMap => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as AttemptMap : {};
  } catch { return {}; }
};

const write = (map: AttemptMap): void => {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(map)); } catch { /* best effort */ }
};

/**
 * The identity of a checkout attempt must survive a restart: otherwise the retry of a manual
 * payment (cash or card without a Verifón) is seen as another operation and the retained fiscal
 * checkout blocks the sale. It is scoped by the cart content, so a different ticket gets a new id.
 */
export const stableCheckoutAttemptId = (cartKey: string, createId: () => string): string => {
  const key = String(cartKey || '').trim();
  if (!key) return createId();
  const map = read();
  if (typeof map[key] === 'string' && map[key]) return map[key];
  const id = createId();
  const entries = Object.entries(map).slice(-(LIMIT - 1));
  write({ ...Object.fromEntries(entries), [key]: id });
  return id;
};
