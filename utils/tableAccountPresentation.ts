import type { ParkedTicket, PaymentFractionPart } from '../types';
import { isFullyPaidParkedTicket, isPaymentFractionPlanCurrent } from './paymentFractions';

export const getTableOpenElapsedLabel = (
  tableOpenedAt: string | undefined,
  ticketOpenedAt: Array<string | undefined>,
  now: number,
): string => {
  const validTime = (value: string | undefined): number | null => {
    const parsed = typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  };
  const tableTime = validTime(tableOpenedAt);
  const ticketTimes = ticketOpenedAt.map(validTime).filter((time): time is number => time !== null);
  const openedAt = tableTime ?? (ticketTimes.length ? Math.min(...ticketTimes) : null);
  if (openedAt === null || !Number.isFinite(now)) return 'Tiempo no disponible';
  const elapsed = Math.max(0, Math.floor((now - openedAt) / 60_000));
  return `Abierta ${Math.floor(elapsed / 60)}h ${String(elapsed % 60).padStart(2, '0')}m`;
};

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

export const getTableAccountLabel = (ticket: ParkedTicket, index: number): string => {
  const explicit = String(ticket.alias || ticket.barTabName || '').trim();
  if (explicit) return explicit;
  const name = String(ticket.name || '').trim();
  const generatedTail = name.match(/(?:^| - )Cuenta\s+(\d+)(?:\/\d+)?$/i);
  const tablePrefix = String(ticket.tableDisplayLabel || '').trim();
  if (generatedTail && (
    generatedTail[0].trim() === name
    || (tablePrefix && name.startsWith(`${tablePrefix} - `))
    || /^(?:Mesa|Table)\s+[^-]+ - /i.test(name)
  )) return `Cuenta ${generatedTail[1]}`;
  return name || `Cuenta ${index + 1}`;
};

export const buildTableAccountDisplayEntries = (
  tickets: ParkedTicket[],
): TableAccountDisplayEntry[] => tickets.flatMap((ticket, ticketIndex): TableAccountDisplayEntry[] => {
  if (isFullyPaidParkedTicket(ticket)) return [];
  const accountLabel = getTableAccountLabel(ticket, ticketIndex);
  const total = ticketTotal(ticket);
  const plan = ticket.paymentFraction;

  if (plan && isPaymentFractionPlanCurrent(plan, total) && plan.parts.length > 1) {
    return plan.parts.filter(part => part.status === 'PENDING').map((part) => {
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
