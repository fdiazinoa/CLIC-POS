import type { ParkedTicket } from '../types';

const EMPTY_TOTAL_EPSILON = 0.005;

export interface ParkedTicketIntegrityResult {
  tickets: ParkedTicket[];
  removedTicketIds: string[];
}

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
