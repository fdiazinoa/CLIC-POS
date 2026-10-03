import type { ParkedTicket, Transaction } from '../types';

const EMPTY_TOTAL_EPSILON = 0.005;

export interface ParkedTicketIntegrityResult {
  tickets: ParkedTicket[];
  removedTicketIds: string[];
}

const CLOSED_RESTAURANT_ORDERS_KEY = 'clic_closed_restaurant_orders_v1';
const MAX_CLOSED_RESTAURANT_ORDERS = 500;

export interface ClosedRestaurantOrderMarker {
  orderId: string;
  tableId?: string;
  transactionId?: string;
  closedAt: string;
}

export const readClosedRestaurantOrderMarkers = (): ClosedRestaurantOrderMarker[] => {
  try {
    if (typeof localStorage === 'undefined') return [];
    const parsed = JSON.parse(localStorage.getItem(CLOSED_RESTAURANT_ORDERS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(marker => marker && typeof marker.orderId === 'string' && marker.orderId.trim());
  } catch {
    return [];
  }
};

/**
 * Records the paid order before its table cleanup starts. The marker is kept
 * after a successful cleanup so a delayed autosave/native snapshot can never
 * resurrect the already charged account.
 */
export const rememberClosedRestaurantOrder = (
  marker: Omit<ClosedRestaurantOrderMarker, 'closedAt'> & { closedAt?: string },
): void => {
  const orderId = String(marker.orderId || '').trim();
  if (!orderId) return;
  try {
    if (typeof localStorage === 'undefined') return;
    const previous = readClosedRestaurantOrderMarkers().filter(item => item.orderId !== orderId);
    previous.push({
      orderId,
      tableId: marker.tableId ? String(marker.tableId) : undefined,
      transactionId: marker.transactionId ? String(marker.transactionId) : undefined,
      closedAt: marker.closedAt || new Date().toISOString(),
    });
    localStorage.setItem(
      CLOSED_RESTAURANT_ORDERS_KEY,
      JSON.stringify(previous.slice(-MAX_CLOSED_RESTAURANT_ORDERS)),
    );
  } catch {
    // The transaction itself also carries the order id for startup recovery.
  }
};

export const collectClosedRestaurantOrderIds = (
  transactions: Transaction[] = [],
): Set<string> => new Set(
  transactions
    .filter(transaction => transaction.documentType !== 'REFUND')
    .map(transaction => String(transaction.restaurantOrderId || '').trim())
    .filter(Boolean),
);

export const removeClosedRestaurantTickets = (
  tickets: ParkedTicket[] = [],
  closedOrderIds: ReadonlySet<string>,
): ParkedTicketIntegrityResult => {
  const removedTicketIds: string[] = [];
  const repairedTickets = (Array.isArray(tickets) ? tickets : []).filter(ticket => {
    const ticketId = String(ticket?.id || '').trim();
    const barTabId = String(ticket?.barTabId || '').trim();
    const isClosed = (ticketId && closedOrderIds.has(ticketId))
      || (barTabId && closedOrderIds.has(barTabId));
    if (isClosed) removedTicketIds.push(ticketId || barTabId);
    return !isClosed;
  });
  return { tickets: repairedTickets, removedTicketIds };
};

/**
 * Removes the invalid snapshot produced by older POS builds when the last line
 * of a table account was deleted but its previous monetary total remained.
 * A newly-created empty account (`items=[]`, `total=0`) is valid and preserved.
 */
export const removeStaleChargedEmptyTickets = (
  tickets: ParkedTicket[] = [],
): ParkedTicketIntegrityResult => {
  const removedTicketIds: string[] = [];
  const repairedTickets = (Array.isArray(tickets) ? tickets : []).filter((ticket) => {
    const items = Array.isArray(ticket?.items) ? ticket.items : [];
    const persistedTotal = Number(ticket?.total || 0);
    const isStaleChargedEmptyTicket = items.length === 0
      && Number.isFinite(persistedTotal)
      && Math.abs(persistedTotal) >= EMPTY_TOTAL_EPSILON;

    if (isStaleChargedEmptyTicket) {
      removedTicketIds.push(String(ticket.id || ''));
      return false;
    }
    return true;
  });

  return { tickets: repairedTickets, removedTicketIds };
};
