import type { ParkedTicket } from '../types';

export const parkedTicketBelongsToTable = (
  ticket: Pick<ParkedTicket, 'tableId' | 'primaryTableId' | 'joinedTableIds'>,
  tableId: string | number,
): boolean => {
  const expectedTableId = String(tableId ?? '').trim();
  if (!expectedTableId) return false;
  return String(ticket.tableId ?? '').trim() === expectedTableId
    || String(ticket.primaryTableId ?? '').trim() === expectedTableId
    || (Array.isArray(ticket.joinedTableIds)
      && ticket.joinedTableIds.some(joinedTableId => String(joinedTableId).trim() === expectedTableId));
};
