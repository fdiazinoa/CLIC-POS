import { ParkedTicket } from '../types';
import { parkedTicketBelongsToTable } from './parkedTicketTableMembership';

export const getTableSellerId = (tickets: ParkedTicket[], tableId: string): string | undefined =>
  tickets.find(ticket => parkedTicketBelongsToTable(ticket, tableId) && ticket.tableSellerId)?.tableSellerId;

export const hasPaidTableFraction = (tickets: ParkedTicket[], tableId: string): boolean =>
  tickets.some(ticket => parkedTicketBelongsToTable(ticket, tableId)
    && ticket.paymentFraction?.parts.some(part => part.status === 'PAID'));

export const assignTableSeller = (tickets: ParkedTicket[], tableId: string, sellerId: string): ParkedTicket[] =>
  tickets.map(ticket => parkedTicketBelongsToTable(ticket, tableId)
    ? {
        ...ticket,
        tableSellerId: sellerId,
        items: ticket.items.map(item => ({ ...item, salespersonId: sellerId })),
      }
    : ticket);
