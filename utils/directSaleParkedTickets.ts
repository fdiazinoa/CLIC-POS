import type { ParkedTicket } from '../types';

const hasIdentifier = (value: unknown): boolean =>
  value !== null && value !== undefined && String(value).trim() !== '';

/** Table accounts stay in Mesas; only standalone sales belong in Recuperar. */
export const isDirectSaleParkedTicket = (ticket: ParkedTicket): boolean => {
  if (
    hasIdentifier(ticket.tableId)
    || hasIdentifier(ticket.primaryTableId)
    || (ticket.joinedTableIds || []).some(hasIdentifier)
    || hasIdentifier(ticket.barTabId)
    || hasIdentifier(ticket.barTabName)
    || hasIdentifier(ticket.tableDisplayLabel)
    || hasIdentifier(ticket.tableRoomLabel)
  ) return false;

  // Old table tickets may predate the explicit tableId field.
  if (/^TABLE-/i.test(ticket.id) || /^Mesa\s*:/i.test(ticket.name)) return false;
  return true;
};
