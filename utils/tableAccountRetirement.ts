import type { ParkedTicket } from '../types';
import { assertParkedTicketsAcknowledged } from './parkedTicketAck';
import { reconcileRejectedTableTickets } from './tableAccountReconciliation';
import { parkedTicketBelongsToTable } from './parkedTicketTableMembership';

export const findRetiredTableAccountSuccessor = (
  tickets: ParkedTicket[], tableId: string, retiredId: string,
): ParkedTicket | undefined => tickets.find(ticket =>
  parkedTicketBelongsToTable(ticket, tableId)
  && ticket.items?.some(item => item.transferredFromTicketId === retiredId)
);

/** A retired source is published only after a complete Master ACK and durable local save. */
export const commitRetiredTableAccountAfterAck = async (input: {
  expected: ParkedTicket[];
  acknowledged: unknown;
  tableId: string;
  sourceId: string;
  current?: () => ParkedTicket[];
  assertCurrent?: () => void;
  persist: (tickets: ParkedTicket[]) => Promise<void>;
  publish: (tickets: ParkedTicket[]) => void;
}): Promise<ParkedTicket[]> => {
  if (!input.sourceId || input.expected.some(ticket => String(ticket.id) === input.sourceId)) {
    throw new Error('TABLE_ACCOUNT_RETIRE_SOURCE_STILL_PRESENT');
  }
  if (Array.isArray(input.acknowledged) && input.acknowledged.some(ticket => String(ticket?.id) === input.sourceId)) {
    throw new Error('PARKED_TICKETS_ACK_MISMATCH');
  }
  assertParkedTicketsAcknowledged(input.expected, input.acknowledged, '', input.tableId);
  const confirmed = input.acknowledged as ParkedTicket[];
  let observed = input.current?.();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    input.assertCurrent?.();
    const applied = observed
      ? reconcileRejectedTableTickets(observed, confirmed, input.tableId)
      : confirmed;
    await input.persist(applied);
    // An unrelated edit may have published while SQLite was saving. Rebase
    // and persist again instead of replacing its newer UI snapshot.
    input.assertCurrent?.();
    const latest = input.current?.();
    if (latest === observed) {
      input.publish(applied);
      return applied;
    }
    observed = latest;
  }
  throw new Error('TABLE_ACCOUNT_RETIRE_CONCURRENT_CHANGES');
};
