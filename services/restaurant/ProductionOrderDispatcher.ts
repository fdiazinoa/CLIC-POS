import type { CartItem } from '../../types';
import { db } from '../../utils/db';
import {
  dispatchLegacyLanMutation,
  persistLegacyLanMutationCompletion,
  validateLegacySuccessResponse,
  type LegacyLanMutationReceipt,
} from '../sync/LegacyLanMutationTransport';

const QUEUE_COLLECTION = 'kdsDispatchQueue' as any;
const PRINT_QUEUE_COLLECTION = 'productionPrintQueue' as any;

export type ProductionDispatchPayload = {
  orderId: string;
  displayId?: string;
  orderNumber?: string;
  date: string;
  terminalId: string;
  sourceTerminal?: Record<string, unknown>;
  userName: string;
  customerName: string;
  serviceType?: 'DINE_IN' | 'TAKEOUT' | 'DELIVERY';
  table?: Record<string, unknown> | null;
  area: {
    id: string;
    name: string;
    targetTerminalId?: string | null;
    targetTerminalName?: string | null;
    warningMinutes?: number;
    criticalMinutes?: number;
  };
  kdsTiming?: { warningMinutes: number; criticalMinutes: number };
  items: Array<Record<string, unknown>>;
  total: number;
};

export type ProductionDispatchIntent = {
  id: string;
  status: 'PENDING';
  phase: 'DISPATCH_PENDING' | 'UPDATE_PENDING';
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  nextRetryAt?: string;
  kdsBaseUrl?: string;
  orderId: string;
  areaId: string;
  areaName: string;
  cartIds: string[];
  payload: ProductionDispatchPayload;
};

export type ProductionDispatchResult = {
  intent: ProductionDispatchIntent;
  status: 'SENT' | 'PENDING';
  error?: string;
};

export type ProductionPrintIntent = {
  id: string;
  status: 'PENDING' | 'OUTCOME_UNKNOWN';
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  nextRetryAt?: string;
  orderId: string;
  areaId: string;
  areaName: string;
  cartIds: string[];
  orderNumber?: string;
  customerName?: string;
  items: CartItem[];
  printerId?: string;
};

const normalizedIdentityPart = (value: unknown): string =>
  encodeURIComponent(String(value ?? '').trim().toLowerCase());

