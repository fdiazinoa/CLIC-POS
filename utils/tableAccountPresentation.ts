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
  editName: string;
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
    return plan.parts.map((part) => {
      const fractionName = String(part.name || '').trim();
      const effectiveName = fractionName || accountLabel;
      return {
        key: `${ticket.id}-fraction-${part.index}`,
        ticket,
        accountLabel: effectiveName,
        displayLabel: `${effectiveName} · Cuota ${part.index} de ${plan.count}`,
        amount: Number(part.amount || 0),
        status: part.status,
        fractionIndex: part.index,
        fractionCount: plan.count,
        editName: fractionName || accountLabel,
      };
    });
  }

  return [{
    key: String(ticket.id),
    ticket,
    accountLabel,
    displayLabel: accountLabel,
    amount: total,
    status: 'PENDING' as const,
    editName: accountLabel,
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
  fractionIndex?: number,
): ParkedTicket => {
  const accountName = requestedName.trim();
  if (!accountName) return ticket;

  if (fractionIndex && ticket.paymentFraction) {
    const partExists = ticket.paymentFraction.parts.some(part => part.index === fractionIndex);
    if (!partExists) return ticket;
    return {
      ...ticket,
      paymentFraction: {
        ...ticket.paymentFraction,
        parts: ticket.paymentFraction.parts.map(part => (
          part.index === fractionIndex ? { ...part, name: accountName } : part
        )),
      },
    };
  }

  return {
    ...ticket,
    name: `${tableLabel} - ${accountName}`,
    alias: accountName,
    barTabName: ticket.barTabName ? accountName : ticket.barTabName,
  };
};
