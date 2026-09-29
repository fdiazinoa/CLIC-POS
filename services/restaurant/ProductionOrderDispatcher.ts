import type { CartItem } from '../../types';
import { db } from '../../utils/db';
import {
  dispatchLegacyLanMutation,
  persistLegacyLanMutationCompletion,
  validateLegacySuccessResponse,
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
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
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
  status: 'PENDING';
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
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
});

const saveIntent = async (intent: ProductionDispatchIntent): Promise<void> => {
  const queue = await readQueue();
  const existing = queue.find((entry) => entry.id === intent.id);
  const next = existing
    ? queue.map((entry) => entry.id === intent.id
      ? mergeProductionDispatchIntent(existing, intent)
      : entry)
    : [...queue, intent];
  await db.save(QUEUE_COLLECTION, next);
};

const removeIntent = async (intentId: string): Promise<void> => {
  const queue = await readQueue();
  await db.save(QUEUE_COLLECTION, queue.filter((entry) => entry.id !== intentId));
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

export const buildProductionDispatchRequests = (intent: ProductionDispatchIntent) => ([
  {
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
  {
    method: 'POST' as const,
    url: `${intent.kdsBaseUrl}/api/ordenes/enviar-comanda/${encodeURIComponent(intent.orderId)}`,
    operation: 'KDS_ORDER_DISPATCH',
    body: intent.payload,
  },
]);

const requestIntentJson = async (
  intent: ProductionDispatchIntent,
  method: 'POST' | 'PUT',
  url: string,
  body: unknown,
  operation: string,
) => dispatchLegacyLanMutation<any>({
  url,
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  timeoutMs: 5000,
  operation,
  correlationId: `${intent.id}:${operation}`,
  validateResponse: validateLegacySuccessResponse,
});

/**
 * Persists the deterministic dispatch intent before any LAN request. Payment is
 * deliberately outside this service, so a retry can only resend the kitchen
 * order and can never re-run a charge.
 */
export const dispatchProductionOrder = async (
  intent: ProductionDispatchIntent,
): Promise<ProductionDispatchResult> => {
  await saveIntent(intent);
  if (!intent.kdsBaseUrl) {
    return { intent, status: 'PENDING', error: 'KDS_HOST_NOT_CONFIGURED' };
  }

  try {
    const [updateRequest, dispatchRequest] = buildProductionDispatchRequests(intent);
    const updateReceipt = await requestIntentJson(intent, updateRequest.method, updateRequest.url, updateRequest.body, updateRequest.operation);
    const dispatchReceipt = await requestIntentJson(intent, dispatchRequest.method, dispatchRequest.url, dispatchRequest.body, dispatchRequest.operation);

    await removeIntent(intent.id);
    await updateReceipt.completeAfterDurableCommit(`KDS:update:${intent.id}`, () =>
      persistLegacyLanMutationCompletion(updateReceipt.correlationId, `KDS:update:${intent.id}`, updateReceipt.response.status));
    await dispatchReceipt.completeAfterDurableCommit(`KDS:dispatch:${intent.id}`, () =>
      persistLegacyLanMutationCompletion(dispatchReceipt.correlationId, `KDS:dispatch:${intent.id}`, dispatchReceipt.response.status));
    return { intent, status: 'SENT' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'KDS_UNREACHABLE';
    const pending: ProductionDispatchIntent = {
      ...intent,
      status: 'PENDING',
      attempts: intent.attempts + 1,
      lastError: message,
      updatedAt: new Date().toISOString(),
    };
    await saveIntent(pending);
    return { intent: pending, status: 'PENDING', error: message };
  }
};

export const retryPendingProductionOrders = async (): Promise<ProductionDispatchResult[]> => {
  if (retryInFlight) return [];
  retryInFlight = true;
  try {
    const queue = await readQueue();
    const results: ProductionDispatchResult[] = [];
    for (const intent of queue) {
      results.push(await dispatchProductionOrder(intent));
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
};

const removePrintIntent = async (intentId: string): Promise<void> => {
  const queue = await readPrintQueue();
  await db.save(PRINT_QUEUE_COLLECTION, queue.filter((entry) => entry.id !== intentId));
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

export const dispatchProductionPrint = async (
  intent: ProductionPrintIntent,
  print: (intent: ProductionPrintIntent) => Promise<boolean>,
): Promise<{ intent: ProductionPrintIntent; status: 'PRINTED' | 'PENDING'; error?: string }> => {
  await savePrintIntent(intent);
  try {
    if (!await print(intent)) throw new Error('PRODUCTION_PRINTER_NOT_CONFIRMED');
    await removePrintIntent(intent.id);
    return { intent, status: 'PRINTED' };
  } catch (error) {
    const pending = {
      ...intent,
      attempts: Number(intent.attempts || 0) + 1,
      updatedAt: new Date().toISOString(),
      lastError: error instanceof Error ? error.message : 'PRODUCTION_PRINT_FAILED',
    };
    await savePrintIntent(pending);
    return { intent: pending, status: 'PENDING', error: pending.lastError };
  }
};

export const retryPendingProductionPrints = async (
  print: (intent: ProductionPrintIntent) => Promise<boolean>,
) => {
  const queue = await readPrintQueue();
  const results = [];
  for (const intent of queue) results.push(await dispatchProductionPrint(intent, print));
  return results;
};

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