export const createSerializedCollectionMutator = () => {
  let tail: Promise<unknown> = Promise.resolve();
  return async <T>(mutation: () => Promise<T>): Promise<T> => {
    const run = tail.then(mutation, mutation);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
};

const mutateProductionQueues = createSerializedCollectionMutator();

export const calculateProductionNextRetryAt = (
  attempts: number,
  nowMs = Date.now(),
): string => new Date(nowMs + Math.min(5 * 60_000, 5_000 * (2 ** Math.min(6, Math.max(0, attempts - 1))))).toISOString();

export const isProductionRetryDue = (
  intent: Pick<ProductionDispatchIntent, 'nextRetryAt'>,
  nowMs = Date.now(),
): boolean => !intent.nextRetryAt || Date.parse(intent.nextRetryAt) <= nowMs;

export const getProductionCartIdentity = (item: Pick<CartItem, 'id' | 'cartId'>): string =>
  String(item.cartId || item.id || '').trim();

export const buildProductionDispatchIntentId = (
  orderId: string,
  areaId: string,
  cartIds: string[],
): string => {
  const lines = Array.from(new Set(cartIds.map((id) => String(id).trim()).filter(Boolean))).sort();
  return `kds:${normalizedIdentityPart(orderId)}:${normalizedIdentityPart(areaId)}:${lines.map(normalizedIdentityPart).join(',')}`;
};

const readQueue = async (): Promise<ProductionDispatchIntent[]> => {
  const stored = await db.get(QUEUE_COLLECTION).catch(() => []);
  if (!Array.isArray(stored)) return [];
  return stored.map((entry: any) => {
    const payload = entry?.payload || {};
    const orderId = String(entry?.orderId || payload?.orderId || '').trim();
    const areaId = String(entry?.areaId || payload?.area?.id || '').trim();
    const cartIds = Array.isArray(entry?.cartIds) ? entry.cartIds.map(String) : [];
    return {
      ...entry,
      id: String(entry?.id || buildProductionDispatchIntentId(orderId, areaId, cartIds)),
      status: 'PENDING',
      phase: entry?.phase === 'UPDATE_PENDING' ? 'UPDATE_PENDING' : 'DISPATCH_PENDING',
      attempts: Number(entry?.attempts || 0),
      createdAt: entry?.createdAt || new Date().toISOString(),
      updatedAt: entry?.updatedAt || new Date().toISOString(),
      orderId,
      areaId,
      areaName: String(entry?.areaName || payload?.area?.name || areaId),
      cartIds,
      payload,
    } as ProductionDispatchIntent;
  }).filter((entry) => Boolean(entry.orderId && entry.areaId));
};

export const mergeProductionDispatchIntent = (
  existing: ProductionDispatchIntent,
  incoming: ProductionDispatchIntent,
): ProductionDispatchIntent => ({
  ...existing,
  ...incoming,
  createdAt: existing.createdAt,
  attempts: Math.max(Number(existing.attempts || 0), Number(incoming.attempts || 0)),
  phase: existing.phase === 'UPDATE_PENDING' || incoming.phase === 'UPDATE_PENDING'
    ? 'UPDATE_PENDING'
    : 'DISPATCH_PENDING',
});

const saveIntent = async (intent: ProductionDispatchIntent): Promise<void> => {
  await mutateProductionQueues(async () => {
    const queue = await readQueue();
    const existing = queue.find((entry) => entry.id === intent.id);
    const next = existing
      ? queue.map((entry) => entry.id === intent.id
        ? mergeProductionDispatchIntent(existing, intent)
        : entry)
      : [...queue, intent];
    await db.save(QUEUE_COLLECTION, next);
  });
};

const removeIntent = async (intentId: string): Promise<void> => {
  await mutateProductionQueues(async () => {
    const queue = await readQueue();
    await db.save(QUEUE_COLLECTION, queue.filter((entry) => entry.id !== intentId));
  });
};

export const createProductionDispatchIntent = (input: {
  kdsBaseUrl?: string;
  cartIds: string[];
  payload: ProductionDispatchPayload;
}): ProductionDispatchIntent => {
  const now = new Date().toISOString();
  const areaId = String(input.payload.area.id || '').trim();
  const cartIds = Array.from(new Set(input.cartIds.map((id) => String(id).trim()).filter(Boolean))).sort();
  return {
    id: buildProductionDispatchIntentId(input.payload.orderId, areaId, cartIds),
    status: 'PENDING',
    phase: 'DISPATCH_PENDING',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    kdsBaseUrl: String(input.kdsBaseUrl || '').trim().replace(/\/+$/, '') || undefined,
    orderId: input.payload.orderId,
    areaId,
    areaName: input.payload.area.name,
    cartIds,
    payload: input.payload,
  };
};

export const buildProductionDispatchRequests = (intent: ProductionDispatchIntent) => ({
  update: {
    method: 'PUT' as const,
    url: `${intent.kdsBaseUrl}/api/ordenes/${encodeURIComponent(intent.orderId)}`,
    operation: 'KDS_ORDER_UPDATE',
    body: {
      items: intent.payload.items,
      total: intent.payload.total,
      status: 'OCCUPIED',
      displayId: intent.payload.displayId,
      orderNumber: intent.payload.orderNumber,
      terminalId: intent.payload.terminalId,
      userName: intent.payload.userName,
      customerName: intent.payload.customerName,
      serviceType: intent.payload.serviceType,
      table: intent.payload.table,
      area: intent.payload.area,
      sourceTerminal: intent.payload.sourceTerminal,
      kdsTiming: intent.payload.kdsTiming,
    },
  },
  dispatch: {
    method: 'POST' as const,
    url: `${intent.kdsBaseUrl}/api/ordenes/enviar-comanda/${encodeURIComponent(intent.orderId)}`,
    operation: 'KDS_ORDER_DISPATCH',
    body: intent.payload,
  },
});

type ProductionRequests = ReturnType<typeof buildProductionDispatchRequests>;
export type ProductionRequest = ProductionRequests[keyof ProductionRequests];
export type ProductionDispatchOperations = {
  update: 'KDS_ORDER_UPDATE' | 'KDS_ORDER_UPDATE_RETRY';
  dispatch: 'KDS_ORDER_DISPATCH' | 'KDS_ORDER_DISPATCH_RETRY';
};

const DEFAULT_OPERATIONS: ProductionDispatchOperations = {
  update: 'KDS_ORDER_UPDATE',
  dispatch: 'KDS_ORDER_DISPATCH',
};

const requestIntentJson = async (
  intent: ProductionDispatchIntent,
  request: ProductionRequest,
  operation: ProductionDispatchOperations[keyof ProductionDispatchOperations],
): Promise<LegacyLanMutationReceipt<any>> => dispatchLegacyLanMutation<any>({
  url: request.url,
  method: request.method,
  headers: {
    'Content-Type': 'application/json',
    'X-Idempotency-Key': `${intent.id}:${request.operation}`,
  },
  body: JSON.stringify(request.body),
  timeoutMs: 5000,
  operation,
  correlationId: `${intent.id}:${operation}`,
  validateResponse: validateLegacySuccessResponse,
  // Both KDS endpoints upsert deterministic order/line identities. Closing an
  // ambiguous journal row is safe because the durable phase can replay it.
  idempotentReplaySafe: true,
});

type ProductionAttemptReceipt = Pick<LegacyLanMutationReceipt<any>, 'correlationId' | 'response' | 'completeAfterDurableCommit'>;

const acknowledgeProductionReceipt = async (
  receipt: ProductionAttemptReceipt | void,
  reference: string,
): Promise<void> => {
  if (!receipt) return;
  const durableReference = receipt.response.ok
    ? reference
    : `${reference}:retryable:${receipt.response.status}`;
  await receipt.completeAfterDurableCommit(durableReference, () =>
    persistLegacyLanMutationCompletion(
      receipt.correlationId,
      durableReference,
      receipt.response.status,
    ));
  if (!receipt.response.ok) {
    throw Object.assign(
      new Error(`PRODUCTION_DELIVERY_REJECTED:${receipt.response.status}`),
      { httpStatus: receipt.response.status },
    );
  }
};

export const runProductionDispatchAttempt = async (
  intent: ProductionDispatchIntent,
  request: (request: ProductionRequest) => Promise<ProductionAttemptReceipt | void>,
  checkpoint: (intent: ProductionDispatchIntent) => Promise<void>,
): Promise<ProductionDispatchIntent> => {
  const requests = buildProductionDispatchRequests(intent);
  let current = intent;
  try {
    // The direct-payload KDS endpoint upserts deterministic line identities.
    // Dispatch first so an ambiguous metadata PUT can never prevent kitchen delivery.
    if (current.phase === 'DISPATCH_PENDING') {
      const dispatchReceipt = await request(requests.dispatch);
      await acknowledgeProductionReceipt(dispatchReceipt, `KDS:dispatch:${intent.id}`);
      current = { ...current, phase: 'UPDATE_PENDING', updatedAt: new Date().toISOString() };
      await checkpoint(current);
    }
    const updateReceipt = await request(requests.update);
    await acknowledgeProductionReceipt(updateReceipt, `KDS:update:${intent.id}`);
    return current;
  } catch (error) {
    const failure = error instanceof Error ? error : new Error('KDS_UNREACHABLE');
    throw Object.assign(failure, { productionIntent: current });
  }
};

/**
 * Persists the deterministic dispatch intent before any LAN request. Payment is
 * deliberately outside this service, so a retry can only resend the kitchen
 * order and can never re-run a charge.
 */
export const dispatchProductionOrder = async (
  intent: ProductionDispatchIntent,
  operations: ProductionDispatchOperations = DEFAULT_OPERATIONS,
  dependencies?: {
    save: (intent: ProductionDispatchIntent) => Promise<void>;
    remove: (intentId: string) => Promise<void>;
    request: (
      intent: ProductionDispatchIntent,
      request: ProductionRequest,
      operation: ProductionDispatchOperations[keyof ProductionDispatchOperations],
    ) => Promise<ProductionAttemptReceipt>;
  },
): Promise<ProductionDispatchResult> => {
  const persist = dependencies?.save || saveIntent;
  const remove = dependencies?.remove || removeIntent;
  const request = dependencies?.request || requestIntentJson;
  await persist(intent);
  if (!intent.kdsBaseUrl) {
    const pending = {
      ...intent,
      attempts: Number(intent.attempts || 0) + 1,
      nextRetryAt: calculateProductionNextRetryAt(Number(intent.attempts || 0) + 1),
      updatedAt: new Date().toISOString(),
      lastError: 'KDS_HOST_NOT_CONFIGURED',
    };
    await persist(pending);
    return { intent: pending, status: 'PENDING', error: pending.lastError };
  }

  try {
    await runProductionDispatchAttempt(
      intent,
      (productionRequest) => request(
        intent,
        productionRequest,
        productionRequest.method === 'POST' ? operations.dispatch : operations.update,
      ),
      persist,
    );
    await remove(intent.id);
    return { intent, status: 'SENT' };
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'KDS_UNREACHABLE';
    const attempted = error?.productionIntent || intent;
    const pending: ProductionDispatchIntent = {
      ...attempted,
      status: 'PENDING',
      attempts: Number(attempted.attempts || 0) + 1,
      nextRetryAt: calculateProductionNextRetryAt(Number(attempted.attempts || 0) + 1),
      lastError: message,
      updatedAt: new Date().toISOString(),
    };
    await persist(pending);
    return { intent: pending, status: 'PENDING', error: message };
  }
};

export const retryPendingProductionOrders = async (
  operations: ProductionDispatchOperations = DEFAULT_OPERATIONS,
): Promise<ProductionDispatchResult[]> => {
  if (retryInFlight) return [];
  retryInFlight = true;
  try {
    const queue = await mutateProductionQueues(readQueue);
    const results: ProductionDispatchResult[] = [];
    for (const intent of queue.filter((entry) => isProductionRetryDue(entry))) {
      results.push(await dispatchProductionOrder(intent, operations));
    }
    return results;
  } finally {
    retryInFlight = false;
  }
};

let retryInFlight = false;

const readPrintQueue = async (): Promise<ProductionPrintIntent[]> => {
  const stored = await db.get(PRINT_QUEUE_COLLECTION).catch(() => []);
  return Array.isArray(stored) ? stored as ProductionPrintIntent[] : [];
};

const savePrintIntent = async (intent: ProductionPrintIntent): Promise<void> => {
  await mutateProductionQueues(async () => {
    const queue = await readPrintQueue();
    const existing = queue.find((entry) => entry.id === intent.id);
    const nextIntent = existing ? {
      ...existing,
      ...intent,
      createdAt: existing.createdAt,
      attempts: Math.max(Number(existing.attempts || 0), Number(intent.attempts || 0)),
    } : intent;
    await db.save(PRINT_QUEUE_COLLECTION, existing
      ? queue.map((entry) => entry.id === intent.id ? nextIntent : entry)
      : [...queue, nextIntent]);
  });
};

const removePrintIntent = async (intentId: string): Promise<void> => {
  await mutateProductionQueues(async () => {
    const queue = await readPrintQueue();
    await db.save(PRINT_QUEUE_COLLECTION, queue.filter((entry) => entry.id !== intentId));
  });
};

export const createProductionPrintIntent = (input: Omit<ProductionPrintIntent, 'id' | 'status' | 'attempts' | 'createdAt' | 'updatedAt'>): ProductionPrintIntent => {
  const now = new Date().toISOString();
  const cartIds = Array.from(new Set(input.cartIds.map(String).filter(Boolean))).sort();
  return {
    ...input,
    id: `print:${buildProductionDispatchIntentId(input.orderId, input.areaId, cartIds)}`,
    status: 'PENDING',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    cartIds,
  };
};

export const isProductionPrintAutoRetryEligible = (intent: ProductionPrintIntent): boolean =>
  intent.status === 'PENDING' && isProductionRetryDue(intent);

export const listAmbiguousProductionPrints = async (): Promise<ProductionPrintIntent[]> =>
  mutateProductionQueues(async () => (await readPrintQueue()).filter((intent) => intent.status === 'OUTCOME_UNKNOWN'));

export const applyProductionPrintReconciliation = (
  intent: ProductionPrintIntent,
  resolution: 'CONFIRMED_PRINTED' | 'CONFIRMED_NOT_PRINTED',
  now = new Date(),
): ProductionPrintIntent | null => resolution === 'CONFIRMED_PRINTED' ? null : {
  ...intent,
  status: 'PENDING',
  nextRetryAt: now.toISOString(),
  lastError: 'PRODUCTION_PRINT_OPERATOR_CONFIRMED_NOT_PRINTED',
  updatedAt: now.toISOString(),
};

export const resolveAmbiguousProductionPrint = async (
  intentId: string,
  resolution: 'CONFIRMED_PRINTED' | 'CONFIRMED_NOT_PRINTED',
): Promise<ProductionPrintIntent | null> => {
  if (resolution === 'CONFIRMED_PRINTED') {
    await removePrintIntent(intentId);
    return null;
  }
  return mutateProductionQueues(async () => {
    const queue = await readPrintQueue();
    const current = queue.find((intent) => intent.id === intentId);
    if (!current || current.status !== 'OUTCOME_UNKNOWN') return null;
    const reconciled = applyProductionPrintReconciliation(current, resolution);
    if (!reconciled) return null;
    await db.save(PRINT_QUEUE_COLLECTION, queue.map((intent) => intent.id === intentId ? reconciled : intent));
    return reconciled;
  });
};

export const runProductionPrintAttempt = async (
  intent: ProductionPrintIntent,
  print: (intent: ProductionPrintIntent) => Promise<boolean>,
  checkpoint: (intent: ProductionPrintIntent) => Promise<void>,
): Promise<{ intent: ProductionPrintIntent; status: 'PRINTED' | 'PENDING' | 'OUTCOME_UNKNOWN'; error?: string }> => {
  // Persist ambiguity before handing bytes to the printer. A crash, timeout or
  // late transport completion must require reconciliation instead of duplicating paper.
  const inFlight: ProductionPrintIntent = {
    ...intent,
    status: 'OUTCOME_UNKNOWN',
    attempts: Number(intent.attempts || 0) + 1,
    updatedAt: new Date().toISOString(),
    lastError: 'PRODUCTION_PRINT_OUTCOME_UNKNOWN',
  };
  await checkpoint(inFlight);
  try {
    if (await print(inFlight)) return { intent: inFlight, status: 'PRINTED' };
    const unknown = {
      ...inFlight,
      lastError: 'PRODUCTION_PRINT_OUTCOME_UNKNOWN',
      updatedAt: new Date().toISOString(),
    };
    await checkpoint(unknown);
    return { intent: unknown, status: 'OUTCOME_UNKNOWN', error: unknown.lastError };
  } catch (error) {
    const unknown = {
      ...inFlight,
      lastError: error instanceof Error ? error.message : 'PRODUCTION_PRINT_OUTCOME_UNKNOWN',
      updatedAt: new Date().toISOString(),
    };
    await checkpoint(unknown);
    return { intent: unknown, status: 'OUTCOME_UNKNOWN', error: unknown.lastError };
  }
};

export const dispatchProductionPrint = async (
  intent: ProductionPrintIntent,
  print: (intent: ProductionPrintIntent) => Promise<boolean>,
): Promise<{ intent: ProductionPrintIntent; status: 'PRINTED' | 'PENDING' | 'OUTCOME_UNKNOWN'; error?: string }> => {
  await savePrintIntent(intent);
  const result = await runProductionPrintAttempt(intent, print, savePrintIntent);
  if (result.status === 'PRINTED') {
    await removePrintIntent(intent.id);
  }
  return result;
};

export const retryPendingProductionPrints = async (
  print: (intent: ProductionPrintIntent) => Promise<boolean>,
) => {
  if (printRetryInFlight) return [];
  printRetryInFlight = true;
  try {
    const queue = await mutateProductionQueues(readPrintQueue);
    const results = [];
    for (const intent of queue.filter(isProductionPrintAutoRetryEligible)) {
      results.push(await dispatchProductionPrint(intent, print));
    }
    return results;
  } finally {
    printRetryInFlight = false;
  }
};

let printRetryInFlight = false;

export const buildProductionDispatchItems = (items: CartItem[], areaId: string) =>
  items.map((item, index) => ({
    id: getProductionCartIdentity(item) || `${item.id}-${index}`,
    producto_id: item.id,
    productId: item.id,
    sku: (item as any).sku || (item as any).code || '',
    name: item.name,
    nombre: item.name,
    quantity: Number(item.quantity || 0),
    cantidad: Number(item.quantity || 0),
    modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
    modificadores: Array.isArray(item.modifiers) ? item.modifiers : [],
    note: item.note || '',
    production_area_id: areaId,
    estado_cocina: 'PENDIENTE',
    variantInfo: item.variantInfo || '',
  }));
