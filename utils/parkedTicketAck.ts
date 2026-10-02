type TicketForAck = {
  id?: string;
  tableId?: string | number;
  primaryTableId?: string | number;
  joinedTableIds?: Array<string | number>;
  items?: unknown[];
  total?: number;
};

const belongsToTable = (ticket: TicketForAck, tableId: string): boolean =>
  String(ticket.tableId || '') === tableId || String(ticket.primaryTableId || '') === tableId ||
  (Array.isArray(ticket.joinedTableIds) && ticket.joinedTableIds.some(id => String(id) === tableId));

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
};

const stableWireValue = (value: unknown): unknown =>
  stableValue(JSON.parse(JSON.stringify(value)));

export const assertParkedTicketsAcknowledged = (
  submitted: TicketForAck[],
  acknowledged: unknown,
  changedTicketId = '',
  tableId = '',
): void => {
  if (!Array.isArray(acknowledged)) throw new Error('PARKED_TICKETS_ACK_REQUIRED');
  const expected = tableId ? submitted.filter(ticket => belongsToTable(ticket, tableId)) : submitted;
  const actual = tableId
    ? (acknowledged as TicketForAck[]).filter(ticket => belongsToTable(ticket, tableId))
    : acknowledged as TicketForAck[];
  const actualById = new Map(actual.map(ticket => [String(ticket.id || ''), ticket]));
  if (actual.length !== expected.length || actualById.size !== expected.length) {
    throw new Error('PARKED_TICKETS_ACK_MISMATCH');
  }
  for (const ticket of expected) {
    const confirmed = actualById.get(String(ticket.id || ''));
    if (!confirmed || JSON.stringify(stableWireValue(confirmed)) !== JSON.stringify(stableWireValue(ticket))) {
      throw new Error('PARKED_TICKETS_ACK_MISMATCH');
    }
  }
  if (changedTicketId && !expected.some(ticket => ticket.id === changedTicketId) &&
      (acknowledged as TicketForAck[]).some(ticket => ticket.id === changedTicketId)) {
    throw new Error('PARKED_TICKETS_ACK_MISMATCH');
  }
};
