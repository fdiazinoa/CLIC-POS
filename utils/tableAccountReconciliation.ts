import type { ParkedTicket } from '../types';
import { parkedTicketBelongsToTable } from './parkedTicketTableMembership';

/** Replace only the rejected table's scope; never restore an old whole-store render. */
export const reconcileRejectedTableTickets = (
  currentTickets: ParkedTicket[],
  authoritativeTickets: ParkedTicket[],
  tableId: string,
): ParkedTicket[] => [
  ...currentTickets.filter(ticket => !parkedTicketBelongsToTable(ticket, tableId)),
  ...authoritativeTickets.filter(ticket => parkedTicketBelongsToTable(ticket, tableId)),
];
