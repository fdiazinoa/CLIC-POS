import type { ParkedTicket, PaymentFractionPart } from '../types';
import { isPaymentFractionPlanCurrent } from './paymentFractions';

export interface TableAccountDisplayEntry {
  key: string;
  ticket: ParkedTicket;
  accountLabel: string;
  displayLabel: string;
  amount: number;
  status: PaymentFractionPart['status'];
  fractionIndex?: number;
  fractionCount?: number;
}

const ticketTotal = (ticket: ParkedTicket): number => Number(
  ticket.total
  ?? (ticket.items || []).reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0,
  ),
);

export const getTableAccountLabel = (ticket: ParkedTicket, index: number): string => (
  String(ticket.barTabName || ticket.alias || ticket.name || '').trim()
  || `Cuenta ${index + 1}`
);

export const buildTableAccountDisplayEntries = (
  tickets: ParkedTicket[],
): TableAccountDisplayEntry[] => tickets.flatMap((ticket, ticketIndex): TableAccountDisplayEntry[] => {
  const accountLabel = getTableAccountLabel(ticket, ticketIndex);
  const total = ticketTotal(ticket);
  const plan = ticket.paymentFraction;

  if (plan && isPaymentFractionPlanCurrent(plan, total) && plan.parts.length > 1) {
    return plan.parts.map((part) => ({
      key: `${ticket.id}-fraction-${part.index}`,
      ticket,
      accountLabel,
      displayLabel: `${accountLabel} · Cuota ${part.index} de ${plan.count}`,
      amount: Number(part.amount || 0),
      status: part.status,
      fractionIndex: part.index,
      fractionCount: plan.count,
    }));
  }

  return [{
    key: String(ticket.id),
    ticket,
    accountLabel,
    displayLabel: accountLabel,
    amount: total,
    status: 'PENDING' as const,
  }];
});

export const summarizeOpenTableAccounts = (entries: TableAccountDisplayEntry[]) => {
  const openEntries = entries.filter(entry => entry.status === 'PENDING');
  return {
    count: openEntries.length,
    total: openEntries.reduce((sum, entry) => sum + entry.amount, 0),
  };
};

export const renameTableAccountTicket = (
  ticket: ParkedTicket,
  tableLabel: string,
  requestedName: string,
): ParkedTicket => {
  const accountName = requestedName.trim();
  if (!accountName) return ticket;

  return {
    ...ticket,
    name: `${tableLabel} - ${accountName}`,
    alias: accountName,
    barTabName: ticket.barTabName ? accountName : ticket.barTabName,
  };
};
